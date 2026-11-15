import os

os.environ["DATABASE_URL"] = os.environ.get("TEST_DATABASE_URL", "sqlite://")
os.environ["SECRET_KEY"] = "test-secret-key-test-secret-key-0123456789"
os.environ["ENVIRONMENT"] = "test"
os.environ.pop("GOOGLE_CLIENT_ID", None)
os.environ.pop("GOOGLE_CLIENT_SECRET", None)

import pytest
from fastapi.testclient import TestClient

from app.database import Base, engine
from app.main import app


@pytest.fixture()
def client():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    with TestClient(app, follow_redirects=False) as c:
        yield c


def make_user(client, name="ana"):
    r = client.post("/api/v1/auth/register", json={
        "email": f"{name}@example.com", "username": name, "password": "Secreta123", "full_name": name.title(),
    })
    assert r.status_code == 201, r.text
    r = client.post("/api/v1/auth/login", data={"username": name, "password": "Secreta123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}, r.json()


@pytest.fixture()
def auth(client):
    return make_user(client)[0]
