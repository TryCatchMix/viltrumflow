from collections import Counter
from datetime import date, datetime, timedelta, timezone
from typing import List

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user
from ..models import Note, NoteLink, Priority, Project, Status, Task, User

router = APIRouter()


class DayPoint(BaseModel):
    date: str
    created: int
    completed: int
    open: int  # tareas abiertas al final del día


class ProjectStat(BaseModel):
    id: int
    name: str
    color: str
    total: int
    completed: int


class Overview(BaseModel):
    total: int
    by_status: dict
    by_priority: dict
    overdue: int
    due_today: int
    due_week: int
    completed_week: int
    completion_rate: float
    notes: int
    links: int
    timeline: List[DayPoint]
    projects: List[ProjectStat]
    top_tags: List[dict]


def _day(dt: datetime, offset: timedelta) -> date:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return (dt + offset).date()


@router.get("/overview", response_model=Overview)
def overview(
    days: int = Query(30, ge=7, le=365),
    tz_offset: int = Query(0, ge=-840, le=840, description="Minutos al este de UTC del cliente"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    offset = timedelta(minutes=tz_offset)
    today = (datetime.now(timezone.utc) + offset).date()
    tasks = db.query(Task).filter(Task.user_id == user.id, Task.parent_task_id.is_(None)).all()
    live = [t for t in tasks if t.status != Status.ARCHIVED]
    open_ = [t for t in live if t.status != Status.COMPLETED]

    by_status = {s.value: 0 for s in Status}
    for t in tasks:
        by_status[t.status.value] += 1
    by_priority = {p.value: 0 for p in Priority}
    for t in open_:
        by_priority[t.priority.value] += 1

    due = [(t, _day(t.due_date, offset)) for t in open_ if t.due_date]
    week_ago = today - timedelta(days=6)
    done_days = [_day(t.completed_at, offset) for t in live if t.completed_at]
    created_days = [_day(t.created_at, offset) for t in live]

    created_c, done_c = Counter(created_days), Counter(done_days)
    start = today - timedelta(days=days - 1)
    open_count = sum(1 for d in created_days if d < start) - sum(1 for d in done_days if d < start)
    timeline = []
    for i in range(days):
        d = start + timedelta(days=i)
        open_count += created_c[d] - done_c[d]
        timeline.append(DayPoint(date=d.isoformat(), created=created_c[d], completed=done_c[d], open=max(open_count, 0)))

    projects = []
    for p in db.query(Project).filter(Project.owner_id == user.id, Project.is_archived.is_(False)).order_by(Project.name):
        mine = [t for t in live if t.project_id == p.id]
        projects.append(ProjectStat(id=p.id, name=p.name, color=p.color, total=len(mine),
                                    completed=sum(1 for t in mine if t.status == Status.COMPLETED)))

    tag_c = Counter()
    for t in live:
        tag_c.update(filter(None, t.tags.split(",")))

    note_ids = [i for (i,) in db.query(Note.id).filter(Note.owner_id == user.id)]
    links = db.query(NoteLink).filter(NoteLink.source_id.in_(note_ids)).count() if note_ids else 0
    completed = by_status[Status.COMPLETED.value]
    return Overview(
        total=len(live),
        by_status=by_status,
        by_priority=by_priority,
        overdue=sum(1 for _, d in due if d < today),
        due_today=sum(1 for _, d in due if d == today),
        due_week=sum(1 for _, d in due if today <= d <= today + timedelta(days=6)),
        completed_week=sum(1 for d in done_days if d >= week_ago),
        completion_rate=round(100 * completed / len(live), 1) if live else 0.0,
        notes=len(note_ids),
        links=links,
        timeline=timeline,
        projects=projects,
        top_tags=[{"tag": t, "count": c} for t, c in tag_c.most_common(8)],
    )
