from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Dict, List, Optional, Set

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from .. import schemas
from ..database import get_db
from ..deps import get_current_user
from ..models import Habit, HabitCheck, User
from ..services import game
from ..services.reminders import user_tz

router = APIRouter()

EDIT_WINDOW = 7  # días hacia atrás en los que aún se puede marcar una rutina olvidada


def local_today(user: User) -> date:
    return datetime.now(timezone.utc).astimezone(user_tz(user)).date()


def scheduled(h: Habit, d: date) -> bool:
    return d >= h.start_day and str(d.weekday()) in h.days


def _get(db: Session, user: User, habit_id: int) -> Habit:
    h = db.get(Habit, habit_id)
    if not h or h.user_id != user.id:
        raise HTTPException(404, "Rutina no encontrada")
    return h


def _done_days(db: Session, habit_ids: List[int]) -> Dict[int, Dict[date, HabitCheck]]:
    out: Dict[int, Dict[date, HabitCheck]] = defaultdict(dict)
    if habit_ids:
        for c in db.query(HabitCheck).filter(HabitCheck.habit_id.in_(habit_ids)):
            out[c.habit_id][c.day] = c
    return out


def streak_at(h: Habit, done: Set[date], day: date) -> int:
    """Días programados seguidos cumplidos hasta `day`. Si `day` aún no está marcado, no rompe la racha."""
    n, d = 0, day
    for _ in range(730):
        if d < h.start_day:
            break
        if scheduled(h, d):
            if d in done:
                n += 1
            elif d != day:
                break
        d -= timedelta(days=1)
    return n


def best_streak(h: Habit, done: Set[date], until: date) -> int:
    best = run = 0
    d = max(h.start_day, until - timedelta(days=730))
    while d <= until:
        if scheduled(h, d):
            if d in done:
                run += 1
                best = max(best, run)
            elif d != until:
                run = 0
        d += timedelta(days=1)
    return best


def _item(h: Habit, checks: Dict[date, HabitCheck], day: date) -> schemas.HabitDayItem:
    item = schemas.HabitDayItem.model_validate(h)
    c = checks.get(day)
    item.checked, item.checked_at = c is not None, c.checked_at if c else None
    item.streak = streak_at(h, set(checks), day)
    # Lo que vale marcarla: si aún no está marcada, la racha contaría un día más
    item.xp = game.habit_xp(h, item.streak if c else item.streak + 1)
    return item


