from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session, selectinload

from .. import schemas
from ..database import get_db
from ..deps import get_current_user
from ..models import Comment, Note, Priority, Project, Status, Task, User
from ..services import google_calendar as gcal
from ..services.recurrence import spawn_next

router = APIRouter()

SYNC_FIELDS = {"title", "description", "due_date", "all_day", "status"}


def _get(db: Session, user: User, task_id: int) -> Task:
    t = db.get(Task, task_id)
    if not t or t.user_id != user.id:
        raise HTTPException(404, "Tarea no encontrada")
    return t


def _check_refs(db: Session, user: User, project_id=None, parent_task_id=None, note_id=None) -> None:
    """Las referencias deben pertenecer al usuario: evita enlazar recursos ajenos por id."""
    if project_id is not None:
        p = db.get(Project, project_id)
        if not p or p.owner_id != user.id:
            raise HTTPException(400, "Proyecto no válido")
    if parent_task_id is not None:
        parent = db.get(Task, parent_task_id)
        if not parent or parent.user_id != user.id:
            raise HTTPException(400, "Tarea padre no válida")
        if parent.parent_task_id is not None:
            raise HTTPException(400, "Solo se admite un nivel de subtareas")
    if note_id is not None:
        n = db.get(Note, note_id)
        if not n or n.owner_id != user.id:
            raise HTTPException(400, "Nota no válida")


def _tags(tags: List[str]) -> str:
    clean, seen = [], set()
    for t in tags:
        t = t.strip().lstrip("#").replace(",", " ").lower()
        if t and t not in seen:
            seen.add(t)
            clean.append(t)
    return ",".join(clean)[:500]


def _after_complete(db: Session, user: User, task: Task) -> None:
    """Si es recurrente, crea la siguiente ocurrencia y la envía al calendario."""
    nxt = spawn_next(db, task)
    if nxt:
        gcal.auto_sync(db, user, nxt)


def _apply_status(task: Task, status: Status) -> None:
    if status == Status.COMPLETED and task.status != Status.COMPLETED:
        task.completed_at = datetime.now(timezone.utc)
    elif status != Status.COMPLETED:
        task.completed_at = None
    task.status = status


