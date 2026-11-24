"""Listas reutilizables (compra, maleta, antes de salir…): marcar, vaciar, sugerencias de lo habitual y compartir."""
import re
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user
from ..models import ItemList, ListItem, ListMember, User

router = APIRouter()

MAX_ACTIVE = 300
SUGGESTIONS = 12


class ListIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    emoji: str = Field("", max_length=16)
    color: str = Field("#7c5cff", pattern=r"^#[0-9a-fA-F]{6}$")
    items: List[str] = Field(default_factory=list, max_length=100)


class ListUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    emoji: Optional[str] = Field(None, max_length=16)
    color: Optional[str] = Field(None, pattern=r"^#[0-9a-fA-F]{6}$")


class ItemsIn(BaseModel):
    # Varios a la vez separados por comas o saltos de línea: «leche, pan, huevos»
    text: str = Field(min_length=1, max_length=2000)


class ItemUpdate(BaseModel):
    text: Optional[str] = Field(None, min_length=1, max_length=200)
    checked: Optional[bool] = None


class MemberIn(BaseModel):
    identifier: str = Field(min_length=3, max_length=255)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip()).lower()


def _name(u: User) -> str:
    return u.full_name or u.username


def _get(db: Session, user: User, list_id: int, owner_only: bool = False) -> ItemList:
    lst = db.get(ItemList, list_id)
    if not lst or (lst.owner_id != user.id and not any(m.user_id == user.id for m in lst.members)):
        raise HTTPException(404, "Lista no encontrada")
    if owner_only and lst.owner_id != user.id:
        raise HTTPException(403, "Solo quien creó la lista puede hacer esto")
    return lst


def _summary(lst: ItemList, user: User) -> dict:
    active = [i for i in lst.items if i.active]
    return {
        "id": lst.id, "name": lst.name, "emoji": lst.emoji, "color": lst.color,
        "pending": sum(1 for i in active if not i.checked), "total": len(active),
        "is_owner": lst.owner_id == user.id, "owner_name": _name(lst.owner), "member_count": len(lst.members),
        "updated_at": lst.updated_at if lst.updated_at.tzinfo else lst.updated_at.replace(tzinfo=timezone.utc),
    }


def _item(i: ListItem) -> dict:
    return {"id": i.id, "text": i.text, "checked": i.checked, "times_used": i.times_used}


def _detail(lst: ItemList, user: User) -> dict:
    active = sorted([i for i in lst.items if i.active], key=lambda i: (i.checked, i.position, i.id))
    def recent(i: ListItem) -> float:
        at = i.last_used_at if i.last_used_at.tzinfo else i.last_used_at.replace(tzinfo=timezone.utc)
        return at.timestamp()

    remembered = sorted([i for i in lst.items if not i.active], key=lambda i: (-i.times_used, -recent(i)))
    members = [{"user_id": lst.owner_id, "name": _name(lst.owner), "username": lst.owner.username, "owner": True}]
    members += [{"user_id": m.user_id, "name": _name(m.user), "username": m.user.username, "owner": False} for m in lst.members]
    return {**_summary(lst, user), "items": [_item(i) for i in active],
            "suggestions": [_item(i) for i in remembered[:SUGGESTIONS]], "members": members}


def _touch(lst: ItemList) -> None:
    lst.updated_at = _now()  # para ordenar por uso reciente y que el resto de miembros vea que cambió


