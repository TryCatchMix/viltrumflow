from .conftest import make_user

T = "/api/v1/tasks"
P = "/api/v1/projects"


def test_task_lifecycle(client, auth):
    p = client.post(P, headers=auth, json={"name": "Web", "color": "#112233"}).json()
    r = client.post(T, headers=auth, json={"title": "Diseñar", "project_id": p["id"], "tags": ["#UI", "ui", "front"],
                                           "due_date": "2026-03-10T00:00:00Z", "priority": "high"})
    assert r.status_code == 201, r.text
    t = r.json()
    assert t["tags"] == ["ui", "front"] and t["status"] == "todo" and t["completed_at"] is None

    sub = client.post(T, headers=auth, json={"title": "Boceto", "parent_task_id": t["id"]}).json()
    assert client.post(T, headers=auth, json={"title": "x", "parent_task_id": sub["id"]}).status_code == 400

    listed = client.get(T, headers=auth).json()
    assert [x["title"] for x in listed] == ["Diseñar"]  # las subtareas van anidadas
    assert listed[0]["subtasks"][0]["title"] == "Boceto"

    done = client.put(f"{T}/{t['id']}", headers=auth, json={"status": "completed"}).json()
    assert done["completed_at"] is not None
    reopened = client.put(f"{T}/{t['id']}", headers=auth, json={"status": "todo", "due_date": None}).json()
    assert reopened["completed_at"] is None and reopened["due_date"] is None

    stats = client.get(P, headers=auth).json()[0]
    assert stats["total_tasks"] == 1 and stats["completed_tasks"] == 0

    assert client.delete(f"{P}/{p['id']}", headers=auth).status_code == 204
    assert client.get(f"{T}/{t['id']}", headers=auth).json()["project_id"] is None  # la tarea sobrevive
    assert client.delete(f"{T}/{t['id']}", headers=auth).status_code == 204
    assert client.get(f"{T}/{sub['id']}", headers=auth).status_code == 404  # subtarea en cascada


def test_filters(client, auth):
    for title, pr, tags in [("Comprar pan", "low", ["casa"]), ("Informe anual", "urgent", ["trabajo"]), ("Pan de masa madre", "low", [])]:
        client.post(T, headers=auth, json={"title": title, "priority": pr, "tags": tags})
    assert len(client.get(T, headers=auth, params={"q": "pan"}).json()) == 2
    assert [t["title"] for t in client.get(T, headers=auth, params={"priority": "urgent"}).json()] == ["Informe anual"]
    assert [t["title"] for t in client.get(T, headers=auth, params={"tag": "casa"}).json()] == ["Comprar pan"]


def test_move_reorders_column(client, auth):
    ids = [client.post(T, headers=auth, json={"title": f"t{i}"}).json()["id"] for i in range(3)]
    r = client.patch(f"{T}/{ids[0]}/move", headers=auth, json={"status": "in_progress", "position": 0})
    assert r.json()["status"] == "in_progress"
    client.patch(f"{T}/{ids[1]}/move", headers=auth, json={"status": "in_progress", "position": 0})
    client.patch(f"{T}/{ids[2]}/move", headers=auth, json={"status": "in_progress", "position": 1})
    col = client.get(T, headers=auth, params={"status": "in_progress"}).json()
    assert [t["id"] for t in col] == [ids[1], ids[2], ids[0]]
    assert [t["position"] for t in col] == [0, 1, 2]
    done = client.patch(f"{T}/{ids[0]}/move", headers=auth, json={"status": "completed", "position": 0}).json()
    assert done["completed_at"]


def test_comments(client, auth):
    t = client.post(T, headers=auth, json={"title": "Con comentarios"}).json()
    c = client.post(f"{T}/{t['id']}/comments", headers=auth, json={"content": "Hola"}).json()
    assert c["author_name"] == "Ana"
    assert len(client.get(f"{T}/{t['id']}/comments", headers=auth).json()) == 1
    assert client.delete(f"{T}/{t['id']}/comments/{c['id']}", headers=auth).status_code == 204


def test_users_are_isolated(client):
    ana, _ = make_user(client, "ana")
    bea, _ = make_user(client, "bea")
    p = client.post(P, headers=ana, json={"name": "Privado"}).json()
    t = client.post(T, headers=ana, json={"title": "Secreta"}).json()
    n = client.post("/api/v1/notes", headers=ana, json={"title": "Diario secreto", "content": "x"}).json()

    assert client.get(T, headers=bea).json() == []
    for method, url in [("get", f"{T}/{t['id']}"), ("delete", f"{T}/{t['id']}"), ("get", f"{P}/{p['id']}"),
                        ("get", f"/api/v1/notes/{n['id']}"), ("delete", f"/api/v1/notes/{n['id']}")]:
        assert getattr(client, method)(url, headers=bea).status_code == 404
    assert client.put(f"{T}/{t['id']}", headers=bea, json={"title": "hack"}).status_code == 404
    # no se pueden referenciar recursos ajenos
    assert client.post(T, headers=bea, json={"title": "x", "project_id": p["id"]}).status_code == 400
    assert client.post(T, headers=bea, json={"title": "x", "parent_task_id": t["id"]}).status_code == 400
    assert client.post(T, headers=bea, json={"title": "x", "note_id": n["id"]}).status_code == 400
    assert not any(r["title"] == "Diario secreto" for r in client.get("/api/v1/search", headers=bea, params={"q": "secret"}).json())


