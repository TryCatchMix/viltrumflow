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
    assert client.post(f"{A}/login", data={"username": "ana", "password": "Nueva1234"}).status_code == 200


def test_new_user_gets_welcome_vault(client, auth):
    titles = {n["title"] for n in client.get("/api/v1/notes", headers=auth).json()}
    assert {"Bienvenido", "Ideas"} <= titles
    graph = client.get("/api/v1/notes/graph", headers=auth).json()
    assert all(n["kind"] == "note" for n in graph["nodes"]) and len(graph["edges"]) == 1
