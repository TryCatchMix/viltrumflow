from datetime import datetime, timezone
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session, selectinload

from .. import schemas
from ..database import get_db
from ..deps import get_current_user
from ..models import Comment, Note, Priority, Status, Task, User
from ..services import access, mailer
from ..services import google_calendar as gcal
from ..services.recurrence import spawn_next

router = APIRouter()

SYNC_FIELDS = {"title", "description", "due_date", "all_day", "status"}


def display_name(u: Optional[User]) -> str:
    return (u.full_name or u.username) if u else ""


def _out(db: Session, user: User, task: Task, roles: Optional[Dict[int, str]] = None) -> schemas.TaskOut:
    o = schemas.TaskOut.model_validate(task)
    o.owner_name = display_name(task.owner)
    o.assignee_name = display_name(task.assignee) or None
    o.can_edit = access.can_edit(db, user, task, roles)
    if task.note_id and task.note and task.note.owner_id == user.id and task.note.deleted_at is None:
        o.note_title = task.note.title
    else:
        o.note_id = None  # las notas son privadas: no se expone ni su id a otros miembros
    return o


def _get(db: Session, user: User, task_id: int, write: bool = False) -> Task:
    """404 si no existe o no puede verla (no se revela su existencia); 403 si puede verla pero no editarla."""
    t = db.get(Task, task_id)
    if not t or t.deleted_at is not None or not access.can_view(db, user, t):
        raise HTTPException(404, "Tarea no encontrada")
    if write and not access.can_edit(db, user, t):
        raise HTTPException(403, "Solo tienes permiso de lectura en este proyecto")
    return t


def _require_editor(db: Session, user: User, project_id: Optional[int]) -> None:
    if project_id is None:
        return
    role = access.project_role(db, user, project_id)
    if role is None:
        raise HTTPException(400, "Proyecto no válido")
    if role == access.VIEWER:
        raise HTTPException(403, "Solo tienes permiso de lectura en este proyecto")


def _check_note(db: Session, user: User, note_id: Optional[int]) -> None:
    if note_id is not None:
        n = db.get(Note, note_id)
        if not n or n.owner_id != user.id or n.deleted_at is not None:
            raise HTTPException(400, "Nota no válida")


def _check_assignee(db: Session, user: User, project_id: Optional[int], assignee_id: Optional[int]) -> None:
    """Solo se asigna a quien participa en el proyecto; fuera de un proyecto, solo a uno mismo."""
    if assignee_id is None:
        return
    ok = access.is_participant(db, project_id, assignee_id) if project_id is not None else assignee_id == user.id
    if not ok:
        raise HTTPException(400, "Solo puedes asignar la tarea a alguien con acceso al proyecto")


def _tags(tags: List[str]) -> str:
    clean, seen = [], set()
    for t in tags:
        t = t.strip().lstrip("#").replace(",", " ").lower()
        if t and t not in seen:
            seen.add(t)
            clean.append(t)
    return ",".join(clean)[:500]


def _after_complete(db: Session, task: Task) -> None:
    """Si es recurrente, crea la siguiente ocurrencia y la envía al calendario."""
    nxt = spawn_next(db, task)
    if nxt:
        gcal.auto_sync(db, nxt.owner, nxt)


def _apply_status(task: Task, status: Status) -> None:
    if status == Status.COMPLETED and task.status != Status.COMPLETED:
        task.completed_at = datetime.now(timezone.utc)
        if task.timer_started_at:  # una tarea terminada no sigue contando tiempo
            started = task.timer_started_at if task.timer_started_at.tzinfo else task.timer_started_at.replace(tzinfo=timezone.utc)
            task.time_spent_seconds = (task.time_spent_seconds or 0) + max(0, int((task.completed_at - started).total_seconds()))
            task.timer_started_at = None
    elif status != Status.COMPLETED:
        task.completed_at = None
    task.status = status


def _notify_assignment(db: Session, actor: User, task: Task) -> None:
    """Avisa por email al nuevo responsable (el aviso en la app llega por /reminders/poll)."""
    a = task.assignee
    if not a or a.id == actor.id:
        task.assigned_notified_at = datetime.now(timezone.utc)  # asignarse a uno mismo no genera aviso
        db.commit()
        return
    task.assigned_notified_at = None
    db.commit()
    if a.email_reminders:
        who = display_name(actor)
        text, html = mailer.render(f"{who} te ha asignado una tarea", [(task.project.name if task.project else "Tarea", [task.title])])
        mailer.send_email(a.email, f"Nueva tarea asignada: {task.title}", text, html)


