from datetime import date, datetime, timedelta, timezone

from tests.conftest import make_user

D, T = "/api/v1/day-plan", "/api/v1/tasks"


def iso(d: date, h=None):
    return f"{d.isoformat()}T00:00:00Z" if h is None else datetime(d.year, d.month, d.day, h, 0, tzinfo=timezone.utc).isoformat()


def test_morning_plan_with_priorities(client, auth):
    today = date.today()
    late = client.post(T, headers=auth, json={"title": "Atrasada", "due_date": iso(today - timedelta(days=2))}).json()
    due = client.post(T, headers=auth, json={"title": "Para hoy", "due_date": iso(today, 15), "all_day": False}).json()
    free = client.post(T, headers=auth, json={"title": "Sin fecha", "priority": "high"}).json()
    client.post(T, headers=auth, json={"title": "La semana que viene", "due_date": iso(today + timedelta(days=7))})
    sub = client.post(T, headers=auth, json={"title": "Subtarea", "parent_task_id": free["id"]}).json()

    s = client.get(D, headers=auth).json()
    assert s["day"] == today.isoformat() and s["planned_at"] is None and s["priorities"] == [] and s["streak"] == 0
    assert [t["title"] for t in s["due"]] == ["Atrasada", "Para hoy"]
    assert "Sin fecha" in [t["title"] for t in s["candidates"]] and "Subtarea" not in [t["title"] for t in s["candidates"]]

    s = client.put(f"{D}/{today}", headers=auth, json={"priorities": [due["id"], free["id"], due["id"]], "intention": " Terminar el informe "}).json()
    assert [t["title"] for t in s["priorities"]] == ["Para hoy", "Sin fecha"] and s["intention"] == "Terminar el informe"
    assert s["planned_at"] and s["streak"] == 1
    # Cambiar el plan no reinicia la hora en que se hizo
    first = s["planned_at"]
    assert client.put(f"{D}/{today}", headers=auth, json={"priorities": [late["id"]]}).json()["planned_at"] == first

    assert client.put(f"{D}/{today}", headers=auth, json={"priorities": [1, 2, 3, 4]}).status_code == 422
    assert client.put(f"{D}/{today}", headers=auth, json={"priorities": [99999]}).status_code == 404
    assert client.put(f"{D}/{today + timedelta(days=2)}", headers=auth, json={}).status_code == 400
    # Se puede preparar el de mañana
    assert client.put(f"{D}/{today + timedelta(days=1)}", headers=auth, json={"priorities": [free["id"]]}).status_code == 200
    # Una prioridad borrada desaparece del plan
    client.delete(f"{T}/{late['id']}", headers=auth)
    assert client.get(D, headers=auth).json()["priorities"] == []


def test_evening_close_moves_pending_to_tomorrow(client, auth):
    today = date.today()
    timed = client.post(T, headers=auth, json={"title": "Llamada", "due_date": iso(today, 16), "all_day": False}).json()
    allday = client.post(T, headers=auth, json={"title": "Recado", "due_date": iso(today - timedelta(days=1))}).json()
    nodate = client.post(T, headers=auth, json={"title": "Sin fecha"}).json()
    done = client.post(T, headers=auth, json={"title": "Hecha", "due_date": iso(today)}).json()
    client.put(f"{T}/{done['id']}", headers=auth, json={"status": "completed"})

    s = client.get(D, headers=auth).json()
    assert [t["title"] for t in s["done"]] == ["Hecha"] and s["xp"] > 0
    r = client.post(f"{D}/{today}/close", headers=auth, json={"reflection": "Buen día", "move_to_tomorrow": [timed["id"], allday["id"], nodate["id"], done["id"]]}).json()
    assert r["moved"] == 3 and r["skipped"] == 1 and r["closed_at"] and r["reflection"] == "Buen día"
    tomorrow = today + timedelta(days=1)
    tasks = {t["title"]: t for t in client.get(T, headers=auth).json()}
    assert tasks["Llamada"]["due_date"].startswith(tomorrow.isoformat()) and "16:00" in tasks["Llamada"]["due_date"] and not tasks["Llamada"]["all_day"]
    assert tasks["Recado"]["due_date"].startswith(tomorrow.isoformat()) and tasks["Recado"]["all_day"]
    assert tasks["Sin fecha"]["due_date"].startswith(tomorrow.isoformat())
    assert client.get(D, headers=auth).json()["due"] == []
    assert client.post(f"{D}/{tomorrow}/close", headers=auth, json={}).status_code == 400


