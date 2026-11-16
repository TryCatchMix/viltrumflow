from datetime import datetime, timedelta, timezone
from typing import List
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from .. import schemas
from ..config import settings
from ..database import get_db
from ..deps import get_current_user
from ..models import GoogleAccount, Status, Task, User
from ..security import create_token, decode_token
from ..services import google_calendar as gcal

router = APIRouter()


def _account(user: User) -> GoogleAccount:
    if not settings.google_configured:
        raise HTTPException(503, "Google Calendar no está configurado en el servidor")
    if not user.google_account:
        raise HTTPException(409, "Google Calendar no está conectado")
    return user.google_account


def _guard(db: Session, user: User, fn):
    """Traduce los errores de Google a respuestas HTTP; si el acceso fue revocado, desconecta."""
    try:
        return fn()
    except gcal.GoogleAuthExpired as exc:
        db.rollback()
        if user.google_account:
            db.delete(user.google_account)
            db.commit()
        raise HTTPException(409, str(exc))
    except (gcal.GoogleError, httpx.HTTPError) as exc:
        db.rollback()
        raise HTTPException(502, f"Error al hablar con Google Calendar: {exc}")


@router.get("/status", response_model=schemas.CalendarStatus)
def status(user: User = Depends(get_current_user)):
    acct = user.google_account
    return schemas.CalendarStatus(
        configured=settings.google_configured, connected=bool(acct and settings.google_configured),
        email=acct.email if acct else None, auto_sync=acct.auto_sync if acct else True,
    )


@router.get("/auth-url")
def auth_url(user: User = Depends(get_current_user)):
    if not settings.google_configured:
        raise HTTPException(503, "Google Calendar no está configurado en el servidor")
    # El «state» firmado liga la respuesta de Google con el usuario que inició el flujo (anti-CSRF)
    state = create_token(user.id, "google_state", timedelta(minutes=10))
    return {"url": gcal.build_auth_url(state)}


@router.get("/callback", include_in_schema=False)
def callback(state: str = "", code: str = "", error: str = "", db: Session = Depends(get_db)):
    """Destino de la redirección de Google. No lleva cabecera Authorization: la identidad va en `state`."""
    target = settings.FRONTEND_URL.rstrip("/") + "/calendar?"
    if error or not code:
        return RedirectResponse(target + urlencode({"google": "denied"}))
    try:
        user = db.get(User, decode_token(state, "google_state"))
    except HTTPException:
        user = None
    if not user or not settings.google_configured:
        return RedirectResponse(target + urlencode({"google": "error"}))
    try:
        gcal.exchange_code(db, user, code)
    except (gcal.GoogleError, httpx.HTTPError, KeyError):
        db.rollback()
        return RedirectResponse(target + urlencode({"google": "error"}))
    return RedirectResponse(target + urlencode({"google": "connected"}))


@router.put("/settings", response_model=schemas.CalendarStatus)
def update_settings(data: schemas.CalendarSettings, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    acct = _account(user)
    acct.auto_sync = data.auto_sync
    db.commit()
    return status(user)


@router.delete("/disconnect", status_code=204)
def disconnect(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    acct = user.google_account
    if not acct:
        return
    if settings.google_configured:
        gcal.revoke(acct)
    db.query(Task).filter(Task.user_id == user.id).update({"google_event_id": None})
    db.delete(acct)
    db.commit()


@router.get("/events", response_model=List[schemas.CalendarEvent])
def events(
    start: datetime = Query(...), end: datetime = Query(...),
    user: User = Depends(get_current_user), db: Session = Depends(get_db),
):
    acct = _account(user)
    if start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)
    if end.tzinfo is None:
        end = end.replace(tzinfo=timezone.utc)
    if not timedelta(0) < end - start <= timedelta(days=100):
        raise HTTPException(400, "Rango de fechas no válido (máximo 100 días)")
    def run():
        gcal.pull_changes(db, acct)  # primero, lo que se haya movido o renombrado en Google
        return gcal.list_events(db, acct, start, end)

    return _guard(db, user, run)


@router.post("/sync", response_model=schemas.SyncResult)
def sync(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Envía a Google Calendar todas las tareas con fecha (crea o actualiza sus eventos)."""
    acct = _account(user)
    _guard(db, user, lambda: gcal.pull_changes(db, acct, force=True))  # antes de enviar: lo cambiado en Google manda
    tasks = db.query(Task).filter(
        Task.user_id == user.id, Task.parent_task_id.is_(None), Task.deleted_at.is_(None),
        Task.due_date.isnot(None), Task.status != Status.ARCHIVED,
    ).all()
    result = schemas.SyncResult(synced=0, failed=0)

    def run():
        for t in tasks:
            try:
                gcal.upsert_task_event(db, acct, t)
                result.synced += 1
            except gcal.GoogleAuthExpired:
                raise
            except (gcal.GoogleError, httpx.HTTPError):
                db.rollback()
                result.failed += 1
        return result

    return _guard(db, user, run)
