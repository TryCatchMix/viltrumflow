"""Integración con Google Calendar mediante OAuth 2.0 (flujo de código de autorización) y la API REST v3."""
import base64
import json
import logging
from datetime import datetime, timedelta, timezone
from typing import List, Optional
from urllib.parse import quote, urlencode

import httpx
from sqlalchemy.orm import Session

from ..config import settings
from ..models import GoogleAccount, Status, Task, User
from ..security import decrypt, encrypt

logger = logging.getLogger(__name__)

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
REVOKE_URL = "https://oauth2.googleapis.com/revoke"
API = "https://www.googleapis.com/calendar/v3"
# calendarlist.readonly: solo para mostrar la lista de calendarios entre los que elegir
SCOPES = ("openid email https://www.googleapis.com/auth/calendar.events "
          "https://www.googleapis.com/auth/calendar.calendarlist.readonly")
TIMEOUT = 10.0


class GoogleError(Exception):
    pass


class GoogleAuthExpired(GoogleError):
    """El usuario revocó el acceso o el refresh token ya no es válido."""


def _client() -> httpx.Client:  # punto único para simular Google en los tests
    return httpx.Client(timeout=TIMEOUT)


def build_auth_url(state: str) -> str:
    return AUTH_URL + "?" + urlencode({
        "client_id": settings.GOOGLE_CLIENT_ID,
        "redirect_uri": settings.GOOGLE_REDIRECT_URI,
        "response_type": "code",
        "scope": SCOPES,
        "access_type": "offline",
        "include_granted_scopes": "true",
        "prompt": "consent",
        "state": state,
    })


def _email_from_id_token(id_token: Optional[str]) -> Optional[str]:
    # El id_token llega directamente de Google por TLS; solo se lee el email para mostrarlo.
    try:
        payload = id_token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        return json.loads(base64.urlsafe_b64decode(payload)).get("email")
    except Exception:
        return None


def exchange_code(db: Session, user: User, code: str) -> GoogleAccount:
    with _client() as c:
        r = c.post(TOKEN_URL, data={
            "code": code,
            "client_id": settings.GOOGLE_CLIENT_ID,
            "client_secret": settings.GOOGLE_CLIENT_SECRET,
            "redirect_uri": settings.GOOGLE_REDIRECT_URI,
            "grant_type": "authorization_code",
        })
    if r.status_code != 200:
        raise GoogleError(f"Intercambio de código rechazado ({r.status_code})")
    data = r.json()
    acct = user.google_account or GoogleAccount(user_id=user.id)
    acct.access_token_enc = encrypt(data["access_token"])
    if data.get("refresh_token"):
        acct.refresh_token_enc = encrypt(data["refresh_token"])
    acct.expires_at = datetime.now(timezone.utc) + timedelta(seconds=int(data.get("expires_in", 3600)))
    acct.email = _email_from_id_token(data.get("id_token")) or acct.email
    db.add(acct)
    db.commit()
    db.refresh(acct)
    return acct


def _access_token(db: Session, acct: GoogleAccount) -> str:
    expires = acct.expires_at if acct.expires_at.tzinfo else acct.expires_at.replace(tzinfo=timezone.utc)
    token = decrypt(acct.access_token_enc)
    if token and expires - timedelta(seconds=60) > datetime.now(timezone.utc):
        return token
    refresh = decrypt(acct.refresh_token_enc)
    if not refresh:
        raise GoogleAuthExpired("Sin refresh token; vuelve a conectar Google Calendar")
    with _client() as c:
        r = c.post(TOKEN_URL, data={
            "client_id": settings.GOOGLE_CLIENT_ID,
            "client_secret": settings.GOOGLE_CLIENT_SECRET,
            "refresh_token": refresh,
            "grant_type": "refresh_token",
        })
    if r.status_code in (400, 401):
        raise GoogleAuthExpired("Google ha rechazado el refresh token; vuelve a conectar")
    if r.status_code != 200:
        raise GoogleError(f"No se pudo renovar el token ({r.status_code})")
    data = r.json()
    acct.access_token_enc = encrypt(data["access_token"])
    acct.expires_at = datetime.now(timezone.utc) + timedelta(seconds=int(data.get("expires_in", 3600)))
    db.commit()
    return data["access_token"]


def _request(db: Session, acct: GoogleAccount, method: str, path: str, **kwargs) -> httpx.Response:
    token = _access_token(db, acct)
    with _client() as c:
        r = c.request(method, f"{API}{path}", headers={"Authorization": f"Bearer {token}"}, **kwargs)
    if r.status_code == 401:
        raise GoogleAuthExpired("Google ha rechazado el token; vuelve a conectar")
    return r


def _cal(acct: GoogleAccount) -> str:
    return f"/calendars/{quote(acct.calendar_id, safe='')}/events"


