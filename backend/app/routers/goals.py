"""Objetivos a largo plazo: hitos, vínculos con proyectos, tareas y rutinas, avance y ritmo."""
from datetime import date, datetime, timedelta, timezone
from typing import Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user
from ..models import Goal, GoalLink, GoalMilestone, Habit, Project, Status, Task, User
from ..services import game
from ..services.access import can_view, project_roles, visible_tasks
from .habits import checks_by_habit, done_days, is_weekly, local_today, scheduled

router = APIRouter()

HABIT_WINDOW = 28  # días con los que se mide la constancia de las rutinas ligadas
GOAL_XP_BASE, GOAL_XP_PER_STEP, GOAL_XP_MAX = 50, 10, 300
Kind = Literal["project", "task", "habit"]


class GoalIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: Optional[str] = Field(None, max_length=5000)
    color: str = Field("#7c5cff", pattern=r"^#[0-9a-fA-F]{6}$")
    deadline: Optional[date] = None


class GoalUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = Field(None, max_length=5000)
    color: Optional[str] = Field(None, pattern=r"^#[0-9a-fA-F]{6}$")
    deadline: Optional[date] = None
    archived: Optional[bool] = None


class MilestoneIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)


class MilestoneUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    done: Optional[bool] = None


class LinkIn(BaseModel):
    kind: Kind
    ref_id: int


def _aware(dt: Optional[datetime]) -> Optional[datetime]:
    return dt if dt is None or dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _get(db: Session, user: User, goal_id: int) -> Goal:
    g = db.get(Goal, goal_id)
    if not g or g.user_id != user.id:
        raise HTTPException(404, "Objetivo no encontrado")
    return g


def _ids(goal: Goal, kind: str) -> List[int]:
    return [link.ref_id for link in goal.links if link.kind == kind]


def habit_rate(h: Habit, done: set, today: date) -> Optional[int]:
    """% cumplido en los últimos 28 días (hoy solo cuenta si ya está hecho). None si aún no tocaba ningún día."""
    first = max(h.start_day, today - timedelta(days=HABIT_WINDOW - 1))
    if first > today:
        return None
    if is_weekly(h):
        days = (today - first).days + 1
        expected = max(1, round(h.weekly_target * days / 7))
        hits = sum(1 for d in done if first <= d <= today)
        return min(100, round(100 * hits / expected))
    due = [first + timedelta(days=i) for i in range((today - first).days + 1)]
    due = [d for d in due if scheduled(h, d) and (d < today or d in done)]
    if not due:
        return None
    return round(100 * sum(1 for d in due if d in done) / len(due))


class _Ctx:
    """Datos compartidos al calcular varios objetivos a la vez (roles, rutinas y sus checks)."""

    def __init__(self, db: Session, user: User, goals: List[Goal]):
        self.db, self.user, self.today = db, user, local_today(user)
        self.roles = project_roles(db, user)
        habit_ids = {link.ref_id for g in goals for link in g.links if link.kind == "habit"}
        self.habits: Dict[int, Habit] = {
            h.id: h for h in db.query(Habit).filter(Habit.id.in_(habit_ids or [-1]), Habit.user_id == user.id)
        }
        self.checks = checks_by_habit(self.db, list(self.habits))

    def tasks(self, goal: Goal) -> List[Task]:
        task_ids, project_ids = _ids(goal, "task"), [p for p in _ids(goal, "project") if p in self.roles]
        if not task_ids and not project_ids:
            return []
        return self.db.query(Task).filter(
            Task.deleted_at.is_(None), Task.status != Status.ARCHIVED, visible_tasks(self.db, self.user, self.roles),
            or_(Task.id.in_(task_ids or [-1]), (Task.project_id.in_(project_ids or [-1]) & Task.parent_task_id.is_(None))),
        ).order_by(Task.status, Task.due_date.is_(None), Task.due_date, Task.id).all()

    def rate(self, habit_id: int) -> Optional[int]:
        h = self.habits.get(habit_id)
        return habit_rate(h, done_days(h, self.checks[h.id]), self.today) if h else None


