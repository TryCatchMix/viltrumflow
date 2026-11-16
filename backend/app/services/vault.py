"""Exportación e importación del vault como archivos Markdown (compatible con Obsidian)."""
import io
import re
import zipfile
from pathlib import PurePosixPath
from urllib.parse import unquote
from typing import Iterable, List, Tuple

from sqlalchemy.orm import Session

from .. import schemas
from ..config import settings
from ..models import Attachment, Note, User
from . import files as store_files
from .files import IMAGE_SUFFIXES
from .notes import find_by_title, free_title, resolve_dangling, snapshot, sync_note_index

MAX_FILES = 5000
MAX_NOTE_BYTES = 1_000_000
MAX_TOTAL_BYTES = 50_000_000
_UNSAFE = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def _safe(name: str) -> str:
    return _UNSAFE.sub("-", name).strip(" .") or "sin-titulo"


ATTACH_DIR = "adjuntos"
_ATTACH_URL = re.compile(r"\(" + re.escape(store_files.URL_PREFIX) + r"([0-9a-f]{32})\)")
_MD_IMAGE = re.compile(r"!\[([^\]\n]*)\]\(([^)\s]+)(?:\s+\"[^\"\n]*\")?\)")
_EMBED = re.compile(r"!\[\[([^\[\]|\n]+)(?:\|[^\[\]\n]*)?\]\]")


def export_zip(notes: Iterable[Note]) -> bytes:
    buf = io.BytesIO()
    used = set()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        exported = set()
        for n in notes:
            atts = {a.id: a for a in n.attachments}
            depth = len([p for p in n.folder.split("/") if p])

            def link(m: re.Match) -> str:
                """Enlace interno → ruta relativa dentro del zip, para que la imagen se vea en Obsidian."""
                a = atts.get(m.group(1))
                if not a or not store_files.path_for(a).is_file():
                    return m.group(0)
                name = f"{ATTACH_DIR}/{a.id}.{store_files.EXTENSIONS[a.content_type]}"
                if a.id not in exported:
                    exported.add(a.id)
                    z.write(store_files.path_for(a), name)
                return f"({'../' * depth}{name})"

            content = _ATTACH_URL.sub(link, n.content)
            parts = [_safe(p) for p in n.folder.split("/") if p] + [_safe(n.title)]
            path, i = "/".join(parts), 1
            while path.lower() in used:  # títulos que solo difieren en caracteres no válidos
                i += 1
                path = "/".join(parts[:-1] + [f"{parts[-1]} ({i})"])
            used.add(path.lower())
            z.writestr(path + ".md", content)
    return buf.getvalue()


def read_upload(filename: str, data: bytes) -> List[Tuple[str, bytes]]:
    """Devuelve (ruta, contenido) de cada nota de un .zip o de un .md suelto. Lanza ValueError si no es válido."""
    if filename.lower().endswith(".md"):
        return [(PurePosixPath(filename.replace("\\", "/")).name, data)]
    if not filename.lower().endswith(".zip"):
        raise ValueError(f"{filename}: solo se admiten archivos .zip o .md")
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise ValueError(f"{filename}: no es un zip válido")
    out, total = [], 0
    with z:
        for info in z.infolist():
            path = info.filename.replace("\\", "/")
            parts = [p for p in path.split("/") if p]
            # Se ignoran carpetas, lo que no sea Markdown y los directorios ocultos (.obsidian, .trash…)
            is_image = path.lower().endswith(IMAGE_SUFFIXES)
            if info.is_dir() or not (path.lower().endswith(".md") or is_image) or any(p.startswith(".") or p == "__MACOSX" for p in parts):
                continue
            # Tamaño declarado antes de descomprimir: protege frente a bombas zip
            total += info.file_size
            if len(out) >= MAX_FILES or total > MAX_TOTAL_BYTES:
                raise ValueError(f"{filename}: demasiado contenido (máx. {MAX_FILES} notas y {MAX_TOTAL_BYTES // 1_000_000} MB)")
            if info.file_size > (settings.MAX_UPLOAD_MB * 1024 * 1024 if is_image else MAX_NOTE_BYTES):
                out.append((path, None))
                continue
            out.append((path, z.read(info)))
    return out