def list_events(db: Session, acct: GoogleAccount, start: datetime, end: datetime) -> List[dict]:
    out, page = [], None
    for _ in range(10):  # tope de paginación
        params = {
            "timeMin": start.isoformat(), "timeMax": end.isoformat(),
            "singleEvents": "true", "orderBy": "startTime", "maxResults": 250,
        }
        if page:
            params["pageToken"] = page
        r = _request(db, acct, "GET", _cal(acct), params=params)
        if r.status_code != 200:
            raise GoogleError(f"No se pudieron leer los eventos ({r.status_code})")
        data = r.json()
        for ev in data.get("items", []):
            if ev.get("status") == "cancelled":
                continue
            s, e = ev.get("start", {}), ev.get("end", {})
            all_day = "date" in s
            task_id = (ev.get("extendedProperties", {}).get("private", {}) or {}).get("viltrumflowTaskId")
            out.append({
                "id": ev["id"],
                "title": ev.get("summary") or "(Sin título)",
                "start": s.get("date") or s.get("dateTime") or "",
                "end": e.get("date") or e.get("dateTime") or "",
                "all_day": all_day,
                "html_link": ev.get("htmlLink"),
                "task_id": int(task_id) if task_id and str(task_id).isdigit() else None,
            })
        page = data.get("nextPageToken")
        if not page:
            break
    return out


def _event_body(task: Task) -> dict:
    due = task.due_date if task.due_date.tzinfo else task.due_date.replace(tzinfo=timezone.utc)
    done = task.status == Status.COMPLETED
    body = {
        "summary": ("✓ " if done else "") + task.title,
        "description": (task.description or "") + "\n\n— Creado desde ViltrumFlow",
        # «viltrumflow=1» permite pedir a Google solo los eventos creados por la app
        "extendedProperties": {"private": {"viltrumflowTaskId": str(task.id), "viltrumflow": "1"}},
    }
    if task.all_day:
        day = due.date()
        body["start"] = {"date": day.isoformat()}
        body["end"] = {"date": (day + timedelta(days=1)).isoformat()}  # fin exclusivo
    else:
        body["start"] = {"dateTime": due.isoformat()}
        body["end"] = {"dateTime": (due + timedelta(hours=1)).isoformat()}
    return body


def upsert_task_event(db: Session, acct: GoogleAccount, task: Task) -> None:
    """Crea o actualiza el evento de una tarea; lo elimina si ya no tiene fecha."""
    if task.due_date is None or task.status == Status.ARCHIVED:
        delete_task_event(db, acct, task)
        return
    body = _event_body(task)
    if task.google_event_id:
        r = _request(db, acct, "PUT", f"{_cal(acct)}/{quote(task.google_event_id, safe='')}", json=body)
        if r.status_code == 200:
            return
        if r.status_code not in (404, 410):
            raise GoogleError(f"No se pudo actualizar el evento ({r.status_code})")
        task.google_event_id = None  # borrado en Google: se vuelve a crear
    r = _request(db, acct, "POST", _cal(acct), json=body)
    if r.status_code not in (200, 201):
        raise GoogleError(f"No se pudo crear el evento ({r.status_code})")
    task.google_event_id = r.json()["id"]
    db.commit()


def list_calendars(db: Session, acct: GoogleAccount) -> List[dict]:
    """Calendarios en los que el usuario puede escribir."""
    r = _request(db, acct, "GET", "/users/me/calendarList", params={"minAccessRole": "writer", "maxResults": 250})
    if r.status_code == 403:
        raise GoogleError("Falta el permiso para ver tus calendarios: desconecta y vuelve a conectar Google Calendar")
    if r.status_code != 200:
        raise GoogleError(f"No se pudieron leer los calendarios ({r.status_code})")
    return [{"id": c["id"], "name": c.get("summaryOverride") or c.get("summary") or c["id"], "primary": bool(c.get("primary"))}
            for c in r.json().get("items", [])]


PULL_INTERVAL = timedelta(minutes=10)


def _parse_start(start: dict):
    """(vencimiento, día completo) a partir del `start` de un evento, o None si no se entiende."""
    try:
        if "date" in start:
            return datetime.fromisoformat(start["date"]).replace(tzinfo=timezone.utc), True
        # A UTC: SQLite no guarda el desfase horario y «16:30+01:00» acabaría leyéndose como 16:30 UTC
        return datetime.fromisoformat(start["dateTime"].replace("Z", "+00:00")).astimezone(timezone.utc), False
    except (KeyError, ValueError):
        return None