@router.get("", response_model=List[schemas.TaskOut])
def list_tasks(
    status: Optional[Status] = None,
    priority: Optional[Priority] = None,
    project_id: Optional[int] = None,
    tag: Optional[str] = None,
    q: Optional[str] = Query(None, max_length=200),
    due_from: Optional[datetime] = None,
    due_to: Optional[datetime] = None,
    include_archived: bool = False,
    skip: int = Query(0, ge=0),
    limit: int = Query(500, ge=1, le=1000),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Tareas de primer nivel del usuario (las subtareas van anidadas)."""
    query = db.query(Task).options(selectinload(Task.subtasks)).filter(
        Task.user_id == user.id, Task.parent_task_id.is_(None)
    )
    if status:
        query = query.filter(Task.status == status)
    elif not include_archived:
        query = query.filter(Task.status != Status.ARCHIVED)
    if priority:
        query = query.filter(Task.priority == priority)
    if project_id is not None:
        query = query.filter(Task.project_id == project_id)
    if q:
        like = f"%{q.strip()}%"
        query = query.filter(or_(Task.title.ilike(like), Task.description.ilike(like), Task.tags.ilike(like)))
    if due_from:
        query = query.filter(Task.due_date >= due_from)
    if due_to:
        query = query.filter(Task.due_date < due_to)
    tasks = query.order_by(Task.position, Task.created_at.desc()).all()
    if tag:
        wanted = tag.lower().lstrip("#")
        tasks = [t for t in tasks if wanted in t.tags.split(",")]
    return tasks[skip : skip + limit]


@router.post("", response_model=schemas.TaskOut, status_code=201)
def create_task(data: schemas.TaskCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _check_refs(db, user, data.project_id, data.parent_task_id, data.note_id)
    values = data.model_dump(exclude={"tags", "status"})
    task = Task(**values, tags=_tags(data.tags), user_id=user.id, status=Status.TODO)
    _apply_status(task, data.status)
    # Las nuevas van al principio de su columna
    first = db.query(Task.position).filter(Task.user_id == user.id, Task.status == data.status).order_by(Task.position).first()
    task.position = (first[0] - 1) if first else 0
    if task.parent_task_id is not None:
        task.recurrence, task.reminder_minutes = "none", None
    db.add(task)
    db.commit()
    db.refresh(task)
    gcal.auto_sync(db, user, task)
    _after_complete(db, user, task)
    return task


@router.get("/{task_id}", response_model=schemas.TaskOut)
def get_task(task_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _get(db, user, task_id)


@router.put("/{task_id}", response_model=schemas.TaskOut)
def update_task(task_id: int, data: schemas.TaskUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Actualización parcial. Enviar `null` en due_date, project_id, note_id, description o estimated_hours los vacía."""
    task = _get(db, user, task_id)
    values = data.model_dump(exclude_unset=True)
    _check_refs(db, user, values.get("project_id"), None, values.get("note_id"))
    nullable = {"due_date", "project_id", "note_id", "description", "estimated_hours", "reminder_minutes"}
    changed = set()
    for k, v in values.items():
        if v is None and k not in nullable:
            continue
        if k == "status":
            if v != task.status:
                changed.add(k)
            _apply_status(task, v)
            continue
        if k == "tags":
            v = _tags(v)
        if getattr(task, k) != v:
            changed.add(k)
        setattr(task, k, v)
    if changed & {"due_date", "all_day", "reminder_minutes"}:
        # Cambió cuándo toca avisar: el recordatorio vuelve a estar pendiente
        task.reminder_sent_at = task.reminder_emailed_at = None
    db.commit()
    db.refresh(task)
    if changed & SYNC_FIELDS:
        gcal.auto_sync(db, user, task)
    if "status" in changed:
        _after_complete(db, user, task)
    return task


@router.patch("/{task_id}/move", response_model=schemas.TaskOut)
def move_task(task_id: int, data: schemas.TaskMove, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Mueve una tarea a una columna/posición del tablero y renumera esa columna."""
    task = _get(db, user, task_id)
    was_done = task.status == Status.COMPLETED
    _apply_status(task, data.status)
    column = db.query(Task).filter(
        Task.user_id == user.id, Task.parent_task_id.is_(None), Task.status == data.status, Task.id != task.id
    ).order_by(Task.position, Task.created_at.desc()).all()
    column.insert(min(data.position, len(column)), task)
    for i, t in enumerate(column):
        t.position = i
    db.commit()
    db.refresh(task)
    if was_done != (task.status == Status.COMPLETED) or task.status == Status.ARCHIVED:
        gcal.auto_sync(db, user, task)
    if not was_done:
        _after_complete(db, user, task)
    return task


@router.delete("/{task_id}", status_code=204)
def delete_task(task_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    task = _get(db, user, task_id)
    event_ids = [task.google_event_id] if task.google_event_id else []
    db.delete(task)
    db.commit()
    gcal.auto_delete(db, user, event_ids)


# ---------- Comentarios ----------
def _comment_out(c: Comment) -> schemas.CommentOut:
    o = schemas.CommentOut.model_validate(c)
    o.author_name = c.author.full_name or c.author.username
    return o


@router.get("/{task_id}/comments", response_model=List[schemas.CommentOut])
def list_comments(task_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return [_comment_out(c) for c in _get(db, user, task_id).comments]


@router.post("/{task_id}/comments", response_model=schemas.CommentOut, status_code=201)
def add_comment(task_id: int, data: schemas.CommentCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    task = _get(db, user, task_id)
    c = Comment(content=data.content, task_id=task.id, author_id=user.id)
    db.add(c)
    db.commit()
    db.refresh(c)
    return _comment_out(c)


@router.delete("/{task_id}/comments/{comment_id}", status_code=204)
def delete_comment(task_id: int, comment_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    task = _get(db, user, task_id)
    c = db.get(Comment, comment_id)
    if not c or c.task_id != task.id:
        raise HTTPException(404, "Comentario no encontrado")
    db.delete(c)
    db.commit()
