from datetime import date, datetime, timedelta, timezone

from app.database import SessionLocal
from app.models import Goal, Habit, HabitCheck
from app.routers.goals import habit_rate
from tests.conftest import make_user

GO, T, P, H = "/api/v1/goals", "/api/v1/tasks", "/api/v1/projects", "/api/v1/habits"


def xp(client, headers):
    return client.get("/api/v1/game/profile", headers=headers).json()["xp"]


def test_goal_progress_from_tasks_projects_and_milestones(client, auth):
    g = client.post(GO, headers=auth, json={"title": "Lanzar mi web", "deadline": (date.today() + timedelta(days=90)).isoformat()})
    assert g.status_code == 201
    g = g.json()
    assert g["progress"]["percent"] is None and g["status"] == "active" and g["progress"]["days_left"] == 90

    project = client.post(P, headers=auth, json={"name": "Web"}).json()
    in_project = [client.post(T, headers=auth, json={"title": f"Página {i}", "project_id": project["id"]}).json() for i in range(3)]
    loose = client.post(T, headers=auth, json={"title": "Comprar dominio"}).json()
    client.post(T, headers=auth, json={"title": "Subtarea", "parent_task_id": in_project[0]["id"]})  # no cuenta
    client.post(T, headers=auth, json={"title": "Ajena al objetivo"})

    gid = g["id"]
    g = client.post(f"{GO}/{gid}/links", headers=auth, json={"kind": "project", "ref_id": project["id"]}).json()
    g = client.post(f"{GO}/{gid}/links", headers=auth, json={"kind": "task", "ref_id": loose["id"]}).json()
    g = client.post(f"{GO}/{gid}/links", headers=auth, json={"kind": "task", "ref_id": loose["id"]}).json()  # repetido: no duplica
    g = client.post(f"{GO}/{gid}/milestones", headers=auth, json={"title": "Diseño aprobado"}).json()
    assert g["progress"]["tasks_total"] == 4 and g["progress"]["milestones_total"] == 1 and g["progress"]["percent"] == 0
    assert [p["name"] for p in g["projects"]] == ["Web"] and g["projects"][0]["total"] == 3
    assert sum(1 for t in g["tasks"] if t["linked"]) == 1

    for t in (in_project[0], loose):
        client.put(f"{T}/{t['id']}", headers=auth, json={"status": "completed"})
    g = client.put(f"{GO}/milestones/{g['milestones'][0]['id']}", headers=auth, json={"done": True}).json()
    assert g["progress"]["percent"] == 60  # 3 de 5
    assert g["projects"][0]["done"] == 1
    # Una tarea borrada deja de contar
    client.delete(f"{T}/{in_project[2]['id']}", headers=auth)
    assert client.get(f"{GO}/{gid}", headers=auth).json()["progress"]["percent"] == 75

    listed = client.get(GO, headers=auth).json()
    assert [x["title"] for x in listed] == ["Lanzar mi web"] and listed[0]["progress"]["percent"] == 75
    assert client.get(f"{GO}/for/project/{project['id']}", headers=auth).json()[0]["title"] == "Lanzar mi web"

    # Quitar el proyecto: solo queda la tarea suelta y el hito
    g = client.delete(f"{GO}/{gid}/links/project/{project['id']}", headers=auth).json()
    assert g["progress"]["tasks_total"] == 1 and g["progress"]["percent"] == 100


def test_complete_goal_awards_xp_once_and_reopen_revokes(client, auth):
    g = client.post(GO, headers=auth, json={"title": "Leer 12 libros"}).json()
    for i in range(3):
        g = client.post(f"{GO}/{g['id']}/milestones", headers=auth, json={"title": f"Libro {i}"}).json()
    for m in g["milestones"][:2]:
        g = client.put(f"{GO}/milestones/{m['id']}", headers=auth, json={"done": True}).json()
    assert g["xp"] == 50 + 2 * 10
    before = xp(client, auth)
    done = client.post(f"{GO}/{g['id']}/complete", headers=auth).json()
    assert done["status"] == "done" and done["completed_at"] and done["xp_gained"] == 70
    assert xp(client, auth) == before + 70
    assert client.post(f"{GO}/{g['id']}/complete", headers=auth).status_code == 409
    assert client.get(GO, headers=auth).json() == []  # ya no está entre los activos
    assert [x["id"] for x in client.get(f"{GO}?status=done", headers=auth).json()] == [g["id"]]

    history = client.get("/api/v1/game/history", headers=auth).json()
    assert history["by_kind"]["goal"] == 70
    assert next(a for a in history["achievements"] if a["id"] == "goal1")["unlocked"]

    reopened = client.post(f"{GO}/{g['id']}/reopen", headers=auth).json()
    assert reopened["status"] == "active" and xp(client, auth) == before
    # Borrar un objetivo cumplido también retira su experiencia
    client.post(f"{GO}/{g['id']}/complete", headers=auth)
    assert client.delete(f"{GO}/{g['id']}", headers=auth).status_code == 204
    assert xp(client, auth) == before


