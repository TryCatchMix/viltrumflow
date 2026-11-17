from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user
from ..models import PushSubscription, User
from ..services import notify

router = APIRouter()


class Keys(BaseModel):
    p256dh: str = Field(min_length=10, max_length=200)
    auth: str = Field(min_length=8, max_length=100)


class SubscriptionIn(BaseModel):
    endpoint: str = Field(min_length=10, max_length=1000, pattern=r"^https://")
    keys: Keys


class EndpointIn(BaseModel):
    endpoint: str = Field(max_length=1000)


@router.get("/key")
def public_key(_: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Clave pública VAPID con la que el navegador crea la suscripción."""
    return {"public_key": notify.vapid_keys(db)[1]}


@router.post("/subscribe", status_code=204)
def subscribe(data: SubscriptionIn, request: Request, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Registra este navegador. Si la suscripción era de otra cuenta (mismo navegador), pasa a esta."""
    s = db.query(PushSubscription).filter(PushSubscription.endpoint == data.endpoint).first()
    if not s:
        s = PushSubscription(endpoint=data.endpoint)
        db.add(s)
    s.user_id, s.p256dh, s.auth = user.id, data.keys.p256dh, data.keys.auth
    s.user_agent = (request.headers.get("user-agent") or "")[:300]
    db.commit()


@router.post("/unsubscribe", status_code=204)
def unsubscribe(data: EndpointIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db.query(PushSubscription).filter(PushSubscription.endpoint == data.endpoint, PushSubscription.user_id == user.id).delete()
    db.commit()


@router.get("/devices")
def devices(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return {"count": db.query(PushSubscription).filter(PushSubscription.user_id == user.id).count()}


@router.post("/test")
def test(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    sent = notify.send(db, user.id, notify.payload("ViltrumFlow", "Las notificaciones funcionan también con la app cerrada.", "/settings", "vf-test"))
    return {"delivered": sent}
