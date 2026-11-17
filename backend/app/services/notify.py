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
from ..models import Habit, HabitCheck, PushSubscription, ServerKey, Task, User
from . import access
from .reminders import due_reminders, user_tz

logger = logging.getLogger(__name__)

HABIT_WINDOW = timedelta(hours=3)  # pasado este margen tras la hora prevista ya no se avisa (sería tarde)


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
    return out


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
