from sqlalchemy import func
from sqlalchemy.orm import Session

from ..models import Note, NoteLink
from . import markdown as md


def find_by_title(db: Session, owner_id: int, title: str):
    return db.query(Note).filter(Note.owner_id == owner_id, func.lower(Note.title) == title.lower()).first()


def sync_note_index(db: Session, note: Note) -> None:
    """Recalcula etiquetas y enlaces salientes de una nota a partir de su contenido."""
    note.tags = ",".join(md.extract_tags(note.content))[:1000]
    db.query(NoteLink).filter(NoteLink.source_id == note.id).delete()
    for title in md.extract_links(note.content):
        target = find_by_title(db, note.owner_id, title)
        db.add(NoteLink(source_id=note.id, target_id=target.id if target else None, target_title=title[:200]))


def resolve_dangling(db: Session, note: Note) -> None:
    """Al crear/renombrar una nota, los enlaces sin resolver que apuntan a su título pasan a apuntarle."""
    ids = [n.id for n in db.query(Note.id).filter(Note.owner_id == note.owner_id)]
    if not ids:
        return
    db.query(NoteLink).filter(
        NoteLink.source_id.in_(ids), NoteLink.target_id.is_(None),
        func.lower(NoteLink.target_title) == note.title.lower(),
    ).update({"target_id": note.id}, synchronize_session=False)
