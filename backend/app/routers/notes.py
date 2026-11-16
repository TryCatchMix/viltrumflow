from collections import Counter
from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile
from sqlalchemy import or_
from sqlalchemy.orm import Session

from .. import schemas
from ..database import get_db
from ..deps import get_current_user
from ..models import Note, NoteLink, User
from ..services import markdown as md
from ..services import vault
from ..services.notes import find_by_title, free_title, resolve_dangling, sync_note_index, trash_note

router = APIRouter()

DAILY_FOLDER = "Diario"


def _get(db: Session, user: User, note_id: int) -> Note:
    n = db.get(Note, note_id)
    if not n or n.owner_id != user.id or n.deleted_at is not None:
        raise HTTPException(404, "Nota no encontrada")
    return n


def _detail(db: Session, note: Note) -> schemas.NoteOut:
    out = schemas.NoteOut.model_validate(note)
    backlinks = db.query(Note).join(NoteLink, NoteLink.source_id == Note.id).filter(
        NoteLink.target_id == note.id, Note.id != note.id
    ).order_by(Note.title).all()
    out.backlinks = [
        schemas.NoteRef(id=b.id, title=b.title, context=md.link_context(b.content, note.title)) for b in backlinks
    ]
    out.outgoing = [
        schemas.NoteRef(id=l.target_id, title=l.target.title if l.target else l.target_title) for l in note.links
    ]
    return out


