"""Revisión semanal guiada: resumen de la semana, pendientes que reprogramar y objetivos para la siguiente."""
import json
from datetime import date, datetime, time, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user
from ..models import Note, PomodoroSession, Status, Task, User, WeeklyReview, XpEvent
from ..services import access, game
from ..services.reminders import user_tz
from .habits import compute_stats, local_today, week_start

router = APIRouter()

REVIEW_XP = 30


class Goal(BaseModel):
    text: str = Field(min_length=1, max_length=200)
    done: bool = False


class ReviewIn(BaseModel):
    week_start: date
    goals: List[Goal] = Field(default_factory=list, max_length=10)
    reflection: str = Field("", max_length=5000)

    @field_validator("week_start")
    @classmethod
    def _monday(cls, v: date) -> date:
        if v.weekday() != 0:
            raise ValueError("La semana debe empezar en lunes")
        return v


class GoalToggle(BaseModel):
    week_start: date
    index: int = Field(ge=0, le=9)
    done: bool


def default_week(today: date) -> date:
    """De viernes a domingo se revisa la semana en curso; de lunes a jueves, la anterior."""
    return week_start(today) if today.weekday() >= 4 else week_start(today) - timedelta(days=7)


def _record(db: Session, user: User, week: date) -> Optional[WeeklyReview]:
    return db.query(WeeklyReview).filter(WeeklyReview.user_id == user.id, WeeklyReview.week_start == week).first()


def _goals(r: Optional[WeeklyReview]) -> list:
    try:
        return json.loads(r.goals) if r else []
    except ValueError:
        return []


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _task(t: Task, tz) -> dict:
    due = None
    if t.due_date:
        due = _aware(t.due_date).date().isoformat() if t.all_day else _aware(t.due_date).astimezone(tz).date().isoformat()
    return {"id": t.id, "title": t.title, "difficulty": t.difficulty, "priority": t.priority.value, "due_day": due,
            "project": t.project.name if t.project else None, "can_edit": True}