def pull_changes(db: Session, acct: GoogleAccount, force: bool = False) -> int:
    """
    Trae a las tareas los cambios hechos en Google sobre sus eventos: fecha, hora y título.
    Si el evento se borró allí, la tarea se conserva y simplemente deja de estar enlazada.
    Devuelve cuántas tareas cambiaron. Sin `force` no consulta más de una vez cada 10 minutos.
    """
    now = datetime.now(timezone.utc)
    last = acct.last_pull_at
    if last and last.tzinfo is None:
        last = last.replace(tzinfo=timezone.utc)
    if not force and last and now - last < PULL_INTERVAL:
        return 0
    changed, page = 0, None
    for _ in range(10):
        params = {"privateExtendedProperty": "viltrumflow=1", "showDeleted": "true", "singleEvents": "true", "maxResults": 250}
        if last:
            params["updatedMin"] = (last - timedelta(minutes=2)).isoformat()  # margen por desfase de relojes
        if page:
            params["pageToken"] = page
        r = _request(db, acct, "GET", _cal(acct), params=params)
        if r.status_code == 410:  # Google ya no guarda cambios tan antiguos: se vuelve a empezar sin fecha
            last, page = None, None
            continue
        if r.status_code != 200:
            raise GoogleError(f"No se pudieron leer los cambios ({r.status_code})")
        data = r.json()
        for ev in data.get("items", []):
            task_id = (ev.get("extendedProperties", {}).get("private", {}) or {}).get("viltrumflowTaskId")
            task = db.get(Task, int(task_id)) if task_id and str(task_id).isdigit() else None
            # Solo tareas del dueño de la cuenta que siguen enlazadas a ese mismo evento
            if not task or task.user_id != acct.user_id or task.deleted_at is not None or task.google_event_id != ev.get("id"):
                continue
            if ev.get("status") == "cancelled":
                task.google_event_id = None
                changed += 1
                continue
            before = (task.title, task.due_date, task.all_day)
            parsed = _parse_start(ev.get("start", {}))
            if parsed:
                due, all_day = parsed
                current = task.due_date if task.due_date is None or task.due_date.tzinfo else task.due_date.replace(tzinfo=timezone.utc)
                if current != due or task.all_day != all_day:
                    task.due_date, task.all_day = due, all_day
                    task.reminder_sent_at = task.reminder_emailed_at = None  # nueva fecha: el aviso vuelve a contar
            title = (ev.get("summary") or "").removeprefix("✓ ").strip()
            if title and title != task.title:
                task.title = title[:200]
            if (task.title, task.due_date, task.all_day) != before:
                changed += 1
        page = data.get("nextPageToken")
        if not page:
            break
    acct.last_pull_at = now
    db.commit()
    return changed


def pull_all(db: Session) -> None:
    """Pasada del planificador: trae los cambios de todas las cuentas conectadas con sincronización activa."""
    if not settings.google_configured:
        return
    for acct in db.query(GoogleAccount).filter(GoogleAccount.auto_sync.is_(True)).all():
        try:
            pull_changes(db, acct)
        except GoogleAuthExpired:
            db.rollback()
            db.delete(acct)  # acceso revocado en Google: se desconecta, como en los endpoints
            db.commit()
        except (GoogleError, httpx.HTTPError) as exc:
            db.rollback()
            logger.warning("No se pudieron traer cambios de Google para el usuario %s: %s", acct.user_id, exc)


def delete_event(db: Session, acct: GoogleAccount, event_id: str) -> None:
    r = _request(db, acct, "DELETE", f"{_cal(acct)}/{quote(event_id, safe='')}")
    if r.status_code not in (200, 204, 404, 410):
        raise GoogleError(f"No se pudo eliminar el evento ({r.status_code})")


def delete_task_event(db: Session, acct: GoogleAccount, task: Task) -> None:
    if task.google_event_id:
        delete_event(db, acct, task.google_event_id)
        task.google_event_id = None
        db.commit()


def revoke(acct: GoogleAccount) -> None:
    token = decrypt(acct.refresh_token_enc) or decrypt(acct.access_token_enc)
    if not token:
        return
    try:
        with _client() as c:
            c.post(REVOKE_URL, data={"token": token})
    except httpx.HTTPError:  # la desconexión local no debe fallar por esto
        logger.warning("No se pudo revocar el token de Google")


# ---- Sincronización «best effort» usada desde los endpoints de tareas ----

def auto_sync(db: Session, user: User, task: Task) -> None:
    acct = user.google_account
    if not (settings.google_configured and acct and acct.auto_sync):
        return
    if task.parent_task_id is not None or task.deleted_at is not None:
        return
    try:
        upsert_task_event(db, acct, task)
    except (GoogleError, httpx.HTTPError) as exc:
        logger.warning("Sincronización con Google fallida para la tarea %s: %s", task.id, exc)
        db.rollback()


def auto_delete(db: Session, user: User, event_ids: List[str]) -> None:
    acct = user.google_account
    if not (settings.google_configured and acct and event_ids):
        return
    for eid in event_ids:
        try:
            delete_event(db, acct, eid)
        except (GoogleError, httpx.HTTPError) as exc:
            logger.warning("No se pudo eliminar el evento %s: %s", eid, exc)
