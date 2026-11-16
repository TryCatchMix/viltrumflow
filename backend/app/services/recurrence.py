"""Tareas recurrentes: al completar una, se crea la siguiente ocurrencia."""
import calendar
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy.orm import Session

from ..models import Status, Task


def _add_months(dt: datetime, months: int) -> datetime:
    m = dt.month - 1 + months
    year, month = dt.year + m // 12, m % 12 + 1
    # El 31 de enero + 1 mes es el último día de febrero
    return dt.replace(year=year, month=month, day=min(dt.day, calendar.monthrange(year, month)[1]))


def _step(dt: datetime, rule: str) -> datetime:
    if rule == "daily":
        return dt + timedelta(days=1)
    if rule == "weekdays":
        dt += timedelta(days=1)
        while dt.weekday() >= 5:
            dt += timedelta(days=1)
        return dt
    if rule == "weekly":
        return dt + timedelta(days=7)
    if rule == "biweekly":
        return dt + timedelta(days=14)
    if rule == "monthly":
        return _add_months(dt, 1)
    if rule == "yearly":
        return _add_months(dt, 12)
    raise ValueError(rule)


def next_due(due: Optional[datetime], rule: str, now: Optional[datetime] = None) -> datetime:
    """Siguiente vencimiento. Si la tarea iba atrasada, salta las ocurrencias ya pasadas."""
    now = now or datetime.now(timezone.utc)
    if due is None:
        due = now.replace(hour=0, minute=0, second=0, microsecond=0)
    elif due.tzinfo is None:
        due = due.replace(tzinfo=timezone.utc)
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    nxt = _step(due, rule)
    for _ in range(1000):
        if nxt >= today:
            break
        nxt = _step(nxt, rule)
    return nxt


def spawn_next(db: Session, task: Task) -> Optional[Task]:
    """Crea la siguiente ocurrencia de una tarea recurrente recién completada (una sola vez)."""
    if task.recurrence == "none" or task.recurred or task.status != Status.COMPLETED or task.parent_task_id:
        return None
    nxt = Task(
        title=task.title, description=task.description, priority=task.priority, status=Status.TODO,
        due_date=next_due(task.due_date, task.recurrence), all_day=task.all_day,
        estimated_hours=task.estimated_hours, tags=task.tags, project_id=task.project_id, note_id=task.note_id,
        user_id=task.user_id, recurrence=task.recurrence, reminder_minutes=task.reminder_minutes,
        assignee_id=task.assignee_id, assigned_notified_at=task.assigned_notified_at,
    )
    first = db.query(Task.position).filter(Task.user_id == task.user_id, Task.status == Status.TODO).order_by(Task.position).first()
    nxt.position = (first[0] - 1) if first else 0
    nxt.subtasks = [Task(title=s.title, user_id=task.user_id, status=Status.TODO) for s in task.subtasks]
    task.recurred = True
    db.add(nxt)
    db.commit()
    db.refresh(nxt)
    return nxt
