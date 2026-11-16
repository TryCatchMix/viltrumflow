import base64
import hashlib
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
import jwt
from cryptography.fernet import Fernet, InvalidToken
from fastapi import HTTPException, status

from .config import settings


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), hashed.encode())
    except ValueError:
        return False


def create_token(user_id: int, token_type: str, expires: timedelta, **extra) -> str:
    payload = {"sub": str(user_id), "type": token_type, "exp": datetime.now(timezone.utc) + expires, **extra}
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def password_version(hashed_password: str) -> str:
    """
    Huella de la contraseña actual que viaja en los tokens (claim `pv`). Al cambiar la contraseña la
    huella cambia y todos los tokens anteriores dejan de valer: cierra las demás sesiones y hace que
    un enlace de restablecimiento solo sirva una vez.
    """
    return hashlib.sha256(f"{settings.SECRET_KEY}:{hashed_password}".encode()).hexdigest()[:16]


def create_token_pair(user_id: int, hashed_password: str) -> dict:
    pv = password_version(hashed_password)
    return {
        "access_token": create_token(user_id, "access", timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES), pv=pv),
        "refresh_token": create_token(user_id, "refresh", timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS), pv=pv),
        "token_type": "bearer",
    }


def decode_token(token: str, expected_type: str) -> int:
    """Devuelve el id de usuario o lanza 401. Comprueba el tipo para que un refresh no sirva como access."""
    return int(decode_payload(token, expected_type)["sub"])


def decode_payload(token: str, expected_type: str) -> dict:
    """Carga útil validada (firma, caducidad, tipo y `sub` numérico) o 401."""
    error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Credenciales no válidas",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except jwt.PyJWTError:
        raise error
    if payload.get("type") != expected_type:
        raise error
    try:
        int(payload["sub"])
    except (KeyError, ValueError):
        raise error
    return payload


def user_from_token(db, token: str, expected_type: str):
    """Usuario activo dueño del token, comprobando que no se emitió antes del último cambio de contraseña."""
    from .models import User

    payload = decode_payload(token, expected_type)
    user = db.get(User, int(payload["sub"]))
    if user is None or not user.is_active or payload.get("pv") != password_version(user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Credenciales no válidas",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


# --- Cifrado de tokens de terceros (Google) en reposo ---

def _fernet() -> Fernet:
    key = base64.urlsafe_b64encode(hashlib.sha256(settings.SECRET_KEY.encode()).digest())
    return Fernet(key)


def encrypt(value: str) -> str:
    return _fernet().encrypt(value.encode()).decode()


def decrypt(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    try:
        return _fernet().decrypt(value.encode()).decode()
    except InvalidToken:
        return None
