"""Ritual del día: plan de la mañana (3 prioridades e intención) y cierre de la noche (lo hecho, mover lo pendiente)."""
from datetime import date, datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user
from ..models import DayPlan, MoodEntry, Status, Task, User, XpEvent
from ..services import access
from ..services import google_calendar as gcal
from ..services.reminders import user_tz
from .habits import local_today

router = APIRouter()

MAX_PRIORITIES = 3
OPEN = (Status.TODO, Status.IN_PROGRESS, Status.REVIEW)


class PlanIn(BaseModel):
    priorities: List[int] = Field(default_factory=list, max_length=MAX_PRIORITIES)
    intention: Optional[str] = Field(None, max_length=300)


class CloseIn(BaseModel):
    reflection: Optional[str] = Field(None, max_length=5000)
    move_to_tomorrow: List[int] = Field(default_factory=list, max_length=200)


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _day_of(t: Task, tz) -> Optional[date]:
    if not t.due_date:
        return None
    return _aware(t.due_date).date() if t.all_day else _aware(t.due_date).astimezone(tz).date()


def _task(t: Task, tz) -> dict:
    return {
        "id": t.id, "title": t.title, "status": t.status.value, "priority": t.priority.value, "difficulty": t.difficulty,
        "due_date": _aware(t.due_date) if t.due_date else None, "all_day": t.all_day, "due_day": (d.isoformat() if (d := _day_of(t, tz)) else None),
        "estimated_minutes": t.estimated_minutes,
        "project": {"name": t.project.name, "color": t.project.color} if t.project else None,
    }


def _ids(plan: Optional[DayPlan]) -> List[int]:
    return [int(x) for x in (plan.priorities if plan else "").split(",") if x.strip().isdigit()]


def _mine(db: Session, user: User):
    """Tareas principales, no borradas, visibles y de las que el usuario es responsable."""
    return db.query(Task).filter(Task.deleted_at.is_(None), Task.parent_task_id.is_(None),
                                 access.visible_tasks(db, user), access.responsible(user))


def _check_day(user: User, day: date, allow_tomorrow: bool) -> date:
    today = local_today(user)
    if day > today + timedelta(days=1 if allow_tomorrow else 0) or day < today - timedelta(days=7):
        raise HTTPException(400, "Solo se pueden planificar los últimos 7 días, hoy o mañana")
    return day


def _streak(db: Session, user: User, today: date) -> int:
    days = {d for (d,) in db.query(DayPlan.day).filter(DayPlan.user_id == user.id, DayPlan.planned_at.isnot(None),
                                                         DayPlan.day >= today - timedelta(days=400))}
    d, n = (today if today in days else today - timedelta(days=1)), 0
    while d in days:
        n += 1
        d -= timedelta(days=1)
    return n


