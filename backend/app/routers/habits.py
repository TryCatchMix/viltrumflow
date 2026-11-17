from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Dict, List, Optional, Set

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from .. import schemas
from ..database import get_db
from ..deps import get_current_user
from ..models import Habit, HabitCheck, HabitFreeze, User
from ..services import game
from ..services.reminders import user_tz

router = APIRouter()

EDIT_WINDOW = 7  # días hacia atrás en los que aún se puede marcar una rutina olvidada


def local_today(user: User) -> date:
    return datetime.now(timezone.utc).astimezone(user_tz(user)).date()


def week_start(d: date) -> date:
    return d - timedelta(days=d.weekday())


def is_weekly(h: Habit) -> bool:
    return bool(h.weekly_target)


def scheduled(h: Habit, d: date) -> bool:
    """¿Aparece ese día? Las semanales, todos los días; las de días fijos, solo los elegidos."""
    return d >= h.start_day and (is_weekly(h) or str(d.weekday()) in h.days)


def _get(db: Session, user: User, habit_id: int) -> Habit:
    h = db.get(Habit, habit_id)
    if not h or h.user_id != user.id:
        raise HTTPException(404, "Rutina no encontrada")
    return h


def checks_by_habit(db: Session, habit_ids: List[int]) -> Dict[int, Dict[date, HabitCheck]]:
    out: Dict[int, Dict[date, HabitCheck]] = defaultdict(dict)
    if habit_ids:
        for c in db.query(HabitCheck).filter(HabitCheck.habit_id.in_(habit_ids)):
            out[c.habit_id][c.day] = c
    return out


def done_days(h: Habit, checks: Dict[date, HabitCheck]) -> Set[date]:
    """Días cumplidos: los que llegaron a la cantidad objetivo."""
    target = h.target_count or 1
    return {d for d, c in checks.items() if (c.count or 0) >= target}


def week_count(done: Set[date], d: date) -> int:
    start = week_start(d)
    return sum(1 for x in done if start <= x <= start + timedelta(days=6))


def streak_at(h: Habit, done: Set[date], day: date, frozen: Set[date] = frozenset()) -> int:
    """
    Días programados seguidos cumplidos hasta `day` (o semanas seguidas con el objetivo alcanzado,
    si es semanal). El día o la semana en curso, si aún no se ha cumplido, no rompe la racha.
    Un día salvado por un protector (`frozen`) ni rompe la racha ni la alarga.
    """
    n = 0
    if is_weekly(h):
        w = week_start(day)
        for _ in range(260):
            if w + timedelta(days=6) < h.start_day:
                break
            if week_count(done, w) >= h.weekly_target:
                n += 1
            elif w != week_start(day):
                break
            w -= timedelta(days=7)
        return n
    d = day
    for _ in range(730):
        if d < h.start_day:
            break
        if scheduled(h, d):
            if d in done:
                n += 1
            elif d not in frozen and d != day:
                break
        d -= timedelta(days=1)
    return n


def best_streak(h: Habit, done: Set[date], until: date, frozen: Set[date] = frozenset()) -> int:
    best = run = 0
    if is_weekly(h):
        w = week_start(max(h.start_day, until - timedelta(days=730)))
        while w <= until:
            if week_count(done, w) >= h.weekly_target:
                run += 1
                best = max(best, run)
            elif w != week_start(until):
                run = 0
            w += timedelta(days=7)
        return best
    d = max(h.start_day, until - timedelta(days=730))
    while d <= until:
        if scheduled(h, d):
            if d in done:
                run += 1
                best = max(best, run)
            elif d not in frozen and d != until:
                run = 0
        d += timedelta(days=1)
    return best


def frozen_by_habit(db: Session, habit_ids: List[int]) -> Dict[int, Set[date]]:
    out: Dict[int, Set[date]] = defaultdict(set)
    if habit_ids:
        for hid, d in db.query(HabitFreeze.habit_id, HabitFreeze.day).filter(HabitFreeze.habit_id.in_(habit_ids)):
            out[hid].add(d)
    return out


