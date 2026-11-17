from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest

from app.database import SessionLocal
from app.models import Habit, HabitCheck, PushSubscription, User
from app.services import notify

from .conftest import make_user

T, H, P, R = "/api/v1/tasks", "/api/v1/habits", "/api/v1/push", "/api/v1/review"
MADRID = ZoneInfo("Europe/Madrid")


def madrid_today():
    return datetime.now(timezone.utc).astimezone(MADRID).date()


def xp(client, auth):
    return client.get("/api/v1/game/profile", headers=auth).json()["xp"]


@pytest.fixture()
def madrid(client, auth):
    client.put("/api/v1/auth/me", headers=auth, json={"timezone": "Europe/Madrid"})
    return auth


def set_start(habit_id, days_ago):
    with SessionLocal() as db:
        db.get(Habit, habit_id).start_day = madrid_today() - timedelta(days=days_ago)
        db.commit()


# ---------- Estimación en minutos ----------
def test_estimate_in_minutes(client, auth):
    t = client.post(T, headers=auth, json={"title": "Correo rápido", "estimated_minutes": 15}).json()
    assert t["estimated_minutes"] == 15 and "estimated_hours" not in t
    assert client.put(f"{T}/{t['id']}", headers=auth, json={"estimated_minutes": 45}).json()["estimated_minutes"] == 45
    before = xp(client, auth)
    client.put(f"{T}/{t['id']}", headers=auth, json={"status": "completed"})
    assert xp(client, auth) - before == 20 + 3  # 45 min estimados → 3 XP de esfuerzo
    assert client.post(T, headers=auth, json={"title": "x", "estimated_minutes": -5}).status_code == 422


# ---------- Rutinas con cantidad ----------
def test_quantity_habit(client, madrid):
    today = madrid_today().isoformat()
    h = client.post(H, headers=madrid, json={"title": "Beber agua", "target_count": 8, "unit": " vasos ", "difficulty": 1}).json()
    assert (h["target_count"], h["unit"]) == (8, "vasos")
    put = lambda n: client.put(f"{H}/{h['id']}/count", headers=madrid, json={"day": today, "count": n}).json()

    r = put(3)
    assert (r["item"]["count"], r["item"]["checked"], r["xp_gained"]) == (3, False, 0)
    assert xp(client, madrid) == 0
    r = put(8)
    assert r["item"]["checked"] and r["xp_gained"] == 5 and xp(client, madrid) == 5
    assert put(10)["xp_gained"] == 0 and xp(client, madrid) == 5  # pasarse no vuelve a puntuar
    r = put(7)  # por debajo del objetivo: deja de estar cumplida y se retira la experiencia
    assert not r["item"]["checked"] and xp(client, madrid) == 0
    # «marcar» la da por completa; desmarcar la deja a cero
    r = client.put(f"{H}/{h['id']}/check", headers=madrid, json={"day": today, "checked": True}).json()
    assert r["item"]["count"] == 8 and r["item"]["checked"]
    r = client.put(f"{H}/{h['id']}/check", headers=madrid, json={"day": today, "checked": False}).json()
    assert r["item"]["count"] == 0

    # en las estadísticas, el progreso a medias de días pasados es «parcial» y no cuenta como cumplida
    set_start(h["id"], 2)
    yesterday = (madrid_today() - timedelta(days=1)).isoformat()
    client.put(f"{H}/{h['id']}/count", headers=madrid, json={"day": yesterday, "count": 4})
    s = client.get(f"{H}/stats", headers=madrid, params={"days": 7}).json()["habits"][0]
    assert s["states"][-3:] == ["missed", "partial", "pending"] and (s["done"], s["scheduled"]) == (0, 2)


