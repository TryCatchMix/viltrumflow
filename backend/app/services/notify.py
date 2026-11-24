"""Avisos para el usuario (recordatorios, tareas asignadas, rutinas a su hora) y su envío por Web Push."""
import base64
import json
import logging
from datetime import date, datetime, time, timedelta, timezone
from typing import List, Optional

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..config import settings
from ..models import DayPlan, Habit, HabitCheck, MoodEntry, PushSubscription, ServerKey, Status, Task, User
from . import access
from .reminders import due_reminders, user_tz

logger = logging.getLogger(__name__)

HABIT_WINDOW = timedelta(hours=3)  # pasado este margen tras la hora prevista ya no se avisa (sería tarde)
MOOD_TITLE = "¿Cómo ha ido el día?"
MORNING_WINDOW = timedelta(hours=4)  # si el servidor estuvo parado, el resumen aún llega dentro de este margen


# ---------- Recolección de avisos ----------
def gather(db: Session, user: User, now: datetime) -> List[dict]:
    """
    Avisos pendientes para el usuario. Los marca como entregados (sin hacer commit): el canal que los
    recoge primero —la app abierta o el push— es el que avisa, y el otro ya no los repite.
    """
    out: List[dict] = []
    for t in due_reminders(db, user, now, "browser"):
        out.append({"kind": "reminder", "task_id": t.id, "title": t.title, "due_date": t.due_date, "all_day": t.all_day})
        t.reminder_sent_at = now
    assigned = db.query(Task).filter(
        Task.assignee_id == user.id, Task.assigned_notified_at.is_(None), Task.deleted_at.is_(None),
        access.visible_tasks(db, user),
    ).all()
    for t in assigned:
        out.append({"kind": "assigned", "task_id": t.id, "title": t.title, "due_date": t.due_date, "all_day": t.all_day,
                    "by": t.project.name if t.project else None})
        t.assigned_notified_at = now
    out += _habit_notices(db, user, now)
    out += _mood_notice(db, user, now)
    out += _morning_notice(db, user, now)
    return out


def _plural(n: int, one: str, many: str) -> str:
    return f"{n} {one if n == 1 else many}"


def morning_summary(db: Session, user: User, day: date) -> dict:
    """Qué hay para el día: tareas (y cuántas urgentes), atrasadas, rutinas pendientes y si ya está planificado."""
    from ..routers.habits import checks_by_habit, done_days, scheduled, week_count  # evita import circular

    tz = user_tz(user)
    tasks = db.query(Task).filter(
        Task.deleted_at.is_(None), Task.parent_task_id.is_(None), Task.due_date.isnot(None),
        Task.status.in_((Status.TODO, Status.IN_PROGRESS, Status.REVIEW)),
        access.visible_tasks(db, user), access.responsible(user),
    ).all()

    def local_day(t: Task) -> date:
        due = t.due_date if t.due_date.tzinfo else t.due_date.replace(tzinfo=timezone.utc)
        return due.date() if t.all_day else due.astimezone(tz).date()

    today_tasks = [t for t in tasks if local_day(t) == day]
    overdue = sum(1 for t in tasks if local_day(t) < day)
    important = sum(1 for t in today_tasks if t.priority.value in ("high", "urgent"))
    habits = [h for h in db.query(Habit).filter(Habit.user_id == user.id, Habit.is_archived.is_(False)) if scheduled(h, day)]
    checks = checks_by_habit(db, [h.id for h in habits])
    pending_habits = 0
    for h in habits:
        done = done_days(h, checks[h.id])
        if day not in done and not (h.weekly_target and week_count(done, day) >= h.weekly_target):
            pending_habits += 1
    planned = db.query(DayPlan.id).filter(DayPlan.user_id == user.id, DayPlan.day == day, DayPlan.planned_at.isnot(None)).first() is not None
    parts = []
    if today_tasks:
        parts.append(_plural(len(today_tasks), "tarea", "tareas") + (f" ({_plural(important, 'importante', 'importantes')})" if important else ""))
    if overdue:
        parts.append(_plural(overdue, "atrasada", "atrasadas"))
    if pending_habits:
        parts.append(_plural(pending_habits, "rutina", "rutinas"))
    body = ("Hoy: " + " · ".join(parts) + ".") if parts else "Hoy no tienes nada programado."
    body += " Tu plan ya está listo." if planned else " Elige tus 3 prioridades."
    return {"tasks": len(today_tasks), "important": important, "overdue": overdue, "habits": pending_habits,
            "planned": planned, "body": body, "url": "/today" if planned else "/plan"}


