import re
from datetime import datetime, timezone
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
