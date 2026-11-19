import base64
import json
import time
from urllib.parse import parse_qs, urlparse

import httpx
import pytest

from app.config import settings
from app.services import google_calendar as gcal
from app.services import google_login
from tests.conftest import make_user

G = "/api/v1/auth/google"


def _jwt(claims: dict) -> str:
    enc = lambda d: base64.urlsafe_b64encode(json.dumps(d).encode()).decode().rstrip("=")
    return f"{enc({'alg': 'RS256'})}.{enc(claims)}.firma"


class FakeGoogle:
    def __init__(self):
        self.claims = {}
        self.status = 200
        self.redirect_uris = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        assert str(request.url).startswith(gcal.TOKEN_URL)
        body = parse_qs(request.content.decode())
        self.redirect_uris.append(body["redirect_uri"][0])
        if self.status != 200:
            return httpx.Response(self.status, json={"error": "invalid_grant"})
        return httpx.Response(200, json={"access_token": "x", "id_token": _jwt(self.claims)})


@pytest.fixture()
def google(monkeypatch):
    fake = FakeGoogle()
    monkeypatch.setattr(settings, "GOOGLE_CLIENT_ID", "cid")
    monkeypatch.setattr(settings, "GOOGLE_CLIENT_SECRET", "csecret")
    monkeypatch.setattr(gcal, "_client", lambda: httpx.Client(transport=httpx.MockTransport(fake.handler)))
    google_login._used.clear()
    return fake


def _start(client, google, ticket=None, **claims):
    """Inicia el flujo y prepara la identidad que «devolverá» Google. Devuelve el state."""
    r = client.post(f"{G}/start", data={"ticket": ticket}) if ticket else client.get(f"{G}/start")
    assert r.status_code in (302, 303), r.text
    q = parse_qs(urlparse(r.headers["location"]).query)
    assert q["scope"] == ["openid email profile"]
    assert q["redirect_uri"] == ["http://localhost:8000/api/v1/auth/google/callback"]
    google.claims = {
        "iss": "https://accounts.google.com", "aud": "cid", "exp": time.time() + 600, "nonce": q["nonce"][0],
        "sub": "g-123", "email": "nuevo@gmail.com", "email_verified": True, "name": "Nuevo Usuario",
        "picture": "https://lh3.googleusercontent.com/a/foto", **claims,
    }
    return q["state"][0]


def _callback(client, state, code="c0de"):
    r = client.get(f"{G}/callback", params={"state": state, "code": code})
    assert r.status_code == 302
    return r.headers["location"]


def _login_code(location: str) -> str:
    assert "#" in location, location
    return parse_qs(location.split("#", 1)[1])["google_code"][0]


def test_providers_and_unconfigured(client):
    assert client.get("/api/v1/auth/providers").json() == {"google": False}
    r = client.get(f"{G}/start")
    assert r.status_code == 307 or r.status_code == 302
    assert "google=unavailable" in r.headers["location"]


def test_sign_up_and_sign_in_with_google(client, google):
    assert client.get("/api/v1/auth/providers").json() == {"google": True}
    loc = _callback(client, _start(client, google))
    assert loc.startswith("http://localhost:4200/login#")
    tokens = client.post(f"{G}/exchange", json={"code": _login_code(loc)}).json()
    headers = {"Authorization": f"Bearer {tokens['access_token']}"}
    me = client.get("/api/v1/auth/me", headers=headers).json()
    assert me["email"] == "nuevo@gmail.com" and me["username"] == "nuevo" and me["full_name"] == "Nuevo Usuario"
    assert me["google_linked"] is True and me["has_password"] is False
    assert me["avatar_url"].startswith("https://lh3.")
    # Recibe las notas de bienvenida como cualquier cuenta nueva
    assert {n["title"] for n in client.get("/api/v1/notes", headers=headers).json()} >= {"Bienvenido", "Ideas"}

    # Segunda vez: misma cuenta, aunque el email de Google haya cambiado
    loc = _callback(client, _start(client, google, email="otro@gmail.com"))
    tokens2 = client.post(f"{G}/exchange", json={"code": _login_code(loc)}).json()
    me2 = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {tokens2['access_token']}"}).json()
    assert me2["id"] == me["id"]

    # Sin contraseña todavía: la elige sin escribir la actual y ya puede entrar también con ella
    r = client.post("/api/v1/auth/change-password", headers=headers, json={"new_password": "NuevaClave1"})
    assert r.status_code == 200
    assert client.post("/api/v1/auth/login", data={"username": "nuevo", "password": "NuevaClave1"}).status_code == 200
    # Con contraseña ya elegida, cambiarla exige la actual
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    assert client.post("/api/v1/auth/change-password", headers=h, json={"new_password": "OtraClave1"}).status_code == 400


