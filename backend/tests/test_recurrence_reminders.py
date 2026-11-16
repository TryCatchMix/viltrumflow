from datetime import datetime, timedelta, timezone

import pytest

from app.database import SessionLocal
from app.models import Task, User
from app.services import mailer, reminders
from app.services.recurrence import next_due

T = "/api/v1/tasks"
UTC = timezone.utc


def dt(s):
    return datetime.fromisoformat(s).replace(tzinfo=UTC)


def test_next_due_rules():
    now = dt("2026-01-01")
    assert next_due(dt("2026-01-30"), "daily", now) == dt("2026-01-31")
    assert next_due(dt("2026-01-30"), "weekdays", now) == dt("2026-02-02")  # viernes → lunes
    assert next_due(dt("2026-01-30"), "weekly", now) == dt("2026-02-06")
    assert next_due(dt("2026-01-30"), "biweekly", now) == dt("2026-02-13")
    assert next_due(dt("2026-01-31"), "monthly", now) == dt("2026-02-28")  # se ajusta al fin de mes
    assert next_due(dt("2024-02-29"), "yearly", dt("2024-01-01")) == dt("2025-02-28")
    assert next_due(dt("2026-03-10T15:30:00"), "weekly", now) == dt("2026-03-17T15:30:00")  # conserva la hora
    # atrasada: salta las ocurrencias pasadas en vez de crear otra ya vencida
    assert next_due(dt("2026-01-05"), "weekly", dt("2026-01-27T10:00:00")) == dt("2026-02-02")
    assert next_due(None, "daily", dt("2026-01-27T10:00:00")) == dt("2026-01-28")


def test_completing_recurring_task_creates_next(client, auth):
    t = client.post(T, headers=auth, json={"title": "Regar", "recurrence": "weekly", "due_date": "2030-05-06T00:00:00Z",
                                           "reminder_minutes": 60, "tags": ["casa"], "priority": "high"}).json()
    assert t["recurrence"] == "weekly"
    client.post(T, headers=auth, json={"title": "Llenar regadera", "parent_task_id": t["id"]})
    sub = client.get(f"{T}/{t['id']}", headers=auth).json()["subtasks"][0]
    client.put(f"{T}/{sub['id']}", headers=auth, json={"status": "completed"})

    client.put(f"{T}/{t['id']}", headers=auth, json={"status": "completed"})
    open_ = [x for x in client.get(T, headers=auth).json() if x["status"] == "todo"]
    assert len(open_) == 1
    nxt = open_[0]
    assert nxt["id"] != t["id"] and nxt["title"] == "Regar" and nxt["due_date"].startswith("2030-05-13")
    assert nxt["recurrence"] == "weekly" and nxt["reminder_minutes"] == 60 and nxt["tags"] == ["casa"] and nxt["priority"] == "high"
    assert [(s["title"], s["status"]) for s in nxt["subtasks"]] == [("Llenar regadera", "todo")]

    # reabrir y volver a completar la original no duplica la siguiente
    client.put(f"{T}/{t['id']}", headers=auth, json={"status": "todo"})
    client.put(f"{T}/{t['id']}", headers=auth, json={"status": "completed"})
    assert len(client.get(T, headers=auth).json()) == 2

    # desde el tablero también, y la cadena continúa
    client.patch(f"{T}/{nxt['id']}/move", headers=auth, json={"status": "completed", "position": 0})
    dues = sorted(x["due_date"][:10] for x in client.get(T, headers=auth).json())
    assert dues == ["2030-05-06", "2030-05-13", "2030-05-20"]

    # una tarea normal no genera nada
    n = client.post(T, headers=auth, json={"title": "Única"}).json()
    client.put(f"{T}/{n['id']}", headers=auth, json={"status": "completed"})
    assert len(client.get(T, headers=auth).json()) == 4
    assert client.post(T, headers=auth, json={"title": "x", "recurrence": "a veces"}).status_code == 422


def test_browser_reminders_poll(client, auth):
    R = "/api/v1/reminders/poll"
    now = datetime.now(UTC)
    iso = lambda d: d.isoformat()
    soon = client.post(T, headers=auth, json={"title": "Reunión", "all_day": False, "due_date": iso(now + timedelta(minutes=20)), "reminder_minutes": 30}).json()
    client.post(T, headers=auth, json={"title": "Lejana", "all_day": False, "due_date": iso(now + timedelta(hours=5)), "reminder_minutes": 30})
    client.post(T, headers=auth, json={"title": "Sin aviso", "all_day": False, "due_date": iso(now + timedelta(minutes=5))})
    client.post(T, headers=auth, json={"title": "Muy antigua", "all_day": False, "due_date": iso(now - timedelta(days=3)), "reminder_minutes": 0})
    done = client.post(T, headers=auth, json={"title": "Hecha", "all_day": False, "due_date": iso(now + timedelta(minutes=5)), "reminder_minutes": 30}).json()
    client.put(f"{T}/{done['id']}", headers=auth, json={"status": "completed"})

    assert [r["title"] for r in client.post(R, headers=auth).json()] == ["Reunión"]
    assert client.post(R, headers=auth).json() == []  # una sola vez

    # reprogramar la tarea vuelve a armar el recordatorio
    client.put(f"{T}/{soon['id']}", headers=auth, json={"due_date": iso(now + timedelta(minutes=10))})
    assert [r["task_id"] for r in client.post(R, headers=auth).json()] == [soon["id"]]
    # quitar el recordatorio
    client.put(f"{T}/{soon['id']}", headers=auth, json={"reminder_minutes": None, "due_date": iso(now + timedelta(minutes=9))})
    assert client.post(R, headers=auth).json() == []