def _progress(ctx: _Ctx, goal: Goal, tasks: List[Task]) -> dict:
    t_done = sum(1 for t in tasks if t.status == Status.COMPLETED)
    m_done = sum(1 for m in goal.milestones if m.done)
    total = len(tasks) + len(goal.milestones)
    percent = round(100 * (t_done + m_done) / total) if total else None
    rates = [r for r in (ctx.rate(i) for i in _ids(goal, "habit")) if r is not None]
    expected = days_left = None
    on_track = True
    if goal.deadline:
        days_left = (goal.deadline - ctx.today).days
        if goal.status == "active":
            start = _aware(goal.created_at).astimezone(timezone.utc).date()
            span = max(1, (goal.deadline - start).days)
            expected = max(0, min(100, round(100 * (ctx.today - start).days / span)))
            # Va bien si el avance no se queda más de 10 puntos por detrás del tiempo transcurrido
            measured = percent if percent is not None else (round(sum(rates) / len(rates)) if rates else None)
            on_track = days_left >= 0 and (measured is None or measured >= expected - 10)
    return {
        "percent": percent, "tasks_done": t_done, "tasks_total": len(tasks),
        "milestones_done": m_done, "milestones_total": len(goal.milestones),
        "habit_rate": round(sum(rates) / len(rates)) if rates else None, "habits_count": len(_ids(goal, "habit")),
        "projects_count": len(_ids(goal, "project")), "expected": expected, "days_left": days_left, "on_track": on_track,
    }


def _summary(ctx: _Ctx, goal: Goal, tasks: Optional[List[Task]] = None) -> dict:
    tasks = ctx.tasks(goal) if tasks is None else tasks
    return {
        "id": goal.id, "title": goal.title, "description": goal.description, "color": goal.color,
        "deadline": goal.deadline, "status": goal.status, "completed_at": _aware(goal.completed_at),
        "created_at": _aware(goal.created_at), "progress": _progress(ctx, goal, tasks),
    }


def _detail(db: Session, user: User, goal: Goal) -> dict:
    ctx = _Ctx(db, user, [goal])
    tasks = ctx.tasks(goal)
    out = _summary(ctx, goal, tasks)
    project_ids = [p for p in _ids(goal, "project") if p in ctx.roles]
    projects = {p.id: p for p in db.query(Project).filter(Project.id.in_(project_ids or [-1]))}
    by_project: Dict[int, List[Task]] = {}
    for t in tasks:
        if t.project_id in projects:
            by_project.setdefault(t.project_id, []).append(t)
    out["projects"] = [{
        "id": p.id, "name": p.name, "color": p.color,
        "done": sum(1 for t in by_project.get(p.id, []) if t.status == Status.COMPLETED), "total": len(by_project.get(p.id, [])),
    } for pid in project_ids if (p := projects.get(pid))]
    direct = set(_ids(goal, "task"))
    out["tasks"] = [{
        "id": t.id, "title": t.title, "status": t.status.value, "priority": t.priority.value,
        "due_date": _aware(t.due_date), "all_day": t.all_day, "project_id": t.project_id, "linked": t.id in direct,
    } for t in tasks]
    out["habits"] = [{"id": h.id, "title": h.title, "color": h.color, "rate": ctx.rate(h.id), "archived": h.is_archived}
                     for hid in _ids(goal, "habit") if (h := ctx.habits.get(hid))]
    out["milestones"] = [{"id": m.id, "title": m.title, "done": m.done, "done_at": _aware(m.done_at)} for m in goal.milestones]
    out["xp"] = goal_xp(out["progress"]) if goal.status != "done" else None
    return out


def goal_xp(progress: dict) -> int:
    steps = progress["tasks_done"] + progress["milestones_done"]
    return min(GOAL_XP_MAX, GOAL_XP_BASE + GOAL_XP_PER_STEP * steps)