# ---------- Rutinas «N veces por semana» ----------
def test_weekly_habit(client, madrid):
    today = madrid_today()
    monday = today - timedelta(days=today.weekday())
    h = client.post(H, headers=madrid, json={"title": "Correr", "weekly_target": 3, "days": "0"}).json()
    assert h["weekly_target"] == 3
    set_start(h["id"], 30)
    # aparece todos los días aunque «days» diga solo lunes
    assert [i["title"] for i in client.get(f"{H}/day", headers=madrid).json()] == ["Correr"]

    with SessionLocal() as db:
        # semana pasada: 3 días (cumplida); la anterior: 1 (no cumplida)
        for d in (monday - timedelta(days=7), monday - timedelta(days=5), monday - timedelta(days=3), monday - timedelta(days=12)):
            db.add(HabitCheck(habit_id=h["id"], day=d, count=1))
        db.commit()
    item = client.get(f"{H}/day", headers=madrid).json()[0]
    assert (item["streak"], item["week_done"]) == (1, 0)  # una semana seguida; esta, aún sin empezar

    s = client.get(f"{H}/stats", headers=madrid, params={"days": 14}).json()
    hs = s["habits"][0]
    assert hs["period"] == "week" and "missed" not in hs["states"] and "free" in hs["states"]
    assert hs["best_streak"] == 1
    # las semanales no entran en el cumplimiento por días
    assert all(d["scheduled"] == 0 for d in s["daily"])

    # se puede deshacer lo de hoy sin perder la racha de semanas
    r = client.put(f"{H}/{h['id']}/check", headers=madrid, json={"day": today.isoformat(), "checked": True}).json()
    assert r["item"]["week_done"] == 1 and r["item"]["checked"]
    # cambiar a días fijos vuelve a respetar los días
    client.put(f"{H}/{h['id']}", headers=madrid, json={"weekly_target": None, "days": str((today.weekday() + 1) % 7)})
    assert client.get(f"{H}/day", headers=madrid).json() == []


# ---------- Avisos de rutinas a su hora ----------
def test_habit_reminder_at_target_time(client, madrid):
    h = client.post(H, headers=madrid, json={"title": "Pastilla", "target_time": "09:00", "remind": True}).json()
    client.post(H, headers=madrid, json={"title": "Sin aviso", "target_time": "09:00"})
    set_start(h["id"], 3)
    day = madrid_today()
    at = lambda hh, mm: datetime(day.year, day.month, day.day, hh, mm, tzinfo=MADRID).astimezone(timezone.utc)
    with SessionLocal() as db:
        user = db.query(User).one()
        assert notify.gather(db, user, at(8, 59)) == []
        notices = notify.gather(db, user, at(9, 5))
        assert [(n["kind"], n["title"]) for n in notices] == [("habit", "Pastilla")]
        db.commit()
        assert notify.gather(db, user, at(9, 10)) == []  # una vez al día
        # al día siguiente vuelve; si ya está hecha, no; y pasadas 3 h tampoco
        db.get(Habit, h["id"]).last_reminded_on = None
        db.add(HabitCheck(habit_id=h["id"], day=day, count=1))
        db.commit()
        assert notify.gather(db, user, at(9, 30)) == []
        db.query(HabitCheck).delete()
        db.commit()
        assert notify.gather(db, user, at(12, 1)) == []


# ---------- Web Push ----------
@pytest.fixture()
def pushes(monkeypatch):
    sent = []

    class Gone(Exception):
        pass

    def fake_webpush(subscription_info, data, **kw):
        import json
        from pywebpush import WebPushException
        if "gone" in subscription_info["endpoint"]:
            resp = type("R", (), {"status_code": 410})()
            raise WebPushException("gone", response=resp)
        assert kw["vapid_claims"]["sub"].startswith(("mailto:", "https://"))
        sent.append((subscription_info["endpoint"], json.loads(data)["notification"]))

    monkeypatch.setattr("pywebpush.webpush", fake_webpush)
    return sent


SUB = {"endpoint": "https://push.example.com/abc", "keys": {"p256dh": "B" * 87, "auth": "a" * 22}}


