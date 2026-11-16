from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy.orm import Session

from ..models import Note, Task

RETENTION = timedelta(days=30)


def purge_expired(db: Session, now: Optional[datetime] = None, owner_id: Optional[int] = None) -> int:
    """Elimina definitivamente lo que lleva más de 30 días en la papelera."""
    cutoff = (now or datetime.now(timezone.utc)) - RETENTION
    n = 0
    tasks = db.query(Task).filter(Task.deleted_at.isnot(None), Task.deleted_at < cutoff, Task.parent_task_id.is_(None))
    notes = db.query(Note).filter(Note.deleted_at.isnot(None), Note.deleted_at < cutoff)
    if owner_id is not None:
        tasks, notes = tasks.filter(Task.user_id == owner_id), notes.filter(Note.owner_id == owner_id)
    for obj in [*tasks.all(), *notes.all()]:
        db.delete(obj)
        n += 1
    db.commit()
    return n
