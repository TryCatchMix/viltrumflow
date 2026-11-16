from app.services import markdown as md

N = "/api/v1/notes"


def test_markdown_parsing():
    text = "# Título\nVer [[Nota A]] y [[nota a|alias]] y [[B#sec]] #Tag1 #proyecto/web a#no\n```\n[[Código]] #nada\n```\n`[[inline]]`\n- [ ] uno\n  * [x] dos"
    assert md.extract_links(text) == ["Nota A", "B"]
    assert md.extract_tags(text) == ["tag1", "proyecto/web"]
    assert md.extract_checklist(text) == [(6, "uno", False), (7, "dos", True)]
    assert md.rename_links(text, "nota a", "Z").count("[[Z") == 2 and "[[Z|alias]]" in md.rename_links(text, "nota a", "Z")
    assert "- [x] uno" in md.toggle_checkbox(text, 6, True)


def test_links_backlinks_and_rename(client, auth):
    a = client.post(N, headers=auth, json={"title": "Alfa", "content": "Enlaza a [[Beta]] y a [[Fantasma]] #uno"}).json()
    assert a["tags"] == ["uno"]
    assert {(o["title"], o["id"]) for o in a["outgoing"]} == {("Beta", None), ("Fantasma", None)}

    # al crear Beta, el enlace pendiente se resuelve
    b = client.post(N, headers=auth, json={"title": "beta", "content": ""}).json()
    assert [(x["title"], x["context"]) for x in b["backlinks"]] == [("Alfa", "Enlaza a [[Beta]] y a [[Fantasma]] #uno")]
    assert client.post(N, headers=auth, json={"title": "BETA"}).status_code == 409

    # renombrar reescribe los enlaces en las notas origen
    r = client.put(f"{N}/{b['id']}", headers=auth, json={"title": "Gamma"})
    assert r.status_code == 200 and [x["title"] for x in r.json()["backlinks"]] == ["Alfa"]
    a2 = client.get(f"{N}/{a['id']}", headers=auth).json()
    assert "[[Gamma]]" in a2["content"] and "[[Beta]]" not in a2["content"]
    assert client.get(f"{N}/by-title/gamma", headers=auth).json()["id"] == b["id"]

    g = client.get(f"{N}/graph", headers=auth, params={"include_tags": True}).json()
    kinds = {n["label"]: n["kind"] for n in g["nodes"]}
    assert kinds["Alfa"] == "note" and kinds["Fantasma"] == "ghost" and kinds["#uno"] == "tag"
    pairs = {(e["source"], e["target"]) for e in g["edges"]}
    assert (f"n{a['id']}", f"n{b['id']}") in pairs and (f"n{a['id']}", "g:fantasma") in pairs

    # borrar el destino deja el enlace sin resolver
    assert client.delete(f"{N}/{b['id']}", headers=auth).status_code == 204
    out = client.get(f"{N}/{a['id']}", headers=auth).json()["outgoing"]
    assert {(o["title"], o["id"]) for o in out} == {("Gamma", None), ("Fantasma", None)}


def test_search_tags_and_folder(client, auth):
    client.post(N, headers=auth, json={"title": "Receta", "content": "Harina y agua #cocina/pan", "folder": "../Casa//Cocina/"})
    found = client.get(N, headers=auth, params={"q": "harina"}).json()
    assert found[0]["title"] == "Receta" and "Harina" in found[0]["snippet"] and found[0]["folder"] == "Casa/Cocina"
    assert [n["title"] for n in client.get(N, headers=auth, params={"tag": "cocina"}).json()] == ["Receta"]
    tags = {t["tag"]: t["count"] for t in client.get(f"{N}/tags", headers=auth).json()}
    assert tags["cocina/pan"] == 1
    assert client.post(N, headers=auth, json={"title": "Mal[titulo]"}).status_code == 422
    assert any(r["kind"] == "note" and r["title"] == "Receta" for r in client.get("/api/v1/search", headers=auth, params={"q": "agua"}).json())


def test_checklist_and_daily(client, auth):
    n = client.post(N, headers=auth, json={"title": "Lista", "content": "- [ ] leche\n- [x] pan\ntexto"}).json()
    items = [i for i in client.get(f"{N}/checklist", headers=auth).json() if i["note_id"] == n["id"]]
    assert [(i["text"], i["checked"]) for i in items] == [("leche", False), ("pan", True)]
    r = client.patch(f"{N}/{n['id']}/checklist", headers=auth, json={"line": 0, "checked": True})
    assert r.json()["content"].startswith("- [x] leche")
    assert client.patch(f"{N}/{n['id']}/checklist", headers=auth, json={"line": 2, "checked": True}).status_code == 409

    d1 = client.post(f"{N}/daily", headers=auth, params={"day": "2026-05-01"}).json()
    d2 = client.post(f"{N}/daily", headers=auth, params={"day": "2026-05-01"}).json()
    assert d1["id"] == d2["id"] and d1["is_daily"] and d1["folder"] == "Diario" and d1["title"] == "2026-05-01"


def test_convert_checkbox_into_task(client, auth):
    n = client.post(N, headers=auth, json={"title": "Plan", "content": "Intro\n  - [ ] Llamar a Juan\n- [x] hecho\n```\n- [ ] código\n```"}).json()
    r = client.post(f"{N}/{n['id']}/checklist/convert", headers=auth, json={"line": 1, "due_date": "2030-01-02T00:00:00Z", "tags": ["tel"]})
    assert r.status_code == 201, r.text
    t = r.json()
    assert t["title"] == "Llamar a Juan" and t["note_id"] == n["id"] and t["note_title"] == "Plan" and t["due_date"].startswith("2030-01-02")
    content = client.get(f"{N}/{n['id']}", headers=auth).json()["content"]
    assert content.split("\n")[1] == "  - Llamar a Juan *(convertida en tarea)*"
    # ya no aparece como casilla, y la tarea se lista por nota
    assert [i["text"] for i in client.get(f"{N}/checklist", headers=auth).json() if i["note_id"] == n["id"]] == ["hecho"]
    assert [x["id"] for x in client.get("/api/v1/tasks", headers=auth, params={"note_id": n["id"]}).json()] == [t["id"]]
    # líneas que no son casillas (texto, o dentro de código)
    for line in (0, 4, 99):
        assert client.post(f"{N}/{n['id']}/checklist/convert", headers=auth, json={"line": line}).status_code == 409
