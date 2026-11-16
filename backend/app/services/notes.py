import re
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..models import Note, NoteLink
from . import markdown as md


def find_by_title(db: Session, owner_id: int, title: str) -> Optional[Note]:
    """Nota viva (no en la papelera) con ese título, sin distinguir mayúsculas."""
    return db.query(Note).filter(
        Note.owner_id == owner_id, Note.deleted_at.is_(None), func.lower(Note.title) == title.lower()
    ).first()


def _unique_title(db: Session, owner_id: int, base: str, suffix: str, keep_id: Optional[int] = None) -> str:
    """`base (suffix)`, `base (suffix 2)`… hasta dar con un título que no use ninguna nota, viva o no."""
    i = 1
    while True:
        title = f"{base[:170]} ({suffix}{'' if i == 1 else f' {i}'})"
        q = db.query(Note.id).filter(Note.owner_id == owner_id, func.lower(Note.title) == title.lower())
        if keep_id is not None:
            q = q.filter(Note.id != keep_id)
        if not q.first():
            return title
        i += 1


def free_title(db: Session, owner_id: int, title: str, keep_id: Optional[int] = None) -> None:
    """
    El título es único por usuario en la base de datos, también para las notas de la papelera.
    Antes de usar un título, las notas en la papelera que lo ocupan se renombran para dejarlo libre.
    """
    q = db.query(Note).filter(Note.owner_id == owner_id, Note.deleted_at.isnot(None), func.lower(Note.title) == title.lower())
    for trashed in q.all():
        if trashed.id != keep_id:
            trashed.title = _unique_title(db, owner_id, trashed.title, "papelera", trashed.id)
    db.flush()


def sync_note_index(db: Session, note: Note) -> None:
    """Recalcula etiquetas y enlaces salientes de una nota a partir de su contenido."""
    note.tags = ",".join(md.extract_tags(note.content))[:1000]
    db.query(NoteLink).filter(NoteLink.source_id == note.id).delete()
    for title in md.extract_links(note.content):
        target = find_by_title(db, note.owner_id, title)
        db.add(NoteLink(source_id=note.id, target_id=target.id if target else None, target_title=title[:200]))


def resolve_dangling(db: Session, note: Note) -> None:
    """Al crear/renombrar/restaurar una nota, los enlaces sin resolver que apuntan a su título pasan a apuntarle."""
    ids = [n.id for n in db.query(Note.id).filter(Note.owner_id == note.owner_id, Note.deleted_at.is_(None))]
    if not ids:
        return
    db.query(NoteLink).filter(
        NoteLink.source_id.in_(ids), NoteLink.target_id.is_(None),
        func.lower(NoteLink.target_title) == note.title.lower(),
    ).update({"target_id": note.id}, synchronize_session=False)


def trash_note(db: Session, note: Note) -> None:
    """Papelera: la nota desaparece del vault y del grafo; los enlaces que apuntaban a ella quedan sin resolver."""
    note.deleted_at = datetime.now(timezone.utc)
    note.is_pinned = False
    db.query(NoteLink).filter(NoteLink.target_id == note.id).update({"target_id": None})
    db.query(NoteLink).filter(NoteLink.source_id == note.id).delete()
    db.flush()


def restore_note(db: Session, note: Note) -> None:
    # Recupera su título original si sigue libre; si mientras tanto se creó otra con ese título, se distingue
    original = re.sub(r" \(papelera( \d+)?\)$", "", note.title)
    if find_by_title(db, note.owner_id, original):
        note.title = _unique_title(db, note.owner_id, original, "restaurada", note.id)
    else:
        free_title(db, note.owner_id, original, keep_id=note.id)
        note.title = original
    note.deleted_at = None
    db.flush()
    sync_note_index(db, note)
    resolve_dangling(db, note)


# ---------- Historial de versiones ----------
VERSION_INTERVAL = timedelta(minutes=10)
MAX_VERSIONS = 50


def snapshot(db: Session, note: Note, force: bool = False) -> None:
    """
    Guarda el contenido actual antes de cambiarlo. Con el autoguardado habría una versión por pulsación,
    así que solo se guarda una cada 10 minutos (o siempre con `force`, antes de restaurar o sobrescribir).
    """
    from ..models import NoteVersion

    last = db.query(NoteVersion).filter(NoteVersion.note_id == note.id).order_by(NoteVersion.created_at.desc()).first()
    if last:
        if last.content == note.content:
            return
        created = last.created_at if last.created_at.tzinfo else last.created_at.replace(tzinfo=timezone.utc)
        if not force and datetime.now(timezone.utc) - created < VERSION_INTERVAL:
            return
    elif not note.content.strip():
        return  # nota recién creada y vacía: no hay nada que conservar
    db.add(NoteVersion(note_id=note.id, title=note.title, content=note.content))
    db.flush()
    old = db.query(NoteVersion.id).filter(NoteVersion.note_id == note.id).order_by(NoteVersion.created_at.desc(), NoteVersion.id.desc()).offset(MAX_VERSIONS).all()
    if old:
        db.query(NoteVersion).filter(NoteVersion.id.in_([i for (i,) in old])).delete(synchronize_session=False)


# ---------- Plantillas ----------
TEMPLATE_FOLDER = "Plantillas"


def render_template(content: str, title: str, day: str, time: str) -> str:
    """Sustituye {{title}}, {{date}} y {{time}} (y sus nombres en español)."""
    values = {"title": title, "titulo": title, "título": title, "date": day, "fecha": day, "time": time, "hora": time}
    return re.sub(r"\{\{\s*([a-zA-Záéíóúñ]+)\s*\}\}", lambda m: values.get(m.group(1).lower(), m.group(0)), content)


def find_template(db: Session, owner_id: int, name: str) -> Optional[Note]:
    note = find_by_title(db, owner_id, name)
    return note if note and note.folder.split("/")[0].lower() == TEMPLATE_FOLDER.lower() else None


# ---------- Menciones sin enlazar ----------
def _mention_re(title: str) -> "re.Pattern":
    # Palabra completa, sin distinguir mayúsculas (\w de Python entiende tildes y ñ)
    return re.compile(r"(?<![\w\[])" + re.escape(title) + r"(?![\w\]])", re.IGNORECASE)


def _mask(line: str) -> str:
    """Deja en blanco (misma longitud) lo que no cuenta como texto: enlaces, código en línea y URLs."""
    for pattern in (md.WIKILINK, re.compile(r"`[^`\n]*`"), re.compile(r"\]\([^)\n]*\)"), re.compile(r"https?://\S+")):
        line = pattern.sub(lambda m: " " * len(m.group(0)), line)
    return line


def find_mention(content: str, title: str):
    """(nº de línea, inicio, fin) de la primera mención en texto plano del título, o None."""
    pattern = _mention_re(title)
    lines = content.split("\n")
    for i, _ in md.prose_lines(content):
        m = pattern.search(_mask(lines[i]))
        if m:
            return i, m.start(), m.end()
    return None


def link_mention(content: str, title: str) -> Optional[str]:
    """Convierte la primera mención en un enlace; conserva el texto original como alias si difiere del título."""
    found = find_mention(content, title)
    if not found:
        return None
    i, start, end = found
    lines = content.split("\n")
    text = lines[i][start:end]
    link = f"[[{title}]]" if text == title else f"[[{title}|{text}]]"
    lines[i] = lines[i][:start] + link + lines[i][end:]
    return "\n".join(lines)
