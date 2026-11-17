from collections import defaultdict
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import String, cast, func
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user
from ..models import Habit, HabitCheck, PomodoroSession, Task, User, XpEvent
from ..services import game
from ..services.reminders import user_tz
from .habits import best_streak, checks_by_habit, done_days, local_today

router = APIRouter()

KIND = {"task": "task", "subtask": "task", "habit": "habit", "focus": "focus", "review": "review"}


@router.get("/profile")
def profile(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Experiencia total, nivel, rango actual y la escala completa de rangos."""
    return game.profile(db, user)


def _achievements(db: Session, user: User) -> list:
    tasks = db.query(func.count(XpEvent.id)).filter(XpEvent.user_id == user.id, XpEvent.kind == "task").scalar()
    epic = db.query(func.count(XpEvent.id)).join(Task, cast(Task.id, String) == XpEvent.ref)\
        .filter(XpEvent.user_id == user.id, XpEvent.kind == "task", Task.difficulty == 4).scalar()
    checks = db.query(func.count(XpEvent.id)).filter(XpEvent.user_id == user.id, XpEvent.kind == "habit").scalar()
    blocks = db.query(func.count(PomodoroSession.id)).filter(PomodoroSession.user_id == user.id).scalar()
    reviews = db.query(func.count(XpEvent.id)).filter(XpEvent.user_id == user.id, XpEvent.kind == "review").scalar()
    today = local_today(user)
    streak = 0
    habits = db.query(Habit).filter(Habit.user_id == user.id, Habit.weekly_target.is_(None)).all()  # racha en días
    checks = checks_by_habit(db, [h.id for h in habits])
    for h in habits:
        streak = max(streak, best_streak(h, done_days(h, checks[h.id]), today))
    defs = [
        ("first", "Primera conquista", "Completa tu primera tarea", tasks, 1),
        ("tasks25", "Campaña en marcha", "Completa 25 tareas", tasks, 25),
        ("tasks100", "Cien victorias", "Completa 100 tareas", tasks, 100),
        ("epic", "Hazaña épica", "Completa una tarea de dificultad épica", epic, 1),
        ("streak7", "Disciplina de hierro", "Cumple una rutina 7 días programados seguidos", streak, 7),
        ("streak30", "Voluntad inquebrantable", "Cumple una rutina 30 días programados seguidos", streak, 30),
        ("checks50", "Constancia", "Marca 50 rutinas", checks, 50),
        ("focus10", "Mente enfocada", "Termina 10 bloques de concentración", blocks, 10),
        ("focus50", "Concentración absoluta", "Termina 50 bloques de concentración", blocks, 50),
        ("review4", "Estratega", "Completa 4 revisiones semanales", reviews, 4),
    ]
    return [{"id": i, "name": n, "description": d, "progress": min(int(p or 0), g), "goal": g, "unlocked": (p or 0) >= g}
            for i, n, d, p, g in defs]


@router.get("/history")
def history(days: int = Query(30, ge=7, le=180), user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Experiencia por día y por origen, últimos movimientos y logros."""
    tz = user_tz(user)
    today = datetime.now(timezone.utc).astimezone(tz).date()
    start = today - timedelta(days=days - 1)
    events = db.query(XpEvent).filter(XpEvent.user_id == user.id).order_by(XpEvent.created_at.desc(), XpEvent.id.desc()).all()
    per_day = defaultdict(lambda: {"task": 0, "habit": 0, "focus": 0, "review": 0})
    totals = {"task": 0, "habit": 0, "focus": 0, "review": 0}
    for e in events:
        k = KIND.get(e.kind, "task")
        totals[k] += e.amount
        d = (e.created_at if e.created_at.tzinfo else e.created_at.replace(tzinfo=timezone.utc)).astimezone(tz).date()
        if d >= start:
            per_day[d][k] += e.amount
    daily = []
    for i in range(days):
        d = start + timedelta(days=i)
        daily.append({"date": d.isoformat(), **per_day[d], "total": sum(per_day[d].values())})
    return {
        "daily": daily,
        "by_kind": totals,
        "today_xp": daily[-1]["total"],
        "week_xp": sum(d["total"] for d in daily[-7:]),
        "recent": [{"kind": KIND.get(e.kind, "task"), "amount": e.amount, "detail": e.detail, "created_at": e.created_at
                    if e.created_at.tzinfo else e.created_at.replace(tzinfo=timezone.utc)} for e in events[:25]],
        "achievements": _achievements(db, user),
    }