@router.get("", response_model=List[schemas.NoteSummary])
def list_notes(
    q: Optional[str] = Query(None, max_length=200),
    tag: Optional[str] = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(Note).filter(Note.owner_id == user.id, Note.deleted_at.is_(None))
    if q and q.strip():
        like = f"%{q.strip()}%"
        query = query.filter(or_(Note.title.ilike(like), Note.content.ilike(like)))
    notes = query.order_by(Note.is_pinned.desc(), Note.updated_at.desc()).all()
    if tag:
        wanted = tag.lower().lstrip("#")
        # Etiquetas anidadas: #proyecto incluye #proyecto/web
        notes = [n for n in notes if any(t == wanted or t.startswith(wanted + "/") for t in n.tags.split(","))]
    out = []
    for n in notes:
        s = schemas.NoteSummary.model_validate(n)
        if q and q.strip():
            s.snippet = md.snippet(n.content, q.strip())
        out.append(s)
    return out


@router.post("", response_model=schemas.NoteOut, status_code=201)
def create_note(data: schemas.NoteCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if find_by_title(db, user.id, data.title):
        raise HTTPException(409, "Ya existe una nota con ese título")
    free_title(db, user.id, data.title)
    note = Note(**data.model_dump(), owner_id=user.id)
    db.add(note)
    db.flush()
    sync_note_index(db, note)
    resolve_dangling(db, note)
    db.commit()
    db.refresh(note)
    return _detail(db, note)


@router.post("/daily", response_model=schemas.NoteOut)
def daily_note(day: Optional[date] = None, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Devuelve (creándola si hace falta) la nota diaria del día indicado; la fecha la aporta el cliente."""
    title = (day or date.today()).isoformat()
    note = find_by_title(db, user.id, title)
    if not note:
        free_title(db, user.id, title)
        note = Note(title=title, folder=DAILY_FOLDER, is_daily=True, owner_id=user.id,
                    content=f"# {title}\n\n## Tareas\n- [ ] \n\n## Notas\n")
        db.add(note)
        db.flush()
        sync_note_index(db, note)
        resolve_dangling(db, note)
        db.commit()
        db.refresh(note)
    return _detail(db, note)


@router.get("/graph", response_model=schemas.Graph)
def graph(include_tags: bool = False, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    notes = db.query(Note).filter(Note.owner_id == user.id, Note.deleted_at.is_(None)).all()
    by_id = {n.id: n for n in notes}
    nodes = {f"n{n.id}": schemas.GraphNode(id=f"n{n.id}", label=n.title, kind="note", note_id=n.id, folder=n.folder) for n in notes}
    edges, seen = [], set()

    def add(src: str, dst: str, kind: str):
        if src == dst or (src, dst) in seen or (dst, src) in seen:
            return
        seen.add((src, dst))
        edges.append(schemas.GraphEdge(source=src, target=dst, kind=kind))
        nodes[src].degree += 1
        nodes[dst].degree += 1

    links = db.query(NoteLink).filter(NoteLink.source_id.in_(by_id.keys())).all() if by_id else []
    for l in links:
        if l.target_id in by_id:
            dst = f"n{l.target_id}"
        else:
            dst = "g:" + l.target_title.lower()
            nodes.setdefault(dst, schemas.GraphNode(id=dst, label=l.target_title, kind="ghost"))
        add(f"n{l.source_id}", dst, "link")
    if include_tags:
        for n in notes:
            for t in filter(None, n.tags.split(",")):
                tid = "t:" + t
                nodes.setdefault(tid, schemas.GraphNode(id=tid, label="#" + t, kind="tag"))
                add(f"n{n.id}", tid, "tag")
    return schemas.Graph(nodes=list(nodes.values()), edges=edges)


@router.get("/tags", response_model=List[schemas.TagCount])
def tags(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    counter = Counter()
    for (t,) in db.query(Note.tags).filter(Note.owner_id == user.id, Note.deleted_at.is_(None), Note.tags != ""):
        counter.update(filter(None, t.split(",")))
    return [schemas.TagCount(tag=t, count=c) for t, c in sorted(counter.items(), key=lambda x: (-x[1], x[0]))]


@router.get("/checklist", response_model=List[schemas.ChecklistItem])
def checklist(include_done: bool = True, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Todas las casillas `- [ ]` escritas en las notas."""
    out = []
    notes = db.query(Note).filter(Note.owner_id == user.id, Note.deleted_at.is_(None), Note.content.like("%[%]%")).order_by(Note.updated_at.desc())
    for n in notes:
        for line, text, checked in md.extract_checklist(n.content):
            if text and (include_done or not checked):
                out.append(schemas.ChecklistItem(note_id=n.id, note_title=n.title, line=line, text=text, checked=checked))
    return out


@router.get("/export")
def export_vault(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Descarga todas las notas como un zip de archivos .md en sus carpetas."""
    notes = db.query(Note).filter(Note.owner_id == user.id, Note.deleted_at.is_(None)).order_by(Note.folder, Note.title).all()
    name = f"viltrumflow-notas-{date.today().isoformat()}.zip"
    return Response(vault.export_zip(notes), media_type="application/zip",
                    headers={"Content-Disposition": f'attachment; filename="{name}"'})


@router.post("/import", response_model=schemas.ImportResult)
async def import_vault(
    files: List[UploadFile] = File(...), overwrite: bool = False,
    user: User = Depends(get_current_user), db: Session = Depends(get_db),
):
    """Importa un .zip (p. ej. un vault de Obsidian) o archivos .md sueltos. El título es el nombre del archivo."""
    entries, total = [], 0
    for f in files[:vault.MAX_FILES]:
        data = await f.read(vault.MAX_TOTAL_BYTES + 1)
        total += len(data)
        if total > vault.MAX_TOTAL_BYTES:
            raise HTTPException(413, "La subida supera el tamaño máximo (50 MB)")
        try:
            entries += vault.read_upload(f.filename or "", data)
        except ValueError as exc:
            raise HTTPException(400, str(exc))
    if not entries:
        raise HTTPException(400, "No se ha encontrado ninguna nota .md")
    return vault.import_notes(db, user, entries, overwrite)


@router.get("/by-title/{title:path}", response_model=schemas.NoteOut)
def get_by_title(title: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    note = find_by_title(db, user.id, title)
    if not note:
        raise HTTPException(404, "Nota no encontrada")
    return _detail(db, note)


@router.get("/{note_id}", response_model=schemas.NoteOut)
def get_note(note_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _detail(db, _get(db, user, note_id))


@router.put("/{note_id}", response_model=schemas.NoteOut)
def update_note(note_id: int, data: schemas.NoteUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    note = _get(db, user, note_id)
    values = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}
    new_title = values.get("title")
    renamed = new_title is not None and new_title != note.title
    if renamed:
        other = find_by_title(db, user.id, new_title)
        if other and other.id != note.id:
            raise HTTPException(409, "Ya existe una nota con ese título")
        free_title(db, user.id, new_title, keep_id=note.id)
    old_title = note.title
    for k, v in values.items():
        setattr(note, k, v)
    db.flush()
    if renamed:
        # Como Obsidian: al renombrar se actualizan los enlaces de las notas que apuntaban aquí
        sources = db.query(Note).join(NoteLink, NoteLink.source_id == Note.id).filter(NoteLink.target_id == note.id).all()
        for src in {s.id: s for s in sources}.values():
            src.content = md.rename_links(src.content, old_title, note.title)
            db.flush()
            sync_note_index(db, src)
        resolve_dangling(db, note)
    if "content" in values or renamed:
        sync_note_index(db, note)
    db.commit()
    db.refresh(note)
    return _detail(db, note)


@router.patch("/{note_id}/checklist", response_model=schemas.NoteOut)
def toggle_checklist(note_id: int, data: schemas.ChecklistToggle, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    note = _get(db, user, note_id)
    try:
        note.content = md.toggle_checkbox(note.content, data.line, data.checked)
    except ValueError as exc:
        raise HTTPException(409, str(exc))
    db.commit()
    db.refresh(note)
    return _detail(db, note)


@router.post("/{note_id}/checklist/convert", response_model=schemas.TaskOut, status_code=201)
def convert_checklist(note_id: int, data: schemas.ChecklistConvert, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Convierte una casilla de la nota en una tarea real enlazada a ella; la casilla pasa a ser una viñeta."""
    from . import tasks as tasks_router

    note = _get(db, user, note_id)
    try:
        content, text = md.convert_checkbox(note.content, data.line)
    except ValueError as exc:
        raise HTTPException(409, str(exc))
    task = tasks_router.create_task(
        schemas.TaskCreate(title=(data.title or text)[:200], due_date=data.due_date, all_day=data.all_day,
                           priority=data.priority, tags=data.tags, project_id=data.project_id, note_id=note.id),
        user, db,
    )
    note.content = content
    db.commit()
    return task


@router.delete("/{note_id}", status_code=204)
def delete_note(note_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Envía la nota a la papelera (se puede restaurar durante 30 días)."""
    trash_note(db, _get(db, user, note_id))
    db.commit()
