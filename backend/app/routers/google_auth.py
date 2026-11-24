"""
Inicio de sesión con Google.

Flujo: el navegador abre /start (GET para entrar, POST con un «ticket» para vincular una cuenta ya
abierta). /start guarda un nonce en una cookie y redirige a Google; Google vuelve a /callback, que
comprueba que el nonce de la cookie coincide con el del «state» firmado (así nadie puede colar su
cuenta de Google en el navegador de otro) y redirige a la SPA con un código de un solo uso en el
fragmento de la URL. La SPA lo canjea en /exchange por los tokens de sesión habituales.
"""
import re
import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Cookie, Depends, Form, HTTPException
from fastapi.responses import RedirectResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import schemas
from ..config import settings
from ..database import get_db
from ..deps import get_current_user
from ..models import User
from ..security import create_token, create_token_pair, decode_payload, hash_password, password_version, user_from_token
from ..services import google_login
from .auth import add_starter_notes

router = APIRouter()

COOKIE = "vf_google_nonce"
COOKIE_PATH = "/api/v1/auth/google"
STATE_MINUTES = 10
CODE_SECONDS = 120


def _frontend(path: str, **params) -> str:
    url = settings.FRONTEND_URL.rstrip("/") + path
    return url + ("?" + urlencode(params) if params else "")


def _require_configured():
    if not settings.google_login_configured:
        raise HTTPException(503, "El inicio de sesión con Google no está configurado en este servidor")


def _redirect_to_google(user_id: int, link: bool) -> RedirectResponse:
    nonce = secrets.token_urlsafe(24)
    state = create_token(user_id, "google_login", timedelta(minutes=STATE_MINUTES), nonce=nonce, link=link)
    response = RedirectResponse(google_login.build_url(state, nonce), status_code=302)
    response.set_cookie(
        COOKIE, nonce, max_age=STATE_MINUTES * 60, path=COOKIE_PATH, httponly=True, samesite="lax",
        secure=settings.google_login_redirect_uri.startswith("https://"),
    )
    return response


@router.get("/start", include_in_schema=False)
def start_login():
    """Entrar o registrarse con Google."""
    if not settings.google_login_configured:
        return RedirectResponse(_frontend("/login", google="unavailable"))
    return _redirect_to_google(0, link=False)


@router.post("/link-ticket")
def link_ticket(user: User = Depends(get_current_user)):
    """Vale de 2 minutos y un solo uso para que el navegador inicie la vinculación (no lleva cabecera Authorization)."""
    _require_configured()
    ticket = create_token(user.id, "google_link", timedelta(minutes=2), pv=password_version(user.hashed_password),
                          jti=secrets.token_urlsafe(12))
    return {"ticket": ticket}


@router.post("/start", include_in_schema=False)
def start_link(ticket: str = Form(...), db: Session = Depends(get_db)):
    """Vincular Google a la cuenta abierta. El vale va en el cuerpo (formulario), no en la URL."""
    if not settings.google_login_configured:
        return RedirectResponse(_frontend("/settings", google="unavailable"), status_code=303)
    try:
        user = user_from_token(db, ticket, "google_link")
        payload = decode_payload(ticket, "google_link")
    except HTTPException:
        return RedirectResponse(_frontend("/settings", google="expired"), status_code=303)
    if not google_login.consume_once(payload.get("jti", ""), 300):
        return RedirectResponse(_frontend("/settings", google="expired"), status_code=303)
    response = _redirect_to_google(user.id, link=True)
    response.status_code = 303
    return response


def _unique_username(db: Session, email: str) -> str:
    base = re.sub(r"[^A-Za-z0-9_.-]", "", email.split("@")[0])[:40]
    if len(base) < 3:
        base = "usuario"
    name, n = base, 1
    while db.query(User.id).filter(func.lower(User.username) == name.lower()).first():
        n += 1
        name = f"{base}{n}"
    return name


@router.get("/callback", include_in_schema=False)
def callback(
    state: str = "", code: str = "", error: str = "",
    nonce_cookie: str = Cookie("", alias=COOKIE), db: Session = Depends(get_db),
):
    try:
        payload = decode_payload(state, "google_login")
    except HTTPException:
        payload = None
    link = bool(payload and payload.get("link"))
    page = "/settings" if link else "/login"

    def done(url: str) -> RedirectResponse:
        response = RedirectResponse(url, status_code=302)
        response.delete_cookie(COOKIE, path=COOKIE_PATH)
        return response

    # El nonce de la cookie demuestra que este navegador es el que empezó el flujo
    nonce = payload.get("nonce", "") if payload else ""
    if not payload or not nonce_cookie or not secrets.compare_digest(nonce, nonce_cookie):
        return done(_frontend(page, google="expired"))
    if error or not code:
        return done(_frontend(page, google="denied"))
    if not settings.google_login_configured:
        return done(_frontend(page, google="unavailable"))
    try:
        claims = google_login.exchange(code, nonce)
    except (google_login.GoogleLoginError, httpx.HTTPError, ValueError):
        return done(_frontend(page, google="error"))

    sub = str(claims["sub"])
    owner = db.query(User).filter(User.google_sub == sub).first()

    if link:
        user = db.get(User, int(payload["sub"]))
        if not user or not user.is_active:
            return done(_frontend(page, google="error"))
        if owner and owner.id != user.id:
            return done(_frontend(page, google="taken"))
        user.google_sub = sub
        db.commit()
        return done(_frontend(page, google="linked"))

    user = owner
    if user is None:
        email = (claims.get("email") or "").lower()
        if not email or claims.get("email_verified") not in (True, "true"):
            return done(_frontend(page, google="unverified"))
        if db.query(User.id).filter(func.lower(User.email) == email).first():
            # No se vincula sola: alguien pudo registrar ese email sin ser su dueño. El titular entra con
            # su contraseña (o la restablece por email) y vincula Google desde Ajustes.
            return done(_frontend(page, google="exists"))
        name = (claims.get("name") or "").strip()[:100] or None
        picture = claims.get("picture") if str(claims.get("picture", "")).startswith("https://") else None
        user = User(
            email=email, username=_unique_username(db, email), full_name=name, avatar_url=picture,
            hashed_password=hash_password(secrets.token_urlsafe(32)), password_set=False, google_sub=sub,
        )
        db.add(user)
        db.flush()
        add_starter_notes(db, user)
    elif not user.is_active:
        return done(_frontend(page, google="error"))
    user.last_login = datetime.now(timezone.utc)
    db.commit()
    one_time = create_token(user.id, "google_code", timedelta(seconds=CODE_SECONDS),
                            pv=password_version(user.hashed_password), jti=secrets.token_urlsafe(12))
    # En el fragmento (#): el navegador no lo envía a ningún servidor ni queda en sus registros
    return done(_frontend(page) + "#" + urlencode({"google_code": one_time}))


@router.post("/exchange", response_model=schemas.Token)
def exchange(data: schemas.GoogleExchange, db: Session = Depends(get_db)):
    """Canjea el código de un solo uso de /callback por los tokens de sesión."""
    user = user_from_token(db, data.code, "google_code")
    if not google_login.consume_once(decode_payload(data.code, "google_code").get("jti", ""), CODE_SECONDS + 60):
        raise HTTPException(401, "Este enlace de acceso ya se ha usado; vuelve a entrar con Google")
    return create_token_pair(user.id, user.hashed_password)


@router.delete("/link", response_model=schemas.UserOut)
def unlink(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not user.password_set:
        raise HTTPException(400, "Elige antes una contraseña: sin ella no podrías volver a entrar")
    user.google_sub = None
    db.commit()
    db.refresh(user)
    return user