MAX_FREEZES = 2
FREEZE_LOOKBACK = 7


def apply_freezes(db: Session, user: User) -> List[dict]:
    """
    Gasta protectores en los días ya terminados en los que una rutina diaria con racha no se cumplió.
    Revisa cada día una sola vez (`freezes_checked_on`), en orden, y protege primero las rachas más largas.
    Devuelve los días salvados.
    """
    today = local_today(user)
    last = today - timedelta(days=1)
    start = max(user.freezes_checked_on + timedelta(days=1), today - timedelta(days=FREEZE_LOOKBACK)) \
        if user.freezes_checked_on else last
    used: List[dict] = []
    if user.streak_freezes > 0 and start <= last:
        habits = db.query(Habit).filter(Habit.user_id == user.id, Habit.is_archived.is_(False), Habit.weekly_target.is_(None)).all()
        checks, frozen = checks_by_habit(db, [h.id for h in habits]), frozen_by_habit(db, [h.id for h in habits])
        done = {h.id: done_days(h, checks[h.id]) for h in habits}
        d = start
        while d <= last and user.streak_freezes > 0:
            missed = []
            for h in habits:
                if not scheduled(h, d) or d in done[h.id] or d in frozen[h.id]:
                    continue
                prev = d - timedelta(days=1)
                # Racha que llegaba viva hasta el día anterior (un día anterior fallado y sin proteger la rompió)
                broken = scheduled(h, prev) and prev >= h.start_day and prev not in done[h.id] and prev not in frozen[h.id]
                streak = 0 if broken else streak_at(h, done[h.id], prev, frozen[h.id])
                if streak >= 1:
                    missed.append((streak, h))
            for streak, h in sorted(missed, key=lambda x: -x[0]):
                if user.streak_freezes <= 0:
                    break
                db.add(HabitFreeze(habit_id=h.id, day=d))
                frozen[h.id].add(d)
                user.streak_freezes -= 1
                used.append({"habit_id": h.id, "title": h.title, "day": d.isoformat(), "streak": streak})
            d += timedelta(days=1)
    if user.freezes_checked_on != last:
        user.freezes_checked_on = last
    db.commit()
    return used


def _item(h: Habit, checks: Dict[date, HabitCheck], day: date, frozen: Set[date] = frozenset()) -> schemas.HabitDayItem:
    item = schemas.HabitDayItem.model_validate(h)
    done = done_days(h, checks)
    c = checks.get(day)
    item.count = c.count if c else 0
    item.checked, item.checked_at = day in done, c.checked_at if c else None
    item.streak = streak_at(h, done, day, frozen)
    item.week_done = week_count(done, day)
    if item.checked:
        item.xp = game.habit_xp(h, item.streak)
    else:  # lo que valdría completarla: si con ella se cumple el día o la semana, la racha sube
        # Si completarla cumple el día (o el objetivo de la semana), la racha sube en uno
        raises = (not is_weekly(h)) or week_count(done | {day}, day) == h.weekly_target
        item.xp = game.habit_xp(h, item.streak + (1 if raises else 0))
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
    h.unit = h.unit.strip()
    db.add(h)
    db.commit()
    db.refresh(h)
    return h


