"""Diario de ánimo y energía, y su relación con lo que se hace cada día."""
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from math import sqrt
from typing import Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user
from ..models import Habit, MoodEntry, PomodoroSession, User, XpEvent
from ..services.reminders import user_tz
from .habits import checks_by_habit, done_days, is_weekly, local_today, scheduled

router = APIRouter()

FACTORS = {
    "slept_well": "Dormí bien", "slept_bad": "Dormí mal", "exercise": "Ejercicio", "outdoors": "Aire libre",
    "social": "Vida social", "stress": "Estrés", "sick": "Malestar", "rest": "Descanso",
}
BACKFILL_DAYS = 30  # se puede rellenar un día olvidado hasta un mes atrás
MIN_FACTOR_DAYS = 3  # días con (y sin) un factor para comparar
MIN_CORR_DAYS = 7


class MoodIn(BaseModel):
    mood: int = Field(ge=1, le=5)
    energy: int = Field(ge=1, le=5)
    factors: List[str] = Field(default_factory=list, max_length=len(FACTORS))
    note: Optional[str] = Field(None, max_length=2000)

    @field_validator("factors")
    @classmethod
    def _known(cls, v):
        unknown = [f for f in v if f not in FACTORS]
        if unknown:
            raise ValueError(f"Factores desconocidos: {', '.join(unknown)}")
        return list(dict.fromkeys(v))


def _out(e: MoodEntry) -> dict:
    return {"day": e.day.isoformat(), "mood": e.mood, "energy": e.energy,
            "factors": [f for f in (e.factors or "").split(",") if f], "note": e.note}