# ---------- Objetivos ----------
@router.get("")
def list_goals(status: Literal["active", "done", "archived", "all"] = Query("active"),
               user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    q = db.query(Goal).filter(Goal.user_id == user.id)
    if status != "all":
        q = q.filter(Goal.status == status)
    goals = q.order_by(Goal.deadline.is_(None), Goal.deadline, Goal.id).all()
    ctx = _Ctx(db, user, goals)
    return [_summary(ctx, g) for g in goals]


@router.post("", status_code=201)
def create_goal(data: GoalIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    g = Goal(user_id=user.id, **data.model_dump())
    db.add(g)
    db.commit()
    db.refresh(g)
    return _detail(db, user, g)


@router.get("/{goal_id}")
def get_goal(goal_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _detail(db, user, _get(db, user, goal_id))


@router.put("/{goal_id}")
def update_goal(goal_id: int, data: GoalUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    g = _get(db, user, goal_id)
    values = data.model_dump(exclude_unset=True)
    archived = values.pop("archived", None)
    for k, v in values.items():
        if v is None and k in ("title", "color"):
            continue
        setattr(g, k, v)
    if archived is True and g.status == "active":
        g.status = "archived"
    elif archived is False and g.status == "archived":
        g.status = "active"
    db.commit()
    return _detail(db, user, g)


@router.delete("/{goal_id}", status_code=204)
def delete_goal(goal_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    g = _get(db, user, goal_id)
    game.revoke(db, "goal", str(g.id))
    db.delete(g)
    db.commit()


@router.post("/{goal_id}/complete")
def complete_goal(goal_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Da el objetivo por cumplido (aunque falten pasos: quien decide es el usuario) y concede su experiencia."""
    g = _get(db, user, goal_id)
    if g.status == "done":
        raise HTTPException(409, "Este objetivo ya está cumplido")
    detail = _detail(db, user, g)
    g.status, g.completed_at = "done", datetime.now(timezone.utc)
    db.commit()
    gained = game.award(db, user.id, "goal", str(g.id), goal_xp(detail["progress"]), g.title)
    return {**_detail(db, user, g), "xp_gained": gained}


@router.post("/{goal_id}/reopen")
def reopen_goal(goal_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    g = _get(db, user, goal_id)
    if g.status == "done":
        game.revoke(db, "goal", str(g.id))
    g.status, g.completed_at = "active", None
    db.commit()
    return _detail(db, user, g)


# ---------- Hitos ----------
@router.post("/{goal_id}/milestones", status_code=201)
def add_milestone(goal_id: int, data: MilestoneIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    g = _get(db, user, goal_id)
    if len(g.milestones) >= 100:
        raise HTTPException(400, "Máximo 100 hitos por objetivo")
    db.add(GoalMilestone(goal_id=g.id, title=data.title.strip(), position=max((m.position for m in g.milestones), default=-1) + 1))
    db.commit()
    db.refresh(g)
    return _detail(db, user, g)


def _milestone(db: Session, user: User, milestone_id: int) -> GoalMilestone:
    m = db.get(GoalMilestone, milestone_id)
    if not m or m.goal.user_id != user.id:
        raise HTTPException(404, "Hito no encontrado")
    return m


@router.put("/milestones/{milestone_id}")
def update_milestone(milestone_id: int, data: MilestoneUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    m = _milestone(db, user, milestone_id)
    if data.title is not None:
        m.title = data.title.strip()
    if data.done is not None and data.done != m.done:
        m.done, m.done_at = data.done, (datetime.now(timezone.utc) if data.done else None)
    db.commit()
    return _detail(db, user, m.goal)


@router.delete("/milestones/{milestone_id}")
def delete_milestone(milestone_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    m = _milestone(db, user, milestone_id)
    goal = m.goal
    db.delete(m)
    db.commit()
    db.refresh(goal)
    return _detail(db, user, goal)


# ---------- Vínculos ----------
def _check_access(db: Session, user: User, kind: str, ref_id: int) -> None:
    if kind == "project":
        ok = ref_id in project_roles(db, user)
    elif kind == "task":
        t = db.get(Task, ref_id)
        ok = bool(t and t.deleted_at is None and t.parent_task_id is None and can_view(db, user, t))
    else:
        h = db.get(Habit, ref_id)
        ok = bool(h and h.user_id == user.id)
    if not ok:
        raise HTTPException(404, {"project": "Proyecto no encontrado", "task": "Tarea no encontrada", "habit": "Rutina no encontrada"}[kind])


@router.post("/{goal_id}/links")
def add_link(goal_id: int, data: LinkIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    g = _get(db, user, goal_id)
    _check_access(db, user, data.kind, data.ref_id)
    if not any(link.kind == data.kind and link.ref_id == data.ref_id for link in g.links):
        if len(g.links) >= 300:
            raise HTTPException(400, "Este objetivo ya tiene demasiados elementos vinculados")
        db.add(GoalLink(goal_id=g.id, kind=data.kind, ref_id=data.ref_id))
        db.commit()
        db.refresh(g)
    return _detail(db, user, g)


@router.delete("/{goal_id}/links/{kind}/{ref_id}")
def remove_link(goal_id: int, kind: Kind, ref_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    g = _get(db, user, goal_id)
    db.query(GoalLink).filter(GoalLink.goal_id == g.id, GoalLink.kind == kind, GoalLink.ref_id == ref_id).delete()
    db.commit()
    db.refresh(g)
    return _detail(db, user, g)


@router.get("/for/{kind}/{ref_id}")
def goals_for(kind: Kind, ref_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Objetivos del usuario a los que está ligado un proyecto, tarea o rutina (para mostrarlo en su ficha)."""
    rows = db.query(Goal.id, Goal.title, Goal.color, Goal.status).join(GoalLink).filter(
        Goal.user_id == user.id, GoalLink.kind == kind, GoalLink.ref_id == ref_id,
    ).all()
    return [{"id": i, "title": t, "color": c, "status": s} for i, t, c, s in rows]
