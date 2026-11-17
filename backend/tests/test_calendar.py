import httpx
import pytest

from app.config import settings
from app.services import google_calendar as gcal

C = "/api/v1/calendar"
T = "/api/v1/tasks"


class FakeGoogle:
    """Simula los endpoints de Google que usa la integración."""

    def __init__(self):
        self.events, self.calls, self.seq, self.refreshes, self.calendars_used = {}, [], 0, 0, []

    def handler(self, request: httpx.Request) -> httpx.Response:
        url, method = str(request.url), request.method
        self.calls.append((method, url))
        if url.startswith(gcal.TOKEN_URL):
            body = request.content.decode()
            if "grant_type=refresh_token" in body:
                self.refreshes += 1
                return httpx.Response(200, json={"access_token": "at2", "expires_in": 3600})
            return httpx.Response(200, json={"access_token": "at1", "refresh_token": "rt1", "expires_in": 3600})
        if url.startswith(gcal.REVOKE_URL):
            return httpx.Response(200)
        assert request.headers["Authorization"].startswith("Bearer at")
        import json
        if "calendarList" in url:
            return httpx.Response(200, json={"items": [{"id": "primary@x", "summary": "Personal", "primary": True},
                                                       {"id": "trabajo@x", "summary": "Trabajo"}]})
        self.calendars_used.append(url.split("/calendars/")[1].split("/")[0])
        if method == "POST":
            self.seq += 1
            eid = f"ev{self.seq}"
            self.events[eid] = json.loads(request.content)
            return httpx.Response(200, json={"id": eid})
        eid = url.rsplit("/", 1)[-1].split("?")[0]
        if method == "PUT":
            if eid not in self.events:
                return httpx.Response(404)
            self.events[eid] = json.loads(request.content)
            return httpx.Response(200, json={"id": eid})
        if method == "DELETE":
            return httpx.Response(204 if self.events.pop(eid, None) else 410)
        items = [{"id": k, **v} for k, v in self.events.items()]
        if "privateExtendedProperty" in url:  # consulta de cambios: solo eventos de la app, incluidos los borrados
            return httpx.Response(200, json={"items": items})
        items = [i for i in items if i.get("status") != "cancelled"]
        items.append({"id": "ext", "summary": "Dentista", "start": {"dateTime": "2026-03-10T10:00:00+01:00"},
                      "end": {"dateTime": "2026-03-10T11:00:00+01:00"}, "htmlLink": "https://calendar.google.com/x"})
        return httpx.Response(200, json={"items": items})


@pytest.fixture()
def google(monkeypatch):
    fake = FakeGoogle()
    monkeypatch.setattr(settings, "GOOGLE_CLIENT_ID", "cid")
    monkeypatch.setattr(settings, "GOOGLE_CLIENT_SECRET", "csecret")
    monkeypatch.setattr(gcal, "_client", lambda: httpx.Client(transport=httpx.MockTransport(fake.handler)))
    return fake


def connect(client, auth):
    url = client.get(f"{C}/auth-url", headers=auth).json()["url"]
    assert "scope=openid+email+https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fcalendar.events" in url and "access_type=offline" in url
    state = httpx.URL(url).params["state"]
    r = client.get(f"{C}/callback", params={"code": "abc", "state": state})
    assert r.status_code == 307 and r.headers["location"].endswith("/calendar?google=connected")


def test_not_configured(client, auth):
    assert client.get(f"{C}/status", headers=auth).json() == {"configured": False, "connected": False, "email": None, "auto_sync": True, "calendar_id": "primary"}
    assert client.get(f"{C}/auth-url", headers=auth).status_code == 503
    # sin Google, las tareas funcionan con normalidad
    assert client.post(T, headers=auth, json={"title": "x", "due_date": "2026-03-10T00:00:00Z"}).status_code == 201


def test_callback_rejects_bad_state(client, auth, google):
    r = client.get(f"{C}/callback", params={"code": "abc", "state": "falso"})
    assert r.headers["location"].endswith("google=error")
    # un access token normal no vale como state
    token = auth["Authorization"].split()[1]
    assert client.get(f"{C}/callback", params={"code": "abc", "state": token}).headers["location"].endswith("google=error")
    assert client.get(f"{C}/callback", params={"error": "access_denied"}).headers["location"].endswith("google=denied")
    assert client.get(f"{C}/status", headers=auth).json()["connected"] is False


