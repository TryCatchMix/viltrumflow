from tests.conftest import make_user

L = "/api/v1/lists"


def texts(d, checked=None):
    return [i["text"] for i in d["items"] if checked is None or i["checked"] == checked]


def test_shopping_flow_with_remembered_suggestions(client, auth):
    lst = client.post(L, headers=auth, json={"name": "Compra", "emoji": "🛒"}).json()
    assert lst["items"] == [] and lst["suggestions"] == [] and lst["is_owner"]
    lid = lst["id"]
    d = client.post(f"{L}/{lid}/items", headers=auth, json={"text": "leche, pan\nhuevos;  Leche "}).json()
    assert texts(d) == ["huevos", "pan", "leche"] and d["pending"] == 3  # lo último añadido, arriba; sin duplicados
    pan = next(i for i in d["items"] if i["text"] == "pan")
    d = client.patch(f"{L}/items/{pan['id']}", headers=auth, json={"checked": True}).json()
    assert texts(d, checked=True) == ["pan"] and texts(d)[-1] == "pan" and d["pending"] == 2

    # «Quitar lo comprado»: sale de la lista pero se recuerda
    d = client.post(f"{L}/{lid}/clear-checked", headers=auth).json()
    assert texts(d) == ["huevos", "leche"] and [s["text"] for s in d["suggestions"]] == ["pan"]
    # Volver a añadirlo lo recupera (y suma un uso); las sugerencias se ordenan por uso
    d = client.post(f"{L}/{lid}/items", headers=auth, json={"text": "Pan"}).json()
    assert "pan" in texts(d) and d["suggestions"] == []
    assert next(i for i in d["items"] if i["text"] == "pan")["times_used"] == 2
    for t in ("pan", "leche"):
        item = next(i for i in d["items"] if i["text"] == t)
        d = client.patch(f"{L}/items/{item['id']}", headers=auth, json={"checked": True}).json()
    d = client.post(f"{L}/{lid}/clear-checked", headers=auth).json()
    assert [s["text"] for s in d["suggestions"]] == ["pan", "leche"]
    # Añadir algo ya pendiente no lo duplica; si estaba marcado, lo desmarca
    hue = next(i for i in d["items"] if i["text"] == "huevos")
    client.patch(f"{L}/items/{hue['id']}", headers=auth, json={"checked": True})
    d = client.post(f"{L}/{lid}/items", headers=auth, json={"text": "huevos"}).json()
    assert texts(d) == ["huevos"] and texts(d, checked=False) == ["huevos"]
    # Olvidar del todo
    sug = d["suggestions"][0]
    d = client.delete(f"{L}/items/{sug['id']}", headers=auth).json()
    assert [s["text"] for s in d["suggestions"]] == ["leche"]
    summary = client.get(L, headers=auth).json()[0]
    assert (summary["name"], summary["emoji"], summary["pending"], summary["total"]) == ("Compra", "🛒", 1, 1)


def test_packing_list_uncheck_all_and_edit(client, auth):
    d = client.post(L, headers=auth, json={"name": "Maleta", "items": ["Cargador", "Pasaporte", "Cargador", " "]}).json()
    assert texts(d) == ["Cargador", "Pasaporte"]
    for i in d["items"]:
        d = client.patch(f"{L}/items/{i['id']}", headers=auth, json={"checked": True}).json()
    assert d["pending"] == 0
    d = client.post(f"{L}/{d['id']}/uncheck-all", headers=auth).json()
    assert d["pending"] == 2 and d["total"] == 2 and d["suggestions"] == []
    d = client.patch(f"{L}/items/{d['items'][0]['id']}", headers=auth, json={"text": "Cargador del móvil"}).json()
    assert "Cargador del móvil" in texts(d)
    d = client.put(f"{L}/{d['id']}", headers=auth, json={"name": "Maleta de viaje", "emoji": "🧳"}).json()
    assert d["name"] == "Maleta de viaje" and d["emoji"] == "🧳"
    assert client.post(L, headers=auth, json={"name": ""}).status_code == 422


def test_shared_list(client):
    ana, _ = make_user(client, "ana")
    bea, _ = make_user(client, "bea")
    carl, _ = make_user(client, "carl")
    d = client.post(L, headers=ana, json={"name": "Compra de casa"}).json()
    lid = d["id"]
    assert client.get(f"{L}/{lid}", headers=bea).status_code == 404
    d = client.post(f"{L}/{lid}/members", headers=ana, json={"identifier": "BEA@example.com"}).json()
    assert [m["username"] for m in d["members"]] == ["ana", "bea"]
    assert client.post(f"{L}/{lid}/members", headers=ana, json={"identifier": "bea"}).status_code == 409
    assert client.post(f"{L}/{lid}/members", headers=ana, json={"identifier": "nadie"}).status_code == 404
    # Bea la ve, añade y marca; no puede borrarla ni invitar
    shared = client.get(L, headers=bea).json()
    assert shared[0]["name"] == "Compra de casa" and not shared[0]["is_owner"] and shared[0]["owner_name"] == "Ana"
    d = client.post(f"{L}/{lid}/items", headers=bea, json={"text": "café"}).json()
    assert texts(client.get(f"{L}/{lid}", headers=ana).json()) == ["café"]
    assert client.delete(f"{L}/{lid}", headers=bea).status_code == 403
    assert client.post(f"{L}/{lid}/members", headers=bea, json={"identifier": "carl"}).status_code == 403
    carl_id = client.get("/api/v1/auth/me", headers=carl).json()["id"]
    bea_id = client.get("/api/v1/auth/me", headers=bea).json()["id"]
    assert client.delete(f"{L}/{lid}/members/{carl_id}", headers=bea).status_code == 403
    # Carl no puede tocar sus elementos
    assert client.patch(f"{L}/items/{d['items'][0]['id']}", headers=carl, json={"checked": True}).status_code == 404
    # Bea sale de la lista
    assert client.delete(f"{L}/{lid}/members/{bea_id}", headers=bea).status_code == 204
    assert client.get(L, headers=bea).json() == []
    assert client.delete(f"{L}/{lid}", headers=ana).status_code == 204
