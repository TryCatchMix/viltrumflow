from datetime import datetime, timedelta, timezone

from app.database import SessionLocal
from app.models import Note, Task
from app.services.trash import purge_expired

N, T, TR = "/api/v1/notes", "/api/v1/tasks", "/api/v1/trash"


def test_note_trash_restore_and_links(client, auth):
    a = client.post(N, headers=auth, json={"title": "Alfa", "content": "ver [[Beta]] #x"}).json()
    b = client.post(N, headers=auth, json={"title": "Beta", "content": "vuelve a [[Alfa]]"}).json()
    assert client.delete(f"{N}/{b['id']}", headers=auth).status_code == 204

    # desaparece de todas partes y el enlace queda sin resolver
    assert client.get(f"{N}/{b['id']}", headers=auth).status_code == 404
    assert client.get(f"{N}/by-title/Beta", headers=auth).status_code == 404
    assert "Beta" not in [n["title"] for n in client.get(N, headers=auth).json()]
    assert not any(r["title"] == "Beta" for r in client.get("/api/v1/search", headers=auth, params={"q": "Beta"}).json() if r["kind"] == "note")
    g = client.get(f"{N}/graph", headers=auth).json()
    assert {n["label"]: n["kind"] for n in g["nodes"]}["Beta"] == "ghost"
    assert client.get(f"{N}/{a['id']}", headers=auth).json()["backlinks"] == []

    items = client.get(TR, headers=auth).json()
    assert [(i["kind"], i["title"]) for i in items] == [("note", "Beta")] and items[0]["purge_at"] > items[0]["deleted_at"]

    # restaurar reconstruye enlaces en ambos sentidos
    assert client.post(f"{TR}/note/{b['id']}/restore", headers=auth).status_code == 200
    assert [x["title"] for x in client.get(f"{N}/{a['id']}", headers=auth).json()["backlinks"]] == ["Beta"]
    assert client.get(f"{N}/{a['id']}", headers=auth).json()["outgoing"][0]["id"] == b["id"]
    assert client.get(TR, headers=auth).json() == []


def test_title_reuse_while_in_trash(client, auth):
    old = client.post(N, headers=auth, json={"title": "Plan", "content": "viejo"}).json()
    client.delete(f"{N}/{old['id']}", headers=auth)
    new = client.post(N, headers=auth, json={"title": "Plan", "content": "nuevo"})  # el título queda libre
    assert new.status_code == 201
    assert client.get(TR, headers=auth).json()[0]["title"] == "Plan (papelera)"
    r = client.post(f"{TR}/note/{old['id']}/restore", headers=auth).json()
    assert "Plan (restaurada)" in r["message"]
    titles = {n["title"]: n["id"] for n in client.get(N, headers=auth).json()}
    assert titles["Plan"] == new.json()["id"] and titles["Plan (restaurada)"] == old["id"]
    # también al renombrar otra nota hacia un título ocupado solo por la papelera
    client.delete(f"{N}/{old['id']}", headers=auth)
    assert client.put(f"{N}/{new.json()['id']}", headers=auth, json={"title": "Plan (restaurada)"}).status_code == 200


def test_task_trash_with_subtasks(client, auth):
    t = client.post(T, headers=auth, json={"title": "Mudanza", "due_date": "2030-01-01T00:00:00Z", "reminder_minutes": 0}).json()
    s = client.post(T, headers=auth, json={"title": "Cajas", "parent_task_id": t["id"]}).json()
    extra = client.post(T, headers=auth, json={"title": "Suelta", "parent_task_id": t["id"]}).json()
    assert client.delete(f"{T}/{extra['id']}", headers=auth).status_code == 204  # una subtarea se borra del todo
    assert client.delete(f"{T}/{t['id']}", headers=auth).status_code == 204

    assert client.get(T, headers=auth).json() == []
    assert client.get(f"{T}/{t['id']}", headers=auth).status_code == 404
    assert client.get(f"{T}/{s['id']}", headers=auth).status_code == 404
    assert client.put(f"{T}/{t['id']}", headers=auth, json={"title": "x"}).status_code == 404
    assert client.get("/api/v1/stats/overview", headers=auth).json()["total"] == 0
    assert [(i["kind"], i["title"]) for i in client.get(TR, headers=auth).json()] == [("task", "Mudanza")]  # sin la subtarea

    client.post(f"{TR}/task/{t['id']}/restore", headers=auth)
    back = client.get(f"{T}/{t['id']}", headers=auth).json()
    assert [x["title"] for x in back["subtasks"]] == ["Cajas"]

    client.delete(f"{T}/{t['id']}", headers=auth)
    assert client.delete(f"{TR}/task/{t['id']}", headers=auth).status_code == 204
    assert client.get(TR, headers=auth).json() == []
    assert client.post(f"{TR}/task/{t['id']}/restore", headers=auth).status_code == 404
    with SessionLocal() as db:
        assert db.query(Task).count() == 0  # subtareas eliminadas en cascada


def test_empty_trash_and_purge_after_30_days(client, auth):
    from .conftest import make_user
    bea, _ = make_user(client, "bea")
    n = client.post(N, headers=auth, json={"title": "Temporal"}).json()
    t = client.post(T, headers=auth, json={"title": "Temporal"}).json()
    other = client.post(N, headers=bea, json={"title": "De Bea"}).json()
    for h, url in [(auth, f"{N}/{n['id']}"), (auth, f"{T}/{t['id']}"), (bea, f"{N}/{other['id']}")]:
        client.delete(url, headers=h)

    # la papelera es privada
    assert client.post(f"{TR}/note/{other['id']}/restore", headers=auth).status_code == 404
    assert client.delete(f"{TR}/note/{other['id']}", headers=auth).status_code == 404
    assert len(client.get(TR, headers=auth).json()) == 2

    now = datetime.now(timezone.utc)
    with SessionLocal() as db:
        assert purge_expired(db, now + timedelta(days=29)) == 0
        db.query(Note).filter(Note.id == n["id"]).update({"deleted_at": now - timedelta(days=31)})
        db.commit()
        assert purge_expired(db, now) == 1
    assert [i["kind"] for i in client.get(TR, headers=auth).json()] == ["task"]

    assert client.delete(TR, headers=auth).status_code == 204
    assert client.get(TR, headers=auth).json() == []
    assert len(client.get(TR, headers=bea).json()) == 1  # vaciar la mía no toca la de otros