def test_connect_sync_and_disconnect(client, auth, google):
    pre = client.post(T, headers=auth, json={"title": "Previa", "due_date": "2026-03-09T00:00:00Z"}).json()
    assert client.get(f"{C}/events", headers=auth, params={"start": "2026-03-01T00:00:00Z", "end": "2026-04-01T00:00:00Z"}).status_code == 409
    connect(client, auth)
    assert client.get(f"{C}/status", headers=auth).json()["connected"] is True

    # tarea nueva con fecha → evento de día completo con fin exclusivo
    t = client.post(T, headers=auth, json={"title": "Entrega", "due_date": "2026-03-10T00:00:00Z"}).json()
    assert t["google_event_id"] == "ev1"
    assert google.events["ev1"]["start"] == {"date": "2026-03-10"} and google.events["ev1"]["end"] == {"date": "2026-03-11"}

    # con hora → dateTime de una hora; completar → prefijo ✓
    client.put(f"{T}/{t['id']}", headers=auth, json={"all_day": False, "due_date": "2026-03-10T15:00:00Z", "status": "completed"})
    assert google.events["ev1"]["summary"] == "✓ Entrega" and google.events["ev1"]["start"]["dateTime"].startswith("2026-03-10T15:00")

    # sincronización manual envía también las tareas anteriores a la conexión
    assert client.post(f"{C}/sync", headers=auth).json() == {"synced": 2, "failed": 0}
    assert client.get(f"{T}/{pre['id']}", headers=auth).json()["google_event_id"] == "ev2"

    evs = client.get(f"{C}/events", headers=auth, params={"start": "2026-03-01T00:00:00Z", "end": "2026-04-01T00:00:00Z"}).json()
    by_id = {e["id"]: e for e in evs}
    assert by_id["ev1"]["task_id"] == t["id"] and by_id["ext"]["task_id"] is None and by_id["ext"]["all_day"] is False

    # evento borrado a mano en Google → se vuelve a crear
    google.events.pop("ev2")
    client.put(f"{T}/{pre['id']}", headers=auth, json={"title": "Previa 2"})
    assert client.get(f"{T}/{pre['id']}", headers=auth).json()["google_event_id"] == "ev3"

    # quitar la fecha o borrar la tarea elimina el evento
    client.put(f"{T}/{pre['id']}", headers=auth, json={"due_date": None})
    assert "ev3" not in google.events
    client.delete(f"{T}/{t['id']}", headers=auth)
    assert google.events == {}

    # auto_sync desactivado → no se crean eventos
    client.put(f"{C}/settings", headers=auth, json={"auto_sync": False})
    off = client.post(T, headers=auth, json={"title": "Sin sync", "due_date": "2026-03-12T00:00:00Z"}).json()
    assert off["google_event_id"] is None

    assert client.delete(f"{C}/disconnect", headers=auth).status_code == 204
    assert any(u.startswith(gcal.REVOKE_URL) for _, u in google.calls)
    assert client.get(f"{C}/status", headers=auth).json()["connected"] is False


def test_tokens_encrypted_and_refreshed(client, auth, google):
    from datetime import datetime, timedelta, timezone
    from app.database import SessionLocal
    from app.models import GoogleAccount

    connect(client, auth)
    with SessionLocal() as db:
        acct = db.query(GoogleAccount).one()
        assert "at1" not in acct.access_token_enc and "rt1" not in acct.refresh_token_enc
        acct.expires_at = datetime.now(timezone.utc) - timedelta(minutes=5)
        db.commit()
    r = client.get(f"{C}/events", headers=auth, params={"start": "2026-03-01T00:00:00Z", "end": "2026-04-01T00:00:00Z"})
    assert r.status_code == 200 and google.refreshes == 1


