"""
Colección de cartas de Cyberpunk TCG: escanear con la cámara (añadir, quitar, consultar, lista de deseos),
catálogo propio, totales e historial con «Deshacer».
"""
import re
import unicodedata
from difflib import SequenceMatcher
from typing import List, Literal, Optional, Tuple

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..deps import get_current_user
from ..models import Attachment, TcgCard, TcgEvent, User
from ..services import files, tcg_vision

router = APIRouter()

Mode = Literal["add", "remove", "check", "wish"]
MAX_QTY = 999
FUZZY_MATCH = 0.86  # parecido mínimo del nombre para darlo por la misma carta
FUZZY_CANDIDATE = 0.55  # … y para proponerla como posible


# --- Normalización y búsqueda --------------------------------------------------------------------

def name_key(name: str) -> str:
    """«Yorinobu  Arasaka!» → «yorinobu arasaka». Sin acentos ni signos, para comparar."""
    s = unicodedata.normalize("NFKD", name or "")
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    return re.sub(r"[\W_]+", " ", s).strip()[:120]


def canonical_number(number: str) -> str:
    """
    Número de colección en forma estable: «1» y «001» son la misma carta; se conserva el prefijo β (beta)
    y la letra final («005B» → «005b»). Se descarta el total del set («014/131» → «014»).
    """
    s = re.sub(r"\s+", "", (number or "").split("/")[0]).lstrip("#")
    s = s.replace("ß", "β").replace("Β", "β")  # la β griega a veces llega como ß o Beta mayúscula
    m = re.fullmatch(r"(\D*?)(\d+)(\D*)", s)
    if not m:
        return s.lower()[:20]
    prefix, digits, suffix = m.groups()
    prefix = "β" if prefix.lower() in ("β", "b", "beta") else prefix.upper()
    return f"{prefix}{int(digits):03d}{suffix.lower()}"[:20]


def _similar(a: str, b: str) -> float:
    return SequenceMatcher(None, a, b).ratio() if a and b else 0.0


def find_card(cards: List[TcgCard], name: str, number: str) -> Tuple[Optional[TcgCard], List[TcgCard]]:
    """
    Busca la carta leída en la colección. Devuelve (la carta, si no hay duda; candidatas parecidas).
    El número no basta solo (hay números repetidos con distinta ilustración) ni el nombre (reimpresiones).
    """
    key, num = name_key(name), canonical_number(number) if number else ""
    for c in cards:
        if c.name_key == key and c.number == num and key:
            return c, []
    scored = sorted(((_similar(key, c.name_key), c) for c in cards), key=lambda x: -x[0])
    if num:
        same_num = [c for c in cards if c.number == num]
        if not key and len(same_num) == 1:
            return same_num[0], []
        close = [(s, c) for s, c in scored if c.number == num and s >= FUZZY_MATCH]
        if len(close) == 1:
            return close[0][1], []
        # Mismo nombre sin número guardado: es la misma carta, y se completa su número
        bare = [c for s, c in scored if s >= FUZZY_MATCH and not c.number]
        if len(bare) == 1 and not close:
            return bare[0], []
    else:
        close = [c for s, c in scored if s >= FUZZY_MATCH]
        if len(close) == 1:
            return close[0], []
    candidates = [c for s, c in scored if s >= FUZZY_CANDIDATE or (num and c.number == num)]
    return None, candidates[:6]


# --- Esquemas ------------------------------------------------------------------------------------

class CardIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    number: str = Field("", max_length=20)
    set_name: str = Field("", max_length=80)
    rarity: str = Field("", max_length=40)
    card_type: str = Field("", max_length=40)
    quantity: int = Field(0, ge=0, le=MAX_QTY)
    wanted: bool = False

    @field_validator("name", "number", "set_name", "rarity", "card_type")
    @classmethod
    def _strip(cls, v: str) -> str:
        return " ".join((v or "").split())

    @field_validator("name")
    @classmethod
    def _named(cls, v: str) -> str:
        if not name_key(v):
            raise ValueError("El nombre de la carta no puede quedar vacío")
        return v


class AdjustIn(BaseModel):
    delta: int = Field(ge=-MAX_QTY, le=MAX_QTY)