def _morning_notice(db: Session, user: User, now: datetime) -> List[dict]:
    if not user.morning_summary:
        return []
    local = now.astimezone(user_tz(user))
    today = local.date()
    at = datetime.combine(today, time(user.morning_summary_hour or 8, 0), tzinfo=local.tzinfo)
    if user.last_morning_summary_on == today or not (at <= local < at + MORNING_WINDOW):
        return []
    user.last_morning_summary_on = today
    summary = morning_summary(db, user, today)
    return [{"kind": "morning", "task_id": user.id, "title": summary["body"], "due_date": None, "all_day": False,
             "by": summary["url"]}]


def _mood_notice(db: Session, user: User, now: datetime) -> List[dict]:
    """Una vez al día, a partir de la hora elegida (y hasta medianoche), si aún no hay registro de ánimo."""
    if not user.mood_reminder:
        return []
    local = now.astimezone(user_tz(user))
    today = local.date()
    if user.last_mood_reminded_on == today or local.hour < (user.mood_reminder_hour or 21):
        return []
    if db.query(MoodEntry.id).filter(MoodEntry.user_id == user.id, MoodEntry.day == today).first():
        return []
    user.last_mood_reminded_on = today
    return [{"kind": "mood", "task_id": user.id, "title": MOOD_TITLE, "due_date": None, "all_day": False}]


def _habit_notices(db: Session, user: User, now: datetime) -> List[dict]:
    from ..routers.habits import checks_by_habit, done_days, scheduled, week_count  # evita import circular

    tz = user_tz(user)
    local = now.astimezone(tz)
    today = local.date()
    habits = db.query(Habit).filter(
        Habit.user_id == user.id, Habit.is_archived.is_(False), Habit.remind.is_(True), Habit.target_time.isnot(None),
    ).all()
    habits = [h for h in habits if h.last_reminded_on != today and scheduled(h, today)]
    if not habits:
        return []
    checks = checks_by_habit(db, [h.id for h in habits])
    out = []
    for h in habits:
        at = datetime.combine(today, time(int(h.target_time[:2]), int(h.target_time[3:])), tzinfo=tz)
        if not (at <= local < at + HABIT_WINDOW):
            continue
        done = done_days(h, checks[h.id])
        if today in done or (h.weekly_target and week_count(done, today) >= h.weekly_target):
            continue  # ya hecha (o la semana ya está cumplida)
        c = checks[h.id].get(today)
        progress = f" ({c.count if c else 0}/{h.target_count} {h.unit})".rstrip() if (h.target_count or 1) > 1 else ""
        out.append({"kind": "habit", "task_id": h.id, "title": h.title + progress, "due_date": None, "all_day": False})
        h.last_reminded_on = today
    return out


# ---------- Web Push ----------
def vapid_keys(db: Session) -> tuple:
    """(clave privada PEM, clave pública en base64url). Se generan la primera vez y se guardan en la base de datos."""
    row = db.get(ServerKey, "vapid")
    if row:
        data = json.loads(row.value)
        return data["private"], data["public"]
    key = ec.generate_private_key(ec.SECP256R1())
    private = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).decode()
    raw = key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    public = base64.urlsafe_b64encode(raw).decode().rstrip("=")
    db.add(ServerKey(name="vapid", value=json.dumps({"private": private, "public": public})))
    try:
        db.commit()
    except IntegrityError:  # otra réplica la generó a la vez: se usa la suya
        db.rollback()
        return vapid_keys(db)
    return private, public


def _subject() -> str:
    if settings.VAPID_SUBJECT:
        return settings.VAPID_SUBJECT
    url = settings.FRONTEND_URL.rstrip("/")
    return url if url.startswith("https://") else "mailto:noreply@viltrumflow.invalid"


def payload(title: str, body: str, url: str = "/", tag: Optional[str] = None) -> dict:
    """Formato que entiende el service worker de Angular: muestra la notificación y abre `url` al pulsarla."""
    return {"notification": {
        "title": title, "body": body, "icon": "icons/icon-192.png", "badge": "icons/icon-192.png", "tag": tag or url,
        "data": {"onActionClick": {"default": {"operation": "navigateLastFocusedOrOpen", "url": url}}},
    }}


