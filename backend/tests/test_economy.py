from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest

from app.database import SessionLocal
from app.models import Habit, HabitCheck, HabitFreeze, PomodoroSession, User, WeeklyMission, XpEvent
from app.routers.habits import apply_freezes
from app.services import game, missions

from .conftest import make_user

T, H, G = "/api/v1/tasks", "/api/v1/habits", "/api/v1/game"
MADRID = ZoneInfo("Europe/Madrid")


def today():
    return datetime.now(timezone.utc).astimezone(MADRID).date()


@pytest.fixture()
def madrid(client, auth):
    client.put("/api/v1/auth/me", headers=auth, json={"timezone": "Europe/Madrid"})
    return auth


def give_xp(user_id, amount, kind="task", ref="seed"):
    with SessionLocal() as db:
        game.award(db, user_id, kind, ref, amount, "semilla")


def wallet(client, h):
    return client.get(f"{G}/wallet", headers=h).json()


# ---------- Monedas y protector de racha ----------
def test_coins_and_buying_freezes(client, madrid):
    w = wallet(client, madrid)
    assert (w["coins"], w["freezes"], w["max_freezes"], w["freeze_price"], w["xp_per_coin"]) == (0, 0, 2, 50, 10)
    assert client.post(f"{G}/freezes/buy", headers=madrid).status_code == 409  # sin monedas
    give_xp(1, 1234)
    w = wallet(client, madrid)
    assert w["coins"] == 123 and w["next_coin_in"] == 6
    w = client.post(f"{G}/freezes/buy", headers=madrid).json()
    assert (w["coins"], w["freezes"]) == (73, 1)
    client.post(f"{G}/freezes/buy", headers=madrid)
    assert client.post(f"{G}/freezes/buy", headers=madrid).status_code == 409  # máximo 2
    hist = client.get(f"{G}/coins/history", headers=madrid).json()
    assert [(e["reason"], e["amount"]) for e in hist] == [("freeze", -50), ("freeze", -50)]
    assert client.delete(f"{G}/coins/{hist[0]['id']}", headers=madrid).status_code == 404  # una compra no se deshace


def test_freeze_saves_a_missed_day(client, madrid):
    t = today()
    h = client.post(H, headers=madrid, json={"title": "Leer"}).json()
    other = client.post(H, headers=madrid, json={"title": "Sin racha"}).json()
    with SessionLocal() as db:
        for hid in (h["id"], other["id"]):
            db.get(Habit, hid).start_day = t - timedelta(days=10)
        for n in (5, 4, 3, 2):  # «Leer»: cuatro días seguidos; ayer fallado
            db.add(HabitCheck(habit_id=h["id"], day=t - timedelta(days=n), count=1))
        u = db.query(User).one()
        u.streak_freezes, u.freezes_checked_on = 1, t - timedelta(days=2)
        db.commit()

    items = {i["title"]: i for i in client.get(f"{H}/day", headers=madrid).json()}
    assert items["Leer"]["streak"] == 4  # la racha sigue viva gracias al protector
    w = wallet(client, madrid)
    assert w["freezes"] == 0 and w["recent_freezes"] == [{"habit": "Leer", "day": (t - timedelta(days=1)).isoformat()}]
    # «Sin racha» no tenía racha que salvar: no gasta protector (y no había más)
    s = client.get(f"{H}/stats", headers=madrid, params={"days": 7}).json()
    leer = next(x for x in s["habits"] if x["title"] == "Leer")
    assert leer["states"][-2:] == ["frozen", "pending"] and leer["frozen"] == 1
    assert (leer["done"], leer["scheduled"]) == (4, 5)  # el día salvado no cuenta ni a favor ni en contra
    # hoy se cumple: la racha sigue sumando
    r = client.put(f"{H}/{h['id']}/check", headers=madrid, json={"day": t.isoformat(), "checked": True}).json()
    assert r["item"]["streak"] == 5
    # si después se marca el día salvado, el protector se devuelve
    client.put(f"{H}/{h['id']}/check", headers=madrid, json={"day": (t - timedelta(days=1)).isoformat(), "checked": True})
    assert wallet(client, madrid)["freezes"] == 1
    with SessionLocal() as db:
        assert db.query(HabitFreeze).count() == 0