def test_push_subscribe_and_task_reminder(client, auth, pushes):
    key = client.get(f"{P}/key", headers=auth).json()["public_key"]
    assert len(key) == 87 and key == client.get(f"{P}/key", headers=auth).json()["public_key"]  # estable
    assert client.post(f"{P}/subscribe", headers=auth, json={**SUB, "endpoint": "http://inseguro"}).status_code == 422
    assert client.post(f"{P}/subscribe", headers=auth, json=SUB).status_code == 204
    assert client.post(f"{P}/subscribe", headers=auth, json=SUB).status_code == 204  # idempotente
    assert client.get(f"{P}/devices", headers=auth).json() == {"count": 1}
    assert client.post(f"{P}/test", headers=auth).json() == {"delivered": 1}
    assert pushes[-1][1]["title"] == "ViltrumFlow" and pushes[-1][1]["data"]["onActionClick"]["default"]["url"] == "/settings"

    now = datetime.now(timezone.utc)
    t = client.post(T, headers=auth, json={"title": "Reunión", "all_day": False,
                                           "due_date": (now + timedelta(minutes=5)).isoformat(), "reminder_minutes": 10}).json()
    with SessionLocal() as db:
        assert notify.push_notices(db, now) == 1
        assert notify.push_notices(db, now) == 0  # ya entregado
    assert pushes[-1][1]["title"] == "Recordatorio: Reunión" and pushes[-1][1]["tag"] == f"vf-task-{t['id']}"
    # y la app abierta ya no lo repite
    assert client.post("/api/v1/reminders/poll", headers=auth).json() == []


def test_push_failures(client, auth, pushes):
    client.post(f"{P}/subscribe", headers=auth, json={**SUB, "endpoint": "https://push.example.com/gone"})
    now = datetime.now(timezone.utc)
    client.post(T, headers=auth, json={"title": "Aviso", "all_day": False, "due_date": (now + timedelta(minutes=5)).isoformat(), "reminder_minutes": 10})
    with SessionLocal() as db:
        assert notify.push_notices(db, now) == 0
        assert db.query(PushSubscription).count() == 0  # suscripción caducada: se borra
    # como no llegó a ningún sitio, el aviso sigue pendiente para la app
    assert [r["title"] for r in client.post("/api/v1/reminders/poll", headers=auth).json()] == ["Aviso"]


def test_subscription_moves_between_accounts(client, pushes):
    ana, _ = make_user(client, "ana")
    bea, _ = make_user(client, "bea")
    client.post(f"{P}/subscribe", headers=ana, json=SUB)
    client.post(f"{P}/subscribe", headers=bea, json=SUB)  # mismo navegador, otra cuenta
    assert client.get(f"{P}/devices", headers=ana).json()["count"] == 0
    assert client.post(f"{P}/unsubscribe", headers=ana, json={"endpoint": SUB["endpoint"]}).status_code == 204
    assert client.get(f"{P}/devices", headers=bea).json()["count"] == 1  # ana no puede quitársela a bea
    client.post(f"{P}/unsubscribe", headers=bea, json={"endpoint": SUB["endpoint"]})
    assert client.get(f"{P}/devices", headers=bea).json()["count"] == 0


def test_pomodoro_push(client, auth, pushes):
    client.post(f"{P}/subscribe", headers=auth, json=SUB)
    now = datetime.now(timezone.utc)
    assert client.put("/api/v1/pomodoro/timer", headers=auth, json={"ends_at": (now - timedelta(minutes=1)).isoformat(), "phase": "focus"}).status_code == 400
    assert client.put("/api/v1/pomodoro/timer", headers=auth, json={"ends_at": (now + timedelta(minutes=25)).isoformat(), "phase": "nap"}).status_code == 422
    client.put("/api/v1/pomodoro/timer", headers=auth, json={"ends_at": (now + timedelta(seconds=30)).isoformat(), "phase": "focus"})
    with SessionLocal() as db:
        assert notify.push_pomodoro(db, now) == 0  # aún no
        assert notify.push_pomodoro(db, now + timedelta(seconds=31)) == 1
        assert notify.push_pomodoro(db, now + timedelta(seconds=60)) == 0  # una sola vez
    assert pushes[-1][1]["title"] == "Pomodoro · Bloque terminado" and pushes[-1][1]["tag"] == "vf-pomodoro"
    # en pausa o terminado con la app abierta, no se avisa
    client.put("/api/v1/pomodoro/timer", headers=auth, json={"ends_at": (now + timedelta(seconds=30)).isoformat(), "phase": "short"})
    client.delete("/api/v1/pomodoro/timer", headers=auth)
    with SessionLocal() as db:
        assert notify.push_pomodoro(db, now + timedelta(minutes=5)) == 0