def _import_images(db: Session, user: User, pending: List[Tuple[Note, str]], images: dict, res: schemas.ImportResult) -> None:
    """Sube las imágenes del zip que las notas referencian y reescribe sus enlaces (`![](ruta)` y `![[imagen]]`)."""
    if not images:
        return
    by_name = {}
    for p in images:
        by_name.setdefault(PurePosixPath(p).name.lower(), p)
    stored: dict = {}

    def resolve(note: Note, base: PurePosixPath, ref: str):
        ref = unquote(ref.split("#")[0].split("?")[0])
        if "://" in ref or ref.startswith(("/", "data:")):
            return None
        parts: List[str] = []
        for part in [*base.parts, *PurePosixPath(ref).parts]:  # normaliza «..» sin salir del zip
            if part == "..":
                if parts:
                    parts.pop()
            elif part != ".":
                parts.append(part)
        path = "/".join(parts)
        if path not in images:
            path = by_name.get(PurePosixPath(ref).name.lower())  # Obsidian enlaza por nombre, esté donde esté
        if not path:
            return None
        key = (note.id, path)
        if key not in stored:
            data = images[path]
            try:
                if data is None:
                    raise store_files.UploadError(f"supera {settings.MAX_UPLOAD_MB} MB")
                stored[key] = store_files.url_for(store_files.store(db, user.id, path, data, note.id))
                db.flush()
            except store_files.UploadError as exc:
                stored[key] = None
                res.errors.append(f"{path}: {exc}")
        return stored[key]

    for note, path in pending:
        base = PurePosixPath(path).parent

        def md_image(m: re.Match) -> str:
            url = resolve(note, base, m.group(2))
            return f"![{m.group(1)}]({url})" if url else m.group(0)

        def embed(m: re.Match) -> str:
            name = m.group(1).strip()
            url = resolve(note, base, name) if name.lower().endswith(IMAGE_SUFFIXES) else None
            return f"![{PurePosixPath(name).name}]({url})" if url else m.group(0)

        note.content = _EMBED.sub(embed, _MD_IMAGE.sub(md_image, note.content))


def import_notes(db: Session, user: User, files: List[Tuple[str, bytes]], overwrite: bool) -> schemas.ImportResult:
    res = schemas.ImportResult()
    touched: List[Note] = []
    # Si todo cuelga de una única carpeta raíz (lo habitual al comprimir un vault), se descarta
    roots = {p.split("/")[0] for p, _ in files if "/" in p}
    strip = len(roots) == 1 and all("/" in p for p, _ in files)
    images = {p: d for p, d in files if p.lower().endswith(IMAGE_SUFFIXES)}
    files = [(p, d) for p, d in files if p not in images]
    pending: List[Tuple[Note, str]] = []  # (nota, ruta dentro del zip) para enlazar sus imágenes
    for path, data in files:
        p = PurePosixPath(path)
        folder = "/".join(p.parts[(1 if strip else 0):-1])
        if data is None:
            res.errors.append(f"{path}: supera 1 MB")
            continue
        try:
            title = schemas._clean_title(p.stem)[:200]
            folder = schemas._clean_folder(folder)[:300]
        except ValueError as exc:
            res.errors.append(f"{path}: {exc}")
            continue
        content = data.decode("utf-8-sig", errors="replace").replace("\r\n", "\n")
        note = find_by_title(db, user.id, title)
        if note and not overwrite:
            res.skipped += 1
            continue
        if note:
            if note.content != content:
                snapshot(db, note, force=True)  # sobrescribir no debe perder lo que había
            note.content, note.folder = content, folder
            res.updated += 1
        else:
            free_title(db, user.id, title)
            note = Note(title=title, content=content, folder=folder, owner_id=user.id)
            db.add(note)
            res.created += 1
        db.flush()
        touched.append(note)
        pending.append((note, path))
    _import_images(db, user, pending, images, res)
    # Segunda pasada: con todas las notas ya creadas, los enlaces se resuelven sin importar el orden
    for note in touched:
        sync_note_index(db, note)
        resolve_dangling(db, note)
    db.commit()
    res.errors = res.errors[:50]
    return res
