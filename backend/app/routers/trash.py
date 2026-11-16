from typing import List, Literal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session

from .. import schemas
from ..database import get_db
from ..deps import get_current_user
from ..models import Note, Project, Task, User
from ..services import google_calendar as gcal
from ..services.notes import restore_note
from ..services.trash import RETENTION, purge_expired

router = APIRouter()
Kind = Literal["note", "task"]


def _tasks(db: Session, user: User):
    """Tareas en la papelera que el usuario puede recuperar: las que creó y las de sus proyectos."""
    owned = db.query(Project.id).filter(Project.owner_id == user.id)
    return db.query(Task).filter(
        Task.deleted_at.isnot(None), Task.parent_task_id.is_(None),
        or_(Task.user_id == user.id, Task.project_id.in_(owned)),
    )


def _notes(db: Session, user: User):
    return db.query(Note).filter(Note.owner_id == user.id, Note.deleted_at.isnot(None))


def _find(db: Session, user: User, kind: Kind, item_id: int):
    q = _notes(db, user).filter(Note.id == item_id) if kind == "note" else _tasks(db, user).filter(Task.id == item_id)
    obj = q.first()
    if not obj:
        raise HTTPException(404, "No está en la papelera")
    return obj


@router.get("", response_model=List[schemas.TrashItem])
def list_trash(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    purge_expired(db, owner_id=user.id)
    items = [schemas.TrashItem(kind="note", id=n.id, title=n.title, detail=n.folder or None,
                               deleted_at=n.deleted_at, purge_at=n.deleted_at + RETENTION) for n in _notes(db, user)]
    items += [schemas.TrashItem(kind="task", id=t.id, title=t.title, detail=t.project.name if t.project else None,
                                deleted_at=t.deleted_at, purge_at=t.deleted_at + RETENTION) for t in _tasks(db, user)]
    return sorted(items, key=lambda i: i.deleted_at, reverse=True)


@router.post("/{kind}/{item_id}/restore", response_model=schemas.Message)
def restore(kind: Kind, item_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    obj = _find(db, user, kind, item_id)
    if kind == "note":
        restore_note(db, obj)
        db.commit()
        return {"message": f"Nota restaurada como «{obj.title}»"}
    obj.deleted_at = None
    for s in obj.subtasks:
        s.deleted_at = None
    db.commit()
    gcal.auto_sync(db, obj.owner, obj)
    return {"message": "Tarea restaurada"}


@router.delete("/{kind}/{item_id}", status_code=204)
def delete_forever(kind: Kind, item_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db.delete(_find(db, user, kind, item_id))
    db.commit()


@router.delete("", status_code=204)
def empty_trash(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    for obj in [*_notes(db, user).all(), *_tasks(db, user).all()]:
        db.delete(obj)
    db.commit()