def _state(db: Session, user: User, day: date) -> dict:
    tz = user_tz(user)
    today = local_today(user)
    plan = db.query(DayPlan).filter(DayPlan.user_id == user.id, DayPlan.day == day).first()
    end_utc = datetime.combine(day + timedelta(days=1), datetime.min.time(), tzinfo=tz).astimezone(timezone.utc)
    start_utc = datetime.combine(day, datetime.min.time(), tzinfo=tz).astimezone(timezone.utc)

    # Lo que toca ese día: abiertas con fecha hasta ese día (incluye atrasadas) — margen de un día por las zonas horarias
    open_dated = _mine(db, user).filter(Task.status.in_(OPEN), Task.due_date.isnot(None),
                                        Task.due_date < end_utc + timedelta(days=1)).all()
    due = sorted([t for t in open_dated if _day_of(t, tz) and _day_of(t, tz) <= day],
                 key=lambda t: (_day_of(t, tz), t.all_day, _aware(t.due_date)))
    due_ids = {t.id for t in due}
    candidates = _mine(db, user).filter(Task.status.in_(OPEN), Task.id.notin_(due_ids or [-1]))\
        .order_by(Task.due_date.is_(None), Task.due_date, Task.priority.desc(), Task.created_at.desc()).limit(40).all()
    done = _mine(db, user).filter(Task.status == Status.COMPLETED, Task.completed_at >= start_utc, Task.completed_at < end_utc)\
        .order_by(Task.completed_at).all()

    ids = _ids(plan)
    by_id = {t.id: t for t in db.query(Task).filter(Task.id.in_(ids or [-1]), Task.deleted_at.is_(None))}
    priorities = [by_id[i] for i in ids if i in by_id and access.can_view(db, user, by_id[i])]
    xp = db.query(func.coalesce(func.sum(XpEvent.amount), 0)).filter(
        XpEvent.user_id == user.id, XpEvent.created_at >= start_utc, XpEvent.created_at < end_utc).scalar()
    mood = db.query(MoodEntry).filter(MoodEntry.user_id == user.id, MoodEntry.day == day).first()
    return {
        "day": day.isoformat(), "today": today.isoformat(),
        "planned_at": _aware(plan.planned_at) if plan and plan.planned_at else None,
        "closed_at": _aware(plan.closed_at) if plan and plan.closed_at else None,
        "intention": plan.intention if plan else None, "reflection": plan.reflection if plan else None,
        "priorities": [_task(t, tz) for t in priorities],
        "due": [_task(t, tz) for t in due],
        "candidates": [_task(t, tz) for t in candidates],
        "done": [_task(t, tz) for t in done],
        "xp": int(xp), "mood": {"mood": mood.mood, "energy": mood.energy} if mood else None,
        "streak": _streak(db, user, today),
    }


@router.get("")
def get_plan(day: Optional[date] = Query(None), user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _state(db, user, _check_day(user, day or local_today(user), allow_tomorrow=True))


def _upsert(db: Session, user: User, day: date) -> DayPlan:
    plan = db.query(DayPlan).filter(DayPlan.user_id == user.id, DayPlan.day == day).first()
    if not plan:
        plan = DayPlan(user_id=user.id, day=day, priorities="")
        db.add(plan)
    return plan


@router.put("/{day}")
def save_plan(day: date, data: PlanIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Guarda el plan del día. Se puede preparar el de mañana al cerrar el de hoy."""
    day = _check_day(user, day, allow_tomorrow=True)
    ids = list(dict.fromkeys(data.priorities))
    for i in ids:
        t = db.get(Task, i)
        if not t or t.deleted_at is not None or not access.can_view(db, user, t):
            raise HTTPException(404, "Tarea no encontrada")
    plan = _upsert(db, user, day)
    plan.priorities = ",".join(map(str, ids))
    plan.intention = (data.intention or "").strip() or None
    plan.planned_at = plan.planned_at or datetime.now(timezone.utc)
    db.commit()
    return _state(db, user, day)


@router.post("/{day}/close")
def close_day(day: date, data: CloseIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Cierra el día: guarda la reflexión y pasa al día siguiente las tareas pendientes elegidas (conservando su hora)."""
    day = _check_day(user, day, allow_tomorrow=False)
    tz = user_tz(user)
    roles = access.project_roles(db, user)
    moved, skipped, synced = 0, 0, []
    for i in dict.fromkeys(data.move_to_tomorrow):
        t = db.get(Task, i)
        if not t or t.deleted_at is not None or t.status not in OPEN or not access.can_edit(db, user, t, roles):
            skipped += 1
            continue
        current = _day_of(t, tz)
        target = day + timedelta(days=1)
        if t.due_date is None or current is None:
            t.due_date, t.all_day = datetime(target.year, target.month, target.day, tzinfo=timezone.utc), True
        else:
            t.due_date = _aware(t.due_date) + timedelta(days=(target - current).days)
        t.reminder_sent_at = t.reminder_emailed_at = None
        moved += 1
        synced.append(t)
    plan = _upsert(db, user, day)
    plan.reflection = (data.reflection or "").strip() or None
    plan.closed_at = datetime.now(timezone.utc)
    db.commit()
    for t in synced:  # el evento de Google Calendar se mueve con la tarea
        gcal.auto_sync(db, t.owner, t)
    return {**_state(db, user, day), "moved": moved, "skipped": skipped}