def test_one_time_code_cannot_be_reused(client, google):
    code = _login_code(_callback(client, _start(client, google)))
    assert client.post(f"{G}/exchange", json={"code": code}).status_code == 200
    assert client.post(f"{G}/exchange", json={"code": code}).status_code == 401
    assert client.post(f"{G}/exchange", json={"code": "basura"}).status_code == 401


def test_username_collision_gets_suffix(client, google):
    make_user(client, "nuevo")
    loc = _callback(client, _start(client, google))
    tokens = client.post(f"{G}/exchange", json={"code": _login_code(loc)}).json()
    me = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {tokens['access_token']}"}).json()
    assert me["username"] == "nuevo2"


def test_existing_email_is_not_taken_over(client, google):
    make_user(client, "ana")
    loc = _callback(client, _start(client, google, email="ana@example.com"))
    assert loc == "http://localhost:4200/login?google=exists"


def test_rejects_forged_or_foreign_identity(client, google):
    # Sin la cookie del navegador que empezó el flujo (login CSRF)
    state = _start(client, google)
    client.cookies.clear()
    assert _callback(client, state).endswith("google=expired")
    # Identidad emitida para otra aplicación, con otro nonce o sin email verificado
    for bad in ({"aud": "otra-app"}, {"nonce": "otro"}, {"iss": "https://evil.example"}, {"exp": time.time() - 5}):
        assert _callback(client, _start(client, google, **bad)).endswith("google=error"), bad
    assert _callback(client, _start(client, google, email_verified=False)).endswith("google=unverified")
    # Google rechaza el código o el usuario cancela
    state = _start(client, google)
    google.status = 400
    assert _callback(client, state).endswith("google=error")
    state = _start(client, google)
    r = client.get(f"{G}/callback", params={"state": state, "error": "access_denied"})
    assert r.headers["location"].endswith("google=denied")
    assert client.get("/api/v1/auth/providers").status_code == 200


def test_link_and_unlink_existing_account(client, google):
    headers, _ = make_user(client, "ana")
    ticket = client.post(f"{G}/link-ticket", headers=headers).json()["ticket"]
    loc = _callback(client, _start(client, google, ticket=ticket, email="ana.personal@gmail.com"))
    assert loc == "http://localhost:4200/settings?google=linked"
    assert client.get("/api/v1/auth/me", headers=headers).json()["google_linked"] is True
    # El vale solo sirve una vez
    r = client.post(f"{G}/start", data={"ticket": ticket})
    assert r.headers["location"].endswith("google=expired")

    # Ahora entra con Google en su cuenta de siempre
    code = _login_code(_callback(client, _start(client, google)))
    tokens = client.post(f"{G}/exchange", json={"code": code}).json()
    assert client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {tokens['access_token']}"}).json()["username"] == "ana"

    # Otra cuenta no puede quedarse con la misma cuenta de Google
    h2, _ = make_user(client, "luis")
    t2 = client.post(f"{G}/link-ticket", headers=h2).json()["ticket"]
    assert _callback(client, _start(client, google, ticket=t2)).endswith("google=taken")

    r = client.delete(f"{G}/link", headers=headers)
    assert r.status_code == 200 and r.json()["google_linked"] is False
    assert _callback(client, _start(client, google)).startswith("http://localhost:4200/login#")  # crearía una nueva


def test_cannot_unlink_without_password(client, google):
    code = _login_code(_callback(client, _start(client, google)))
    tokens = client.post(f"{G}/exchange", json={"code": code}).json()
    headers = {"Authorization": f"Bearer {tokens['access_token']}"}
    assert client.delete(f"{G}/link", headers=headers).status_code == 400
    # Con contraseña normal no se puede entrar: la aleatoria no la conoce nadie
    assert client.post("/api/v1/auth/login", data={"username": "nuevo", "password": "Secreta123"}).status_code == 401