def card_out(c: TcgCard) -> dict:
    return {
        "id": c.id, "name": c.name, "number": c.number, "set_name": c.set_name, "rarity": c.rarity,
        "card_type": c.card_type, "quantity": c.quantity, "wanted": c.wanted,
        "image_url": f"{files.URL_PREFIX}{c.image_id}" if c.image_id else None,
        "updated_at": c.updated_at.isoformat() if c.updated_at else None,
    }


def totals(db: Session, user: User) -> dict:
    q = db.query(TcgCard).filter(TcgCard.user_id == user.id)
    copies, unique, extra = q.with_entities(
        func.coalesce(func.sum(TcgCard.quantity), 0),
        func.count().filter(TcgCard.quantity > 0),
        func.coalesce(func.sum(TcgCard.quantity - 1).filter(TcgCard.quantity > 1), 0),
    ).one()
    wanted = q.filter(TcgCard.wanted.is_(True), TcgCard.quantity == 0).count()
    return {"copies": int(copies), "unique": int(unique), "duplicates": int(extra), "wanted": wanted}


def _cards(db: Session, user: User) -> List[TcgCard]:
    return db.query(TcgCard).filter(TcgCard.user_id == user.id).all()


def _get(db: Session, user: User, card_id: int) -> TcgCard:
    c = db.get(TcgCard, card_id)
    if not c or c.user_id != user.id:
        raise HTTPException(404, "Carta no encontrada")
    return c


def _duplicate(db: Session, user: User, key: str, number: str, exclude: Optional[int] = None) -> Optional[TcgCard]:
    q = db.query(TcgCard).filter(TcgCard.user_id == user.id, TcgCard.name_key == key, TcgCard.number == number)
    if exclude:
        q = q.filter(TcgCard.id != exclude)
    return q.first()


def _read_image(upload: Optional[UploadFile]) -> Optional[Tuple[bytes, str]]:
    if upload is None:
        return None
    data = upload.file.read(settings.MAX_UPLOAD_MB * 1024 * 1024 + 1)
    if len(data) > settings.MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(413, f"La foto supera {settings.MAX_UPLOAD_MB} MB")
    kind = files.sniff(data)
    if kind not in ("image/jpeg", "image/png", "image/webp"):
        raise HTTPException(415, "La foto debe ser JPEG, PNG o WebP")
    return data, kind


def _set_image(db: Session, user: User, card: TcgCard, image: Tuple[bytes, str]) -> None:
    ext = files.EXTENSIONS[image[1]]
    try:
        att = files.store(db, user.id, f"carta-{card.number or card.id}.{ext}", image[0])
    except files.UploadError as exc:
        raise HTTPException(413, str(exc))
    old = card.image_id
    db.flush()
    card.image_id = att.id
    if old:
        prev = db.get(Attachment, old)
        if prev:
            db.delete(prev)


# --- Aplicar una función del escáner -------------------------------------------------------------

MESSAGES = {
    "add": "Añadida a tu colección",
    "remove": "Quitada de tu colección",
    "check": "Consulta",
    "wish": "Añadida a tu lista de deseos",
}


def apply(db: Session, user: User, mode: Mode, card: Optional[TcgCard], data: Optional[CardIn], qty: int,
          image: Optional[Tuple[bytes, str]]) -> dict:
    """Ejecuta la función elegida sobre una carta ya identificada (o nueva, con `data`) y hace commit."""
    created = False
    if card is None:
        if mode in ("check", "remove"):
            return {"status": "missing", "card": None, "delta": 0, "event_id": None,
                    "message": "No tienes esta carta en tu colección", "totals": totals(db, user)}
        assert data is not None
        card = TcgCard(user_id=user.id, name=data.name, name_key=name_key(data.name),
                       number=canonical_number(data.number) if data.number else "", set_name=data.set_name,
                       rarity=data.rarity, card_type=data.card_type, quantity=0, wanted=False)
        db.add(card)
        db.flush()
        created = True
    elif data is not None:
        # Completa lo que faltaba (rareza, número…) sin pisar lo que el usuario ya corrigió
        for field in ("set_name", "rarity", "card_type"):
            if not getattr(card, field) and getattr(data, field):
                setattr(card, field, getattr(data, field))
        if not card.number and data.number and not _duplicate(db, user, card.name_key, canonical_number(data.number), card.id):
            card.number = canonical_number(data.number)

    if image and not card.image_id and mode != "check":
        _set_image(db, user, card, image)

    was_wanted, delta, message = card.wanted, 0, MESSAGES[mode]
    if mode == "add":
        delta = min(qty, MAX_QTY - card.quantity)
        card.quantity += delta
        card.wanted = False  # ya la tienes
    elif mode == "remove":
        delta = -min(qty, card.quantity)
        card.quantity += delta
        if delta == 0:
            message = "No te quedaban copias de esta carta"
    elif mode == "wish":
        card.wanted = True
        if card.quantity:
            message = "Ya la tienes, pero queda apuntada en tu lista de deseos"

    event_id = None
    if mode != "check" and (delta or created or was_wanted != card.wanted):
        ev = TcgEvent(user_id=user.id, card_id=card.id, mode=mode, delta=delta, created_card=created, was_wanted=was_wanted)
        db.add(ev)
        db.flush()
        event_id = ev.id
    db.commit()
    return {"status": "done", "card": card_out(card), "created": created, "delta": delta, "event_id": event_id,
            "message": message, "totals": totals(db, user)}


