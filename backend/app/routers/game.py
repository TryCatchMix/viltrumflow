from collections import defaultdict
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import String, cast, func
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user
from ..models import CoinEntry, Habit, HabitCheck, HabitFreeze, PomodoroSession, Reward, Task, User, WeeklyMission, XpEvent
from ..services import economy, game, missions as mission_service
from ..services.reminders import user_tz
from .habits import MAX_FREEZES, apply_freezes, best_streak, checks_by_habit, done_days, frozen_by_habit, local_today, week_start

router = APIRouter()

KIND = {"task": "task", "subtask": "task", "habit": "habit", "focus": "focus", "review": "review", "mission": "mission"}


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
    missions = db.query(func.count(XpEvent.id)).filter(XpEvent.user_id == user.id, XpEvent.kind == "mission").scalar()
    redeemed = db.query(func.count(CoinEntry.id)).filter(CoinEntry.user_id == user.id, CoinEntry.reason == "reward").scalar()
    today = local_today(user)
    streak = 0
    habits = db.query(Habit).filter(Habit.user_id == user.id, Habit.weekly_target.is_(None)).all()  # racha en días
    by_habit, frozen = checks_by_habit(db, [h.id for h in habits]), frozen_by_habit(db, [h.id for h in habits])
    for h in habits:
        streak = max(streak, best_streak(h, done_days(h, by_habit[h.id]), today, frozen[h.id]))
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
        ("missions10", "Mercenario del Imperio", "Completa 10 misiones semanales", missions, 10),
        ("reward1", "Botín merecido", "Canjea tu primera recompensa", redeemed, 1),
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
    per_day = defaultdict(lambda: {"task": 0, "habit": 0, "focus": 0, "review": 0, "mission": 0})
    totals = {"task": 0, "habit": 0, "focus": 0, "review": 0, "mission": 0}
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


# ---------- Monedero y protector de racha ----------
def _wallet(db: Session, user: User) -> dict:
    xp = game.total_xp(db, user.id)
    today = local_today(user)
    recent = db.query(HabitFreeze, Habit.title).join(Habit, Habit.id == HabitFreeze.habit_id).filter(
        Habit.user_id == user.id, HabitFreeze.day >= today - timedelta(days=7)).order_by(HabitFreeze.day.desc()).all()
    return {
        "coins": economy.balance(db, user.id),
        "next_coin_in": economy.XP_PER_COIN - xp % economy.XP_PER_COIN if xp >= 0 else economy.XP_PER_COIN,
        "xp_per_coin": economy.XP_PER_COIN,
        "freezes": user.streak_freezes, "max_freezes": MAX_FREEZES, "freeze_price": economy.FREEZE_PRICE,
        "recent_freezes": [{"habit": title, "day": f.day.isoformat()} for f, title in recent],
    }