def test_all_day_reminder_uses_user_timezone(client, auth):
    assert client.put("/api/v1/auth/me", headers=auth, json={"timezone": "Marte/Olympus"}).status_code == 422
    assert client.put("/api/v1/auth/me", headers=auth, json={"timezone": "Europe/Madrid"}).json()["timezone"] == "Europe/Madrid"
    client.post(T, headers=auth, json={"title": "Día completo", "due_date": "2026-07-10T00:00:00Z", "reminder_minutes": 0})
    with SessionLocal() as db:
        user, task = db.query(User).one(), db.query(Task).one()
        # 9:00 en Madrid (verano, UTC+2) = 07:00 UTC
        assert reminders.remind_at(task, reminders.user_tz(user)) == dt("2026-07-10T07:00:00")
        assert reminders.due_reminders(db, user, dt("2026-07-10T06:59:00"), "browser") == []
        assert len(reminders.due_reminders(db, user, dt("2026-07-10T07:00:00"), "browser")) == 1


@pytest.fixture()
def outbox(monkeypatch):
    sent = []
    monkeypatch.setattr(mailer, "send_email", lambda to, subject, text, html: sent.append((to, subject, text, html)) or True)
    return sent


def test_email_reminders_and_daily_digest(client, auth, outbox):
    client.put("/api/v1/auth/me", headers=auth, json={"timezone": "Europe/Madrid", "email_reminders": True, "daily_digest": True, "digest_hour": 8})
    client.post(T, headers=auth, json={"title": "Entregar <b>informe</b>", "all_day": False, "due_date": "2026-07-10T10:00:00Z", "reminder_minutes": 60})
    client.post(T, headers=auth, json={"title": "Pagar alquiler", "due_date": "2026-07-10T00:00:00Z"})
    client.post(T, headers=auth, json={"title": "Atrasada", "due_date": "2026-07-01T00:00:00Z"})

    with SessionLocal() as db:
        reminders.run_tick(db, dt("2026-07-10T05:30:00"))  # 7:30 en Madrid: aún no toca nada
        assert outbox == []
        reminders.run_tick(db, dt("2026-07-10T06:05:00"))  # 8:05: resumen
        assert len(outbox) == 1
        to, subject, text, html = outbox[0]
        assert to == "ana@example.com" and "2 tareas para hoy" in subject
        assert "Pagar alquiler" in text and "Atrasada — 01/07" in text and "12:00" in text  # 10:00 UTC = 12:00 local
        assert "&lt;b&gt;informe" in html and "<b>informe" not in html  # el contenido del usuario va escapado
        reminders.run_tick(db, dt("2026-07-10T08:00:00"))  # no se repite el mismo día
        assert len(outbox) == 1
        reminders.run_tick(db, dt("2026-07-10T09:00:00"))  # una hora antes de las 10:00 UTC
        assert len(outbox) == 2 and outbox[1][1] == "Recordatorio: Entregar <b>informe</b>"
        reminders.run_tick(db, dt("2026-07-10T09:01:00"))
        assert len(outbox) == 2
        reminders.run_tick(db, dt("2026-07-11T06:00:00"))  # al día siguiente, nuevo resumen
        assert len(outbox) == 3

    # el aviso por email no consume el del navegador (canales independientes)
    with SessionLocal() as db:
        assert len(reminders.due_reminders(db, db.query(User).one(), dt("2026-07-10T09:00:00"), "browser")) == 1
    assert client.get("/api/v1/reminders/status", headers=auth).json() == {"email_configured": False}


def test_failed_email_is_retried(client, auth, monkeypatch):
    client.put("/api/v1/auth/me", headers=auth, json={"daily_digest": True, "digest_hour": 0})
    client.post(T, headers=auth, json={"title": "Hoy", "due_date": "2026-07-10T00:00:00Z"})
    calls = []
    monkeypatch.setattr(mailer, "send_email", lambda *a: calls.append(a) and False)
    with SessionLocal() as db:
        reminders.run_tick(db, dt("2026-07-10T10:00:00"))
        reminders.run_tick(db, dt("2026-07-10T10:01:00"))
    assert len(calls) == 2