@router.get("")
def list_lists(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    shared = db.query(ListMember.list_id).filter(ListMember.user_id == user.id)
    lists = db.query(ItemList).filter(or_(ItemList.owner_id == user.id, ItemList.id.in_(shared)))\
        .order_by(ItemList.updated_at.desc()).all()
    return [_summary(lst, user) for lst in lists]


@router.post("", status_code=201)
def create_list(data: ListIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    lst = ItemList(owner_id=user.id, name=data.name.strip(), emoji=data.emoji.strip(), color=data.color)
    db.add(lst)
    db.flush()
    seen = set()
    for n, text in enumerate(t.strip()[:200] for t in data.items):
        if text and _norm(text) not in seen:
            seen.add(_norm(text))
            db.add(ListItem(list_id=lst.id, text=text, position=n, times_used=0))
    db.commit()
    db.refresh(lst)
    return _detail(lst, user)


@router.get("/{list_id}")
def get_list(list_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _detail(_get(db, user, list_id), user)


@router.put("/{list_id}")
def update_list(list_id: int, data: ListUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    lst = _get(db, user, list_id)
    if data.name is not None:
        lst.name = data.name.strip()
    if data.emoji is not None:
        lst.emoji = data.emoji.strip()
    if data.color is not None:
        lst.color = data.color
    db.commit()
    return _detail(lst, user)


@router.delete("/{list_id}", status_code=204)
def delete_list(list_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db.delete(_get(db, user, list_id, owner_only=True))
    db.commit()


@router.post("/{list_id}/items")
def add_items(list_id: int, data: ItemsIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Añade uno o varios elementos. Si ya estaba en la lista se desmarca; si se usó antes, se recupera (y suma un uso)."""
    lst = _get(db, user, list_id)
    texts = [t.strip()[:200] for t in re.split(r"[,\n;]", data.text) if t.strip()]
    by_norm = {_norm(i.text): i for i in lst.items}
    top = min((i.position for i in lst.items if i.active), default=0)
    active_count = sum(1 for i in lst.items if i.active)
    for text in texts:
        item = by_norm.get(_norm(text))
        if item and item.active:
            item.checked = False
            continue
        if active_count >= MAX_ACTIVE:
            raise HTTPException(400, f"Una lista admite hasta {MAX_ACTIVE} elementos a la vez")
        top -= 1
        active_count += 1
        if item:  # recordado: vuelve a la lista
            item.active, item.checked, item.position = True, False, top
            item.times_used += 1
            item.last_used_at = _now()
        else:
            # active/checked explícitos: los valores por defecto de la columna no existen hasta el INSERT
            item = ListItem(list_id=lst.id, text=text, position=top, times_used=1, last_used_at=_now(), active=True, checked=False)
            db.add(item)
            lst.items.append(item)
            by_norm[_norm(text)] = item
    _touch(lst)
    db.commit()
    db.refresh(lst)
    return _detail(lst, user)


def _get_item(db: Session, user: User, item_id: int) -> ListItem:
    item = db.get(ListItem, item_id)
    if not item:
        raise HTTPException(404, "Elemento no encontrado")
    _get(db, user, item.list_id)
    return item


@router.patch("/items/{item_id}")
def update_item(item_id: int, data: ItemUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    item = _get_item(db, user, item_id)
    if data.text is not None:
        item.text = data.text.strip()
    if data.checked is not None:
        item.checked = data.checked
    _touch(item.list)
    db.commit()
    return _detail(item.list, user)


@router.delete("/items/{item_id}")
def forget_item(item_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Borra el elemento del todo (también de las sugerencias)."""
    item = _get_item(db, user, item_id)
    lst = item.list
    db.delete(item)
    _touch(lst)
    db.commit()
    db.refresh(lst)
    return _detail(lst, user)


@router.post("/{list_id}/uncheck-all")
def uncheck_all(list_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Para listas que se repiten igual (la maleta): todo vuelve a estar por hacer."""
    lst = _get(db, user, list_id)
    for i in lst.items:
        if i.active:
            i.checked = False
    _touch(lst)
    db.commit()
    return _detail(lst, user)


@router.post("/{list_id}/clear-checked")
def clear_checked(list_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Para la compra: lo marcado sale de la lista, pero se recuerda para sugerirlo la próxima vez."""
    lst = _get(db, user, list_id)
    for i in lst.items:
        if i.active and i.checked:
            i.active, i.checked = False, False
    _touch(lst)
    db.commit()
    return _detail(lst, user)


@router.post("/{list_id}/members", status_code=201)
def add_member(list_id: int, data: MemberIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    lst = _get(db, user, list_id, owner_only=True)
    ident = data.identifier.strip().lower()
    target = db.query(User).filter(User.is_active.is_(True),
                                   or_(func.lower(User.username) == ident, func.lower(User.email) == ident)).first()
    if not target:
        raise HTTPException(404, "No hay ningún usuario con ese nombre de usuario o email")
    if target.id == lst.owner_id or any(m.user_id == target.id for m in lst.members):
        raise HTTPException(409, "Esa persona ya tiene acceso")
    db.add(ListMember(list_id=lst.id, user_id=target.id))
    db.commit()
    db.refresh(lst)
    return _detail(lst, user)


@router.delete("/{list_id}/members/{user_id}", status_code=204)
def remove_member(list_id: int, user_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """El dueño quita a alguien, o un miembro sale de la lista."""
    lst = _get(db, user, list_id)
    if user.id != lst.owner_id and user.id != user_id:
        raise HTTPException(403, "Solo quien creó la lista puede quitar a otras personas")
    db.query(ListMember).filter(ListMember.list_id == lst.id, ListMember.user_id == user_id).delete()
    db.commit()
