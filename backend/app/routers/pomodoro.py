import json
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import schemas
from ..database import get_db
from ..deps import get_current_user
from ..models import PomodoroSession, Task, User
from ..services import access, game
from ..services.reminders import user_tz

router = APIRouter()


def _settings(user: User) -> schemas.PomodoroSettings:
    try:
        return schemas.PomodoroSettings(**json.loads(user.pomodoro or "{}"))
    except (ValueError, TypeError):
        return schemas.PomodoroSettings()


@router.get("/settings", response_model=schemas.PomodoroSettings)
def get_settings(user: User = Depends(get_current_user)):
    return _settings(user)


@router.put("/settings", response_model=schemas.PomodoroSettings)
def put_settings(data: schemas.PomodoroSettings, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    user.pomodoro = data.model_dump_json()
    db.commit()
    return data


class TimerIn(schemas.BaseModel):
    ends_at: datetime
    phase: str = schemas.Field(pattern="^(focus|short|long)$")


@router.put("/timer", status_code=204)
def set_timer(data: TimerIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """El reloj está en marcha y termina a esa hora: el servidor avisará por push aunque la app esté cerrada."""
    ends = data.ends_at if data.ends_at.tzinfo else data.ends_at.replace(tzinfo=timezone.utc)
    if not timedelta(0) < ends - datetime.now(timezone.utc) <= timedelta(hours=4):
        raise HTTPException(400, "Hora de fin no válida")
    user.pomodoro_ends_at, user.pomodoro_phase = ends, data.phase
    db.commit()


@router.delete("/timer", status_code=204)
def clear_timer(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Reloj en pausa, reiniciado o terminado con la app abierta: no hace falta avisar."""
    user.pomodoro_ends_at, user.pomodoro_phase = None, None
    db.commit()


@router.post("/sessions", response_model=schemas.PomodoroSessionOut, status_code=201)
def log_session(data: schemas.PomodoroSessionIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Registra un bloque de concentración terminado: suma su tiempo a la tarea elegida y da experiencia."""
    now = datetime.now(timezone.utc)
    # Un bloque no puede durar más que el tiempo real transcurrido desde el anterior
    last = db.query(func.max(PomodoroSession.ended_at)).filter(PomodoroSession.user_id == user.id).scalar()
    if last:
        last = last if last.tzinfo else last.replace(tzinfo=timezone.utc)
        if data.seconds > (now - last).total_seconds() + 60:
            raise HTTPException(429, "Ese bloque se solapa con el anterior")
    task = None
    if data.task_id is not None:
        task = db.get(Task, data.task_id)
        if not task or task.deleted_at is not None or not access.can_edit(db, user, task):
            raise HTTPException(400, "Tarea no válida")
        task.time_spent_seconds = (task.time_spent_seconds or 0) + data.seconds
    s = PomodoroSession(user_id=user.id, task_id=task.id if task else None, seconds=data.seconds, ended_at=now)
    db.add(s)
    db.commit()
    db.refresh(s)
    gained = game.award(db, user.id, "focus", str(s.id), data.seconds // game.FOCUS_SECONDS_PER_XP,
                        f"Concentración: {task.title}" if task else "Bloque de concentración")
    return schemas.PomodoroSessionOut(id=s.id, seconds=s.seconds, ended_at=s.ended_at, task_id=s.task_id,
                                      task_title=task.title if task else None, xp_gained=gained)


@router.get("/stats")
def stats(days: int = Query(14, ge=7, le=90), user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    tz = user_tz(user)
    today = datetime.now(timezone.utc).astimezone(tz).date()
    start = today - timedelta(days=days - 1)
    since = datetime.combine(start, datetime.min.time(), tzinfo=tz)
    sessions = db.query(PomodoroSession).filter(PomodoroSession.user_id == user.id, PomodoroSession.ended_at >= since)\
        .order_by(PomodoroSession.ended_at.desc()).all()
    per_day, per_task = defaultdict(lambda: [0, 0]), defaultdict(int)
    for s in sessions:
        d = (s.ended_at if s.ended_at.tzinfo else s.ended_at.replace(tzinfo=timezone.utc)).astimezone(tz).date()
        per_day[d][0] += s.seconds
        per_day[d][1] += 1
        if s.task_id:
            per_task[s.task_id] += s.seconds
    titles = {t.id: t.title for t in db.query(Task).filter(Task.id.in_(per_task.keys()))} if per_task else {}
    return {
        "daily": [{"date": (start + timedelta(days=i)).isoformat(),
                   "minutes": round(per_day[start + timedelta(days=i)][0] / 60), "sessions": per_day[start + timedelta(days=i)][1]}
                  for i in range(days)],
        "today_sessions": per_day[today][1],
        "today_minutes": round(per_day[today][0] / 60),
        "total_minutes": round(sum(s.seconds for s in sessions) / 60),
        "by_task": sorted(({"title": titles.get(i, "Tarea eliminada"), "minutes": round(v / 60)} for i, v in per_task.items()),
                          key=lambda x: -x["minutes"])[:6],
    }
