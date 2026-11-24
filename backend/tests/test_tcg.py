import io

import pytest

from app.config import settings
from app.routers.tcg import canonical_number, name_key
from app.services import tcg_vision
from app.services.tcg_vision import CardReading, VisionError
from tests.conftest import make_user

T = "/api/v1/tcg"
JPEG = b"\xff\xd8\xff\xe0" + b"0" * 200


def reading(name="Yorinobu Arasaka", number="β001", confidence="high", is_card=True, **kw):
    return CardReading(is_card=is_card, name=name, number=number, set_name=kw.get("set_name", ""),
                       rarity=kw.get("rarity", ""), card_type=kw.get("card_type", ""), confidence=confidence)


@pytest.fixture()
def vision(monkeypatch):
    """Sustituye la llamada a Claude: cada test pone en `queue` lo que «lee» la cámara."""
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "sk-test")
    state = {"queue": [], "known": None}

    def fake(image, media_type, known=()):
        state["known"] = list(known)
        nxt = state["queue"].pop(0)
        if isinstance(nxt, Exception):
            raise nxt
        return nxt
    monkeypatch.setattr(tcg_vision, "read_card", fake)
    return state


def scan(client, auth, mode="add", qty=1, data=JPEG):
    return client.post(f"{T}/scan", headers=auth, data={"mode": mode, "qty": str(qty)},
                       files={"file": ("carta.jpg", io.BytesIO(data), "image/jpeg")})


def test_normalization():
    assert name_key("  Yorinóbu   ARASAKA! ") == "yorinobu arasaka"
    assert canonical_number("1") == canonical_number("001") == "001"
    assert canonical_number("014/131") == "014"
    assert canonical_number("B001") == canonical_number("β1") == "β001"
    assert canonical_number("005B") == "005b"


def test_add_scan_counts_and_totals(client, auth, vision):
    vision["queue"] += [reading(rarity="Rare"), reading(), reading(name="Yorinobu Arasaka", number="1"), reading("Judy Alvarez", "014/131")]
    r = scan(client, auth)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "done" and body["created"] is True and body["delta"] == 1
    assert body["card"]["name"] == "Yorinobu Arasaka" and body["card"]["number"] == "β001" and body["card"]["rarity"] == "Rare"
    assert body["card"]["quantity"] == 1 and body["card"]["image_url"].startswith("/api/v1/attachments/")
    assert body["totals"] == {"copies": 1, "unique": 1, "duplicates": 0, "wanted": 0}

    body = scan(client, auth, qty=2).json()
    assert body["created"] is False and body["card"]["quantity"] == 3 and body["totals"]["copies"] == 3
    # La colección se pasa como referencia al lector
    assert vision["known"] == [("β001", "Yorinobu Arasaka")]

    # «001» es otra impresión (no beta): carta distinta
    body = scan(client, auth).json()
    assert body["created"] is True and body["card"]["number"] == "001"
    body = scan(client, auth).json()
    assert body["card"]["number"] == "014" and body["totals"] == {"copies": 5, "unique": 3, "duplicates": 2, "wanted": 0}

    col = client.get(T, headers=auth).json()
    assert col["recognition"] is True and [c["number"] for c in col["cards"]] == ["001", "014", "β001"]
    # La foto se puede descargar con la sesión
    assert client.get(col["cards"][2]["image_url"], headers=auth).status_code == 200


def test_check_remove_wish_and_undo(client, auth, vision):
    vision["queue"] += [reading() for _ in range(4)] + [reading("Rogue", "020") for _ in range(3)] + [reading("Lucy", "007")]
    scan(client, auth, qty=2)
    body = scan(client, auth, mode="check").json()
    assert body["status"] == "done" and body["card"]["quantity"] == 2 and body["event_id"] is None

    body = scan(client, auth, mode="remove").json()
    assert body["delta"] == -1 and body["card"]["quantity"] == 1 and body["totals"]["copies"] == 1
    undo = client.post(f"{T}/events/{body['event_id']}/undo", headers=auth).json()
    assert undo["card"]["quantity"] == 2 and undo["removed"] is False
    assert scan(client, auth, mode="remove", qty=5).json()["card"]["quantity"] == 0

    # Consultar o quitar una carta que no está: nada cambia
    body = scan(client, auth, mode="check").json()
    assert body["status"] == "missing" and body["card"] is None and body["totals"]["copies"] == 0
    # Lista de deseos: se crea sin copias; al añadirla después, sale de la lista
    body = scan(client, auth, mode="wish").json()
    assert body["card"]["wanted"] is True and body["card"]["quantity"] == 0 and body["totals"]["wanted"] == 1
    body = scan(client, auth).json()
    assert body["card"]["wanted"] is False and body["card"]["quantity"] == 1 and body["totals"]["wanted"] == 0
    # Deshacer el alta de una carta nueva la borra (y su foto)
    body = scan(client, auth).json()
    assert body["created"] is True
    img = body["card"]["image_url"]
    undo = client.post(f"{T}/events/{body['event_id']}/undo", headers=auth).json()
    assert undo["removed"] is True and client.get(img, headers=auth).status_code == 404
    assert [c["name"] for c in client.get(T, headers=auth).json()["cards"]] == ["Rogue", "Yorinobu Arasaka"]


