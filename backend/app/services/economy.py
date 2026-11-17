"""Monedas: se ganan con la experiencia (1 por cada 10 XP) y con las misiones; se gastan en premios y protectores."""
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..models import CoinEntry
from . import game

XP_PER_COIN = 10
FREEZE_PRICE = 50


def coins_from_xp(db: Session, user_id: int) -> int:
    return max(0, game.total_xp(db, user_id)) // XP_PER_COIN


def ledger_total(db: Session, user_id: int) -> int:
    return int(db.query(func.coalesce(func.sum(CoinEntry.amount), 0)).filter(CoinEntry.user_id == user_id).scalar())


def balance(db: Session, user_id: int) -> int:
    """Puede quedar en negativo si se retira experiencia (p. ej. al reabrir tareas) después de gastar."""
    return coins_from_xp(db, user_id) + ledger_total(db, user_id)


def add(db: Session, user_id: int, amount: int, reason: str, ref: str = "", detail: str = "") -> CoinEntry:
    entry = CoinEntry(user_id=user_id, amount=amount, reason=reason, ref=ref, detail=detail[:200])
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry
