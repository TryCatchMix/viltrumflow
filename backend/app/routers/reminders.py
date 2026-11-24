from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import schemas
from ..config import settings
from ..database import get_db
from ..deps import get_current_user
from ..models import User
from ..services import notify

router = APIRouter()


@router.get("/status", response_model=schemas.NotificationStatus)
def status(_: User = Depends(get_current_user)):
    return schemas.NotificationStatus(email_configured=settings.email_configured)


@router.post("/poll", response_model=List[schemas.ReminderOut])
def poll(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Avisos que toca mostrar ahora en la app abierta. Cada uno se entrega una sola vez (aquí o por push)."""
    notices = notify.gather(db, user, datetime.now(timezone.utc))
    db.commit()
    return [schemas.ReminderOut(**n) for n in notices]


@router.get("/morning")
def morning(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Vista previa del resumen de la mañana de hoy (lo mismo que llegará en el aviso)."""
    from .habits import local_today
    return notify.morning_summary(db, user, local_today(user))
