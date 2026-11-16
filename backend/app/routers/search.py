from typing import List

from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from .. import schemas
from ..database import get_db
from ..deps import get_current_user
from ..models import Note, Project, Status, Task, User
from ..services import access
from ..services import markdown as md

router = APIRouter()


@router.get("", response_model=List[schemas.SearchResult])
def search(q: str = Query(..., min_length=1, max_length=200), user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Búsqueda global para el buscador rápido (Ctrl+K)."""
    q = q.strip()
    like = f"%{q}%"
    out: List[schemas.SearchResult] = []
    notes = db.query(Note).filter(Note.owner_id == user.id, Note.deleted_at.is_(None), or_(Note.title.ilike(like), Note.content.ilike(like))).limit(40).all()
    notes.sort(key=lambda n: (q.lower() not in n.title.lower(), n.title.lower()))
    for n in notes[:12]:
        in_title = q.lower() in n.title.lower()
        out.append(schemas.SearchResult(kind="note", id=n.id, title=n.title, snippet=None if in_title else md.snippet(n.content, q)))
    roles = access.project_roles(db, user)
    for t in db.query(Task).filter(access.visible_tasks(db, user, roles), Task.deleted_at.is_(None), Task.status != Status.ARCHIVED,
                                   or_(Task.title.ilike(like), Task.description.ilike(like))).limit(8):
        out.append(schemas.SearchResult(kind="task", id=t.id, title=t.title, snippet=t.status.value))
    for p in db.query(Project).filter(Project.id.in_(roles.keys() or [-1]), Project.name.ilike(like)).limit(5):
        out.append(schemas.SearchResult(kind="project", id=p.id, title=p.name))
    return out
