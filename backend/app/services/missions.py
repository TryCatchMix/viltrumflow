"""Misiones semanales: tres retos por semana, ajustados a lo que el usuario suele hacer."""
import math
import random
from datetime import date, datetime, time, timedelta, timezone
from typing import Callable, Dict, List

from sqlalchemy import String, cast, func
from sqlalchemy.orm import Session

from ..models import Habit, PomodoroSession, Task, User, WeeklyMission, WeeklyReview, XpEvent
from .reminders import user_tz

PER_WEEK = 3


def _window(user: User, week: date):
    tz = user_tz(user)
    return datetime.combine(week, time.min, tzinfo=tz), datetime.combine(week + timedelta(days=7), time.min, tzinfo=tz)


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _completed(db: Session, user: User, since: datetime, until: datetime):
    """Tareas que el usuario completó en el periodo (las que le dieron experiencia y no se han reabierto)."""
    return db.query(Task).join(XpEvent, cast(Task.id, String) == XpEvent.ref).filter(
        XpEvent.user_id == user.id, XpEvent.kind == "task", XpEvent.created_at >= since, XpEvent.created_at < until,
    ).all()


def _on_time(t: Task) -> bool:
    if not t.due_date or not t.completed_at:
        return False
    deadline = _aware(t.due_date) + (timedelta(days=1) if t.all_day else timedelta(0))
    return _aware(t.completed_at) <= deadline


def progress(db: Session, user: User, key: str, week: date) -> int:
    since, until = _window(user, week)
    if key == "tasks":
        return len(_completed(db, user, since, until))
    if key == "hard_tasks":
        return sum(1 for t in _completed(db, user, since, until) if (t.difficulty or 2) >= 3)
    if key == "on_time":
        return sum(1 for t in _completed(db, user, since, until) if _on_time(t))
    if key == "habit_checks":
        return db.query(func.count(XpEvent.id)).filter(XpEvent.user_id == user.id, XpEvent.kind == "habit",
                                                       XpEvent.created_at >= since, XpEvent.created_at < until).scalar()
    if key == "perfect_days":
        from ..routers.habits import compute_stats, local_today  # evita import circular
        today = local_today(user)
        last = min(week + timedelta(days=6), today)
        return compute_stats(db, user, week, last, today)["perfect_days"] if last >= week else 0
    if key == "focus_minutes":
        secs = db.query(func.coalesce(func.sum(PomodoroSession.seconds), 0)).filter(
            PomodoroSession.user_id == user.id, PomodoroSession.ended_at >= since, PomodoroSession.ended_at < until).scalar()
        return int(secs) // 60
    if key == "review":
        r = db.query(WeeklyReview).filter(WeeklyReview.user_id == user.id, WeeklyReview.week_start == week).first()
        return 1 if r and r.completed_at else 0
    return 0


TEXT: Dict[str, Callable[[int], str]] = {
    "tasks": lambda n: f"Completa {n} tareas",
    "hard_tasks": lambda n: f"Completa {n} tareas difíciles o épicas",
    "on_time": lambda n: f"Termina {n} tareas antes de su fecha",
    "habit_checks": lambda n: f"Marca {n} rutinas",
    "perfect_days": lambda n: f"Cumple todas tus rutinas {n} días",
    "focus_minutes": lambda n: f"Concéntrate {n} minutos con el Pomodoro",
    "review": lambda n: "Haz la revisión de esta semana",
}
HINT = {
    "tasks": "Cuentan las tareas que completes esta semana.",
    "hard_tasks": "Tareas con dificultad «Difícil» o «Épica».",
    "on_time": "Completadas antes de que acabe su fecha de vencimiento.",
    "habit_checks": "Cada rutina cumplida suma una.",
    "perfect_days": "Días en los que cumples todas las rutinas que tocan.",
    "focus_minutes": "Bloques de concentración terminados en Enfoque.",
    "review": "Se puede hacer de viernes a domingo.",
}
REWARD = {  # (XP, monedas)
    "tasks": (60, 15), "hard_tasks": (80, 20), "on_time": (60, 15), "habit_checks": (50, 12),
    "perfect_days": (80, 20), "focus_minutes": (60, 15), "review": (40, 10),
}


def _candidates(db: Session, user: User, week: date) -> Dict[str, int]:
    """Objetivo de cada misión posible: un 20 % por encima de la media de las 4 semanas anteriores, con mínimos."""
    since, until = _window(user, week - timedelta(days=28))[0], _window(user, week)[0]
    done = _completed(db, user, since, until)
    weekly = lambda n: n / 4
    has_habits = db.query(Habit.id).filter(Habit.user_id == user.id, Habit.is_archived.is_(False)).first() is not None
    has_daily = db.query(Habit.id).filter(Habit.user_id == user.id, Habit.is_archived.is_(False), Habit.weekly_target.is_(None)).first() is not None
    checks = db.query(func.count(XpEvent.id)).filter(XpEvent.user_id == user.id, XpEvent.kind == "habit",
                                                     XpEvent.created_at >= since, XpEvent.created_at < until).scalar()
    focus = db.query(func.coalesce(func.sum(PomodoroSession.seconds), 0)).filter(
        PomodoroSession.user_id == user.id, PomodoroSession.ended_at >= since, PomodoroSession.ended_at < until).scalar() // 60
    up = lambda avg, lo, hi: max(lo, min(hi, math.ceil(avg * 1.2)))
    out = {
        "tasks": up(weekly(len(done)), 3, 30),
        "hard_tasks": up(weekly(sum(1 for t in done if (t.difficulty or 2) >= 3)), 2, 8),
        "on_time": up(weekly(sum(1 for t in done if _on_time(t))), 2, 20),
        "focus_minutes": max(100, min(600, int(math.ceil(weekly(focus) * 1.2 / 25) * 25))),
        "review": 1,
    }
    if has_habits:
        out["habit_checks"] = up(weekly(checks), 5, 50)
    if has_daily:
        out["perfect_days"] = 5 if weekly(checks) >= 10 else 3
    return out


def ensure_week(db: Session, user: User, week: date) -> List[WeeklyMission]:
    """Las misiones de la semana; se eligen la primera vez que se piden y ya no cambian."""
    existing = db.query(WeeklyMission).filter(WeeklyMission.user_id == user.id, WeeklyMission.week_start == week)\
        .order_by(WeeklyMission.id).all()
    if existing:
        return existing
    cand = _candidates(db, user, week)
    rng = random.Random(f"{user.id}:{week.isoformat()}")  # misma elección aunque se pida dos veces a la vez
    keys = sorted(cand)
    habit_keys = [k for k in ("perfect_days", "habit_checks") if k in cand]
    chosen = [rng.choice(habit_keys)] if habit_keys else []  # quien tiene rutinas, siempre una misión de rutinas
    rest = [k for k in keys if k not in chosen and k not in habit_keys]
    chosen += rng.sample(rest, PER_WEEK - len(chosen))
    for k in chosen:
        xp, coins = REWARD[k]
        db.add(WeeklyMission(user_id=user.id, week_start=week, key=k, target=cand[k], reward_xp=xp, reward_coins=coins))
    try:
        db.commit()
    except Exception:  # otra petición simultánea ya las creó
        db.rollback()
    return db.query(WeeklyMission).filter(WeeklyMission.user_id == user.id, WeeklyMission.week_start == week)\
        .order_by(WeeklyMission.id).all()