def test_ambiguous_reading_asks_and_apply(client, auth, vision):
    client.post(f"{T}/cards", headers=auth, json={"name": "Johnny Silverhand", "number": "010", "quantity": 1})
    client.post(f"{T}/cards", headers=auth, json={"name": "Johnny Silverhand", "number": "160", "quantity": 1})
    # Sin número legible, dos candidatas: pregunta y no toca nada
    vision["queue"] += [reading("Johnny Silverhand", "", confidence="medium")]
    body = scan(client, auth).json()
    assert body["status"] == "choose" and {c["number"] for c in body["candidates"]} == {"010", "160"}
    assert client.get(T, headers=auth).json()["totals"]["copies"] == 2
    chosen = body["candidates"][0]
    r = client.post(f"{T}/apply", headers=auth, data={"mode": "add", "card_id": str(chosen["id"])},
                    files={"file": ("c.jpg", io.BytesIO(JPEG), "image/jpeg")})
    assert r.status_code == 200 and r.json()["card"]["quantity"] == 2 and r.json()["card"]["image_url"]

    # Pequeño error de lectura del nombre con el mismo número: es la misma carta
    vision["queue"] += [reading("Johny Silverhand", "160")]
    assert scan(client, auth).json()["card"]["quantity"] == 2

    # Corrección a mano de una lectura: crea la carta o usa la existente con ese nombre y número
    r = client.post(f"{T}/apply", headers=auth, data={"mode": "add", "name": "Adam Smasher", "number": "33", "rarity": "Iconic Rare"})
    assert r.json()["created"] is True and r.json()["card"]["number"] == "033"
    r = client.post(f"{T}/apply", headers=auth, data={"mode": "add", "name": "adam smasher", "number": "033"})
    assert r.json()["created"] is False and r.json()["card"]["quantity"] == 2
    assert client.post(f"{T}/apply", headers=auth, data={"mode": "add", "name": " "}).status_code == 422


def test_unreadable_and_errors(client, auth, vision):
    vision["queue"] += [reading(is_card=False, name="", number=""), VisionError("Demasiadas lecturas seguidas")]
    body = scan(client, auth).json()
    assert body["status"] == "unreadable" and client.get(T, headers=auth).json()["cards"] == []
    r = scan(client, auth)
    assert r.status_code == 503 and "Demasiadas" in r.json()["detail"]
    assert scan(client, auth, data=b"GIF89a" + b"0" * 50).status_code == 415
    assert client.post(f"{T}/scan", headers=auth, data={"mode": "steal"},
                       files={"file": ("c.jpg", io.BytesIO(JPEG), "image/jpeg")}).status_code == 422


def test_without_key_manual_collection(client, auth, monkeypatch):
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", None)
    assert client.get(T, headers=auth).json()["recognition"] is False
    r = scan(client, auth)
    assert r.status_code == 503 and "ANTHROPIC_API_KEY" in r.json()["detail"]

    c = client.post(f"{T}/cards", headers=auth, json={"name": "Panam Palmer", "number": "12", "quantity": 2}).json()["card"]
    assert client.post(f"{T}/cards", headers=auth, json={"name": "PANAM palmer", "number": "012"}).status_code == 409
    r = client.post(f"{T}/cards/{c['id']}/adjust", headers=auth, json={"delta": -5}).json()
    assert r["card"]["quantity"] == 0 and r["totals"]["copies"] == 0
    r = client.put(f"{T}/cards/{c['id']}", headers=auth, json={"name": "Panam Palmer", "number": "012", "rarity": "Rare", "quantity": 4, "wanted": False}).json()
    assert r["card"]["rarity"] == "Rare" and r["totals"] == {"copies": 4, "unique": 1, "duplicates": 3, "wanted": 0}
    r = client.post(f"{T}/cards/{c['id']}/image", headers=auth, files={"file": ("p.png", io.BytesIO(b"\x89PNG\r\n\x1a\n" + b"0" * 40), "image/png")})
    assert r.json()["card"]["image_url"]
    ev = client.get(f"{T}/events", headers=auth).json()
    assert [e["delta"] for e in ev] == [-2]
    assert client.delete(f"{T}/cards/{c['id']}", headers=auth).status_code == 204
    assert client.get(T, headers=auth).json()["cards"] == []


def test_collections_are_private(client, vision):
    ana, _ = make_user(client, "ana")
    bea, _ = make_user(client, "bea")
    vision["queue"] += [reading()]
    card = scan(client, ana).json()["card"]
    assert client.get(T, headers=bea).json()["cards"] == []
    assert client.post(f"{T}/cards/{card['id']}/adjust", headers=bea, json={"delta": 1}).status_code == 404
    assert client.delete(f"{T}/cards/{card['id']}", headers=bea).status_code == 404
    assert client.post(f"{T}/apply", headers=bea, data={"mode": "add", "card_id": str(card["id"])}).status_code == 404
    ev = client.get(f"{T}/events", headers=ana).json()[0]
    assert client.post(f"{T}/events/{ev['id']}/undo", headers=bea).status_code == 404
    assert client.get(card["image_url"], headers=bea).status_code == 404
