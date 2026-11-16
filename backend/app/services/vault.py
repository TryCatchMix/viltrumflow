"""Exportación e importación del vault como archivos Markdown (compatible con Obsidian)."""
import io
import re
import zipfile
from pathlib import PurePosixPath
from typing import Iterable, List, Tuple

from sqlalchemy.orm import Session

from .. import schemas
from ..models import Note, User
from .notes import find_by_title, free_title, resolve_dangling, sync_note_index

MAX_FILES = 5000
MAX_NOTE_BYTES = 1_000_000
MAX_TOTAL_BYTES = 50_000_000
_UNSAFE = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def _safe(name: str) -> str:
    return _UNSAFE.sub("-", name).strip(" .") or "sin-titulo"


def export_zip(notes: Iterable[Note]) -> bytes:
    buf = io.BytesIO()
    used = set()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for n in notes:
            parts = [_safe(p) for p in n.folder.split("/") if p] + [_safe(n.title)]
            path, i = "/".join(parts), 1
            while path.lower() in used:  # títulos que solo difieren en caracteres no válidos
                i += 1
                path = "/".join(parts[:-1] + [f"{parts[-1]} ({i})"])
            used.add(path.lower())
            z.writestr(path + ".md", n.content)
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
            if info.is_dir() or not path.lower().endswith(".md") or any(p.startswith(".") or p == "__MACOSX" for p in parts):
                continue
            # Tamaño declarado antes de descomprimir: protege frente a bombas zip
            total += info.file_size
            if len(out) >= MAX_FILES or total > MAX_TOTAL_BYTES:
                raise ValueError(f"{filename}: demasiado contenido (máx. {MAX_FILES} notas y {MAX_TOTAL_BYTES // 1_000_000} MB)")
            if info.file_size > MAX_NOTE_BYTES:
                out.append((path, None))
                continue
            out.append((path, z.read(info)))
    return out


def import_notes(db: Session, user: User, files: List[Tuple[str, bytes]], overwrite: bool) -> schemas.ImportResult:
    res = schemas.ImportResult()
    touched: List[Note] = []
    # Si todo cuelga de una única carpeta raíz (lo habitual al comprimir un vault), se descarta
    roots = {p.split("/")[0] for p, _ in files if "/" in p}
    strip = len(roots) == 1 and all("/" in p for p, _ in files)
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
            note.content, note.folder = content, folder
            res.updated += 1
        else:
            free_title(db, user.id, title)
            note = Note(title=title, content=content, folder=folder, owner_id=user.id)
            db.add(note)
            res.created += 1
        db.flush()
        touched.append(note)
    # Segunda pasada: con todas las notas ya creadas, los enlaces se resuelven sin importar el orden
    for note in touched:
        sync_note_index(db, note)
        resolve_dangling(db, note)
    db.commit()
    res.errors = res.errors[:50]
    return res
