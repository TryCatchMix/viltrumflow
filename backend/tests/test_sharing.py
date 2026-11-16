import pytest

from app.services import mailer

from .conftest import make_user

P, T = "/api/v1/projects", "/api/v1/tasks"


@pytest.fixture()
def team(client):
    ana, _ = make_user(client, "ana")
    bea, _ = make_user(client, "bea")
    leo, _ = make_user(client, "leo")
    eva, _ = make_user(client, "eva")  # sin acceso
    p = client.post(P, headers=ana, json={"name": "Lanzamiento"}).json()
    members = client.post(f"{P}/{p['id']}/members", headers=ana, json={"identifier": "BEA@example.com", "role": "editor"}).json()
    client.post(f"{P}/{p['id']}/members", headers=ana, json={"identifier": "leo", "role": "viewer"})
    ids = {m["username"]: m["user_id"] for m in members}
    ids["leo"] = next(m["user_id"] for m in client.get(f"{P}/{p['id']}/members", headers=ana).json() if m["username"] == "leo")
    return {"ana": ana, "bea": bea, "leo": leo, "eva": eva, "pid": p["id"], "ids": ids}


def test_invite_rules(client, team):
    ana, bea, eva, pid = team["ana"], team["bea"], team["eva"], team["pid"]
    M = f"{P}/{pid}/members"
    assert [(m["username"], m["role"]) for m in client.get(M, headers=bea).json()] == [("ana", "owner"), ("bea", "editor"), ("leo", "viewer")]
    assert client.post(M, headers=ana, json={"identifier": "nadie"}).status_code == 404
    assert client.post(M, headers=ana, json={"identifier": "bea"}).status_code == 409
    assert client.post(M, headers=ana, json={"identifier": "ana"}).status_code == 409
    assert client.post(M, headers=bea, json={"identifier": "eva"}).status_code == 403  # solo el propietario invita
    assert client.get(M, headers=eva).status_code == 404  # sin acceso, el proyecto no existe para ella
    assert client.post(M, headers=eva, json={"identifier": "eva"}).status_code == 404

    shared = client.get(P, headers=bea).json()[0]
    assert shared["role"] == "editor" and shared["owner_name"] == "Ana" and shared["member_count"] == 2
    assert client.get(P, headers=eva).json() == []
    # solo el propietario edita o borra el proyecto
    assert client.put(f"{P}/{pid}", headers=bea, json={"name": "x"}).status_code == 403
    assert client.delete(f"{P}/{pid}", headers=bea).status_code == 403


def test_task_permissions_by_role(client, team):
    ana, bea, leo, eva, pid = team["ana"], team["bea"], team["leo"], team["eva"], team["pid"]
    t = client.post(T, headers=ana, json={"title": "Web", "project_id": pid}).json()
    private = client.post(T, headers=ana, json={"title": "Privada de Ana"}).json()

    # todos los miembros la ven; la privada no
    for h in (bea, leo):
        assert [x["title"] for x in client.get(T, headers=h).json()] == ["Web"]
        assert client.get(f"{T}/{private['id']}", headers=h).status_code == 404
    assert client.get(T, headers=eva).json() == []
    assert client.get(f"{T}/{t['id']}", headers=eva).status_code == 404
    assert client.put(f"{T}/{t['id']}", headers=eva, json={"title": "hack"}).status_code == 404

    # editora: edita, mueve, crea y añade subtareas
    assert client.get(f"{T}/{t['id']}", headers=bea).json()["can_edit"] is True
    assert client.put(f"{T}/{t['id']}", headers=bea, json={"title": "Web v2"}).json()["title"] == "Web v2"
    assert client.patch(f"{T}/{t['id']}/move", headers=bea, json={"status": "in_progress", "position": 0}).status_code == 200
    mine = client.post(T, headers=bea, json={"title": "De Bea", "project_id": pid}).json()
    sub = client.post(T, headers=bea, json={"title": "Sub", "parent_task_id": t["id"]}).json()
    assert client.put(f"{T}/{mine['id']}", headers=ana, json={"priority": "high"}).status_code == 200  # la propietaria edita las de otros
    assert client.put(f"{T}/{sub['id']}", headers=ana, json={"status": "completed"}).status_code == 200  # subtarea: hereda el proyecto

    # lector: ve y comenta, pero no modifica
    assert client.get(f"{T}/{t['id']}", headers=leo).json()["can_edit"] is False
    for call in (lambda: client.put(f"{T}/{t['id']}", headers=leo, json={"title": "x"}),
                 lambda: client.patch(f"{T}/{t['id']}/move", headers=leo, json={"status": "completed", "position": 0}),
                 lambda: client.delete(f"{T}/{t['id']}", headers=leo),
                 lambda: client.post(T, headers=leo, json={"title": "x", "project_id": pid}),
                 lambda: client.post(T, headers=leo, json={"title": "x", "parent_task_id": t["id"]})):
        assert call().status_code == 403
    c = client.post(f"{T}/{t['id']}/comments", headers=leo, json={"content": "¿fecha?"}).json()
    assert c["author_name"] == "Leo"
    assert client.delete(f"{T}/{t['id']}/comments/{c['id']}", headers=bea).status_code == 403
    assert client.delete(f"{T}/{t['id']}/comments/{c['id']}", headers=ana).status_code == 204

    # no se puede meter una tarea en un proyecto ajeno ni de solo lectura
    own = client.post(T, headers=leo, json={"title": "De Leo"}).json()
    assert client.put(f"{T}/{own['id']}", headers=leo, json={"project_id": pid}).status_code == 403
    assert client.post(T, headers=eva, json={"title": "x", "project_id": pid}).status_code == 400

    # avance del proyecto: cuenta las tareas de todos
    assert client.get(P, headers=leo).json()[0]["total_tasks"] == 2