# ---------- Revisión semanal ----------
def test_weekly_review(client, madrid):
    today = madrid_today()
    monday = today - timedelta(days=today.weekday())
    week = monday if today.weekday() >= 4 else monday - timedelta(days=7)
    s = client.get(R, headers=madrid).json()
    assert s["week_start"] == week.isoformat() and s["week_end"] == (week + timedelta(days=6)).isoformat()

    # tareas: una completada esta semana, una atrasada sin hacer, una sin fecha
    done = client.post(T, headers=madrid, json={"title": "Hecha", "difficulty": 3}).json()
    client.put(f"{T}/{done['id']}", headers=madrid, json={"status": "completed"})
    client.post(T, headers=madrid, json={"title": "Atrasada", "due_date": "2020-01-01T00:00:00Z"})
    client.post(T, headers=madrid, json={"title": "Sin fecha"})
    s = client.get(R, headers=madrid, params={"week_start": monday.isoformat()}).json()
    assert [t["title"] for t in s["completed"]] == ["Hecha"] and s["xp"]["task"] == 40
    assert [t["title"] for t in s["carried_over"]] == ["Atrasada"] and [t["title"] for t in s["no_date"]] == ["Sin fecha"]
    assert s["completed_at"] is None and s["xp_reward"] == 30

    assert client.get(R, headers=madrid, params={"week_start": (monday + timedelta(days=7)).isoformat()}).status_code == 400
    body = {"week_start": monday.isoformat(), "goals": [{"text": "Terminar el informe"}, {"text": "Correr 3 veces"}], "reflection": "Buena semana"}
    assert client.put(R, headers=madrid, json={**body, "week_start": (monday + timedelta(days=1)).isoformat()}).status_code == 422
    assert client.put(R, headers=madrid, json=body).status_code == 200
    r = client.post(f"{R}/complete", headers=madrid, json=body).json()
    assert r["xp_gained"] == 30 and r["completed_at"]
    assert client.post(f"{R}/complete", headers=madrid, json=body).json()["xp_gained"] == 0  # una sola vez
    s = client.get(R, headers=madrid, params={"week_start": monday.isoformat()}).json()
    assert [g["text"] for g in s["goals"]] == ["Terminar el informe", "Correr 3 veces"] and s["reflection"] == "Buena semana"

    # los objetivos fijados la semana pasada aparecen en «Hoy» y se pueden marcar
    prev = (monday - timedelta(days=7)).isoformat()
    client.put(R, headers=madrid, json={"week_start": prev, "goals": [{"text": "Leer un libro"}]})
    info = client.get(f"{R}/today", headers=madrid).json()
    assert info["goals_week"] == prev and info["goals"] == [{"text": "Leer un libro", "done": False}]
    assert client.put(f"{R}/goal", headers=madrid, json={"week_start": prev, "index": 0, "done": True}).status_code == 204
    assert client.get(f"{R}/today", headers=madrid).json()["goals"][0]["done"] is True
    assert client.put(f"{R}/goal", headers=madrid, json={"week_start": prev, "index": 5, "done": True}).status_code == 404
    assert client.get(R, headers=madrid, params={"week_start": monday.isoformat()}).json()["previous_goals"][0]["done"] is True

    bea, _ = make_user(client, "bea")
    assert client.get(R, headers=bea, params={"week_start": monday.isoformat()}).json()["goals"] == []  # privada
