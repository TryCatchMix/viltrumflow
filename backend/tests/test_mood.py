from datetime import date, datetime, timedelta, timezone

from app.database import SessionLocal
from app.models import Habit, HabitCheck, MoodEntry, PomodoroSession, XpEvent
from tests.conftest import make_user

M = "/api/v1/mood"


def test_check_in_edit_and_limits(client, auth):
    today = date.today()
    r = client.get(M, headers=auth).json()
    assert r["entry_today"] is None and r["entries"] == [] and {f["key"] for f in r["factors"]} >= {"exercise", "slept_well"}

    e = client.put(f"{M}/{today}", headers=auth, json={"mood": 4, "energy": 2, "factors": ["exercise", "exercise", "stress"], "note": "  Cansado pero contento "})
    assert e.status_code == 200 and e.json() == {"day": today.isoformat(), "mood": 4, "energy": 2, "factors": ["exercise", "stress"], "note": "Cansado pero contento"}
    # Editar el mismo día no duplica
    client.put(f"{M}/{today}", headers=auth, json={"mood": 5, "energy": 3})
    r = client.get(M, headers=auth).json()
    assert len(r["entries"]) == 1 and r["entry_today"]["mood"] == 5 and r["entry_today"]["factors"] == [] and r["entry_today"]["note"] is None

    # Un día olvidado sí; el futuro o hace más de un mes, no
    assert client.put(f"{M}/{today - timedelta(days=3)}", headers=auth, json={"mood": 2, "energy": 2}).status_code == 200
    assert client.put(f"{M}/{today + timedelta(days=1)}", headers=auth, json={"mood": 3, "energy": 3}).status_code == 400
    assert client.put(f"{M}/{today - timedelta(days=31)}", headers=auth, json={"mood": 3, "energy": 3}).status_code == 400
    for bad in ({"mood": 0, "energy": 3}, {"mood": 3, "energy": 6}, {"mood": 3, "energy": 3, "factors": ["drogas"]}):
        assert client.put(f"{M}/{today}", headers=auth, json=bad).status_code == 422
    assert [e["day"] for e in client.get(M, headers=auth).json()["entries"]] == [(today - timedelta(days=3)).isoformat(), today.isoformat()]

    assert client.delete(f"{M}/{today}", headers=auth).status_code == 204
    assert client.get(M, headers=auth).json()["entry_today"] is None


def test_entries_are_private(client):
    ana, _ = make_user(client, "ana")
    bea, _ = make_user(client, "bea")
    client.put(f"{M}/{date.today()}", headers=ana, json={"mood": 1, "energy": 1, "note": "Día horrible"})
    assert client.get(M, headers=bea).json()["entries"] == []
    client.delete(f"{M}/{date.today()}", headers=bea)
    assert len(client.get(M, headers=ana).json()["entries"]) == 1
    assert client.get(f"{M}/insights", headers=bea).json()["logged"] == 0


def test_insights_relate_mood_and_energy_to_what_gets_done(client, auth):
    me = client.get("/api/v1/auth/me", headers=auth).json()
    today = date.today()
    with SessionLocal() as db:
        habit = Habit(user_id=me["id"], title="Leer", days="0123456", start_day=today - timedelta(days=40))
        db.add(habit)
        db.flush()
        for i in range(1, 15):
            day = today - timedelta(days=i)
            high = i % 2 == 0  # días pares: con energía; impares: sin ella
            factors = "exercise,slept_well" if high else "slept_bad"
            db.add(MoodEntry(user_id=me["id"], day=day, mood=5 if high else 2, energy=4 if high else 1, factors=factors))
            at = datetime.combine(day, datetime.min.time(), tzinfo=timezone.utc) + timedelta(hours=10)
            for n in range(4 if high else 1):
                db.add(XpEvent(user_id=me["id"], kind="task", ref=f"t{i}-{n}", amount=10, created_at=at + timedelta(minutes=n)))
            if high:
                db.add(HabitCheck(habit_id=habit.id, day=day))
                db.add(PomodoroSession(user_id=me["id"], seconds=50 * 60, ended_at=at + timedelta(hours=6, minutes=50)))
        db.commit()

    r = client.get(f"{M}/insights?days=30", headers=auth).json()
    assert r["logged"] == 14 and r["streak"] == 14  # hoy aún sin registrar: la racha cuenta hasta ayer
    assert r["avg_mood"] == 3.5 and r["avg_energy"] == 2.5
    high, low = r["by_energy"]["high"], r["by_energy"]["low"]
    assert (high["days"], high["tasks"], high["habits"], high["focus"]) == (7, 4.0, 100, 50)
    assert (low["days"], low["tasks"], low["habits"], low["focus"]) == (7, 1.0, 0, 0)
    assert r["by_mood"]["mid"]["days"] == 0 and r["by_mood"]["mid"]["tasks"] is None
    c = r["correlations"]
    assert c["mood_tasks"] == 1.0 and c["energy_focus"] == 1.0 and c["mood_habits"] == 1.0
    # Horas: tareas a las 10; el enfoque cuenta en la hora en que empezó el bloque (16:00), no en la que terminó
    assert r["hours"]["tasks"][10] == 7 * 4 + 7 and sum(r["hours"]["tasks"]) == 35
    assert r["hours"]["focus"][16] == 350 and sum(r["hours"]["focus"]) == 350
    assert sum(w["days"] for w in r["weekdays"]) == 14
    keys = [f["key"] for f in r["factors"]]
    assert "exercise" in keys and "slept_bad" in keys and "stress" not in keys
    ex = next(f for f in r["factors"] if f["key"] == "exercise")
    assert (ex["days"], ex["mood_with"], ex["mood_without"], ex["energy_with"], ex["energy_without"]) == (7, 5.0, 2.0, 4.0, 1.0)

    # Con menos de 7 días registrados no se calculan correlaciones
    with SessionLocal() as db:
        db.query(MoodEntry).filter(MoodEntry.day < today - timedelta(days=5)).delete()
        db.commit()
    assert all(v is None for v in client.get(f"{M}/insights", headers=auth).json()["correlations"].values())