def send(db: Session, user_id: int, message: dict) -> int:
    """Envía a todos los dispositivos del usuario. Devuelve a cuántos llegó; borra las suscripciones caducadas."""
    from py_vapid import Vapid
    from pywebpush import WebPushException, webpush

    subs = db.query(PushSubscription).filter(PushSubscription.user_id == user_id).all()
    if not subs:
        return 0
    private, _ = vapid_keys(db)
    vapid = Vapid.from_pem(private.encode())
    delivered = 0
    for s in subs:
        try:
            webpush({"endpoint": s.endpoint, "keys": {"p256dh": s.p256dh, "auth": s.auth}}, json.dumps(message),
                    vapid_private_key=vapid, vapid_claims={"sub": _subject()}, timeout=10, ttl=3600)
            delivered += 1
        except WebPushException as exc:
            status = getattr(exc.response, "status_code", None)
            if status in (404, 410):  # el navegador retiró la suscripción
                db.delete(s)
            else:
                logger.warning("Push fallido (%s) para el usuario %s: %s", status, user_id, exc)
        except Exception as exc:  # red caída, etc.: no debe tumbar al planificador
            logger.warning("Push fallido para el usuario %s: %s", user_id, exc)
    db.commit()
    return delivered


def _message(n: dict, tz) -> dict:
    if n["kind"] == "assigned":
        return payload("Nueva tarea asignada", n["title"] + (f" · {n['by']}" if n.get("by") else ""), "/tasks", f"vf-assigned-{n['task_id']}")
    if n["kind"] == "habit":
        return payload("Rutina pendiente", n["title"], "/today", f"vf-habit-{n['task_id']}")
    if n["kind"] == "morning":
        return payload("Buenos días ☀️", n["title"], n.get("by") or "/plan", "vf-morning")
    if n["kind"] == "mood":
        return payload(MOOD_TITLE, "Registra tu ánimo y energía en diez segundos.", "/today", "vf-mood")
    due = n["due_date"]
    when = "Vence hoy o mañana" if n["all_day"] or not due else \
        "Vence a las " + (due if due.tzinfo else due.replace(tzinfo=timezone.utc)).astimezone(tz).strftime("%H:%M")
    return payload(f"Recordatorio: {n['title']}", when, "/tasks", f"vf-task-{n['task_id']}")


def push_notices(db: Session, now: datetime) -> int:
    """Pasada del planificador: lleva por push los avisos pendientes de quienes tienen dispositivos suscritos."""
    total = 0
    user_ids = [u for (u,) in db.query(PushSubscription.user_id).distinct()]
    for user in db.query(User).filter(User.id.in_(user_ids), User.is_active.is_(True)).all() if user_ids else []:
        try:
            notices = gather(db, user, now)
            if not notices:
                db.rollback()
                continue
            tz = user_tz(user)
            # Se hace commit de las marcas antes de enviar: si el envío falla del todo, se deshacen
            sent = 0
            for n in notices:
                sent += send(db, user.id, _message(n, tz)) > 0
            if not sent:
                _unmark(db, notices)
            total += sent
        except Exception:
            logger.exception("Fallo al enviar avisos push al usuario %s", user.id)
            db.rollback()
    return total


def _unmark(db: Session, notices: List[dict]) -> None:
    """Ningún dispositivo recibió los avisos: vuelven a quedar pendientes para la app o el próximo intento."""
    for n in notices:
        if n["kind"] == "reminder":
            db.query(Task).filter(Task.id == n["task_id"]).update({"reminder_sent_at": None})
        elif n["kind"] == "assigned":
            db.query(Task).filter(Task.id == n["task_id"]).update({"assigned_notified_at": None})
        elif n["kind"] == "mood":
            db.query(User).filter(User.id == n["task_id"]).update({"last_mood_reminded_on": None})
        elif n["kind"] == "morning":
            db.query(User).filter(User.id == n["task_id"]).update({"last_morning_summary_on": None})
        else:
            db.query(Habit).filter(Habit.id == n["task_id"]).update({"last_reminded_on": None})
    db.commit()


PHASE_TEXT = {
    "focus": ("Bloque terminado", "Toca descansar."),
    "short": ("Fin del descanso", "A por otro bloque de concentración."),
    "long": ("Fin del descanso largo", "Empieza una serie nueva cuando quieras."),
}


def push_pomodoro(db: Session, now: datetime) -> int:
    """Avisa del final de las fases de Pomodoro vencidas, aunque la app esté cerrada."""
    sent = 0
    for user in db.query(User).filter(User.pomodoro_ends_at.isnot(None), User.pomodoro_ends_at <= now).all():
        title, body = PHASE_TEXT.get(user.pomodoro_phase or "focus", PHASE_TEXT["focus"])
        user.pomodoro_ends_at, user.pomodoro_phase = None, None
        db.commit()  # una sola vez, se entregue o no
        sent += send(db, user.id, payload(f"Pomodoro · {title}", body, "/focus", "vf-pomodoro")) > 0
    return sent
