"""Experiencia, niveles y rangos."""
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..models import Habit, Priority, Status, Task, User, XpEvent

# Nombre y nivel mínimo de cada rango del Imperio
RANKS = [
    ("Aspirante", 1), ("Recluta", 3), ("Soldado", 5), ("Guerrero", 8), ("Veterano", 12),
    ("Centurión", 16), ("Conquistador", 20), ("Comandante", 25), ("General", 30), ("Regente del Imperio", 40),
]
TASK_BASE = {1: 10, 2: 20, 3: 40, 4: 80}
HABIT_BASE = {1: 5, 2: 10, 3: 15, 4: 25}
SUBTASK_XP = 5
FOCUS_SECONDS_PER_XP = 300  # 1 XP por cada 5 minutos de concentración


def level_threshold(level: int) -> int:
    """XP total necesaria para alcanzar un nivel: 0, 100, 300, 600, 1000… (cada nivel pide 100 más que el anterior)."""
    return 50 * (level - 1) * level


def level_for(xp: int) -> int:
    level = 1
    while level_threshold(level + 1) <= xp:
        level += 1
    return level


def rank_index(level: int) -> int:
    return max(i for i, (_, minimum) in enumerate(RANKS) if level >= minimum)


def total_xp(db: Session, user_id: int) -> int:
    return int(db.query(func.coalesce(func.sum(XpEvent.amount), 0)).filter(XpEvent.user_id == user_id).scalar())


def award(db: Session, user_id: int, kind: str, ref: str, amount: int, detail: str = "") -> int:
    """Concede experiencia una sola vez por (kind, ref). Devuelve lo concedido (0 si ya estaba)."""
    if amount <= 0 or db.query(XpEvent.id).filter(XpEvent.kind == kind, XpEvent.ref == ref).first():
        return 0
    db.add(XpEvent(user_id=user_id, kind=kind, ref=ref, amount=amount, detail=detail[:200]))
    db.commit()
    return amount


def revoke(db: Session, kind: str, ref: str) -> None:
    """Retira la experiencia de algo que se ha deshecho (tarea reabierta, check desmarcado)."""
    if db.query(XpEvent).filter(XpEvent.kind == kind, XpEvent.ref == ref).delete():
        db.commit()


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def task_xp(task: Task) -> int:
    """
    Experiencia por completar una tarea:
    base según dificultad + tiempo (1 XP por cada 5 min registrados, máx. 60; sin registro, 1 por cada 12 min estimados, máx. 40)
    + 25 % de la base si se termina a tiempo + un extra por prioridad alta o urgente.
    """
    base = TASK_BASE.get(task.difficulty or 2, 20)
    spent = task.time_spent_seconds or 0
    effort = min(60, spent // 300) if spent >= 300 else min(40, (task.estimated_minutes or 0) // 12)
    on_time = 0
    if task.due_date and task.completed_at:
        deadline = _aware(task.due_date) + (timedelta(days=1) if task.all_day else timedelta(0))
        if _aware(task.completed_at) <= deadline:
            on_time = round(base * 0.25)
    priority = {Priority.URGENT: 5, Priority.HIGH: 3}.get(task.priority, 0)
    return base + effort + on_time + priority


def on_task_status(db: Session, actor: User, task: Task) -> int:
    """Tras un cambio de estado: da la experiencia a quien la completa, o la retira si se reabre."""
    kind = "subtask" if task.parent_task_id else "task"
    if task.status != Status.COMPLETED:
        revoke(db, kind, str(task.id))
        return 0
    amount = SUBTASK_XP if task.parent_task_id else task_xp(task)
    return award(db, actor.id, kind, str(task.id), amount, task.title)


def habit_xp(habit: Habit, streak: int) -> int:
    """Base según dificultad + 1 por cada día de racha (máx. 10): la constancia puntúa."""
    return HABIT_BASE.get(habit.difficulty or 2, 10) + min(max(streak - 1, 0), 10)


def profile(db: Session, user: User) -> dict:
    xp = total_xp(db, user.id)
    level = level_for(xp)
    idx = rank_index(level)
    start, nxt = level_threshold(level), level_threshold(level + 1)
    return {
        "xp": xp, "level": level, "level_start_xp": start, "next_level_xp": nxt,
        "rank_index": idx, "rank": RANKS[idx][0],
        "next_rank": RANKS[idx + 1][0] if idx + 1 < len(RANKS) else None,
        "next_rank_level": RANKS[idx + 1][1] if idx + 1 < len(RANKS) else None,
        "ranks": [{"name": n, "min_level": m, "min_xp": level_threshold(m)} for n, m in RANKS],
    }
