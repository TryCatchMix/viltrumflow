from datetime import date, datetime, timedelta, timezone

from app.database import SessionLocal
from app.models import Habit, HabitCheck, PomodoroSession, Task
from app.services import game

from .conftest import make_user

T, H, G, P = "/api/v1/tasks", "/api/v1/habits", "/api/v1/game", "/api/v1/pomodoro"


def xp(client, auth):
    return client.get(f"{G}/profile", headers=auth).json()["xp"]


def test_level_curve_and_ranks():
    assert [game.level_threshold(n) for n in (1, 2, 3, 4, 5, 10)] == [0, 100, 300, 600, 1000, 4500]
    assert [game.level_for(x) for x in (0, 99, 100, 299, 300, 4500)] == [1, 1, 2, 2, 3, 10]
    assert [game.RANKS[game.rank_index(l)][0] for l in (1, 2, 3, 7, 8, 39, 40, 99)] == [
        "Aspirante", "Aspirante", "Recluta", "Soldado", "Guerrero", "General", "Regente del Imperio", "Regente del Imperio"]


def test_task_xp_depends_on_difficulty_time_and_punctuality(client, auth):
    def complete(**fields):
        t = client.post(T, headers=auth, json={"title": "x", **fields}).json()
        before = xp(client, auth)
        client.put(f"{T}/{t['id']}", headers=auth, json={"status": "completed"})
        return xp(client, auth) - before, t

    assert complete(difficulty=1)[0] == 10
    assert complete()[0] == 20  # normal por defecto
    assert complete(difficulty=4)[0] == 80
    assert complete(difficulty=3, priority="urgent")[0] == 45
    assert complete(difficulty=2, estimated_hours=3)[0] == 35  # sin tiempo registrado cuenta la estimación
    assert complete(difficulty=2, due_date="2099-01-01T00:00:00Z")[0] == 25  # a tiempo: +25 %
    assert complete(difficulty=2, due_date="2020-01-01T00:00:00Z")[0] == 20  # tarde: sin extra

    # tiempo registrado: 1 XP por cada 5 minutos, hasta 60
    t = client.post(T, headers=auth, json={"title": "larga", "estimated_hours": 8}).json()
    client.put(f"{T}/{t['id']}", headers=auth, json={"time_spent_seconds": 2 * 3600})
    before = xp(client, auth)
    client.put(f"{T}/{t['id']}", headers=auth, json={"status": "completed"})
    assert xp(client, auth) - before == 20 + 24


def test_xp_is_awarded_once_and_revoked_on_reopen(client, auth):
    t = client.post(T, headers=auth, json={"title": "Ida y vuelta", "difficulty": 3}).json()
    s = client.post(T, headers=auth, json={"title": "Sub", "parent_task_id": t["id"]}).json()
    client.put(f"{T}/{t['id']}", headers=auth, json={"status": "completed"})
    client.put(f"{T}/{s['id']}", headers=auth, json={"status": "completed"})
    assert xp(client, auth) == 45
    client.put(f"{T}/{t['id']}", headers=auth, json={"title": "Renombrada"})  # editar no vuelve a puntuar
    assert xp(client, auth) == 45
    client.put(f"{T}/{t['id']}", headers=auth, json={"status": "todo"})  # reabrir retira la experiencia
    assert xp(client, auth) == 5
    client.patch(f"{T}/{t['id']}/move", headers=auth, json={"status": "completed", "position": 0})  # desde el tablero también
    assert xp(client, auth) == 45
    client.patch(f"{T}/{t['id']}/move", headers=auth, json={"status": "review", "position": 0})
    assert xp(client, auth) == 5
    # crearla ya completada también puntúa; borrarla no quita lo ganado
    done = client.post(T, headers=auth, json={"title": "Hecha", "status": "completed"}).json()
    assert xp(client, auth) == 25
    client.delete(f"{T}/{done['id']}", headers=auth)
    assert xp(client, auth) == 25


def test_xp_goes_to_whoever_completes_in_shared_project(client):
    ana, _ = make_user(client, "ana")
    bea, _ = make_user(client, "bea")
    p = client.post("/api/v1/projects", headers=ana, json={"name": "Equipo"}).json()
    client.post(f"/api/v1/projects/{p['id']}/members", headers=ana, json={"identifier": "bea"})
    t = client.post(T, headers=ana, json={"title": "Compartida", "project_id": p["id"]}).json()
    client.put(f"{T}/{t['id']}", headers=bea, json={"status": "completed"})
    assert xp(client, bea) == 20 and xp(client, ana) == 0
    # la experiencia es privada
    assert client.get(f"{G}/history", headers=ana).json()["recent"] == []


