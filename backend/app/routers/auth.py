from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from .. import schemas
from ..database import get_db
from ..deps import get_current_user
from ..models import Note, User
from ..security import create_token_pair, decode_token, hash_password, verify_password
from ..services.notes import sync_note_index

router = APIRouter()

WELCOME = """# Bienvenido a ViltrumFlow

Este es tu **vault**: notas en Markdown enlazadas entre sí.

## Lo básico
- Escribe `[[` para enlazar otra nota, por ejemplo [[Ideas]]. Si no existe, se crea al hacer clic.
- Usa #etiquetas para clasificar. Esta nota tiene #inicio.
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
    for title, content in (("Bienvenido", WELCOME), ("Ideas", "# Ideas\n\nApunta aquí lo que se te ocurra. Vuelve a [[Bienvenido]].\n")):
        note = Note(title=title, content=content, owner_id=user.id)
        db.add(note)
        db.flush()
        sync_note_index(db, note)
    db.commit()
    db.refresh(user)
    return user


@router.post("/login", response_model=schemas.Token)
def login(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    ident = form.username.strip().lower()
    user = db.query(User).filter(
        or_(func.lower(User.username) == ident, func.lower(User.email) == ident)
    ).first()
    if not user or not verify_password(form.password, user.hashed_password) or not user.is_active:
        raise HTTPException(401, "Usuario o contraseña incorrectos", headers={"WWW-Authenticate": "Bearer"})
    user.last_login = datetime.now(timezone.utc)
    db.commit()
    return create_token_pair(user.id)


@router.post("/refresh", response_model=schemas.Token)
def refresh(data: schemas.RefreshRequest, db: Session = Depends(get_db)):
    user = db.get(User, decode_token(data.refresh_token, "refresh"))
    if not user or not user.is_active:
        raise HTTPException(401, "Credenciales no válidas")
    return create_token_pair(user.id)


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
        if v is None and k in ("email", "theme", "language"):
            continue
        setattr(user, k, v)
    db.commit()
    db.refresh(user)
    return user


@router.post("/change-password", response_model=schemas.Message)
def change_password(data: schemas.PasswordChange, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not verify_password(data.current_password, user.hashed_password):
        raise HTTPException(400, "La contraseña actual no es correcta")
    user.hashed_password = hash_password(data.new_password)
    db.commit()
    return {"message": "Contraseña actualizada"}


@router.delete("/me", status_code=204)
def delete_me(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db.delete(user)
    db.commit()