@router.get("/wallet")
def wallet(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Monedas, protectores de racha disponibles y los que se han gastado esta semana."""
    apply_freezes(db, user)
    return _wallet(db, user)


@router.post("/freezes/buy")
def buy_freeze(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if user.streak_freezes >= MAX_FREEZES:
        raise HTTPException(409, f"Ya tienes el máximo de protectores ({MAX_FREEZES})")
    if economy.balance(db, user.id) < economy.FREEZE_PRICE:
        raise HTTPException(409, "No tienes monedas suficientes")
    economy.add(db, user.id, -economy.FREEZE_PRICE, "freeze", detail="Protector de racha")
    user.streak_freezes += 1
    db.commit()
    return _wallet(db, user)


@router.get("/coins/history")
def coin_history(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.query(CoinEntry).filter(CoinEntry.user_id == user.id).order_by(CoinEntry.created_at.desc(), CoinEntry.id.desc()).limit(50).all()
    return [{"id": e.id, "amount": e.amount, "reason": e.reason, "detail": e.detail,
             "created_at": e.created_at if e.created_at.tzinfo else e.created_at.replace(tzinfo=timezone.utc)} for e in rows]


@router.delete("/coins/{entry_id}", status_code=204)
def undo_redemption(entry_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Deshace el canje de una recompensa (devuelve las monedas). Solo para canjes."""
    e = db.get(CoinEntry, entry_id)
    if not e or e.user_id != user.id or e.reason != "reward":
        raise HTTPException(404, "Canje no encontrado")
    db.delete(e)
    db.commit()


# ---------- Misiones semanales ----------
def _mission_out(db: Session, user: User, m: WeeklyMission) -> dict:
    p = mission_service.progress(db, user, m.key, m.week_start)
    return {"key": m.key, "title": mission_service.TEXT[m.key](m.target), "hint": mission_service.HINT[m.key],
            "target": m.target, "progress": min(p, m.target), "reward_xp": m.reward_xp, "reward_coins": m.reward_coins,
            "claimed": m.claimed_at is not None, "claimable": m.claimed_at is None and p >= m.target}


CHEST_TEXT = "Las tres misiones de la semana completadas: protector de racha de regalo"


@router.get("/missions")
def get_missions(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Misiones de la semana en curso. Completar las tres regala un protector de racha."""
    week = week_start(local_today(user))
    ms = mission_service.ensure_week(db, user, week)
    chest = db.query(CoinEntry.id).filter(CoinEntry.user_id == user.id, CoinEntry.reason == "chest", CoinEntry.ref == week.isoformat()).first()
    return {"week_start": week.isoformat(), "week_end": (week + timedelta(days=6)).isoformat(),
            "missions": [_mission_out(db, user, m) for m in ms], "chest_claimed": chest is not None}


@router.post("/missions/{key}/claim")
def claim_mission(key: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    week = week_start(local_today(user))
    ms = mission_service.ensure_week(db, user, week)
    m = next((x for x in ms if x.key == key), None)
    if not m:
        raise HTTPException(404, "Misión no encontrada")
    if m.claimed_at:
        raise HTTPException(409, "Ya reclamaste esta misión")
    if mission_service.progress(db, user, m.key, week) < m.target:
        raise HTTPException(409, "Aún no has completado esta misión")
    m.claimed_at = datetime.now(timezone.utc)
    db.commit()
    ref = f"{user.id}:{week.isoformat()}:{key}"
    game.award(db, user.id, "mission", ref, m.reward_xp, mission_service.TEXT[key](m.target))
    economy.add(db, user.id, m.reward_coins, "mission", ref, mission_service.TEXT[key](m.target))
    chest = False
    if all(x.claimed_at for x in ms) and not db.query(CoinEntry.id).filter(
            CoinEntry.user_id == user.id, CoinEntry.reason == "chest", CoinEntry.ref == week.isoformat()).first():
        economy.add(db, user.id, 0, "chest", week.isoformat(), CHEST_TEXT)
        if user.streak_freezes < MAX_FREEZES:
            user.streak_freezes += 1
            db.commit()
        chest = True
    return {"xp_gained": m.reward_xp, "coins_gained": m.reward_coins, "chest": chest, "wallet": _wallet(db, user)}


# ---------- Recompensas propias ----------
class RewardIn(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    cost: int = Field(ge=1, le=100_000)
    emoji: str = Field("", max_length=16)
    repeatable: bool = True


class RewardUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=120)
    cost: int | None = Field(None, ge=1, le=100_000)
    emoji: str | None = Field(None, max_length=16)
    repeatable: bool | None = None
    is_archived: bool | None = None


def _reward_out(db: Session, r: Reward) -> dict:
    times = db.query(func.count(CoinEntry.id)).filter(CoinEntry.user_id == r.user_id, CoinEntry.reason == "reward", CoinEntry.ref == str(r.id)).scalar()
    return {"id": r.id, "title": r.title, "cost": r.cost, "emoji": r.emoji, "repeatable": r.repeatable,
            "is_archived": r.is_archived, "times_redeemed": times,
            "available": r.repeatable or times == 0}


def _reward(db: Session, user: User, reward_id: int) -> Reward:
    r = db.get(Reward, reward_id)
    if not r or r.user_id != user.id:
        raise HTTPException(404, "Recompensa no encontrada")
    return r


@router.get("/rewards")
def list_rewards(include_archived: bool = False, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    q = db.query(Reward).filter(Reward.user_id == user.id)
    if not include_archived:
        q = q.filter(Reward.is_archived.is_(False))
    return [_reward_out(db, r) for r in q.order_by(Reward.cost, Reward.id)]


@router.post("/rewards", status_code=201)
def create_reward(data: RewardIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    r = Reward(user_id=user.id, title=data.title.strip(), cost=data.cost, emoji=data.emoji.strip(), repeatable=data.repeatable)
    db.add(r)
    db.commit()
    db.refresh(r)
    return _reward_out(db, r)


@router.put("/rewards/{reward_id}")
def update_reward(reward_id: int, data: RewardUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    r = _reward(db, user, reward_id)
    for k, v in data.model_dump(exclude_unset=True).items():
        if v is not None:
            setattr(r, k, v.strip() if isinstance(v, str) else v)
    db.commit()
    return _reward_out(db, r)


@router.delete("/rewards/{reward_id}", status_code=204)
def delete_reward(reward_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Borra la recompensa. Los canjes ya hechos siguen en el historial."""
    db.delete(_reward(db, user, reward_id))
    db.commit()


@router.post("/rewards/{reward_id}/redeem")
def redeem(reward_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    r = _reward(db, user, reward_id)
    out = _reward_out(db, r)
    if r.is_archived or not out["available"]:
        raise HTTPException(409, "Esta recompensa ya se canjeó y no se puede repetir")
    if economy.balance(db, user.id) < r.cost:
        raise HTTPException(409, "No tienes monedas suficientes")
    entry = economy.add(db, user.id, -r.cost, "reward", str(r.id), f"{r.emoji} {r.title}".strip())
    return {"entry_id": entry.id, "reward": _reward_out(db, r), "wallet": _wallet(db, user)}