def test_profile_levels_and_history(client, auth):
    p = client.get(f"{G}/profile", headers=auth).json()
    assert p["level"] == 1 and p["rank"] == "Aspirante" and p["next_rank"] == "Recluta" and p["next_rank_level"] == 3
    assert len(p["ranks"]) == 10 and p["ranks"][1] == {"name": "Recluta", "min_level": 3, "min_xp": 300}
    for i in range(4):  # 4 épicas = 320 XP → nivel 3
        t = client.post(T, headers=auth, json={"title": f"Épica {i}", "difficulty": 4}).json()
        client.put(f"{T}/{t['id']}", headers=auth, json={"status": "completed"})
    p = client.get(f"{G}/profile", headers=auth).json()
    assert (p["xp"], p["level"], p["rank"], p["level_start_xp"], p["next_level_xp"]) == (320, 3, "Recluta", 300, 600)

    h = client.get(f"{G}/history", headers=auth, params={"days": 7}).json()
    assert len(h["daily"]) == 7 and h["daily"][-1] == {"date": h["daily"][-1]["date"], "task": 320, "habit": 0, "focus": 0, "total": 320}
    assert h["by_kind"] == {"task": 320, "habit": 0, "focus": 0} and h["today_xp"] == 320 and h["week_xp"] == 320
    assert h["recent"][0]["detail"] == "Épica 3" and h["recent"][0]["created_at"].endswith(("Z", "+00:00"))
    ach = {a["id"]: a for a in h["achievements"]}
    assert ach["first"]["unlocked"] and ach["epic"]["unlocked"] and not ach["tasks25"]["unlocked"] and ach["tasks25"]["progress"] == 4


def test_habits_day_check_and_streak(client, auth):
    client.put("/api/v1/auth/me", headers=auth, json={"timezone": "Europe/Madrid"})
    today = datetime.now(timezone.utc).astimezone(__import__("zoneinfo").ZoneInfo("Europe/Madrid")).date()
    h = client.post(H, headers=auth, json={"title": "Leer 20 min", "difficulty": 3, "target_time": "22:00"}).json()
    assert h["days"] == "0123456" and h["start_day"] == today.isoformat()
    other = client.post(H, headers=auth, json={"title": "Solo otro día", "days": str((today.weekday() + 1) % 7)}).json()
    assert client.post(H, headers=auth, json={"title": "x", "days": "789"}).status_code == 422
    assert client.post(H, headers=auth, json={"title": "x", "target_time": "25:00"}).status_code == 422

    items = client.get(f"{H}/day", headers=auth).json()
    assert [(i["title"], i["checked"], i["streak"], i["xp"]) for i in items] == [("Leer 20 min", False, 0, 15)]  # la otra no toca hoy

    # tres días anteriores cumplidos → marcar hoy es el 4.º de racha
    with SessionLocal() as db:
        db.get(Habit, h["id"]).start_day = today - timedelta(days=10)
        for n in (1, 2, 3):
            db.add(HabitCheck(habit_id=h["id"], day=today - timedelta(days=n)))
        db.commit()
    assert client.get(f"{H}/day", headers=auth).json()[0]["streak"] == 3

    r = client.put(f"{H}/{h['id']}/check", headers=auth, json={"day": today.isoformat(), "checked": True}).json()
    assert r["xp_gained"] == 15 + 3 and r["item"]["checked"] and r["item"]["streak"] == 4 and r["item"]["checked_at"]
    assert client.put(f"{H}/{h['id']}/check", headers=auth, json={"day": today.isoformat(), "checked": True}).json()["xp_gained"] == 0
    assert xp(client, auth) == 18
    # desmarcar retira la experiencia
    r = client.put(f"{H}/{h['id']}/check", headers=auth, json={"day": today.isoformat(), "checked": False}).json()
    assert not r["item"]["checked"] and r["item"]["streak"] == 3 and xp(client, auth) == 0

    # un día olvidado se puede marcar hasta 7 días después; ni futuro, ni más antiguo, ni días no programados
    put = lambda hid, d: client.put(f"{H}/{hid}/check", headers=auth, json={"day": d.isoformat(), "checked": True}).status_code
    assert put(h["id"], today - timedelta(days=5)) == 200
    assert put(h["id"], today + timedelta(days=1)) == 400
    assert put(h["id"], today - timedelta(days=8)) == 400
    assert put(other["id"], today) == 400

    bea, _ = make_user(client, "bea")
    assert client.put(f"{H}/{h['id']}/check", headers=bea, json={"day": today.isoformat(), "checked": True}).status_code == 404
    assert client.get(H, headers=bea).json() == []
    # archivar la oculta del día; borrar conserva la experiencia ganada
    client.put(f"{H}/{h['id']}", headers=auth, json={"is_archived": True})
    assert client.get(f"{H}/day", headers=auth).json() == []
    before = xp(client, auth)
    assert client.delete(f"{H}/{h['id']}", headers=auth).status_code == 204 and xp(client, auth) == before