def test_freezes_without_protection_break_the_streak(client, madrid):
    t = today()
    h = client.post(H, headers=madrid, json={"title": "Correr"}).json()
    with SessionLocal() as db:
        db.get(Habit, h["id"]).start_day = t - timedelta(days=10)
        for n in (6, 5, 4):
            db.add(HabitCheck(habit_id=h["id"], day=t - timedelta(days=n), count=1))
        u = db.query(User).one()
        u.streak_freezes, u.freezes_checked_on = 2, t - timedelta(days=4)
        db.commit()
        # tres días fallados (hace 3, 2 y 1): dos protectores cubren los dos primeros; el tercero rompe la racha
        used = apply_freezes(db, db.query(User).one())
        assert [u_["day"] for u_ in used] == [(t - timedelta(days=n)).isoformat() for n in (3, 2)]
        assert db.query(User).one().freezes_checked_on == t - timedelta(days=1)
        assert apply_freezes(db, db.query(User).one()) == []  # cada día se revisa una vez
    assert client.get(f"{H}/day", headers=madrid).json()[0]["streak"] == 0


# ---------- Misiones ----------
def test_missions_week_progress_claim_and_chest(client, madrid):
    t = today()
    week = t - timedelta(days=t.weekday())
    client.post(H, headers=madrid, json={"title": "Meditar"})
    data = client.get(f"{G}/missions", headers=madrid).json()
    assert data["week_start"] == week.isoformat() and len(data["missions"]) == 3 and not data["chest_claimed"]
    keys = [m["key"] for m in data["missions"]]
    assert any(k in ("perfect_days", "habit_checks") for k in keys)  # con rutinas, siempre hay una de rutinas
    assert client.get(f"{G}/missions", headers=madrid).json()["missions"] == data["missions"]  # estables
    assert all(m["progress"] == 0 and not m["claimable"] for m in data["missions"])
    first = data["missions"][0]
    assert client.post(f"{G}/missions/{first['key']}/claim", headers=madrid).status_code == 409  # sin completar
    assert client.post(f"{G}/missions/nada/claim", headers=madrid).status_code == 404

    # se fijan objetivos asumibles para la prueba y se completan las tres
    with SessionLocal() as db:
        for m in db.query(WeeklyMission).all():
            m.target = 1
        db.commit()
    hid = client.get(H, headers=madrid).json()[0]["id"]
    client.put(f"{H}/{hid}/check", headers=madrid, json={"day": t.isoformat(), "checked": True})
    for d in (1, 3, 3):
        x = client.post(T, headers=madrid, json={"title": f"Tarea {d}", "difficulty": d, "due_date": "2099-01-01T00:00:00Z"}).json()
        client.put(f"{T}/{x['id']}", headers=madrid, json={"status": "completed"})
    with SessionLocal() as db:
        db.add(PomodoroSession(user_id=1, seconds=1800, ended_at=datetime.now(timezone.utc)))
        db.commit()
    if "review" in keys:
        client.post("/api/v1/review/complete", headers=madrid, json={"week_start": week.isoformat(), "goals": [], "reflection": ""})
    data = client.get(f"{G}/missions", headers=madrid).json()
    assert all(m["claimable"] for m in data["missions"]), data

    before = wallet(client, madrid)["coins"]
    gained = 0
    for i, m in enumerate(data["missions"]):
        r = client.post(f"{G}/missions/{m['key']}/claim", headers=madrid).json()
        gained += r["coins_gained"]
        assert r["chest"] == (i == 2)  # el cofre llega al reclamar la tercera
    assert client.post(f"{G}/missions/{first['key']}/claim", headers=madrid).status_code == 409
    w = wallet(client, madrid)
    assert w["freezes"] == 1  # regalo del cofre
    xp_after = client.get(f"{G}/profile", headers=madrid).json()["xp"]
    assert w["coins"] >= before + gained  # las misiones dan monedas directas y además experiencia (que da más monedas)
    hist = client.get(f"{G}/history", headers=madrid).json()
    assert hist["by_kind"]["mission"] == sum(m["reward_xp"] for m in data["missions"])
    assert client.get(f"{G}/missions", headers=madrid).json()["chest_claimed"] is True


