from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from .. import schemas
from ..database import get_db
from ..deps import get_current_user
from ..models import Note, User
from ..config import settings
from ..security import (
    create_token, create_token_pair, decode_payload, hash_password, password_version, user_from_token, verify_password,
)
from ..services import mailer, ratelimit
from ..services.notes import resolve_dangling, sync_note_index

router = APIRouter()


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "desconocida"

WELCOME = """# Bienvenido a ViltrumFlow

Este es tu **vault**: notas en Markdown enlazadas entre sí.

## Lo básico
- Escribe `[[` para enlazar otra nota, por ejemplo [[Ideas]]. Si no existe, se crea al hacer clic.
- Clasifica con etiquetas: esta nota tiene #inicio.
- Las casillas aparecen también en **Tareas → Casillas de notas**:
  - [ ] Crear mi primera nota
  - [ ] Abrir la vista de grafo
  - [ ] Conectar Google Calendar desde Calendario

## Atajos
| Atajo | Acción |
| --- | --- |
| `Ctrl/⌘ + K` | Buscador rápido y comandos |
| `Ctrl/⌘ + S` | Guardar la nota (también se guarda sola) |
"""


@router.post("/register", response_model=schemas.UserOut, status_code=201)
def register(data: schemas.UserCreate, db: Session = Depends(get_db)):
    exists = db.query(User).filter(
        or_(func.lower(User.email) == data.email.lower(), func.lower(User.username) == data.username.lower())
    ).first()
    if exists:
        raise HTTPException(409, "El email o el nombre de usuario ya están registrados")
    user = User(
        email=data.email.lower(), username=data.username, full_name=data.full_name,
        hashed_password=hash_password(data.password),
    )
    db.add(user)
    db.flush()
    add_starter_notes(db, user)
    db.commit()
    db.refresh(user)
    return user


def add_starter_notes(db: Session, user: User) -> None:
    for title, content in (("Bienvenido", WELCOME), ("Ideas", "# Ideas\n\nApunta aquí lo que se te ocurra. Vuelve a [[Bienvenido]].\n")):
        note = Note(title=title, content=content, owner_id=user.id)
        db.add(note)
        db.flush()
        sync_note_index(db, note)
        resolve_dangling(db, note)


@router.get("/providers", response_model=schemas.AuthProviders)
def providers():
    """Métodos de acceso disponibles en este servidor (la pantalla de entrada solo muestra los activos)."""
    return {"google": settings.google_login_configured}