def test_stats_overview(client, auth):
    a = client.post(T, headers=auth, json={"title": "a", "due_date": "2020-01-01T00:00:00Z"}).json()
    client.post(T, headers=auth, json={"title": "b", "tags": ["x"]})
    client.put(f"{T}/{a['id']}", headers=auth, json={"status": "completed"})
    o = client.get("/api/v1/stats/overview", headers=auth, params={"days": 7}).json()
    assert o["total"] == 2 and o["by_status"]["completed"] == 1 and o["completion_rate"] == 50.0
    assert o["overdue"] == 0  # completada: ya no cuenta como atrasada
    assert len(o["timeline"]) == 7 and o["timeline"][-1]["created"] == 2 and o["timeline"][-1]["open"] == 1
    assert o["notes"] == 2 and o["top_tags"] == [{"tag": "x", "count": 1}]


def test_due_date_with_offset_is_stored_in_utc(client, auth):
    t = client.post(T, headers=auth, json={"title": "Con desfase", "all_day": False, "due_date": "2026-03-11T16:30:00+01:00"}).json()
    assert t["due_date"].startswith("2026-03-11T15:30")
    u = client.put(f"{T}/{t['id']}", headers=auth, json={"due_date": "2026-03-11T23:30:00-05:00"}).json()
    assert u["due_date"].startswith("2026-03-12T04:30")


def test_time_tracking(client, auth):
    from datetime import datetime, timedelta, timezone
    from app.database import SessionLocal
    from app.models import Task

    def rewind(task_id, minutes):  # como si el cronómetro llevara ese tiempo en marcha
        with SessionLocal() as db:
            db.get(Task, task_id).timer_started_at = datetime.now(timezone.utc) - timedelta(minutes=minutes)
            db.commit()

    a = client.post(T, headers=auth, json={"title": "Informe", "estimated_hours": 2}).json()
    b = client.post(T, headers=auth, json={"title": "Correo"}).json()
    assert client.post(f"{T}/{a['id']}/timer/start", headers=auth).json()["timer_started_at"] is not None
    rewind(a["id"], 30)
    # arrancar otra tarea detiene la anterior y le suma su tiempo
    client.post(f"{T}/{b['id']}/timer/start", headers=auth)
    a2 = client.get(f"{T}/{a['id']}", headers=auth).json()
    assert a2["timer_started_at"] is None and 1795 <= a2["time_spent_seconds"] <= 1810
    rewind(b["id"], 10)
    # completar una tarea detiene su cronómetro
    b2 = client.put(f"{T}/{b['id']}", headers=auth, json={"status": "completed"}).json()
    assert b2["timer_started_at"] is None and 595 <= b2["time_spent_seconds"] <= 610
    assert client.post(f"{T}/{a['id']}/timer/stop", headers=auth).json()["time_spent_seconds"] == a2["time_spent_seconds"]  # parar dos veces no suma

    # corrección manual y resumen estimado/real
    assert client.put(f"{T}/{a['id']}", headers=auth, json={"time_spent_seconds": 5400}).json()["time_spent_seconds"] == 5400
    o = client.get("/api/v1/stats/overview", headers=auth).json()
    assert o["time_tracking"] == [{"id": a["id"], "title": "Informe", "estimated_hours": 2, "spent_hours": 1.5}]
    assert o["spent_hours_week"] == 1.7


def test_datetimes_always_carry_a_timezone(client, auth):
    """Sin zona horaria, el navegador leería las horas como locales (pasaba con SQLite)."""
    import re
    t = client.post(T, headers=auth, json={"title": "Con hora", "all_day": False, "due_date": "2026-03-11T16:30:00+01:00"}).json()
    client.post(f"{T}/{t['id']}/timer/start", headers=auth)
    client.post(f"{T}/{t['id']}/comments", headers=auth, json={"content": "hola"})
    t = client.get(f"{T}/{t['id']}", headers=auth).json()
    stamps = [t["due_date"], t["created_at"], t["updated_at"], t["timer_started_at"],
              client.get(f"{T}/{t['id']}/comments", headers=auth).json()[0]["created_at"],
              client.get("/api/v1/notes", headers=auth).json()[0]["updated_at"],
              client.get("/api/v1/auth/me", headers=auth).json()["created_at"]]
    assert all(re.search(r"(Z|[+-]\d{2}:\d{2})$", s) for s in stamps), stamps