def test_assignment_and_notifications(client, team, monkeypatch):
    ana, bea, leo, eva, pid, ids = team["ana"], team["bea"], team["leo"], team["eva"], team["pid"], team["ids"]
    sent = []
    monkeypatch.setattr(mailer, "send_email", lambda to, subject, text, html: sent.append((to, subject)) or True)
    client.put("/api/v1/auth/me", headers=bea, json={"email_reminders": True})

    t = client.post(T, headers=ana, json={"title": "Preparar demo", "project_id": pid, "assignee_id": ids["bea"],
                                          "all_day": False, "due_date": "2020-01-01T10:00:00Z", "reminder_minutes": 0}).json()
    assert t["assignee_name"] == "Bea" and t["owner_name"] == "Ana"
    assert sent == [("bea@example.com", "Nueva tarea asignada: Preparar demo")]

    # aviso en la app, una sola vez, y solo para la persona asignada
    poll = client.post("/api/v1/reminders/poll", headers=bea).json()
    assert [(r["kind"], r["title"], r["by"]) for r in poll] == [("assigned", "Preparar demo", "Lanzamiento")]
    assert client.post("/api/v1/reminders/poll", headers=bea).json() == []
    assert client.post("/api/v1/reminders/poll", headers=ana).json() == []

    # «mis tareas»: cuenta para la responsable, no para quien la creó
    assert client.get("/api/v1/stats/overview", headers=bea).json()["overdue"] == 1
    assert client.get("/api/v1/stats/overview", headers=ana).json()["total"] == 0
    assert [x["id"] for x in client.get(T, headers=bea, params={"assigned_to_me": True}).json()] == [t["id"]]
    assert client.get(T, headers=ana, params={"assigned_to_me": True}).json() == []

    # solo se asigna a participantes
    assert client.put(f"{T}/{t['id']}", headers=ana, json={"assignee_id": ids["leo"]}).json()["assignee_name"] == "Leo"
    eva_id = client.get("/api/v1/auth/me", headers=eva).json()["id"]
    assert client.put(f"{T}/{t['id']}", headers=ana, json={"assignee_id": eva_id}).status_code == 400
    solo = client.post(T, headers=ana, json={"title": "Sin proyecto"}).json()
    assert client.put(f"{T}/{solo['id']}", headers=ana, json={"assignee_id": ids["bea"]}).status_code == 400
    assert client.put(f"{T}/{t['id']}", headers=ana, json={"assignee_id": None}).json()["assignee_id"] is None
    # sacar la tarea del proyecto retira a un responsable sin acceso
    client.put(f"{T}/{t['id']}", headers=ana, json={"assignee_id": ids["bea"]})
    assert client.put(f"{T}/{t['id']}", headers=ana, json={"project_id": None}).json()["assignee_id"] is None


def test_leaving_and_removal(client, team):
    ana, bea, leo, pid, ids = team["ana"], team["bea"], team["leo"], team["pid"], team["ids"]
    t = client.post(T, headers=ana, json={"title": "Compartida", "project_id": pid, "assignee_id": ids["bea"]}).json()
    by_bea = client.post(T, headers=bea, json={"title": "Creada por Bea", "project_id": pid}).json()

    assert client.put(f"{P}/{pid}/members/{ids['leo']}", headers=ana, json={"role": "editor"}).status_code == 200
    assert client.put(f"{T}/{t['id']}", headers=leo, json={"title": "Ahora sí"}).status_code == 200
    assert client.delete(f"{P}/{pid}/members/{ids['bea']}", headers=leo).status_code == 403  # un miembro no expulsa a otro
    assert client.delete(f"{P}/{pid}/members/{ids['leo']}", headers=leo).status_code == 204  # pero puede salirse

    assert client.delete(f"{P}/{pid}/members/{ids['bea']}", headers=ana).status_code == 204
    # pierde el acceso también a lo que creó dentro del proyecto, y deja de ser responsable
    assert client.get(T, headers=bea).json() == []
    assert client.get(f"{T}/{by_bea['id']}", headers=bea).status_code == 404
    assert client.put(f"{T}/{by_bea['id']}", headers=bea, json={"title": "x"}).status_code == 404
    assert client.get(f"{T}/{t['id']}", headers=ana).json()["assignee_id"] is None

    # al borrar el proyecto, cada tarea vuelve a quien la creó
    assert client.delete(f"{P}/{pid}", headers=ana).status_code == 204
    assert [x["title"] for x in client.get(T, headers=bea).json()] == ["Creada por Bea"]
    assert "Creada por Bea" not in [x["title"] for x in client.get(T, headers=ana).json()]


def test_shared_task_trash(client, team):
    ana, bea, leo, pid = team["ana"], team["bea"], team["leo"], team["pid"]
    t = client.post(T, headers=bea, json={"title": "Borrable", "project_id": pid}).json()
    assert client.delete(f"{T}/{t['id']}", headers=bea).status_code == 204
    assert client.get(T, headers=ana).json() == []
    assert client.get("/api/v1/trash", headers=leo).json() == []
    # la recuperan quien la creó y la propietaria del proyecto
    assert [i["title"] for i in client.get("/api/v1/trash", headers=bea).json()] == ["Borrable"]
    assert client.post(f"/api/v1/trash/task/{t['id']}/restore", headers=ana).status_code == 200
    assert [x["title"] for x in client.get(T, headers=leo).json()] == ["Borrable"]