@router.post("/login", response_model=schemas.Token)
def login(request: Request, form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    ident = form.username.strip().lower()
    # Frena la fuerza bruta: por IP+usuario (adivinar una contraseña) y por IP (probar muchos usuarios)
    window = settings.LOGIN_WINDOW_MINUTES * 60
    ip = _client_ip(request)
    keys = [(f"login:{ip}:{ident}", settings.LOGIN_MAX_ATTEMPTS), (f"login:{ip}", settings.LOGIN_MAX_ATTEMPTS * 6)]
    for key, limit in keys:
        ratelimit.check(key, limit, window)
    user = db.query(User).filter(
        or_(func.lower(User.username) == ident, func.lower(User.email) == ident)
    ).first()
    if not user or not verify_password(form.password, user.hashed_password) or not user.is_active:
        for key, _ in keys:
            ratelimit.hit(key)
        raise HTTPException(401, "Usuario o contraseña incorrectos", headers={"WWW-Authenticate": "Bearer"})
    ratelimit.clear(keys[0][0])
    user.last_login = datetime.now(timezone.utc)
    db.commit()
    return create_token_pair(user.id, user.hashed_password)


@router.post("/refresh", response_model=schemas.Token)
def refresh(data: schemas.RefreshRequest, db: Session = Depends(get_db)):
    user = user_from_token(db, data.refresh_token, "refresh")
    return create_token_pair(user.id, user.hashed_password)


@router.get("/me", response_model=schemas.UserOut)
def me(user: User = Depends(get_current_user)):
    return user


@router.put("/me", response_model=schemas.UserOut)
def update_me(data: schemas.UserUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    values = data.model_dump(exclude_unset=True)
    email = values.get("email")
    if email and email.lower() != user.email:
        if db.query(User).filter(func.lower(User.email) == email.lower(), User.id != user.id).first():
            raise HTTPException(409, "Ese email ya está en uso")
        values["email"] = email.lower()
    for k, v in values.items():
        if v is None and k not in ("full_name", "bio", "avatar_url"):
            continue
        setattr(user, k, v)
    db.commit()
    db.refresh(user)
    return user


@router.post("/change-password", response_model=schemas.Token)
def change_password(data: schemas.PasswordChange, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Cambia la contraseña. Las demás sesiones se cierran; esta recibe tokens nuevos para continuar."""
    # Quien se registró con Google aún no tiene contraseña: la elige sin escribir la actual
    if user.password_set and not verify_password(data.current_password or "", user.hashed_password):
        raise HTTPException(400, "La contraseña actual no es correcta")
    user.hashed_password = hash_password(data.new_password)
    user.password_set = True
    db.commit()
    return create_token_pair(user.id, user.hashed_password)


FORGOT_MESSAGE = "Si existe una cuenta con ese email, te hemos enviado un enlace para restablecer la contraseña."


@router.post("/forgot-password", response_model=schemas.Message)
def forgot_password(data: schemas.ForgotPassword, request: Request, db: Session = Depends(get_db)):
    """Envía un enlace de restablecimiento. La respuesta es la misma exista o no la cuenta."""
    if not settings.email_configured:
        raise HTTPException(503, "Este servidor no tiene configurado el envío de correos; pide a quien lo administra que restablezca tu contraseña")
    email = data.email.lower()
    for key, limit in ((f"forgot:{_client_ip(request)}", 10), (f"forgot:{email}", 3)):
        ratelimit.check(key, limit, 3600)
        ratelimit.hit(key)
    user = db.query(User).filter(func.lower(User.email) == email, User.is_active.is_(True)).first()
    if user:
        token = create_token(user.id, "reset", timedelta(minutes=settings.PASSWORD_RESET_MINUTES),
                             pv=password_version(user.hashed_password))
        link = f"{settings.FRONTEND_URL.rstrip('/')}/reset-password?token={token}"
        text = (f"Hola {user.full_name or user.username}:\n\nPara elegir una contraseña nueva abre este enlace "
                f"(caduca en {settings.PASSWORD_RESET_MINUTES} minutos y solo sirve una vez):\n\n{link}\n\n"
                "Si no lo has pedido tú, ignora este mensaje: tu contraseña no cambia.")
        html = (f'<div style="font-family:system-ui,sans-serif;max-width:520px;color:#1c1b1f"><h2 style="font-size:18px">Restablecer contraseña</h2>'
                f'<p>Para elegir una contraseña nueva pulsa el botón. El enlace caduca en {settings.PASSWORD_RESET_MINUTES} minutos y solo sirve una vez.</p>'
                f'<p><a href="{link}" style="display:inline-block;background:#6a4ae0;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Elegir contraseña nueva</a></p>'
                '<p style="color:#74737c;font-size:13px">Si no lo has pedido tú, ignora este mensaje: tu contraseña no cambia.</p></div>')
        mailer.send_email(user.email, "Restablece tu contraseña de ViltrumFlow", text, html)
    return {"message": FORGOT_MESSAGE}


@router.post("/reset-password", response_model=schemas.Message)
def reset_password(data: schemas.ResetPassword, db: Session = Depends(get_db)):
    invalid = HTTPException(400, "El enlace no es válido o ha caducado. Solicita uno nuevo.")
    try:
        payload = decode_payload(data.token, "reset")
    except HTTPException:
        raise invalid
    user = db.get(User, int(payload["sub"]))
    # `pv` liga el enlace a la contraseña vigente cuando se pidió: tras usarlo (o cambiarla) deja de valer
    if not user or not user.is_active or payload.get("pv") != password_version(user.hashed_password):
        raise invalid
    user.hashed_password = hash_password(data.new_password)
    user.password_set = True
    db.commit()
    return {"message": "Contraseña actualizada. Ya puedes iniciar sesión."}


@router.delete("/me", status_code=204)
def delete_me(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db.delete(user)
    db.commit()
