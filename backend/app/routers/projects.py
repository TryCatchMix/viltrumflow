from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from .. import schemas
from ..database import get_db
from ..deps import get_current_user
from ..models import Project, Status, Task, User

router = APIRouter()


def _get(db: Session, user: User, project_id: int) -> Project:
    p = db.get(Project, project_id)
    if not p or p.owner_id != user.id:
        raise HTTPException(404, "Proyecto no encontrado")
    return p


def _with_stats(db: Session, projects: List[Project]) -> List[schemas.ProjectOut]:
    ids = [p.id for p in projects]
    stats = {}
    if ids:
        rows = db.query(
            Task.project_id, func.count(Task.id),
            func.sum(case((Task.status == Status.COMPLETED, 1), else_=0)),
        ).filter(Task.project_id.in_(ids), Task.parent_task_id.is_(None), Task.status != Status.ARCHIVED
        ).group_by(Task.project_id).all()
        stats = {pid: (total, int(done or 0)) for pid, total, done in rows}
    out = []
    for p in projects:
        o = schemas.ProjectOut.model_validate(p)
        o.total_tasks, o.completed_tasks = stats.get(p.id, (0, 0))
        out.append(o)
    return out


@router.get("", response_model=List[schemas.ProjectOut])
def list_projects(include_archived: bool = False, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    q = db.query(Project).filter(Project.owner_id == user.id)
    if not include_archived:
        q = q.filter(Project.is_archived.is_(False))
    return _with_stats(db, q.order_by(Project.name).all())


@router.post("", response_model=schemas.ProjectOut, status_code=201)
def create_project(data: schemas.ProjectCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    p = Project(**data.model_dump(), owner_id=user.id)
    db.add(p)
    db.commit()
    db.refresh(p)
    return _with_stats(db, [p])[0]


@router.get("/{project_id}", response_model=schemas.ProjectOut)
def get_project(project_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _with_stats(db, [_get(db, user, project_id)])[0]


@router.put("/{project_id}", response_model=schemas.ProjectOut)
def update_project(project_id: int, data: schemas.ProjectUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    p = _get(db, user, project_id)
    for k, v in data.model_dump(exclude_unset=True).items():
        if v is None and k != "description":
            continue
        setattr(p, k, v)
    db.commit()
    db.refresh(p)
    return _with_stats(db, [p])[0]


@router.delete("/{project_id}", status_code=204)
def delete_project(project_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Elimina el proyecto; sus tareas se conservan sin proyecto."""
    p = _get(db, user, project_id)
    db.query(Task).filter(Task.project_id == p.id).update({"project_id": None})
    db.delete(p)
    db.commit()
