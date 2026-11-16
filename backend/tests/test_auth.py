from .conftest import make_user

A = "/api/v1/auth"


def test_register_login_me_refresh(client):
    headers, tokens = make_user(client)
    me = client.get(f"{A}/me", headers=headers).json()
    assert me["username"] == "ana" and "hashed_password" not in me

    # login por email, sin distinguir mayúsculas
    assert client.post(f"{A}/login", data={"username": "ANA@example.com", "password": "Secreta123"}).status_code == 200
    assert client.post(f"{A}/login", data={"username": "ana", "password": "mala"}).status_code == 401

    r = client.post(f"{A}/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert r.status_code == 200 and r.json()["access_token"]
    # un access token no sirve como refresh, ni un refresh como access
    assert client.post(f"{A}/refresh", json={"refresh_token": tokens["access_token"]}).status_code == 401
    assert client.get(f"{A}/me", headers={"Authorization": f"Bearer {tokens['refresh_token']}"}).status_code == 401
    assert client.get(f"{A}/me").status_code == 401


def test_register_validation_and_duplicates(client):
    make_user(client)
    dup = {"email": "ANA@example.com", "username": "otra", "password": "Secreta123"}
    assert client.post(f"{A}/register", json=dup).status_code == 409
    weak = {"email": "b@example.com", "username": "bea", "password": "sinmayusculas1"}
    assert client.post(f"{A}/register", json=weak).status_code == 422


def test_profile_and_password(client, auth):
    r = client.put(f"{A}/me", headers=auth, json={"full_name": "Ana G.", "theme": "dark"})
    assert r.json()["full_name"] == "Ana G." and r.json()["theme"] == "dark"
    bad = client.post(f"{A}/change-password", headers=auth, json={"current_password": "x", "new_password": "Nueva1234"})
    assert bad.status_code == 400
    ok = client.post(f"{A}/change-password", headers=auth, json={"current_password": "Secreta123", "new_password": "Nueva1234"})
    assert ok.status_code == 200
    # las sesiones anteriores dejan de valer; la actual sigue con los tokens nuevos
    assert client.get(f"{A}/me", headers=auth).status_code == 401
    assert client.get(f"{A}/me", headers={"Authorization": f"Bearer {ok.json()['access_token']}"}).status_code == 200
    assert client.post(f"{A}/login", data={"username": "ana", "password": "Nueva1234"}).status_code == 200


def test_new_user_gets_welcome_vault(client, auth):
    titles = {n["title"] for n in client.get("/api/v1/notes", headers=auth).json()}
    assert {"Bienvenido", "Ideas"} <= titles
    graph = client.get("/api/v1/notes/graph", headers=auth).json()
    assert all(n["kind"] == "note" for n in graph["nodes"]) and len(graph["edges"]) == 1


def test_login_rate_limit(client, monkeypatch):
    from app.config import settings
    make_user(client)
    make_user(client, "bea")
    monkeypatch.setattr(settings, "LOGIN_MAX_ATTEMPTS", 3)
    bad = lambda u="ana": client.post(f"{A}/login", data={"username": u, "password": "mala"})
    assert [bad().status_code for _ in range(3)] == [401, 401, 401]
    blocked = bad()
    assert blocked.status_code == 429 and int(blocked.headers["retry-after"]) > 0 and "Demasiados intentos" in blocked.json()["detail"]
    # bloqueada también con la contraseña correcta, pero solo esa cuenta
    assert client.post(f"{A}/login", data={"username": "ANA", "password": "Secreta123"}).status_code == 429
    assert client.post(f"{A}/login", data={"username": "bea", "password": "Secreta123"}).status_code == 200


def test_successful_login_resets_counter(client, monkeypatch):
    from app.config import settings
    make_user(client)
    monkeypatch.setattr(settings, "LOGIN_MAX_ATTEMPTS", 3)
    for _ in range(4):  # dos fallos y un acierto, repetido: nunca llega al límite
        client.post(f"{A}/login", data={"username": "ana", "password": "mala"})
        client.post(f"{A}/login", data={"username": "ana", "password": "mala"})
        assert client.post(f"{A}/login", data={"username": "ana", "password": "Secreta123"}).status_code == 200


def test_password_reset_flow(client, monkeypatch):
    from app.config import settings
    from app.services import mailer
    _, old_tokens = make_user(client)
    F, R = f"{A}/forgot-password", f"{A}/reset-password"

    assert client.post(F, json={"email": "ana@example.com"}).status_code == 503  # sin SMTP no se puede

    sent = []
    monkeypatch.setattr(settings, "SMTP_HOST", "smtp.test")
    monkeypatch.setattr(settings, "SMTP_FROM", "no-reply@test")
    monkeypatch.setattr(mailer, "send_email", lambda to, subject, text, html: sent.append((to, text)) or True)

    # misma respuesta exista o no la cuenta
    unknown = client.post(F, json={"email": "nadie@example.com"})
    known = client.post(F, json={"email": "ANA@example.com"})
    assert unknown.status_code == known.status_code == 200 and unknown.json() == known.json()
    assert len(sent) == 1 and sent[0][0] == "ana@example.com"
    token = sent[0][1].split("reset-password?token=")[1].split()[0]

    assert client.post(R, json={"token": token, "new_password": "debil"}).status_code == 422
    assert client.post(R, json={"token": old_tokens["access_token"], "new_password": "Nueva1234"}).status_code == 400  # otro tipo de token
    assert client.post(R, json={"token": token, "new_password": "Nueva1234"}).status_code == 200
    assert client.post(R, json={"token": token, "new_password": "Otra12345"}).status_code == 400  # un solo uso

    assert client.post(f"{A}/login", data={"username": "ana", "password": "Nueva1234"}).status_code == 200
    assert client.post(f"{A}/login", data={"username": "ana", "password": "Secreta123"}).status_code == 401
    # las sesiones abiertas antes del cambio quedan cerradas
    assert client.get(f"{A}/me", headers={"Authorization": f"Bearer {old_tokens['access_token']}"}).status_code == 401
    assert client.post(f"{A}/refresh", json={"refresh_token": old_tokens["refresh_token"]}).status_code == 401

    # límite de solicitudes por email
    assert [client.post(F, json={"email": "ana@example.com"}).status_code for _ in range(3)] == [200, 200, 429]