@router.get("")
def entries(days: int = Query(90, ge=7, le=370), user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    today = local_today(user)
    rows = db.query(MoodEntry).filter(MoodEntry.user_id == user.id, MoodEntry.day > today - timedelta(days=days))\
        .order_by(MoodEntry.day).all()
    todays = next((r for r in rows if r.day == today), None)
    return {
        "today": today.isoformat(), "entry_today": _out(todays) if todays else None,
        "entries": [_out(r) for r in rows],
        "factors": [{"key": k, "label": v} for k, v in FACTORS.items()],
    }


def _day(user: User, day: date) -> date:
    today = local_today(user)
    if day > today:
        raise HTTPException(400, "No se puede registrar un día que aún no ha llegado")
    if day < today - timedelta(days=BACKFILL_DAYS):
        raise HTTPException(400, f"Solo se pueden registrar los últimos {BACKFILL_DAYS} días")
    return day


@router.put("/{day}")
def save(day: date, data: MoodIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    day = _day(user, day)
    e = db.query(MoodEntry).filter(MoodEntry.user_id == user.id, MoodEntry.day == day).first()
    if not e:
        e = MoodEntry(user_id=user.id, day=day)
        db.add(e)
    e.mood, e.energy, e.factors = data.mood, data.energy, ",".join(data.factors)
    e.note = (data.note or "").strip() or None
    db.commit()
    return _out(e)


@router.delete("/{day}", status_code=204)
def delete(day: date, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db.query(MoodEntry).filter(MoodEntry.user_id == user.id, MoodEntry.day == day).delete()
    db.commit()


# ---------- Análisis ----------
def _local(dt: datetime, tz) -> datetime:
    return (dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)).astimezone(tz)


def _pearson(xs: List[float], ys: List[float]) -> Optional[float]:
    n = len(xs)
    if n < MIN_CORR_DAYS:
        return None
    mx, my = sum(xs) / n, sum(ys) / n
    sx = sqrt(sum((x - mx) ** 2 for x in xs))
    sy = sqrt(sum((y - my) ** 2 for y in ys))
    if not sx or not sy:
        return None
    return round(sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / (sx * sy), 2)


def _avg(values: List[float], digits: int = 1) -> Optional[float]:
    return round(sum(values) / len(values), digits) if values else None


def _activity(db: Session, user: User, first: date, last: date) -> Tuple[Dict[date, dict], List[int], List[int]]:
    """Por día: tareas completadas, % de rutinas diarias cumplidas y minutos de enfoque. También, por hora."""
    tz = user_tz(user)
    since = datetime.combine(first, datetime.min.time(), tzinfo=tz) - timedelta(days=1)
    per_day = defaultdict(lambda: {"tasks": 0, "focus": 0.0, "due": 0, "done": 0})
    hours_tasks, hours_focus = [0] * 24, [0.0] * 24
    for (created,) in db.query(XpEvent.created_at).filter(
            XpEvent.user_id == user.id, XpEvent.kind == "task", XpEvent.created_at >= since):
        local = _local(created, tz)
        if first <= local.date() <= last:
            per_day[local.date()]["tasks"] += 1
            hours_tasks[local.hour] += 1
    for ended, seconds in db.query(PomodoroSession.ended_at, PomodoroSession.seconds).filter(
            PomodoroSession.user_id == user.id, PomodoroSession.ended_at >= since):
        local = _local(ended, tz)
        if first <= local.date() <= last:
            per_day[local.date()]["focus"] += seconds / 60
            # El bloque cuenta en la hora en que se trabajó (la de inicio), no en la que terminó
            hours_focus[(local - timedelta(seconds=seconds)).hour] += seconds / 60
    habits = [h for h in db.query(Habit).filter(Habit.user_id == user.id, Habit.is_archived.is_(False)) if not is_weekly(h)]
    checks = checks_by_habit(db, [h.id for h in habits])
    for h in habits:
        done = done_days(h, checks[h.id])
        d = max(first, h.start_day)
        while d <= last:
            if scheduled(h, d):
                per_day[d]["due"] += 1
                per_day[d]["done"] += d in done
            d += timedelta(days=1)
    return per_day, hours_tasks, [round(m) for m in hours_focus]


def _group(days: List[dict]) -> dict:
    rates = [d["habits"] for d in days if d["habits"] is not None]
    return {
        "days": len(days),
        "tasks": _avg([d["tasks"] for d in days]),
        "habits": round(sum(rates) / len(rates)) if rates else None,
        "focus": _avg([d["focus"] for d in days], 0),
    }


@router.get("/insights")
def insights(days: int = Query(30, ge=7, le=370), user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    today = local_today(user)
    first = today - timedelta(days=days - 1)
    rows = db.query(MoodEntry).filter(MoodEntry.user_id == user.id, MoodEntry.day >= first).order_by(MoodEntry.day).all()
    per_day, hours_tasks, hours_focus = _activity(db, user, first, today)

    logged = []
    for e in rows:
        a = per_day.get(e.day, {"tasks": 0, "focus": 0, "due": 0, "done": 0})
        logged.append({
            "day": e.day, "mood": e.mood, "energy": e.energy, "factors": set(filter(None, (e.factors or "").split(","))),
            "tasks": a["tasks"], "focus": round(a["focus"]),
            "habits": round(100 * a["done"] / a["due"]) if a["due"] else None,
        })

    def bands(key: str) -> dict:
        return {
            "low": _group([d for d in logged if d[key] <= 2]),
            "mid": _group([d for d in logged if d[key] == 3]),
            "high": _group([d for d in logged if d[key] >= 4]),
        }

    with_habits = [d for d in logged if d["habits"] is not None]
    weekdays = []
    for wd in range(7):
        ds = [d for d in logged if d["day"].weekday() == wd]
        weekdays.append({"weekday": wd, "days": len(ds), "mood": _avg([d["mood"] for d in ds]), "energy": _avg([d["energy"] for d in ds])})

    factors = []
    for key, label in FACTORS.items():
        yes = [d for d in logged if key in d["factors"]]
        no = [d for d in logged if key not in d["factors"]]
        if len(yes) >= MIN_FACTOR_DAYS and len(no) >= MIN_FACTOR_DAYS:
            factors.append({
                "key": key, "label": label, "days": len(yes),
                "mood_with": _avg([d["mood"] for d in yes]), "mood_without": _avg([d["mood"] for d in no]),
                "energy_with": _avg([d["energy"] for d in yes]), "energy_without": _avg([d["energy"] for d in no]),
            })
    factors.sort(key=lambda f: -abs((f["mood_with"] or 0) - (f["mood_without"] or 0)))

    # Racha de días seguidos con registro, terminando hoy (o ayer, si hoy aún no se ha registrado)
    have = {e.day for e in rows}
    streak, d = 0, today if today in have else today - timedelta(days=1)
    while d in have:
        streak += 1
        d -= timedelta(days=1)

    return {
        "days": days, "logged": len(logged), "streak": streak,
        "avg_mood": _avg([d["mood"] for d in logged]), "avg_energy": _avg([d["energy"] for d in logged]),
        "by_mood": bands("mood"), "by_energy": bands("energy"),
        "correlations": {
            "mood_tasks": _pearson([d["mood"] for d in logged], [d["tasks"] for d in logged]),
            "energy_tasks": _pearson([d["energy"] for d in logged], [d["tasks"] for d in logged]),
            "energy_focus": _pearson([d["energy"] for d in logged], [d["focus"] for d in logged]),
            "mood_habits": _pearson([d["mood"] for d in with_habits], [d["habits"] for d in with_habits]),
        },
        "weekdays": weekdays,
        "hours": {"tasks": hours_tasks, "focus": hours_focus},
        "factors": factors,
    }
