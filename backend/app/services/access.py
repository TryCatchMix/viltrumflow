"""Permisos sobre proyectos compartidos y sus tareas."""
from typing import Dict, Optional

from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..models import Project, ProjectMember, Task, User

OWNER, EDITOR, VIEWER = "owner", "editor", "viewer"


def project_roles(db: Session, user: User) -> Dict[int, str]:
    """{id de proyecto: rol} de todos los proyectos a los que el usuario tiene acceso."""
    roles = {pid: OWNER for (pid,) in db.query(Project.id).filter(Project.owner_id == user.id)}
    for pid, role in db.query(ProjectMember.project_id, ProjectMember.role).filter(ProjectMember.user_id == user.id):
        roles.setdefault(pid, role)
    return roles


def project_role(db: Session, user: User, project_id: Optional[int]) -> Optional[str]:
    if project_id is None:
        return None
    project = db.get(Project, project_id)
    if not project:
        return None
    if project.owner_id == user.id:
        return OWNER
    m = db.query(ProjectMember.role).filter(ProjectMember.project_id == project_id, ProjectMember.user_id == user.id).first()
    return m[0] if m else None


def scope_project_id(task: Task) -> Optional[int]:
    """Las subtareas heredan el proyecto (y por tanto los permisos) de su tarea padre."""
    return task.parent.project_id if task.parent_task_id and task.parent else task.project_id


def can_view(db: Session, user: User, task: Task) -> bool:
    pid = scope_project_id(task)
    if pid is None:
        return task.user_id == user.id
    # Dentro de un proyecto manda el acceso al proyecto, también para quien creó la tarea
    return project_role(db, user, pid) is not None


def can_edit(db: Session, user: User, task: Task, roles: Optional[Dict[int, str]] = None) -> bool:
    """Edita quien la creó, o el propietario y los editores del proyecto. Un lector solo edita las suyas."""
    pid = scope_project_id(task)
    role = roles.get(pid) if roles is not None and pid is not None else project_role(db, user, pid)
    if pid is not None and role is None:
        return False  # perdió el acceso al proyecto: ni siquiera sus antiguas tareas
    return role in (OWNER, EDITOR) or task.user_id == user.id


def visible_tasks(db: Session, user: User, roles: Optional[Dict[int, str]] = None):
    """Condición SQL: tareas propias sin proyecto ajeno + todas las de los proyectos accesibles."""
    roles = project_roles(db, user) if roles is None else roles
    own = (Task.user_id == user.id) & (Task.project_id.is_(None) | Task.project_id.in_(roles.keys() or [-1]))
    if not roles:
        return own
    return or_(own, Task.project_id.in_(roles.keys()))


def responsible(user: User):
    """Condición SQL: tareas de las que el usuario es responsable (asignadas a él, o suyas sin asignar)."""
    return or_(Task.assignee_id == user.id, (Task.assignee_id.is_(None)) & (Task.user_id == user.id))


def is_participant(db: Session, project_id: int, user_id: int) -> bool:
    project = db.get(Project, project_id)
    if not project:
        return False
    if project.owner_id == user_id:
        return True
    return db.query(ProjectMember.id).filter(ProjectMember.project_id == project_id, ProjectMember.user_id == user_id).first() is not None