def test_habit_stats(client, auth):
    from zoneinfo import ZoneInfo
    client.put("/api/v1/auth/me", headers=auth, json={"timezone": "Europe/Madrid"})
    tz = ZoneInfo("Europe/Madrid")
    today = datetime.now(timezone.utc).astimezone(tz).date()
    h = client.post(H, headers=auth, json={"title": "Madrugar", "target_time": "07:30"}).json()
    at = lambda d, hh, mm: datetime.combine(d, datetime.min.time(), tzinfo=tz).replace(hour=hh, minute=mm).astimezone(timezone.utc)
    with SessionLocal() as db:
        db.get(Habit, h["id"]).start_day = today - timedelta(days=6)
        # hace 6, 5 y 4 días cumplida (07:00, 07:20 y 08:10 → 2 de 3 a tiempo); 3 días fallada; ayer cumplida pero anotada hoy
        for n, hh, mm in ((6, 7, 0), (5, 7, 20), (4, 8, 10)):
            d = today - timedelta(days=n)
            db.add(HabitCheck(habit_id=h["id"], day=d, checked_at=at(d, hh, mm)))
        db.add(HabitCheck(habit_id=h["id"], day=today - timedelta(days=1), checked_at=datetime.now(timezone.utc)))
        db.commit()

    s = client.get(f"{H}/stats", headers=auth, params={"days": 7}).json()
    assert len(s["days"]) == 7 and s["days"][-1] == today.isoformat()
    hs = s["habits"][0]
    assert hs["states"] == ["done", "done", "done", "missed", "missed", "done", "pending"]
    assert (hs["scheduled"], hs["done"], hs["rate"]) == (6, 4, 67)  # hoy, aún pendiente, no cuenta
    assert (hs["streak"], hs["best_streak"]) == (1, 3)
    assert hs["avg_minute"] == round((420 + 440 + 490) / 3) and hs["on_time_rate"] == 67  # la anotada a posteriori no cuenta para la hora
    assert s["hours"][7] == 2 and s["hours"][8] == 1 and sum(s["hours"]) == 3
    assert [d["done"] for d in s["daily"]] == [1, 1, 1, 0, 0, 1, 0] and s["daily"][-1]["scheduled"] == 0
    assert (s["scheduled"], s["done"], s["rate"], s["perfect_days"]) == (6, 4, 67, 4)
    assert s["weekday"][(today - timedelta(days=6)).weekday()] == 100 and s["weekday"][(today - timedelta(days=3)).weekday()] == 0


def test_pomodoro_settings_sessions_and_stats(client, auth):
    assert client.get(f"{P}/settings", headers=auth).json() == {
        "focus_minutes": 25, "short_break_minutes": 5, "long_break_minutes": 15, "cycles": 4, "auto_start": False, "sound": True, "notify": True}
    custom = {"focus_minutes": 50, "short_break_minutes": 10, "long_break_minutes": 30, "cycles": 2, "auto_start": True, "sound": False, "notify": True}
    assert client.put(f"{P}/settings", headers=auth, json=custom).json() == custom
    assert client.get(f"{P}/settings", headers=auth).json() == custom
    assert client.put(f"{P}/settings", headers=auth, json={**custom, "focus_minutes": 0}).status_code == 422

    t = client.post(T, headers=auth, json={"title": "Estudiar"}).json()
    r = client.post(f"{P}/sessions", headers=auth, json={"seconds": 1500, "task_id": t["id"]})
    assert r.status_code == 201 and r.json()["xp_gained"] == 5 and r.json()["task_title"] == "Estudiar"
    assert client.get(f"{T}/{t['id']}", headers=auth).json()["time_spent_seconds"] == 1500  # el tiempo va a la tarea
    # un segundo bloque de 25 min justo después no es posible: no ha pasado ese tiempo
    assert client.post(f"{P}/sessions", headers=auth, json={"seconds": 1500}).status_code == 429
    with SessionLocal() as db:
        db.query(PomodoroSession).update({"ended_at": datetime.now(timezone.utc) - timedelta(minutes=40)})
        db.commit()
    assert client.post(f"{P}/sessions", headers=auth, json={"seconds": 1500}).status_code == 201
    assert client.post(f"{P}/sessions", headers=auth, json={"seconds": 30}).status_code == 422
    bea, _ = make_user(client, "bea")
    assert client.post(f"{P}/sessions", headers=bea, json={"seconds": 600, "task_id": t["id"]}).status_code == 400

    s = client.get(f"{P}/stats", headers=auth, params={"days": 7}).json()
    assert len(s["daily"]) == 7 and s["total_minutes"] == 50 and sum(d["sessions"] for d in s["daily"]) == 2
    assert s["by_task"] == [{"title": "Estudiar", "minutes": 25}]
    assert xp(client, auth) == 10 and client.get(f"{G}/history", headers=auth).json()["by_kind"]["focus"] == 10