def test_plan_is_private_and_respects_project_permissions(client):
    ana, _ = make_user(client, "ana")
    bea, _ = make_user(client, "bea")
    task = client.post(T, headers=ana, json={"title": "De Ana", "due_date": iso(date.today())}).json()
    assert client.put(f"{D}/{date.today()}", headers=bea, json={"priorities": [task["id"]]}).status_code == 404
    assert client.get(D, headers=bea).json()["due"] == []
    # Bea no puede mover tareas de un proyecto en el que solo puede leer
    p = client.post("/api/v1/projects", headers=ana, json={"name": "Equipo"}).json()
    client.post(f"/api/v1/projects/{p['id']}/members", headers=ana, json={"identifier": "bea", "role": "viewer"})
    shared = client.post(T, headers=ana, json={"title": "Compartida", "project_id": p["id"], "due_date": iso(date.today())}).json()
    r = client.post(f"{D}/{date.today()}/close", headers=bea, json={"move_to_tomorrow": [shared["id"], task["id"]]}).json()
    assert r["moved"] == 0 and r["skipped"] == 2
    assert client.get(f"{T}/{shared['id']}", headers=ana).json()["due_date"].startswith(date.today().isoformat())


def test_morning_summary_notice(client, auth):
    from app.database import SessionLocal
    from app.models import User
    from app.services import notify

    today = date.today()
    me = client.put("/api/v1/auth/me", headers=auth, json={"morning_summary": True, "morning_summary_hour": 7}).json()
    assert me["morning_summary"] and me["morning_summary_hour"] == 7
    assert client.put("/api/v1/auth/me", headers=auth, json={"morning_summary_hour": 15}).status_code == 422
    client.post(T, headers=auth, json={"title": "Hoy 1", "due_date": iso(today), "priority": "urgent"})
    client.post(T, headers=auth, json={"title": "Hoy 2", "due_date": iso(today)})
    client.post(T, headers=auth, json={"title": "Antes", "due_date": iso(today - timedelta(days=3))})
    client.post(T, headers=auth, json={"title": "Sin fecha"})
    client.post("/api/v1/habits", headers=auth, json={"title": "Leer"})

    preview = client.get("/api/v1/reminders/morning", headers=auth).json()
    assert preview == {"tasks": 2, "important": 1, "overdue": 1, "habits": 1, "planned": False, "url": "/plan",
                       "body": "Hoy: 2 tareas (1 importante) · 1 atrasada · 1 rutina. Elige tus 3 prioridades."}

    at = lambda hh, mm: datetime(today.year, today.month, today.day, hh, mm, tzinfo=timezone.utc)
    with SessionLocal() as db:
        user = db.query(User).one()
        assert notify.gather(db, user, at(6, 59)) == []
        notices = notify.gather(db, user, at(7, 2))
        assert [n["kind"] for n in notices] == ["morning"]
        msg = notify._message(notices[0], timezone.utc)["notification"]
        assert msg["title"].startswith("Buenos días") and msg["body"] == preview["body"]
        assert msg["data"]["onActionClick"]["default"]["url"] == "/plan"
        db.commit()
        assert notify.gather(db, user, at(8, 0)) == []  # una vez al día
        notify._unmark(db, notices)
        db.refresh(user)
        assert user.last_morning_summary_on is None
        assert notify.gather(db, user, at(11, 30)) == []  # pasado el margen de 4 h ya no se envía

    # Con el plan hecho, el resumen lo dice y abre «Hoy»
    client.put(f"{D}/{today}", headers=auth, json={"priorities": []})
    p = client.get("/api/v1/reminders/morning", headers=auth).json()
    assert p["planned"] and p["url"] == "/today" and p["body"].endswith("Tu plan ya está listo.")