def test_archive_edit_and_validation(client, auth):
    g = client.post(GO, headers=auth, json={"title": "Aprender alemán", "color": "#22aa88"}).json()
    assert client.post(GO, headers=auth, json={"title": ""}).status_code == 422
    assert client.post(GO, headers=auth, json={"title": "x", "color": "rojo"}).status_code == 422
    g = client.put(f"{GO}/{g['id']}", headers=auth, json={"description": "Nivel B1", "deadline": "2027-06-30"}).json()
    assert g["description"] == "Nivel B1" and g["deadline"] == "2027-06-30"
    g = client.put(f"{GO}/{g['id']}", headers=auth, json={"deadline": None, "archived": True}).json()
    assert g["deadline"] is None and g["status"] == "archived"
    assert client.get(GO, headers=auth).json() == []
    assert client.put(f"{GO}/{g['id']}", headers=auth, json={"archived": False}).json()["status"] == "active"
    m = client.post(f"{GO}/{g['id']}/milestones", headers=auth, json={"title": "A1"}).json()["milestones"][0]
    g = client.put(f"{GO}/milestones/{m['id']}", headers=auth, json={"title": "A1 aprobado"}).json()
    assert g["milestones"][0]["title"] == "A1 aprobado"
    assert client.delete(f"{GO}/milestones/{m['id']}", headers=auth).json()["milestones"] == []
    assert client.post(f"{GO}/{g['id']}/links", headers=auth, json={"kind": "nota", "ref_id": 1}).status_code == 422


def test_goals_are_private_and_links_need_access(client):
    ana, _ = make_user(client, "ana")
    bea, _ = make_user(client, "bea")
    g = client.post(GO, headers=ana, json={"title": "Secreto"}).json()
    assert client.get(f"{GO}/{g['id']}", headers=bea).status_code == 404
    assert client.delete(f"{GO}/{g['id']}", headers=bea).status_code == 404
    m = client.post(f"{GO}/{g['id']}/milestones", headers=ana, json={"title": "x"}).json()["milestones"][0]
    assert client.put(f"{GO}/milestones/{m['id']}", headers=bea, json={"done": True}).status_code == 404

    # Bea no puede ligar a su objetivo cosas de Ana a las que no tiene acceso
    gb = client.post(GO, headers=bea, json={"title": "Mío"}).json()
    task = client.post(T, headers=ana, json={"title": "De Ana"}).json()
    project = client.post(P, headers=ana, json={"name": "Equipo"}).json()
    habit = client.post(H, headers=ana, json={"title": "Correr"}).json()
    for kind, ref in (("task", task["id"]), ("project", project["id"]), ("habit", habit["id"]), ("task", 99999)):
        assert client.post(f"{GO}/{gb['id']}/links", headers=bea, json={"kind": kind, "ref_id": ref}).status_code == 404

    # Al compartir el proyecto, Bea sí puede ligarlo a su objetivo; Ana no lo ve en los suyos
    client.post(f"{P}/{project['id']}/members", headers=ana, json={"identifier": "bea", "role": "viewer"})
    shared = client.post(T, headers=ana, json={"title": "Tarea del equipo", "project_id": project["id"]}).json()
    gb = client.post(f"{GO}/{gb['id']}/links", headers=bea, json={"kind": "project", "ref_id": project["id"]}).json()
    assert gb["progress"]["tasks_total"] == 1 and gb["tasks"][0]["id"] == shared["id"]
    assert client.get(f"{GO}/for/project/{project['id']}", headers=ana).json() == []
    # Si la echan del proyecto, deja de contar en su objetivo
    bea_id = client.get("/api/v1/auth/me", headers=bea).json()["id"]
    client.delete(f"{P}/{project['id']}/members/{bea_id}", headers=ana)
    gb = client.get(f"{GO}/{gb['id']}", headers=bea).json()
    assert gb["progress"]["tasks_total"] == 0 and gb["projects"] == []


def test_linked_habit_consistency_and_pace(client, auth):
    habit = client.post(H, headers=auth, json={"title": "Estudiar"}).json()
    g = client.post(GO, headers=auth, json={"title": "Oposiciones", "deadline": (date.today() + timedelta(days=30)).isoformat()}).json()
    with SessionLocal() as db:
        # Creado hace 30 días de 60: ya debería ir por la mitad
        db.get(Goal, g["id"]).created_at = datetime.now(timezone.utc) - timedelta(days=30)
        h = db.get(Habit, habit["id"])
        h.start_day = date.today() - timedelta(days=40)
        tz_today = date.today()
        for n in range(1, 15):  # la mitad de los últimos 28 días
            db.add(HabitCheck(habit_id=h.id, day=tz_today - timedelta(days=n * 2)))
        db.commit()
    g = client.post(f"{GO}/{g['id']}/links", headers=auth, json={"kind": "habit", "ref_id": habit["id"]}).json()
    assert g["habits"][0]["title"] == "Estudiar" and 40 <= g["habits"][0]["rate"] <= 60
    assert g["progress"]["habit_rate"] == g["habits"][0]["rate"] and g["progress"]["habits_count"] == 1
    assert 45 <= g["progress"]["expected"] <= 55
    # Sin tareas ni hitos, el ritmo se mide con la constancia de las rutinas
    assert g["progress"]["percent"] is None and g["progress"]["on_track"] is True
    g = client.post(f"{GO}/{g['id']}/milestones", headers=auth, json={"title": "Temario"}).json()
    assert g["progress"]["percent"] == 0 and g["progress"]["on_track"] is False  # 0 % con la mitad del tiempo gastado


def test_habit_rate_rules():
    today = date(2026, 11, 23)  # lunes
    daily = Habit(title="x", days="0123456", start_day=today - timedelta(days=100), target_count=1)
    assert habit_rate(daily, set(), today) == 0
    done = {today - timedelta(days=i) for i in range(1, 28)}
    assert habit_rate(daily, done, today) == 100  # hoy aún no hecho: no cuenta en contra
    assert habit_rate(daily, done | {today}, today) == 100
    new = Habit(title="x", days="0123456", start_day=today, target_count=1)
    assert habit_rate(new, set(), today) is None
    weekly = Habit(title="x", days="0123456", start_day=today - timedelta(days=100), weekly_target=2, target_count=1)
    assert habit_rate(weekly, {today - timedelta(days=i) for i in range(0, 28, 3)}, today) == 100
