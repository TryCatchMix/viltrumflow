from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import case, func, or_
from sqlalchemy.orm import Session

from .. import schemas
from ..database import get_db
from ..deps import get_current_user
from ..models import Project, ProjectMember, Status, Task, User
from ..services import access

router = APIRouter()


def _name(u: User) -> str:
    return u.full_name or u.username


def _get(db: Session, user: User, project_id: int, owner_only: bool = False) -> Project:
    p = db.get(Project, project_id)
    role = access.project_role(db, user, project_id) if p else None
    if role is None:
        raise HTTPException(404, "Proyecto no encontrado")
    if owner_only and role != access.OWNER:
        raise HTTPException(403, "Solo el propietario puede hacer esto")
    return p


def _with_stats(db: Session, user: User, projects: List[Project]) -> List[schemas.ProjectOut]:
    ids = [p.id for p in projects]
    stats, members = {}, {}
    if ids:
        rows = db.query(
            Task.project_id, func.count(Task.id),
            func.sum(case((Task.status == Status.COMPLETED, 1), else_=0)),
        ).filter(Task.project_id.in_(ids), Task.parent_task_id.is_(None), Task.status != Status.ARCHIVED,
                 Task.deleted_at.is_(None)).group_by(Task.project_id).all()
        stats = {pid: (total, int(done or 0)) for pid, total, done in rows}
        members = dict(db.query(ProjectMember.project_id, func.count(ProjectMember.id))
                       .filter(ProjectMember.project_id.in_(ids)).group_by(ProjectMember.project_id).all())
    roles = access.project_roles(db, user)
    out = []
    for p in projects:
        o = schemas.ProjectOut.model_validate(p)
        o.total_tasks, o.completed_tasks = stats.get(p.id, (0, 0))
        o.role, o.owner_name, o.member_count = roles.get(p.id, access.VIEWER), _name(p.owner), members.get(p.id, 0)
        out.append(o)
    return out


@router.get("", response_model=List[schemas.ProjectOut])
def list_projects(include_archived: bool = False, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Proyectos propios y compartidos conmigo."""
    ids = list(access.project_roles(db, user).keys())
    q = db.query(Project).filter(Project.id.in_(ids or [-1]))
    if not include_archived:
        q = q.filter(Project.is_archived.is_(False))
    return _with_stats(db, user, q.order_by(Project.name).all())


@router.post("", response_model=schemas.ProjectOut, status_code=201)
def create_project(data: schemas.ProjectCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    p = Project(**data.model_dump(), owner_id=user.id)
    db.add(p)
    db.commit()
    db.refresh(p)
    return _with_stats(db, user, [p])[0]


@router.get("/{project_id}", response_model=schemas.ProjectOut)
def get_project(project_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _with_stats(db, user, [_get(db, user, project_id)])[0]


@router.put("/{project_id}", response_model=schemas.ProjectOut)
def update_project(project_id: int, data: schemas.ProjectUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    p = _get(db, user, project_id, owner_only=True)
    for k, v in data.model_dump(exclude_unset=True).items():
        if v is None and k != "description":
            continue
        setattr(p, k, v)
    db.commit()
    db.refresh(p)
    return _with_stats(db, user, [p])[0]


@router.delete("/{project_id}", status_code=204)
def delete_project(project_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Elimina el proyecto; sus tareas se conservan sin proyecto (cada una vuelve a quien la creó)."""
    p = _get(db, user, project_id, owner_only=True)
    db.query(Task).filter(Task.project_id == p.id).update({"project_id": None, "assignee_id": None})
    db.delete(p)
    db.commit()


# ---------- Compartir ----------
def _members(p: Project) -> List[schemas.MemberOut]:
    out = [schemas.MemberOut(user_id=p.owner.id, username=p.owner.username, name=_name(p.owner), role="owner")]
    out += [schemas.MemberOut(user_id=m.user.id, username=m.user.username, name=_name(m.user), role=m.role)
            for m in sorted(p.members, key=lambda m: _name(m.user).lower())]
    return out


@router.get("/{project_id}/members", response_model=List[schemas.MemberOut])
def list_members(project_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _members(_get(db, user, project_id))


@router.post("/{project_id}/members", response_model=List[schemas.MemberOut], status_code=201)
def add_member(project_id: int, data: schemas.MemberInvite, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Comparte el proyecto con un usuario ya registrado, por nombre de usuario o email exactos."""
    p = _get(db, user, project_id, owner_only=True)
    ident = data.identifier.strip().lower()
    target = db.query(User).filter(
        User.is_active.is_(True), or_(func.lower(User.username) == ident, func.lower(User.email) == ident)
    ).first()
    if not target:
        raise HTTPException(404, "No hay ningún usuario con ese nombre de usuario o email")
    if target.id == p.owner_id:
        raise HTTPException(409, "Ya eres el propietario del proyecto")
    if any(m.user_id == target.id for m in p.members):
        raise HTTPException(409, "Esa persona ya tiene acceso")
    db.add(ProjectMember(project_id=p.id, user_id=target.id, role=data.role))
    db.commit()
    db.refresh(p)
    return _members(p)


@router.put("/{project_id}/members/{user_id}", response_model=List[schemas.MemberOut])
def update_member(project_id: int, user_id: int, data: schemas.MemberUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    p = _get(db, user, project_id, owner_only=True)
    m = next((m for m in p.members if m.user_id == user_id), None)
    if not m:
        raise HTTPException(404, "Esa persona no tiene acceso al proyecto")
    m.role = data.role
    db.commit()
    db.refresh(p)
    return _members(p)


@router.delete("/{project_id}/members/{user_id}", status_code=204)
def remove_member(project_id: int, user_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """El propietario retira el acceso a alguien, o un miembro abandona el proyecto."""
    p = _get(db, user, project_id)
    if p.owner_id != user.id and user_id != user.id:
        raise HTTPException(403, "Solo el propietario puede retirar el acceso a otras personas")
    m = next((m for m in p.members if m.user_id == user_id), None)
    if not m:
        raise HTTPException(404, "Esa persona no tiene acceso al proyecto")
    db.query(Task).filter(Task.project_id == p.id, Task.assignee_id == user_id).update({"assignee_id": None})
    db.delete(m)
    db.commit()
