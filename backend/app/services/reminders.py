"""Recordatorios de tareas y resumen diario."""
import logging
from datetime import date, datetime, time, timedelta, timezone
from typing import List, Optional
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from ..models import Status, Task, User
from . import access, mailer, trash

logger = logging.getLogger(__name__)

ALL_DAY_HOUR = 9  # las tareas de día completo «vencen» a las 9:00 locales a efectos de aviso
WINDOW = timedelta(hours=24)  # no se avisa de recordatorios que pasaron hace más de un día
OPEN = (Status.TODO, Status.IN_PROGRESS, Status.REVIEW)


def user_tz(user: User) -> ZoneInfo:
    try:
        return ZoneInfo(user.timezone or "UTC")
    except Exception:
        return ZoneInfo("UTC")


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def due_moment(task: Task, tz: ZoneInfo) -> datetime:
    """Instante de vencimiento. Las de día completo guardan la fecha a medianoche UTC."""
    due = _aware(task.due_date)
    if task.all_day:
        return datetime.combine(due.date(), time(ALL_DAY_HOUR), tzinfo=tz)
    return due


def remind_at(task: Task, tz: ZoneInfo) -> Optional[datetime]:
    if task.due_date is None or task.reminder_minutes is None:
        return None
    return due_moment(task, tz) - timedelta(minutes=task.reminder_minutes)


def due_reminders(db: Session, user: User, now: datetime, channel: str) -> List[Task]:
    """Tareas abiertas cuyo recordatorio ya ha llegado y aún no se ha avisado por ese canal."""
    sent = Task.reminder_sent_at if channel == "browser" else Task.reminder_emailed_at
    tz = user_tz(user)
    candidates = db.query(Task).filter(
        access.responsible(user), Task.deleted_at.is_(None), Task.reminder_minutes.isnot(None), Task.due_date.isnot(None),
        sent.is_(None), Task.status.in_(OPEN), Task.parent_task_id.is_(None),
    ).all()
    out = []
    for t in candidates:
        at = remind_at(t, tz)
        if at and now - WINDOW < at <= now:
            out.append(t)
    return out


def _when(task: Task, tz: ZoneInfo) -> str:
    due = _aware(task.due_date)
    return due.date().strftime("%d/%m") if task.all_day else due.astimezone(tz).strftime("%d/%m %H:%M")


def _local_day(task: Task, tz: ZoneInfo) -> date:
    due = _aware(task.due_date)
    return due.date() if task.all_day else due.astimezone(tz).date()


def send_reminder_emails(db: Session, user: User, now: datetime) -> int:
    tasks = due_reminders(db, user, now, "email")
    if not tasks:
        return 0
    tz = user_tz(user)
    subject = f"Recordatorio: {tasks[0].title}" if len(tasks) == 1 else f"{len(tasks)} recordatorios de tareas"
    text, html = mailer.render("Tienes tareas a punto de vencer", [("Recordatorios", [f"{t.title} — {_when(t, tz)}" for t in tasks])])
    if not mailer.send_email(user.email, subject, text, html):
        return 0
    for t in tasks:
        t.reminder_emailed_at = now
    db.commit()
    return len(tasks)


def send_daily_digest(db: Session, user: User, now: datetime) -> bool:
    """Resumen de la mañana: una vez al día, a partir de la hora local elegida y solo si hay algo que contar."""
    tz = user_tz(user)
    local = now.astimezone(tz)
    if local.hour < user.digest_hour or user.last_digest_on == local.date():
        return False
    tasks = db.query(Task).filter(
        access.responsible(user), Task.deleted_at.is_(None), Task.due_date.isnot(None), Task.status.in_(OPEN), Task.parent_task_id.is_(None),
    ).order_by(Task.due_date).all()
    overdue = [t for t in tasks if _local_day(t, tz) < local.date()]
    today = [t for t in tasks if _local_day(t, tz) == local.date()]
    user.last_digest_on = local.date()  # aunque no haya nada: no se reintenta hasta mañana
    sent = False
    if overdue or today:
        sections = []
        if today:
            sections.append(("Para hoy", [t.title + ("" if t.all_day else f" — {_aware(t.due_date).astimezone(tz):%H:%M}") for t in today]))
        if overdue:
            sections.append(("Atrasadas", [f"{t.title} — {_when(t, tz)}" for t in overdue[:30]]))
        text, html = mailer.render(f"Tu día: {len(today)} para hoy, {len(overdue)} atrasadas", sections)
        sent = mailer.send_email(user.email, f"ViltrumFlow · {len(today)} tareas para hoy", text, html)
        if not sent:
            db.rollback()  # se reintenta en la siguiente pasada
            return False
    db.commit()
    return sent


def run_tick(db: Session, now: Optional[datetime] = None) -> None:
    """Una pasada del planificador: envía los correos pendientes de todos los usuarios."""
    now = now or datetime.now(timezone.utc)
    trash.purge_expired(db, now)
    users = db.query(User).filter(User.is_active.is_(True), (User.email_reminders.is_(True)) | (User.daily_digest.is_(True))).all()
    for user in users:
        try:
            if user.email_reminders:
                send_reminder_emails(db, user, now)
            if user.daily_digest:
                send_daily_digest(db, user, now)
        except Exception:  # un usuario con datos raros no debe parar al resto
            logger.exception("Fallo al procesar los avisos del usuario %s", user.id)
            db.rollback()