@router.get("", response_model=List[schemas.TaskOut])
def list_tasks(
    status: Optional[Status] = None,
    priority: Optional[Priority] = None,
    project_id: Optional[int] = None,
    tag: Optional[str] = None,
    q: Optional[str] = Query(None, max_length=200),
    due_from: Optional[datetime] = None,
    due_to: Optional[datetime] = None,
    assigned_to_me: bool = False,
    note_id: Optional[int] = None,
    include_archived: bool = False,
    skip: int = Query(0, ge=0),
    limit: int = Query(500, ge=1, le=1000),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Tareas de primer nivel visibles: las propias y las de los proyectos compartidos (subtareas anidadas)."""
    roles = access.project_roles(db, user)
    query = db.query(Task).options(selectinload(Task.subtasks), selectinload(Task.owner), selectinload(Task.assignee)).filter(
        access.visible_tasks(db, user, roles), Task.parent_task_id.is_(None), Task.deleted_at.is_(None)
    )
    if status:
        query = query.filter(Task.status == status)
    elif not include_archived:
        query = query.filter(Task.status != Status.ARCHIVED)
    if priority:
        query = query.filter(Task.priority == priority)
    if project_id is not None:
        query = query.filter(Task.project_id == project_id)
    if note_id is not None:
        query = query.filter(Task.note_id == note_id, Task.user_id == user.id)
    if assigned_to_me:
        query = query.filter(Task.assignee_id == user.id)
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
    return [_out(db, user, t, roles) for t in tasks[skip : skip + limit]]


@router.post("", response_model=schemas.TaskOut, status_code=201)
def create_task(data: schemas.TaskCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    project_id = data.project_id
    if data.parent_task_id is not None:
        parent = db.get(Task, data.parent_task_id)
        if not parent or parent.deleted_at is not None or not access.can_view(db, user, parent):
            raise HTTPException(400, "Tarea padre no válida")
        if parent.parent_task_id is not None:
            raise HTTPException(400, "Solo se admite un nivel de subtareas")
        if not access.can_edit(db, user, parent):
            raise HTTPException(403, "Solo tienes permiso de lectura en este proyecto")
        project_id = None  # la subtarea hereda el proyecto de su padre
    _require_editor(db, user, project_id)
    _check_note(db, user, data.note_id)
    _check_assignee(db, user, project_id, data.assignee_id)

    values = data.model_dump(exclude={"tags", "status", "project_id"})
    task = Task(**values, project_id=project_id, tags=_tags(data.tags), user_id=user.id, status=Status.TODO)
    _apply_status(task, data.status)
    # Las nuevas van al principio de su columna
    first = db.query(Task.position).filter(Task.user_id == user.id, Task.status == data.status).order_by(Task.position).first()
    task.position = (first[0] - 1) if first else 0
    if task.parent_task_id is not None:
        task.recurrence, task.reminder_minutes, task.assignee_id = "none", None, None
    db.add(task)
    db.commit()
    db.refresh(task)
    if task.assignee_id:
        _notify_assignment(db, user, task)
    gcal.auto_sync(db, task.owner, task)
    _after_complete(db, task)
    return _out(db, user, task)


@router.get("/{task_id}", response_model=schemas.TaskOut)
def get_task(task_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _out(db, user, _get(db, user, task_id))


@router.put("/{task_id}", response_model=schemas.TaskOut)
def update_task(task_id: int, data: schemas.TaskUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Actualización parcial. Enviar `null` en due_date, project_id, note_id, description, estimated_hours,
    reminder_minutes o assignee_id los vacía."""
    task = _get(db, user, task_id, write=True)
    values = data.model_dump(exclude_unset=True)
    if "project_id" in values and values["project_id"] != task.project_id:
        if task.parent_task_id is not None:
            raise HTTPException(400, "Una subtarea no puede cambiar de proyecto")
        _require_editor(db, user, values["project_id"])
    _check_note(db, user, values.get("note_id"))
    new_project = values.get("project_id", task.project_id)
    if "assignee_id" in values:
        _check_assignee(db, user, new_project, values["assignee_id"])
    elif task.assignee_id and new_project != task.project_id and not (
        new_project is not None and access.is_participant(db, new_project, task.assignee_id)
    ):
        values["assignee_id"] = None  # el responsable no tiene acceso al nuevo proyecto

    nullable = {"due_date", "project_id", "note_id", "description", "estimated_hours", "reminder_minutes", "assignee_id"}
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
    if changed & {"due_date", "all_day", "reminder_minutes", "assignee_id"}:
        # Cambió cuándo o a quién toca avisar: el recordatorio vuelve a estar pendiente
        task.reminder_sent_at = task.reminder_emailed_at = None
    db.commit()
    db.refresh(task)
    if "assignee_id" in changed:
        _notify_assignment(db, user, task)
    if changed & SYNC_FIELDS:
        gcal.auto_sync(db, task.owner, task)
    if "status" in changed:
        _after_complete(db, task)
    return _out(db, user, task)


@router.patch("/{task_id}/move", response_model=schemas.TaskOut)
def move_task(task_id: int, data: schemas.TaskMove, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Mueve una tarea a una columna/posición del tablero y renumera esa columna."""
    task = _get(db, user, task_id, write=True)
    was_done = task.status == Status.COMPLETED
    _apply_status(task, data.status)
    column = db.query(Task).filter(
        access.visible_tasks(db, user), Task.parent_task_id.is_(None), Task.deleted_at.is_(None),
        Task.status == data.status, Task.id != task.id,
    ).order_by(Task.position, Task.created_at.desc()).all()
    column.insert(min(data.position, len(column)), task)
    for i, t in enumerate(column):
        t.position = i
    db.commit()
    db.refresh(task)
    if was_done != (task.status == Status.COMPLETED) or task.status == Status.ARCHIVED:
        gcal.auto_sync(db, task.owner, task)
    if not was_done:
        _after_complete(db, task)
    return _out(db, user, task)


def _stop_timer(task: Task, now: datetime) -> None:
    if task.timer_started_at:
        started = task.timer_started_at if task.timer_started_at.tzinfo else task.timer_started_at.replace(tzinfo=timezone.utc)
        task.time_spent_seconds += max(0, int((now - started).total_seconds()))
        task.timer_started_at = None


@router.post("/{task_id}/timer/start", response_model=schemas.TaskOut)
def start_timer(task_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Arranca el cronómetro de la tarea. Solo hay uno en marcha por persona: el anterior se detiene."""
    task = _get(db, user, task_id, write=True)
    now = datetime.now(timezone.utc)
    running = db.query(Task).filter(Task.timer_started_at.isnot(None), access.responsible(user), Task.id != task.id).all()
    for other in running:
        if access.can_edit(db, user, other):
            _stop_timer(other, now)
    if not task.timer_started_at:
        task.timer_started_at = now
    db.commit()
    db.refresh(task)
    return _out(db, user, task)


@router.post("/{task_id}/timer/stop", response_model=schemas.TaskOut)
def stop_timer(task_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    task = _get(db, user, task_id, write=True)
    _stop_timer(task, datetime.now(timezone.utc))
    db.commit()
    db.refresh(task)
    return _out(db, user, task)


@router.delete("/{task_id}", status_code=204)
def delete_task(task_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Las tareas van a la papelera (30 días) junto con sus subtareas; una subtarea suelta se borra del todo."""
    task = _get(db, user, task_id, write=True)
    if task.parent_task_id is not None:
        db.delete(task)
        db.commit()
        return
    owner, event_ids = task.owner, [task.google_event_id] if task.google_event_id else []
    now = datetime.now(timezone.utc)
    task.deleted_at, task.google_event_id = now, None
    for s in task.subtasks:
        s.deleted_at = now
    db.commit()
    gcal.auto_delete(db, owner, event_ids)


# ---------- Comentarios ----------
def _comment_out(c: Comment) -> schemas.CommentOut:
    o = schemas.CommentOut.model_validate(c)
    o.author_name = display_name(c.author)
    return o


@router.get("/{task_id}/comments", response_model=List[schemas.CommentOut])
def list_comments(task_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return [_comment_out(c) for c in _get(db, user, task_id).comments]


@router.post("/{task_id}/comments", response_model=schemas.CommentOut, status_code=201)
def add_comment(task_id: int, data: schemas.CommentCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Cualquiera con acceso a la tarea puede comentar, también con permiso de lectura."""
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
    is_owner = access.project_role(db, user, access.scope_project_id(task)) == access.OWNER
    if c.author_id != user.id and task.user_id != user.id and not is_owner:
        raise HTTPException(403, "Solo puedes eliminar tus comentarios")
    db.delete(c)
    db.commit()
