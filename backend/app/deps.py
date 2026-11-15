from fastapi import Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from .config import settings
from .database import get_db
from .models import User
from .security import decode_token

oauth2_scheme = OAuth2PasswordBearer(tokenUrl=f"{settings.API_V1_STR}/auth/login")


def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
    user = db.get(User, decode_token(token, "access"))
    if user is None or not user.is_active:
        raise HTTPException(status_code=401, detail="Credenciales no válidas")
    return user