def test_changes_made_in_google_reach_the_task(client, auth, google):
    from app.database import SessionLocal
    from app.models import GoogleAccount
    connect(client, auth)
    RANGE = {"start": "2026-03-01T00:00:00Z", "end": "2026-04-01T00:00:00Z"}
    a = client.post(T, headers=auth, json={"title": "Entrega", "due_date": "2026-03-10T00:00:00Z", "reminder_minutes": 0}).json()
    b = client.post(T, headers=auth, json={"title": "Reunión", "due_date": "2026-03-11T00:00:00Z"}).json()
    c = client.post(T, headers=auth, json={"title": "Borrada allí", "due_date": "2026-03-12T00:00:00Z"}).json()
    assert google.events["ev1"]["extendedProperties"]["private"]["viltrumflow"] == "1"

    # En Google: se mueve una a otro día, otra pasa a tener hora y nombre nuevo, y la tercera se borra
    google.events["ev1"]["start"], google.events["ev1"]["end"] = {"date": "2026-03-15"}, {"date": "2026-03-16"}
    google.events["ev2"].update(summary="Reunión de equipo", start={"dateTime": "2026-03-11T16:30:00+01:00"}, end={"dateTime": "2026-03-11T17:30:00+01:00"})
    google.events["ev3"]["status"] = "cancelled"
    # un evento ajeno con un id de tarea falsificado no puede tocar nada
    google.events["evil"] = {"summary": "Hackeada", "start": {"date": "2026-01-01"}, "end": {"date": "2026-01-02"},
                             "extendedProperties": {"private": {"viltrumflowTaskId": str(a["id"]), "viltrumflow": "1"}}}

    puts = lambda: sum(1 for m, _ in google.calls if m in ("PUT", "POST") and "calendar/v3" in _)
    before = puts()
    assert client.get(f"{C}/events", headers=auth, params=RANGE).status_code == 200
    ta, tb, tc = (client.get(f"{T}/{x['id']}", headers=auth).json() for x in (a, b, c))
    assert ta["title"] == "Entrega" and ta["due_date"].startswith("2026-03-15") and ta["all_day"] is True
    assert tb["title"] == "Reunión de equipo" and tb["all_day"] is False and tb["due_date"].startswith("2026-03-11T15:30")
    assert tc["google_event_id"] is None and tc["due_date"].startswith("2026-03-12")  # la tarea se conserva
    assert puts() == before  # lo traído de Google no se reenvía a Google

    # no se consulta de nuevo hasta pasados 10 minutos, salvo en la sincronización manual
    google.events["ev1"]["start"] = {"date": "2026-03-20"}
    client.get(f"{C}/events", headers=auth, params=RANGE)
    assert client.get(f"{T}/{a['id']}", headers=auth).json()["due_date"].startswith("2026-03-15")
    client.post(f"{C}/sync", headers=auth)
    assert client.get(f"{T}/{a['id']}", headers=auth).json()["due_date"].startswith("2026-03-20")
    assert google.events["ev1"]["start"] == {"date": "2026-03-20"}  # y el envío posterior no lo deshace

    # el planificador también los trae
    google.events["ev1"]["summary"] = "✓ Entrega final"
    with SessionLocal() as db:
        db.query(GoogleAccount).update({"last_pull_at": None})
        db.commit()
        gcal.pull_all(db)
    assert client.get(f"{T}/{a['id']}", headers=auth).json()["title"] == "Entrega final"


def test_choose_calendar(client, auth, google):
    connect(client, auth)
    assert [c["name"] for c in client.get(f"{C}/calendars", headers=auth).json()] == ["Personal", "Trabajo"]
    t = client.post(T, headers=auth, json={"title": "Entrega", "due_date": "2026-03-10T00:00:00Z"}).json()
    assert google.calendars_used[-1] == "primary" and t["google_event_id"] == "ev1"

    assert client.put(f"{C}/settings", headers=auth, json={"calendar_id": "ajeno@x"}).status_code == 400
    s = client.put(f"{C}/settings", headers=auth, json={"calendar_id": "trabajo@x"}).json()
    assert s["calendar_id"] == "trabajo@x" and s["auto_sync"] is True
    # el evento se retira del calendario anterior y la sincronización lo crea en el nuevo
    assert google.events == {} and client.get(f"{T}/{t['id']}", headers=auth).json()["google_event_id"] is None
    assert client.post(f"{C}/sync", headers=auth).json()["synced"] == 1
    assert google.calendars_used[-1] == "trabajo%40x" and len(google.events) == 1


def test_event_duration_follows_estimate(client, auth, google):
    connect(client, auth)
    t = client.post(T, headers=auth, json={"title": "Llamada", "all_day": False, "due_date": "2026-03-10T09:00:00Z", "estimated_minutes": 30}).json()
    ev = google.events[t["google_event_id"]]
    assert ev["start"]["dateTime"].startswith("2026-03-10T09:00") and ev["end"]["dateTime"].startswith("2026-03-10T09:30")
    # alargarla en Google cambia la estimación de la tarea
    ev["end"] = {"dateTime": "2026-03-10T10:15:00+00:00"}
    client.post(f"{C}/sync", headers=auth)
    assert client.get(f"{T}/{t['id']}", headers=auth).json()["estimated_minutes"] == 75