@router.get("")
def summary(week: Optional[date] = Query(None, alias="week_start"), user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Todo lo necesario para revisar una semana (de lunes a domingo)."""
    tz = user_tz(user)
    today = local_today(user)
    week = week_start(week) if week else default_week(today)
    if week > week_start(today):
        raise HTTPException(400, "Esa semana aún no ha empezado")
    end = week + timedelta(days=6)
    since = datetime.combine(week, time.min, tzinfo=tz)
    until = datetime.combine(end + timedelta(days=1), time.min, tzinfo=tz)
    roles = access.project_roles(db, user)
    mine = db.query(Task).filter(
        access.visible_tasks(db, user, roles), access.responsible(user), Task.parent_task_id.is_(None), Task.deleted_at.is_(None),
    )
    completed = mine.filter(Task.status == Status.COMPLETED, Task.completed_at >= since, Task.completed_at < until)\
        .order_by(Task.completed_at).all()
    # Pendientes: abiertas con fecha dentro de la semana o anterior (lo que se ha ido quedando atrás)
    open_ = [t for t in mine.filter(Task.status.notin_([Status.COMPLETED, Status.ARCHIVED]), Task.due_date.isnot(None)).all()]
    carried = []
    for t in open_:
        d = _aware(t.due_date).date() if t.all_day else _aware(t.due_date).astimezone(tz).date()
        if d <= end:
            item = _task(t, tz)
            item["can_edit"] = access.can_edit(db, user, t, roles)
            carried.append(item)
    carried.sort(key=lambda x: x["due_day"])
    no_date = mine.filter(Task.status.notin_([Status.COMPLETED, Status.ARCHIVED]), Task.due_date.is_(None))\
        .order_by(Task.priority.desc(), Task.created_at).limit(15).all()
    next_start = end + timedelta(days=1)
    upcoming = sum(1 for t in open_ if next_start <= (_aware(t.due_date).date() if t.all_day else _aware(t.due_date).astimezone(tz).date()) <= next_start + timedelta(days=6))

    xp = {k: 0 for k in ("task", "habit", "focus", "review", "mission")}
    for kind, amount in db.query(XpEvent.kind, func.sum(XpEvent.amount)).filter(
            XpEvent.user_id == user.id, XpEvent.created_at >= since, XpEvent.created_at < until).group_by(XpEvent.kind):
        xp["task" if kind == "subtask" else kind if kind in xp else "task"] += int(amount or 0)
    focus = db.query(func.coalesce(func.sum(PomodoroSession.seconds), 0)).filter(
        PomodoroSession.user_id == user.id, PomodoroSession.ended_at >= since, PomodoroSession.ended_at < until).scalar()
    notes_created = db.query(func.count(Note.id)).filter(Note.owner_id == user.id, Note.deleted_at.is_(None),
                                                         Note.created_at >= since, Note.created_at < until).scalar()
    habits = compute_stats(db, user, week, min(end, today), today)
    record, previous = _record(db, user, week), _record(db, user, week - timedelta(days=7))
    return {
        "week_start": week.isoformat(), "week_end": end.isoformat(), "is_current": week == week_start(today),
        "completed": [_task(t, tz) for t in completed],
        "carried_over": carried,
        "no_date": [_task(t, tz) for t in no_date],
        "upcoming_next_week": upcoming,
        "xp": xp, "xp_total": sum(xp.values()),
        "focus_minutes": round(int(focus) / 60),
        "notes_created": int(notes_created),
        "habits": {"rate": habits["rate"], "done": habits["done"], "scheduled": habits["scheduled"],
                   "perfect_days": habits["perfect_days"],
                   "items": [{k: h[k] for k in ("id", "title", "color", "rate", "done", "scheduled", "period", "streak")} for h in habits["habits"]]},
        # Objetivos que se fijaron para esta semana en la revisión anterior
        "previous_goals": _goals(previous),
        "goals": _goals(record),
        "reflection": record.reflection if record else "",
        "completed_at": _aware(record.completed_at) if record and record.completed_at else None,
        "xp_reward": REVIEW_XP,
    }


@router.put("")
def save(data: ReviewIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Guarda (sin terminar) los objetivos para la semana siguiente y la reflexión."""
    if data.week_start > week_start(local_today(user)):
        raise HTTPException(400, "Esa semana aún no ha empezado")
    r = _record(db, user, data.week_start)
    if not r:
        r = WeeklyReview(user_id=user.id, week_start=data.week_start)
        db.add(r)
    r.goals = json.dumps([g.model_dump() for g in data.goals], ensure_ascii=False)
    r.reflection = data.reflection
    db.commit()
    return {"saved": True}


@router.post("/complete")
def complete(data: ReviewIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Guarda y da la revisión por terminada. La primera vez da experiencia."""
    save(data, user, db)
    r = _record(db, user, data.week_start)
    if not r.completed_at:
        r.completed_at = datetime.now(timezone.utc)
        db.commit()
    gained = game.award(db, user.id, "review", f"{user.id}:{data.week_start.isoformat()}", REVIEW_XP, "Revisión semanal")
    return {"xp_gained": gained, "completed_at": _aware(r.completed_at)}


@router.get("/today")
def today_info(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Para la página «Hoy»: objetivos de esta semana y si hay una revisión pendiente."""
    today = local_today(user)
    current = week_start(today)
    goals_review = _record(db, user, current - timedelta(days=7))
    due = default_week(today)
    pending = due if today.weekday() in (4, 5, 6, 0, 1) and not (_record(db, user, due) and _record(db, user, due).completed_at) else None
    return {"goals_week": (current - timedelta(days=7)).isoformat(), "goals": _goals(goals_review),
            "pending_review": pending.isoformat() if pending else None}


@router.put("/goal", status_code=204)
def toggle_goal(data: GoalToggle, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Marca un objetivo como cumplido (los objetivos se guardan en la revisión de la semana anterior)."""
    r = _record(db, user, data.week_start)
    goals = _goals(r)
    if not r or data.index >= len(goals):
        raise HTTPException(404, "Objetivo no encontrado")
    goals[data.index]["done"] = data.done
    r.goals = json.dumps(goals, ensure_ascii=False)
    db.commit()
