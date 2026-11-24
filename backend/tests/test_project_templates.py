from datetime import date, timedelta

from tests.conftest import make_user

PT, P, T, GO = "/api/v1/project-templates", "/api/v1/projects", "/api/v1/tasks", "/api/v1/goals"


def test_examples_and_apply_with_relative_dates(client, auth):
    r = client.get(PT, headers=auth).json()
    assert r["mine"] == [] and {e["key"] for e in r["examples"]} == {"mudanza", "examen", "viaje", "lanzamiento"}
    moving = next(e for e in r["examples"] if e["key"] == "mudanza")
    assert moving["span_days"] == 37 and moving["task_count"] == 9

    goal = client.post(GO, headers=auth, json={"title": "Vivir en Valencia"}).json()
    start = date(2027, 3, 15)
    res = client.post(f"{PT}/apply", headers=auth, json={"example": "mudanza", "name": "Mudanza a Valencia", "start": start.isoformat(), "goal_id": goal["id"]})
    assert res.status_code == 201, res.text
    res = res.json()
    assert res["tasks_created"] == 9 and res["project"]["name"] == "Mudanza a Valencia" and res["project"]["total_tasks"] == 9
    tasks = client.get(T, headers=auth, params={"project_id": res["project"]["id"]}).json()
    by_title = {t["title"]: t for t in tasks if not t.get("parent_task_id")}
    assert by_title["Día de la mudanza"]["due_date"].startswith("2027-03-15") and by_title["Día de la mudanza"]["all_day"]
    assert by_title["Día de la mudanza"]["priority"] == "high" and by_title["Día de la mudanza"]["difficulty"] == 4
    assert by_title["Pedir presupuestos de mudanza"]["due_date"].startswith((start - timedelta(days=30)).isoformat())
    assert by_title["Empadronarse en la nueva dirección"]["due_date"].startswith((start + timedelta(days=7)).isoformat())
    detail = client.get(f"{T}/{by_title['Pedir presupuestos de mudanza']['id']}", headers=auth).json()
    assert [s["title"] for s in detail["subtasks"]] == ["Pedir 3 presupuestos", "Comparar y reservar"]
    # Queda ligado al objetivo
    g = client.get(f"{GO}/{goal['id']}", headers=auth).json()
    assert [p["name"] for p in g["projects"]] == ["Mudanza a Valencia"] and g["progress"]["tasks_total"] == 9

    # Sin día de inicio, empieza hoy
    res = client.post(f"{PT}/apply", headers=auth, json={"example": "lanzamiento"}).json()
    tasks = client.get(T, headers=auth, params={"project_id": res["project"]["id"]}).json()
    assert any(t["due_date"].startswith(date.today().isoformat()) for t in tasks if t["title"] == "Definir objetivo, público y alcance")

    for bad in ({}, {"example": "mudanza", "template_id": 1}, {"example": "no-existe"}, {"example": "viaje", "goal_id": 9999}):
        assert client.post(f"{PT}/apply", headers=auth, json=bad).status_code in (400, 404)


def test_save_project_as_template_and_reuse(client, auth):
    p = client.post(P, headers=auth, json={"name": "Boda de Lucía", "color": "#e87ba4", "description": "Organización"}).json()
    a = client.post(T, headers=auth, json={"title": "Reservar sitio", "project_id": p["id"], "due_date": "2027-01-10T00:00:00Z", "difficulty": 3}).json()
    client.post(T, headers=auth, json={"title": "Elegir menú", "parent_task_id": a["id"]})
    client.post(T, headers=auth, json={"title": "Enviar invitaciones", "project_id": p["id"], "due_date": "2027-02-01T00:00:00Z", "priority": "high"})
    client.post(T, headers=auth, json={"title": "Ideas de música", "project_id": p["id"]})
    gone = client.post(T, headers=auth, json={"title": "Borrada", "project_id": p["id"]}).json()
    client.delete(f"{T}/{gone['id']}", headers=auth)

    tpl = client.post(f"{PT}/from-project/{p['id']}", headers=auth)
    assert tpl.status_code == 201
    tpl = tpl.json()
    assert tpl["name"] == "Boda de Lucía" and tpl["color"] == "#e87ba4" and tpl["task_count"] == 3 and tpl["span_days"] == 22
    by_title = {t["title"]: t for t in tpl["tasks"]}
    assert by_title["Reservar sitio"]["offset_days"] == 0 and by_title["Reservar sitio"]["subtasks"] == ["Elegir menú"]
    assert by_title["Enviar invitaciones"]["offset_days"] == 22 and by_title["Enviar invitaciones"]["priority"] == "high"
    assert by_title["Ideas de música"]["offset_days"] is None

    # Editar la plantilla y aplicarla
    tasks = tpl["tasks"] + [{"title": "  Luna de miel  ", "offset_days": 30, "subtasks": ["", " Billetes "]}]
    upd = client.put(f"{PT}/{tpl['id']}", headers=auth, json={"name": "Boda", "tasks": tasks}).json()
    assert upd["name"] == "Boda" and upd["tasks"][-1]["title"] == "Luna de miel" and upd["tasks"][-1]["subtasks"] == ["Billetes"]
    assert client.get(PT, headers=auth).json()["mine"][0]["task_count"] == 4
    res = client.post(f"{PT}/apply", headers=auth, json={"template_id": tpl["id"], "name": "Boda de Marcos", "start": "2027-06-01"}).json()
    created = client.get(T, headers=auth, params={"project_id": res["project"]["id"]}).json()
    dates = {t["title"]: (t["due_date"] or "")[:10] for t in created}
    assert dates == {"Reservar sitio": "2027-06-01", "Enviar invitaciones": "2027-06-23", "Ideas de música": "", "Luna de miel": "2027-07-01"}

    assert client.post(f"{PT}/from-project/{client.post(P, headers=auth, json={'name': 'Vacío'}).json()['id']}", headers=auth).status_code == 400
    assert client.post(PT, headers=auth, json={"name": "x", "tasks": [{"title": "   "}]}).status_code == 422
    assert client.post(PT, headers=auth, json={"name": "x", "tasks": [{"title": "a", "offset_days": 5000}]}).status_code == 422
    assert client.delete(f"{PT}/{tpl['id']}", headers=auth).status_code == 204
    assert client.get(PT, headers=auth).json()["mine"] == []


def test_templates_are_private(client):
    ana, _ = make_user(client, "ana")
    bea, _ = make_user(client, "bea")
    tpl = client.post(PT, headers=ana, json={"name": "Mía", "tasks": [{"title": "Paso 1", "offset_days": 0}]}).json()
    assert client.get(PT, headers=bea).json()["mine"] == []
    assert client.put(f"{PT}/{tpl['id']}", headers=bea, json={"name": "Robada"}).status_code == 404
    assert client.delete(f"{PT}/{tpl['id']}", headers=bea).status_code == 404
    assert client.post(f"{PT}/apply", headers=bea, json={"template_id": tpl["id"]}).status_code == 404
    p = client.post(P, headers=ana, json={"name": "Privado"}).json()
    client.post(T, headers=ana, json={"title": "x", "project_id": p["id"]})
    assert client.post(f"{PT}/from-project/{p['id']}", headers=bea).status_code == 404
    goal = client.post(GO, headers=ana, json={"title": "De Ana"}).json()
    assert client.post(f"{PT}/apply", headers=bea, json={"example": "viaje", "goal_id": goal["id"]}).status_code == 404
