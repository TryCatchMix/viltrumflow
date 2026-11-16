import io
import zipfile
from pathlib import Path

from app.config import settings

from .conftest import make_user
from .test_vault import make_zip, upload as upload_vault

A, N = "/api/v1/attachments", "/api/v1/notes"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
JPG = b"\xff\xd8\xff\xe0" + b"\x00" * 64


def send(client, headers, name, data, **params):
    return client.post(A, headers=headers, params=params, files={"file": (name, data, "application/octet-stream")})


def stored_files():
    return [p for p in Path(settings.UPLOAD_DIR).rglob("*") if p.is_file()]


def test_upload_download_and_validation(client, auth):
    n = client.post(N, headers=auth, json={"title": "Con imagen"}).json()
    r = send(client, auth, "foto.png", PNG, note_id=n["id"])
    assert r.status_code == 201, r.text
    att = r.json()
    assert att["url"] == f"/api/v1/attachments/{att['id']}" and len(att["id"]) == 32

    got = client.get(att["url"], headers=auth)
    assert got.status_code == 200 and got.content == PNG
    assert got.headers["content-type"] == "image/png" and got.headers["x-content-type-options"] == "nosniff"

    # el tipo se decide por el contenido, no por el nombre ni por lo que diga el cliente
    assert send(client, auth, "falsa.png", b"<script>alert(1)</script>").status_code == 415
    assert send(client, auth, "dibujo.svg", b"<svg xmlns='http://www.w3.org/2000/svg'/>").status_code == 415
    renamed = send(client, auth, "../../etc/passwd", JPG)
    assert renamed.status_code == 201 and renamed.json()["filename"] == "passwd"
    assert client.get(renamed.json()["url"], headers=auth).headers["content-type"] == "image/jpeg"
    assert send(client, auth, "grande.png", PNG + b"\x00" * (settings.MAX_UPLOAD_MB * 1024 * 1024)).status_code == 413

    # privadas: sin sesión o con otra cuenta no existen
    bea, _ = make_user(client, "bea")
    assert client.get(att["url"]).status_code == 401
    assert client.get(att["url"], headers=bea).status_code == 404
    assert client.delete(att["url"], headers=bea).status_code == 404
    assert send(client, bea, "x.png", PNG, note_id=n["id"]).status_code == 400


def test_storage_quota(client, auth, monkeypatch):
    monkeypatch.setattr(settings, "USER_STORAGE_MB", 0)
    r = send(client, auth, "foto.png", PNG)
    assert r.status_code == 413 and "límite" in r.json()["detail"]


def test_files_are_removed_with_the_note(client, auth):
    before = len(stored_files())
    n = client.post(N, headers=auth, json={"title": "Temporal"}).json()
    att = send(client, auth, "a.png", PNG, note_id=n["id"]).json()
    loose = send(client, auth, "b.png", PNG).json()
    assert len(stored_files()) == before + 2

    client.delete(f"{N}/{n['id']}", headers=auth)  # a la papelera: la imagen se conserva
    assert client.get(att["url"], headers=auth).status_code == 200
    client.delete(f"/api/v1/trash/note/{n['id']}", headers=auth)  # borrado definitivo: fila y fichero
    assert client.get(att["url"], headers=auth).status_code == 404
    assert client.delete(loose["url"], headers=auth).status_code == 204
    assert len(stored_files()) == before


def test_export_and_import_with_images(client, auth):
    n = client.post(N, headers=auth, json={"title": "Viaje", "folder": "Diario/2026"}).json()
    att = send(client, auth, "playa.png", PNG, note_id=n["id"]).json()
    client.put(f"{N}/{n['id']}", headers=auth, json={"content": f"Mira:\n\n![playa]({att['url']})"})

    z = zipfile.ZipFile(io.BytesIO(client.get(f"{N}/export", headers=auth).content))
    name = f"adjuntos/{att['id']}.png"
    assert z.read(name) == PNG
    assert z.read("Diario/2026/Viaje.md").decode() == f"Mira:\n\n![playa](../../{name})"  # ruta relativa válida en Obsidian

    # vault de Obsidian con las tres formas habituales de enlazar una imagen
    vault = make_zip({
        "V/Notas/Receta.md": "![plato](../img/plato%20final.jpg) y ![[logo.png]] y ![[logo.png|100]]\n![web](https://example.com/x.png) ![[falta.png]]",
        "V/img/plato final.jpg": JPG,
        "V/adjuntos/logo.png": PNG,
        "V/adjuntos/sin-usar.png": PNG,
        "V/img/rota.png": b"no es una imagen",
        "V/Notas/Otra.md": "![x](../img/rota.png)",
    })
    before = len(stored_files())
    res = upload_vault(client, auth, [("vault.zip", vault)]).json()
    assert res["created"] == 2 and any("rota.png" in e for e in res["errors"])
    content = client.get(f"{N}/by-title/Receta", headers=auth).json()["content"]
    urls = [part.split(")")[0] for part in content.split("](")[1:]]
    assert urls[0].startswith("/api/v1/attachments/") and urls[1] == urls[2] and urls[1] != urls[0]
    assert urls[3] == "https://example.com/x.png" and "![[falta.png]]" in content  # lo externo y lo que falta se deja igual
    assert client.get(urls[0], headers=auth).content == JPG and client.get(urls[1], headers=auth).content == PNG
    assert len(stored_files()) == before + 2  # solo las imágenes referenciadas y válidas
    assert "../img/rota.png" in client.get(f"{N}/by-title/Otra", headers=auth).json()["content"]
