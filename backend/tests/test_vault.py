import io
import zipfile

from app.services import markdown as md

N = "/api/v1/notes"


def make_zip(files):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for name, content in files.items():
            z.writestr(name, content)
    return buf.getvalue()


def upload(client, auth, files, **params):
    return client.post(f"{N}/import", headers=auth, params=params,
                       files=[("files", (name, data, "application/octet-stream")) for name, data in files])


def test_frontmatter_parsing():
    text = "---\ntags: [Proyecto, web/front]\nalias: x # no es etiqueta\n- [ ] no es casilla\n---\n# Hola #cuerpo\n- [ ] sí"
    assert md.extract_tags(text) == ["proyecto", "web/front", "cuerpo"]
    assert md.extract_checklist(text) == [(6, "sí", False)]
    assert md.extract_tags("---\ntags:\n  - uno\n  - dos\nfecha: hoy\n---\n") == ["uno", "dos"]
    assert md.extract_tags("--- no es frontmatter #real") == ["real"]


def test_export_roundtrip(client, auth):
    client.post(N, headers=auth, json={"title": "Receta: pan?", "folder": "Casa/Cocina", "content": "Harina [[Ideas]] ñ"})
    r = client.get(f"{N}/export", headers=auth)
    assert r.status_code == 200 and r.headers["content-type"] == "application/zip" and ".zip" in r.headers["content-disposition"]
    z = zipfile.ZipFile(io.BytesIO(r.content))
    names = set(z.namelist())
    assert {"Bienvenido.md", "Ideas.md", "Casa/Cocina/Receta- pan-.md"} == names  # caracteres no válidos saneados
    assert z.read("Casa/Cocina/Receta- pan-.md").decode() == "Harina [[Ideas]] ñ"

    # importar el propio export sin sobrescribir: lo que ya existe se omite
    res = upload(client, auth, [("export.zip", r.content)]).json()
    assert res["created"] == 1 and res["skipped"] == 2 and res["errors"] == []  # «Receta- pan-» es un título nuevo


def test_import_obsidian_vault(client, auth):
    data = make_zip({
        "MiVault/.obsidian/app.json": "{}",
        "MiVault/.trash/Vieja.md": "x",
        "MiVault/Inicio.md": "---\ntags: [mapa]\n---\nVer [[Proyecto A]] y [[Ideas]]\n- [ ] revisar",
        "MiVault/Proyectos/Proyecto A.md": "Vuelve a [[Inicio]] #proyecto\r\nlínea",
        "MiVault/Proyectos/imagen.png": b"\x89PNG",
        "MiVault/Ideas.md": "contenido importado",
        "MiVault/Mal[nombre].md": "x",
    })
    res = upload(client, auth, [("vault.zip", data)]).json()
    assert res["created"] == 2 and res["skipped"] == 1 and res["updated"] == 0  # «Ideas» ya existía
    assert len(res["errors"]) == 1 and "Mal[nombre]" in res["errors"][0]

    a = client.get(f"{N}/by-title/Proyecto A", headers=auth).json()
    assert a["folder"] == "Proyectos" and a["content"] == "Vuelve a [[Inicio]] #proyecto\nlínea" and a["tags"] == ["proyecto"]
    assert [b["title"] for b in a["backlinks"]] == ["Inicio"]  # enlaces resueltos aunque Inicio se importó antes
    inicio = client.get(f"{N}/by-title/Inicio", headers=auth).json()
    assert inicio["folder"] == "" and inicio["tags"] == ["mapa"]  # carpeta raíz del zip descartada
    assert all(o["id"] for o in inicio["outgoing"])
    assert client.get(f"{N}/by-title/Ideas", headers=auth).json()["content"] != "contenido importado"
    assert client.get(f"{N}/by-title/Vieja", headers=auth).status_code == 404

    res = upload(client, auth, [("vault.zip", data)], overwrite=True).json()
    assert res["created"] == 0 and res["updated"] == 3
    assert client.get(f"{N}/by-title/Ideas", headers=auth).json()["content"] == "contenido importado"


def test_import_loose_files_and_rejections(client, auth):
    res = upload(client, auth, [("Suelta.md", "hola [[Otra]]".encode()), ("Otra.md", b"\xef\xbb\xbfcon BOM")]).json()
    assert res["created"] == 2
    assert client.get(f"{N}/by-title/Otra", headers=auth).json()["content"] == "con BOM"
    assert upload(client, auth, [("notas.txt", b"x")]).status_code == 400
    assert upload(client, auth, [("roto.zip", b"no soy un zip")]).status_code == 400
    assert upload(client, auth, [("vacio.zip", make_zip({"a.png": "x"}))]).status_code == 400
    big = make_zip({"Grande.md": "x" * 1_000_001, "Ok.md": "y"})
    res = upload(client, auth, [("big.zip", big)]).json()
    assert res["created"] == 1 and "supera 1 MB" in res["errors"][0]
    assert client.get(f"{N}/export").status_code == 401