# --- Rutas ---------------------------------------------------------------------------------------

@router.get("")
def collection(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    cards = db.query(TcgCard).filter(TcgCard.user_id == user.id).order_by(TcgCard.number, TcgCard.name_key).all()
    return {"recognition": settings.tcg_vision_configured, "cards": [card_out(c) for c in cards],
            "totals": totals(db, user)}


@router.post("/scan")
def scan(mode: Mode = Form(...), qty: int = Form(1, ge=1, le=MAX_QTY), file: UploadFile = File(...),
         user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """
    Lee la carta de la foto y aplica la función elegida. Si la lectura no basta para saber qué carta es,
    devuelve `status: "choose"` con la lectura y las candidatas, sin cambiar nada (ver `/apply`).
    """
    image = _read_image(file)
    assert image is not None
    cards = _cards(db, user)
    try:
        reading = tcg_vision.read_card(image[0], image[1], ((c.number, c.name) for c in cards))
    except tcg_vision.VisionError as exc:
        raise HTTPException(503, str(exc))
    out = {"mode": mode, "reading": reading.model_dump()}
    if not reading.is_card or not name_key(reading.name):
        return {**out, "status": "unreadable", "card": None, "candidates": [],
                "message": "No se ve bien la carta: céntrala en el recuadro, con luz y sin reflejos",
                "totals": totals(db, user)}
    card, candidates = find_card(cards, reading.name, reading.number)
    if card is None and candidates and (reading.confidence != "high" or mode in ("check", "remove")):
        return {**out, "status": "choose", "card": None, "candidates": [card_out(c) for c in candidates],
                "message": "¿Cuál de estas es?", "totals": totals(db, user)}
    data = CardIn(name=reading.name[:120], number=reading.number[:20], set_name=reading.set_name[:80],
                  rarity=reading.rarity[:40], card_type=reading.card_type[:40])
    return {**out, **apply(db, user, mode, card, data, qty, image),
            "candidates": [card_out(c) for c in candidates if card is None]}


@router.post("/apply")
def apply_choice(mode: Mode = Form(...), qty: int = Form(1, ge=1, le=MAX_QTY), card_id: Optional[int] = Form(None),
                 name: str = Form(""), number: str = Form(""), set_name: str = Form(""), rarity: str = Form(""),
                 card_type: str = Form(""), file: Optional[UploadFile] = File(None),
                 user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """
    Aplica una función a una carta concreta: la elegida entre las candidatas (`card_id`) o la escrita a mano
    (si ya existe una con ese nombre y número, se usa esa). La foto, si llega, sirve de imagen de la carta.
    """
    image = _read_image(file)
    data = None
    if card_id is not None:
        card = _get(db, user, card_id)
    else:
        try:
            data = CardIn(name=name, number=number, set_name=set_name, rarity=rarity, card_type=card_type)
        except ValueError:
            raise HTTPException(422, "Indica al menos el nombre de la carta")
        card = _duplicate(db, user, name_key(data.name), canonical_number(data.number) if data.number else "")
    return {"mode": mode, "reading": None, "candidates": [], **apply(db, user, mode, card, data, qty, image)}


@router.post("/cards", status_code=201)
def create_card(data: CardIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    key, num = name_key(data.name), canonical_number(data.number) if data.number else ""
    if _duplicate(db, user, key, num):
        raise HTTPException(409, "Esa carta ya está en tu colección")
    card = TcgCard(user_id=user.id, name=data.name, name_key=key, number=num, set_name=data.set_name,
                   rarity=data.rarity, card_type=data.card_type, quantity=data.quantity, wanted=data.wanted)
    db.add(card)
    db.commit()
    return {"card": card_out(card), "totals": totals(db, user)}


@router.put("/cards/{card_id}")
def update_card(card_id: int, data: CardIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    card = _get(db, user, card_id)
    key, num = name_key(data.name), canonical_number(data.number) if data.number else ""
    if _duplicate(db, user, key, num, card.id):
        raise HTTPException(409, "Ya tienes otra carta con ese nombre y número")
    card.name, card.name_key, card.number = data.name, key, num
    card.set_name, card.rarity, card.card_type = data.set_name, data.rarity, data.card_type
    card.quantity, card.wanted = data.quantity, data.wanted
    try:
        db.commit()
    except IntegrityError:  # pragma: no cover - carrera entre dos ediciones
        db.rollback()
        raise HTTPException(409, "Ya tienes otra carta con ese nombre y número")
    return {"card": card_out(card), "totals": totals(db, user)}


@router.post("/cards/{card_id}/adjust")
def adjust(card_id: int, data: AdjustIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Suma o resta copias a mano (botones − y + de la lista)."""
    card = _get(db, user, card_id)
    delta = max(-card.quantity, min(data.delta, MAX_QTY - card.quantity))
    if delta:
        was_wanted = card.wanted
        card.quantity += delta
        if card.quantity > 0:
            card.wanted = False
        db.add(TcgEvent(user_id=user.id, card_id=card.id, mode="manual", delta=delta, was_wanted=was_wanted))
    db.commit()
    return {"card": card_out(card), "totals": totals(db, user)}


@router.post("/cards/{card_id}/image")
def set_image(card_id: int, file: UploadFile = File(...), user: User = Depends(get_current_user),
              db: Session = Depends(get_db)):
    card = _get(db, user, card_id)
    image = _read_image(file)
    assert image is not None
    _set_image(db, user, card, image)
    db.commit()
    return {"card": card_out(card), "totals": totals(db, user)}


@router.delete("/cards/{card_id}", status_code=204)
def delete_card(card_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    card = _get(db, user, card_id)
    image = db.get(Attachment, card.image_id) if card.image_id else None
    db.delete(card)
    if image:
        db.delete(image)
    db.commit()


@router.get("/events")
def events(limit: int = Query(20, ge=1, le=100), user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.query(TcgEvent, TcgCard).join(TcgCard, TcgCard.id == TcgEvent.card_id)\
        .filter(TcgEvent.user_id == user.id).order_by(TcgEvent.id.desc()).limit(limit).all()
    return [{"id": e.id, "mode": e.mode, "delta": e.delta, "created_at": e.created_at.isoformat(),
             "card": {"id": c.id, "name": c.name, "number": c.number}} for e, c in rows]


@router.post("/events/{event_id}/undo")
def undo(event_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Deshace un escaneo o ajuste: devuelve las copias, la lista de deseos y borra la carta si nació con él."""
    ev = db.get(TcgEvent, event_id)
    if not ev or ev.user_id != user.id:
        raise HTTPException(404, "Ese cambio ya no se puede deshacer")
    card = db.get(TcgCard, ev.card_id)
    card.quantity = max(0, min(MAX_QTY, card.quantity - ev.delta))
    card.wanted = ev.was_wanted
    db.delete(ev)
    db.flush()  # el evento primero: si la carta se borra, su FK en cascada ya no lo encontraría
    removed = False
    if ev.created_card and card.quantity == 0 and not card.wanted:
        later = db.query(TcgEvent).filter(TcgEvent.card_id == card.id, TcgEvent.id != ev.id).count()
        if not later:
            image = db.get(Attachment, card.image_id) if card.image_id else None
            db.delete(card)
            if image:
                db.delete(image)
            removed = True
    db.commit()
    return {"card": None if removed else card_out(card), "removed": removed, "totals": totals(db, user)}
