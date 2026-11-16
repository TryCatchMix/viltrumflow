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
from ..services import notes as note_service
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
    values = data.model_dump(exclude={"template_id", "day", "time"})
    if data.template_id is not None:
        tpl = db.get(Note, data.template_id)
        if not tpl or tpl.owner_id != user.id or tpl.deleted_at is not None:
            raise HTTPException(400, "Plantilla no válida")
        values["content"] = note_service.render_template(
            tpl.content, data.title, data.day or date.today().isoformat(), data.time or "")
    note = Note(**values, owner_id=user.id)
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
        # Si existe una plantilla «Diario» en la carpeta Plantillas, la nota diaria se crea a partir de ella
        tpl = note_service.find_template(db, user.id, "Diario")
        content = note_service.render_template(tpl.content, title, title, "") if tpl else f"# {title}\n\n## Tareas\n- [ ] \n\n## Notas\n"
        note = Note(title=title, folder=DAILY_FOLDER, is_daily=True, owner_id=user.id, content=content)
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
    if not any(p.lower().endswith(".md") for p, _ in entries):
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
    if "content" in values and values["content"] != note.content:
        note_service.snapshot(db, note)  # la versión anterior queda en el historial
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


@router.get("/{note_id}/versions", response_model=List[schemas.NoteVersionOut])
def list_versions(note_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    note = _get(db, user, note_id)
    return [schemas.NoteVersionOut(id=v.id, title=v.title, created_at=v.created_at, size=len(v.content),
                                   preview=" ".join(v.content[:160].split())) for v in note.versions]


def _version(db: Session, user: User, note_id: int, version_id: int):
    note = _get(db, user, note_id)
    v = next((v for v in note.versions if v.id == version_id), None)
    if not v:
        raise HTTPException(404, "Versión no encontrada")
    return note, v


@router.get("/{note_id}/versions/{version_id}", response_model=schemas.NoteVersionDetail)
def get_version(note_id: int, version_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _, v = _version(db, user, note_id, version_id)
    return schemas.NoteVersionDetail(id=v.id, title=v.title, created_at=v.created_at, size=len(v.content), content=v.content)


@router.post("/{note_id}/versions/{version_id}/restore", response_model=schemas.NoteOut)
def restore_version(note_id: int, version_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Vuelve al contenido de esa versión. Lo que había se guarda antes como una versión más."""
    note, v = _version(db, user, note_id, version_id)
    content = v.content
    note_service.snapshot(db, note, force=True)
    note.content = content
    db.flush()
    sync_note_index(db, note)
    db.commit()
    db.refresh(note)
    return _detail(db, note)


@router.get("/{note_id}/mentions", response_model=List[schemas.MentionOut])
def unlinked_mentions(note_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Notas que nombran a esta en texto plano sin enlazarla."""
    note = _get(db, user, note_id)
    if len(note.title) < 3:
        return []  # títulos muy cortos coincidirían con cualquier cosa
    linked = {i for (i,) in db.query(NoteLink.source_id).filter(NoteLink.target_id == note.id)}
    candidates = db.query(Note).filter(
        Note.owner_id == user.id, Note.deleted_at.is_(None), Note.id != note.id, Note.content.ilike(f"%{note.title}%"),
    ).order_by(Note.title).all()
    out = []
    for c in candidates:
        found = None if c.id in linked else note_service.find_mention(c.content, note.title)
        if found:
            line = c.content.split("\n")[found[0]].strip()
            out.append(schemas.MentionOut(note_id=c.id, title=c.title, context=line if len(line) <= 160 else line[:159] + "…"))
    return out


@router.post("/{note_id}/mentions/{source_id}/link", response_model=schemas.NoteOut)
def link_mention(note_id: int, source_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Convierte en enlace la primera mención de esta nota dentro de otra. Devuelve esta nota actualizada."""
    note, source = _get(db, user, note_id), _get(db, user, source_id)
    content = note_service.link_mention(source.content, note.title)
    if content is None:
        raise HTTPException(409, "La mención ya no está en esa nota")
    note_service.snapshot(db, source, force=True)
    source.content = content
    db.flush()
    sync_note_index(db, source)
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