def test_mission_targets_adapt_to_history(client, madrid):
    t = today()
    week = t - timedelta(days=t.weekday())
    with SessionLocal() as db:
        user = db.query(User).one()
        assert missions._candidates(db, user, week)["tasks"] == 3  # sin historial: el mínimo
        # 40 tareas en las 4 semanas anteriores → 10 por semana → objetivo 12
        for i in range(40):
            x = client.post(T, headers=madrid, json={"title": f"t{i}"}).json()
            db.add(XpEvent(user_id=user.id, kind="task", ref=str(x["id"]), amount=20,
                           created_at=datetime.combine(week - timedelta(days=1 + i % 27), datetime.min.time(), tzinfo=MADRID).replace(hour=12)))
        db.commit()
        assert missions._candidates(db, user, week)["tasks"] == 12


# ---------- Recompensas ----------
def test_rewards(client, madrid):
    give_xp(1, 2000)  # 200 monedas
    r = client.post(f"{G}/rewards", headers=madrid, json={"title": "Una tarde libre", "cost": 120, "emoji": "🌴"}).json()
    book = client.post(f"{G}/rewards", headers=madrid, json={"title": "Comprarme el libro", "cost": 60, "repeatable": False}).json()
    assert client.post(f"{G}/rewards", headers=madrid, json={"title": "Gratis", "cost": 0}).status_code == 422
    assert [x["title"] for x in client.get(f"{G}/rewards", headers=madrid).json()] == ["Comprarme el libro", "Una tarde libre"]

    res = client.post(f"{G}/rewards/{book['id']}/redeem", headers=madrid).json()
    assert res["wallet"]["coins"] == 140 and res["reward"]["times_redeemed"] == 1 and not res["reward"]["available"]
    assert client.post(f"{G}/rewards/{book['id']}/redeem", headers=madrid).status_code == 409  # no repetible
    client.post(f"{G}/rewards/{r['id']}/redeem", headers=madrid)
    assert client.post(f"{G}/rewards/{r['id']}/redeem", headers=madrid).status_code == 409  # 20 monedas: no llega
    assert wallet(client, madrid)["coins"] == 20

    hist = client.get(f"{G}/coins/history", headers=madrid).json()
    assert [(e["reason"], e["amount"], e["detail"]) for e in hist[:2]] == [("reward", -120, "🌴 Una tarde libre"), ("reward", -60, "Comprarme el libro")]
    assert client.delete(f"{G}/coins/{hist[0]['id']}", headers=madrid).status_code == 204  # deshacer el canje
    assert wallet(client, madrid)["coins"] == 140

    client.put(f"{G}/rewards/{r['id']}", headers=madrid, json={"cost": 150, "is_archived": True})
    assert [x["title"] for x in client.get(f"{G}/rewards", headers=madrid).json()] == ["Comprarme el libro"]
    assert client.post(f"{G}/rewards/{r['id']}/redeem", headers=madrid).status_code == 409  # archivada

    bea, _ = make_user(client, "bea")
    assert client.post(f"{G}/rewards/{book['id']}/redeem", headers=bea).status_code == 404
    assert client.delete(f"{G}/coins/{hist[1]['id']}", headers=bea).status_code == 404
    assert client.get(f"{G}/rewards", headers=bea).json() == []
    assert client.delete(f"{G}/rewards/{book['id']}", headers=madrid).status_code == 204
    assert len(client.get(f"{G}/coins/history", headers=madrid).json()) == 1  # el historial del canje se conserva
    ach = {a["id"]: a for a in client.get(f"{G}/history", headers=madrid).json()["achievements"]}
    assert ach["reward1"]["unlocked"]
