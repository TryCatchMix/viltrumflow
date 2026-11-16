from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import schemas
from ..config import settings
from ..database import get_db
from ..deps import get_current_user
from ..models import User
from ..services import reminders

router = APIRouter()


@router.get("/status", response_model=schemas.NotificationStatus)
def status(_: User = Depends(get_current_user)):
    return schemas.NotificationStatus(email_configured=settings.email_configured)


@router.post("/poll", response_model=List[schemas.ReminderOut])
def poll(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Recordatorios que toca mostrar ahora en el navegador. Cada uno se entrega una sola vez."""
    now = datetime.now(timezone.utc)
    tasks = reminders.due_reminders(db, user, now, "browser")
    out = [schemas.ReminderOut(task_id=t.id, title=t.title, due_date=t.due_date, all_day=t.all_day) for t in tasks]
    for t in tasks:
        t.reminder_sent_at = now
    db.commit()
    return out