@router.get("/day", response_model=List[schemas.HabitDayItem])
def habits_of_day(day: Optional[date] = None, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Rutinas que tocan ese día (por defecto, hoy en la zona horaria del usuario) con su estado."""
    day = day or local_today(user)
    apply_freezes(db, user)
    habits = [h for h in db.query(Habit).filter(Habit.user_id == user.id, Habit.is_archived.is_(False))
              .order_by(Habit.position, Habit.id) if scheduled(h, day)]
    checks, frozen = checks_by_habit(db, [h.id for h in habits]), frozen_by_habit(db, [h.id for h in habits])
    return [_item(h, checks[h.id], day, frozen[h.id]) for h in habits]


def compute_stats(db: Session, user: User, first: date, last: date, today: date) -> dict:
    """Cumplimiento entre `first` y `last` (incluidos). Lo de hoy solo cuenta si ya está hecho."""
    tz = user_tz(user)
    span = [first + timedelta(days=i) for i in range((last - first).days + 1)]
    habits = db.query(Habit).filter(Habit.user_id == user.id, Habit.is_archived.is_(False)).order_by(Habit.position, Habit.id).all()
    all_checks = checks_by_habit(db, [h.id for h in habits])
    all_frozen = frozen_by_habit(db, [h.id for h in habits])
    daily = [{"date": d.isoformat(), "scheduled": 0, "done": 0} for d in span]
    hours = [0] * 24
    weekday = [[0, 0] for _ in range(7)]  # [cumplidas, programadas] por día de la semana
    out = []
    for h in habits:
        checks, frozen = all_checks[h.id], all_frozen[h.id]
        done = done_days(h, checks)
        states, minutes, on_time, timed = [], [], 0, 0
        target = int(h.target_time[:2]) * 60 + int(h.target_time[3:]) if h.target_time else None
        for i, d in enumerate(span):
            if not scheduled(h, d):
                states.append("off")
                continue
            c = checks.get(d)
            if d in done:
                states.append("done")
                local = (c.checked_at if c.checked_at.tzinfo else c.checked_at.replace(tzinfo=timezone.utc)).astimezone(tz)
                if local.date() == d:  # marcada ese mismo día: la hora es significativa
                    minute = local.hour * 60 + local.minute
                    minutes.append(minute)
                    hours[local.hour] += 1
                    if target is not None:
                        timed += 1
                        on_time += minute <= target
            elif d in frozen:
                states.append("frozen")  # fallada, pero un protector salvó la racha: no cuenta ni a favor ni en contra
            elif c and c.count:
                states.append("partial")  # cantidad empezada pero sin llegar al objetivo
            elif is_weekly(h):
                states.append("free")  # día libre de una rutina semanal: no es un fallo
            else:
                states.append("pending" if d == today else "missed")
            if is_weekly(h):
                continue  # las semanales se cuentan por semanas, no por días
            if d in frozen and d not in done:
                continue
            if d != today or d in done:  # hoy solo cuenta si ya está hecha: el día no ha terminado
                daily[i]["scheduled"] += 1
                daily[i]["done"] += d in done
                weekday[d.weekday()][1] += 1
                weekday[d.weekday()][0] += d in done
        if is_weekly(h):
            # Semanas del periodo; la semana en curso solo cuenta si el objetivo ya está cumplido
            weeks, w = [], week_start(max(first, h.start_day))
            while w <= last:
                met = week_count(done, w) >= h.weekly_target
                if met or w + timedelta(days=6) < today:
                    weeks.append(met)
                w += timedelta(days=7)
            sched, n_done = len(weeks), sum(weeks)
        else:
            sched = sum(1 for d, s in zip(span, states) if s in ("done", "missed") or (s == "partial" and d != today))
            n_done = states.count("done")
        out.append({
            "id": h.id, "title": h.title, "color": h.color, "target_time": h.target_time, "days": h.days,
            "weekly_target": h.weekly_target, "target_count": h.target_count, "unit": h.unit,
            "period": "week" if is_weekly(h) else "day",
            "scheduled": sched, "done": n_done, "rate": round(100 * n_done / sched) if sched else None,
            "streak": streak_at(h, done, min(last, today), frozen), "best_streak": best_streak(h, done, min(last, today), frozen),
            "frozen": len([d for d in span if d in frozen and d not in done]),
            "avg_minute": round(sum(minutes) / len(minutes)) if minutes else None,
            "on_time_rate": round(100 * on_time / timed) if timed else None,
            "states": states,
        })
    total_s = sum(d["scheduled"] for d in daily) + sum(h["scheduled"] for h in out if h["period"] == "week")
    total_d = sum(d["done"] for d in daily) + sum(h["done"] for h in out if h["period"] == "week")
    return {
        "days": [d.isoformat() for d in span],
        "habits": out,
        "daily": daily,
        "hours": hours,
        "weekday": [round(100 * a / b) if b else None for a, b in weekday],
        "scheduled": total_s, "done": total_d, "rate": round(100 * total_d / total_s) if total_s else None,
        "perfect_days": sum(1 for d in daily if d["scheduled"] and d["done"] == d["scheduled"]),
    }


@router.get("/stats")
def stats(days: int = Query(30, ge=7, le=180), user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Cumplimiento por día y por rutina, rachas y a qué hora se suelen marcar."""
    apply_freezes(db, user)
    today = local_today(user)
    return compute_stats(db, user, today - timedelta(days=days - 1), today, today)


@router.put("/{habit_id}", response_model=schemas.HabitOut)
def update_habit(habit_id: int, data: schemas.HabitUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    h = _get(db, user, habit_id)
    values = data.model_dump(exclude_unset=True)
    for k, v in values.items():
        if v is None and k not in ("target_time", "weekly_target"):
            continue
        setattr(h, k, v.strip() if k == "unit" else v)
    db.commit()
    db.refresh(h)
    return h


@router.delete("/{habit_id}", status_code=204)
def delete_habit(habit_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Elimina la rutina y su historial. La experiencia ya ganada con ella se conserva."""
    db.delete(_get(db, user, habit_id))
    db.commit()


def _set_count(db: Session, user: User, h: Habit, day: date, count: int) -> schemas.HabitCheckResult:
    """Fija el progreso del día. Al alcanzar el objetivo da experiencia; si se baja de él, la retira."""
    today = local_today(user)
    if day > today or day < today - timedelta(days=EDIT_WINDOW) or not scheduled(h, day):
        raise HTTPException(400, "Ese día no se puede marcar: no estaba programada o queda fuera de los últimos 7 días")
    apply_freezes(db, user)
    target = h.target_count or 1
    existing = db.query(HabitCheck).filter(HabitCheck.habit_id == h.id, HabitCheck.day == day).first()
    was_done = bool(existing and existing.count >= target)
    if count <= 0:
        if existing:
            db.delete(existing)
    elif existing:
        if existing.count != count:
            existing.count = count
            existing.checked_at = datetime.now(timezone.utc)
    else:
        db.add(HabitCheck(habit_id=h.id, day=day, count=count))
    db.commit()
    ref, gained = f"{h.id}:{day.isoformat()}", 0
    now_done = count >= target
    if now_done and not was_done:
        # Si ese día lo había salvado un protector, ya no hace falta: se devuelve
        freeze = db.query(HabitFreeze).filter(HabitFreeze.habit_id == h.id, HabitFreeze.day == day).first()
        if freeze:
            db.delete(freeze)
            user.streak_freezes = min(MAX_FREEZES, user.streak_freezes + 1)
            db.commit()
        done = done_days(h, checks_by_habit(db, [h.id])[h.id])
        frozen = frozen_by_habit(db, [h.id])[h.id]
        gained = game.award(db, user.id, "habit", ref, game.habit_xp(h, streak_at(h, done, day, frozen)), h.title)
    elif was_done and not now_done:
        game.revoke(db, "habit", ref)
    return schemas.HabitCheckResult(item=_item(h, checks_by_habit(db, [h.id])[h.id], day, frozen_by_habit(db, [h.id])[h.id]), xp_gained=gained)


@router.put("/{habit_id}/check", response_model=schemas.HabitCheckResult)
def check_habit(habit_id: int, data: schemas.HabitCheckIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Marca o desmarca la rutina en un día: hoy o, si se olvidó, alguno de los 7 anteriores."""
    h = _get(db, user, habit_id)
    return _set_count(db, user, h, data.day, (h.target_count or 1) if data.checked else 0)


@router.put("/{habit_id}/count", response_model=schemas.HabitCheckResult)
def count_habit(habit_id: int, data: schemas.HabitCountIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Progreso de una rutina con cantidad (p. ej. 5 de 8 vasos)."""
    return _set_count(db, user, _get(db, user, habit_id), data.day, data.count)