@router.get("", response_model=List[schemas.HabitOut])
def list_habits(include_archived: bool = False, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    q = db.query(Habit).filter(Habit.user_id == user.id)
    if not include_archived:
        q = q.filter(Habit.is_archived.is_(False))
    return q.order_by(Habit.position, Habit.id).all()


@router.post("", response_model=schemas.HabitOut, status_code=201)
def create_habit(data: schemas.HabitIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    last = db.query(Habit.position).filter(Habit.user_id == user.id).order_by(Habit.position.desc()).first()
    h = Habit(**data.model_dump(), user_id=user.id, start_day=local_today(user), position=(last[0] + 1) if last else 0)
    db.add(h)
    db.commit()
    db.refresh(h)
    return h


@router.get("/day", response_model=List[schemas.HabitDayItem])
def habits_of_day(day: Optional[date] = None, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Rutinas programadas para ese día (por defecto, hoy en la zona horaria del usuario) con su estado."""
    day = day or local_today(user)
    habits = [h for h in db.query(Habit).filter(Habit.user_id == user.id, Habit.is_archived.is_(False))
              .order_by(Habit.position, Habit.id) if scheduled(h, day)]
    done = _done_days(db, [h.id for h in habits])
    return [_item(h, done[h.id], day) for h in habits]


@router.get("/stats")
def stats(days: int = Query(30, ge=7, le=180), user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Cumplimiento por día y por rutina, rachas y a qué hora se suelen marcar."""
    tz = user_tz(user)
    today = local_today(user)
    span = [today - timedelta(days=days - 1 - i) for i in range(days)]
    habits = db.query(Habit).filter(Habit.user_id == user.id, Habit.is_archived.is_(False)).order_by(Habit.position, Habit.id).all()
    done = _done_days(db, [h.id for h in habits])
    daily = [{"date": d.isoformat(), "scheduled": 0, "done": 0} for d in span]
    hours = [0] * 24
    weekday = [[0, 0] for _ in range(7)]  # [cumplidas, programadas] por día de la semana
    out = []
    for h in habits:
        checks = done[h.id]
        states, minutes, on_time, timed = [], [], 0, 0
        target = int(h.target_time[:2]) * 60 + int(h.target_time[3:]) if h.target_time else None
        for i, d in enumerate(span):
            if not scheduled(h, d):
                states.append("off")
                continue
            c = checks.get(d)
            if c:
                states.append("done")
                local = (c.checked_at if c.checked_at.tzinfo else c.checked_at.replace(tzinfo=timezone.utc)).astimezone(tz)
                if local.date() == d:  # marcada ese mismo día: la hora es significativa
                    minute = local.hour * 60 + local.minute
                    minutes.append(minute)
                    hours[local.hour] += 1
                    if target is not None:
                        timed += 1
                        on_time += minute <= target
            else:
                states.append("pending" if d == today else "missed")
            if d != today or c:  # hoy solo cuenta si ya está hecha: el día no ha terminado
                daily[i]["scheduled"] += 1
                daily[i]["done"] += bool(c)
                weekday[d.weekday()][1] += 1
                weekday[d.weekday()][0] += bool(c)
        sched = sum(1 for s in states if s in ("done", "missed"))
        n_done = states.count("done")
        out.append({
            "id": h.id, "title": h.title, "color": h.color, "target_time": h.target_time, "days": h.days,
            "scheduled": sched, "done": n_done, "rate": round(100 * n_done / sched) if sched else None,
            "streak": streak_at(h, set(checks), today), "best_streak": best_streak(h, set(checks), today),
            "avg_minute": round(sum(minutes) / len(minutes)) if minutes else None,
            "on_time_rate": round(100 * on_time / timed) if timed else None,
            "states": states,
        })
    total_s, total_d = sum(d["scheduled"] for d in daily), sum(d["done"] for d in daily)
    return {
        "days": [d.isoformat() for d in span],
        "habits": out,
        "daily": daily,
        "hours": hours,
        "weekday": [round(100 * a / b) if b else None for a, b in weekday],
        "scheduled": total_s, "done": total_d, "rate": round(100 * total_d / total_s) if total_s else None,
        "perfect_days": sum(1 for d in daily if d["scheduled"] and d["done"] == d["scheduled"]),
    }


@router.put("/{habit_id}", response_model=schemas.HabitOut)
def update_habit(habit_id: int, data: schemas.HabitUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    h = _get(db, user, habit_id)
    values = data.model_dump(exclude_unset=True)
    for k, v in values.items():
        if v is None and k != "target_time":
            continue
        setattr(h, k, v)
    db.commit()
    db.refresh(h)
    return h


@router.delete("/{habit_id}", status_code=204)
def delete_habit(habit_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Elimina la rutina y su historial. La experiencia ya ganada con ella se conserva."""
    db.delete(_get(db, user, habit_id))
    db.commit()


@router.put("/{habit_id}/check", response_model=schemas.HabitCheckResult)
def check_habit(habit_id: int, data: schemas.HabitCheckIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Marca o desmarca la rutina en un día: hoy o, si se olvidó, alguno de los 7 anteriores."""
    h = _get(db, user, habit_id)
    today = local_today(user)
    if data.day > today or data.day < today - timedelta(days=EDIT_WINDOW) or not scheduled(h, data.day):
        raise HTTPException(400, "Ese día no se puede marcar: no estaba programada o queda fuera de los últimos 7 días")
    existing = db.query(HabitCheck).filter(HabitCheck.habit_id == h.id, HabitCheck.day == data.day).first()
    ref, gained = f"{h.id}:{data.day.isoformat()}", 0
    if data.checked and not existing:
        db.add(HabitCheck(habit_id=h.id, day=data.day))
        db.commit()
        done = {d for (d,) in db.query(HabitCheck.day).filter(HabitCheck.habit_id == h.id)}
        gained = game.award(db, user.id, "habit", ref, game.habit_xp(h, streak_at(h, done, data.day)), h.title)
    elif not data.checked and existing:
        db.delete(existing)
        db.commit()
        game.revoke(db, "habit", ref)
    return schemas.HabitCheckResult(item=_item(h, _done_days(db, [h.id])[h.id], data.day), xp_gained=gained)
