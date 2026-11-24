"""Plantillas de proyecto: listas de tareas reutilizables con fechas relativas al día de inicio."""
import json
from datetime import date, datetime, timedelta, timezone
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, ValidationError, field_validator
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user
from ..models import Goal, GoalLink, Priority, Project, ProjectTemplate, Status, Task, User
from ..services import google_calendar as gcal
from ..services.reminders import user_tz
from .habits import local_today
from .projects import _get as get_project, _with_stats

router = APIRouter()

MAX_TASKS, MAX_SUBTASKS = 100, 20


class TemplateTask(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: Optional[str] = Field(None, max_length=2000)
    # Día respecto al inicio del proyecto (0 = el mismo día; negativo = antes). None = sin fecha
    offset_days: Optional[int] = Field(None, ge=-365, le=730)
    priority: Literal["low", "medium", "high", "urgent"] = "medium"
    difficulty: int = Field(2, ge=1, le=4)
    estimated_minutes: Optional[int] = Field(None, ge=1, le=100_000)
    subtasks: List[str] = Field(default_factory=list, max_length=MAX_SUBTASKS)

    @field_validator("title")
    @classmethod
    def _strip(cls, v):
        v = v.strip()
        if not v:
            raise ValueError("El título no puede estar vacío")
        return v

    @field_validator("subtasks")
    @classmethod
    def _subtasks(cls, v):
        out = [s.strip()[:200] for s in v if s and s.strip()]
        return out


class TemplateIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=2000)
    color: str = Field("#7c5cff", pattern=r"^#[0-9a-fA-F]{6}$")
    tasks: List[TemplateTask] = Field(default_factory=list, max_length=MAX_TASKS)


class TemplateUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=2000)
    color: Optional[str] = Field(None, pattern=r"^#[0-9a-fA-F]{6}$")
    tasks: Optional[List[TemplateTask]] = Field(None, max_length=MAX_TASKS)


class ApplyIn(BaseModel):
    template_id: Optional[int] = None
    example: Optional[str] = None
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    start: Optional[date] = None  # día de inicio; por defecto, hoy
    color: Optional[str] = Field(None, pattern=r"^#[0-9a-fA-F]{6}$")
    goal_id: Optional[int] = None


def _t(title, offset=None, difficulty=2, subtasks=(), priority="medium", minutes=None):
    return {"title": title, "offset_days": offset, "difficulty": difficulty, "subtasks": list(subtasks),
            "priority": priority, "estimated_minutes": minutes}


# Ejemplos listos para usar (o para copiar y adaptar)
EXAMPLES = {
    "mudanza": {
        "name": "Mudanza", "color": "#eda100",
        "description": "El día de inicio es el de la mudanza: las tareas se colocan antes y después.",
        "tasks": [
            _t("Pedir presupuestos de mudanza", -30, 2, ["Pedir 3 presupuestos", "Comparar y reservar"]),
            _t("Dar de alta luz, agua e internet en la casa nueva", -21, 2),
            _t("Comprar cajas y material de embalaje", -14, 1),
            _t("Empaquetar lo que no se usa a diario", -10, 3, ["Libros", "Ropa de otra temporada", "Trastero"]),
            _t("Cambiar la dirección en bancos y suscripciones", -7, 2),
            _t("Empaquetar cocina y baño", -2, 3),
            _t("Día de la mudanza", 0, 4, priority="high"),
            _t("Dar de baja los suministros de la casa anterior", 1, 2),
            _t("Empadronarse en la nueva dirección", 7, 2),
        ],
    },
    "examen": {
        "name": "Preparar un examen", "color": "#2a78d6",
        "description": "El día de inicio es el del examen: el estudio se reparte en las semanas previas.",
        "tasks": [
            _t("Reunir temario y exámenes anteriores", -42, 1),
            _t("Hacer un calendario de estudio por temas", -40, 2),
            _t("Primera vuelta al temario", -35, 4, ["Temas 1-3", "Temas 4-6", "Temas 7-9"]),
            _t("Resúmenes y esquemas", -21, 3),
            _t("Simulacro de examen 1", -14, 3, minutes=120),
            _t("Repasar los fallos del simulacro", -12, 2),
            _t("Simulacro de examen 2", -7, 3, minutes=120),
            _t("Repaso final ligero", -1, 2, priority="high"),
            _t("Examen", 0, 4, priority="urgent"),
        ],
    },
    "viaje": {
        "name": "Viaje", "color": "#1baf7a",
        "description": "El día de inicio es el de salida.",
        "tasks": [
            _t("Reservar vuelos o transporte", -45, 2),
            _t("Reservar alojamiento", -40, 2),
            _t("Revisar documentación (DNI, pasaporte, visados)", -30, 2, priority="high"),
            _t("Planificar qué ver cada día", -14, 1),
            _t("Contratar seguro de viaje", -10, 1),
            _t("Hacer la maleta", -1, 2, ["Ropa", "Cargadores", "Medicinas", "Documentación"]),
            _t("Salida", 0, 1),
        ],
    },
    "lanzamiento": {
        "name": "Lanzar un proyecto", "color": "#7c5cff",
        "description": "El día de inicio es el del arranque; el lanzamiento llega al cabo de 6 semanas.",
        "tasks": [
            _t("Definir objetivo, público y alcance", 0, 3),
            _t("Investigar competencia y referencias", 3, 2),
            _t("Primera versión (prototipo)", 14, 4, ["Diseño", "Desarrollo", "Pruebas"]),
            _t("Probar con 5 personas y recoger opiniones", 21, 3),
            _t("Corregir lo más importante", 28, 3),
            _t("Preparar la comunicación del lanzamiento", 35, 2, ["Texto", "Imágenes", "Lista de contactos"]),
            _t("Lanzamiento", 42, 4, priority="high"),
            _t("Revisar resultados y siguientes pasos", 49, 2),
        ],
    },
}


def _tasks(raw: str) -> List[dict]:
    try:
        return [TemplateTask(**t).model_dump() for t in json.loads(raw or "[]")]
    except (ValueError, TypeError, ValidationError):
        return []


def _out(t: ProjectTemplate) -> dict:
    tasks = _tasks(t.tasks)
    return {"id": t.id, "key": None, "name": t.name, "description": t.description, "color": t.color, "tasks": tasks,
            "task_count": len(tasks), "span_days": _span(tasks)}


def _example_out(key: str) -> dict:
    e = EXAMPLES[key]
    tasks = [TemplateTask(**t).model_dump() for t in e["tasks"]]
    return {"id": None, "key": key, "name": e["name"], "description": e["description"], "color": e["color"],
            "tasks": tasks, "task_count": len(tasks), "span_days": _span(tasks)}


def _span(tasks: List[dict]) -> Optional[int]:
    offsets = [t["offset_days"] for t in tasks if t["offset_days"] is not None]
    return (max(offsets) - min(offsets)) if offsets else None


def _get(db: Session, user: User, template_id: int) -> ProjectTemplate:
    t = db.get(ProjectTemplate, template_id)
    if not t or t.user_id != user.id:
        raise HTTPException(404, "Plantilla no encontrada")
    return t


@router.get("")
def list_templates(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    mine = db.query(ProjectTemplate).filter(ProjectTemplate.user_id == user.id).order_by(ProjectTemplate.name).all()
    return {"mine": [_out(t) for t in mine], "examples": [_example_out(k) for k in EXAMPLES]}


@router.post("", status_code=201)
def create_template(data: TemplateIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    t = ProjectTemplate(user_id=user.id, name=data.name.strip(), description=data.description, color=data.color,
                        tasks=json.dumps([x.model_dump() for x in data.tasks], ensure_ascii=False))
    db.add(t)
    db.commit()
    db.refresh(t)
    return _out(t)


@router.put("/{template_id}")
def update_template(template_id: int, data: TemplateUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    t = _get(db, user, template_id)
    values = data.model_dump(exclude_unset=True)
    if values.get("name"):
        t.name = values["name"].strip()
    if "description" in values:
        t.description = values["description"]
    if values.get("color"):
        t.color = values["color"]
    if data.tasks is not None:
        t.tasks = json.dumps([x.model_dump() for x in data.tasks], ensure_ascii=False)
    db.commit()
    return _out(t)


@router.delete("/{template_id}", status_code=204)
def delete_template(template_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db.delete(_get(db, user, template_id))
    db.commit()


def _task_day(task: Task, tz) -> Optional[date]:
    if not task.due_date:
        return None
    due = task.due_date if task.due_date.tzinfo else task.due_date.replace(tzinfo=timezone.utc)
    return due.date() if task.all_day else due.astimezone(tz).date()


@router.post("/from-project/{project_id}", status_code=201)
def from_project(project_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Guarda un proyecto como plantilla: sus tareas principales, subtareas y fechas relativas a la primera."""
    p = get_project(db, user, project_id)
    tz = user_tz(user)
    tasks = db.query(Task).filter(Task.project_id == p.id, Task.parent_task_id.is_(None), Task.deleted_at.is_(None),
                                  Task.status != Status.ARCHIVED).order_by(Task.due_date.is_(None), Task.due_date, Task.position).all()
    if not tasks:
        raise HTTPException(400, "Este proyecto no tiene tareas que guardar")
    days = [d for d in (_task_day(t, tz) for t in tasks) if d]
    start = min(days) if days else None
    items = []
    for t in tasks[:MAX_TASKS]:
        d = _task_day(t, tz)
        subs = [s.title for s in db.query(Task).filter(Task.parent_task_id == t.id, Task.deleted_at.is_(None)).order_by(Task.position, Task.id)]
        items.append(TemplateTask(
            title=t.title, description=t.description, offset_days=(d - start).days if d and start else None,
            priority=t.priority.value, difficulty=t.difficulty or 2, estimated_minutes=t.estimated_minutes,
            subtasks=subs[:MAX_SUBTASKS],
        ).model_dump())
    tpl = ProjectTemplate(user_id=user.id, name=p.name[:100], description=p.description, color=p.color,
                          tasks=json.dumps(items, ensure_ascii=False))
    db.add(tpl)
    db.commit()
    db.refresh(tpl)
    return _out(tpl)


@router.post("/apply", status_code=201)
def apply(data: ApplyIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Crea un proyecto nuevo con las tareas de la plantilla, fechadas a partir del día de inicio."""
    if (data.template_id is None) == (data.example is None):
        raise HTTPException(400, "Indica una plantilla tuya o un ejemplo")
    if data.template_id is not None:
        tpl = _out(_get(db, user, data.template_id))
    elif data.example in EXAMPLES:
        tpl = _example_out(data.example)
    else:
        raise HTTPException(404, "Ese ejemplo no existe")
    goal = None
    if data.goal_id is not None:
        goal = db.get(Goal, data.goal_id)
        if not goal or goal.user_id != user.id:
            raise HTTPException(404, "Objetivo no encontrado")
    start = data.start or local_today(user)

    project = Project(name=(data.name or tpl["name"]).strip()[:100], description=tpl["description"],
                      color=data.color or tpl["color"], owner_id=user.id)
    db.add(project)
    db.flush()
    first = db.query(Task.position).filter(Task.user_id == user.id, Task.status == Status.TODO).order_by(Task.position).first()
    pos = (first[0] if first else 0) - len(tpl["tasks"]) - 1
    created: List[Task] = []
    for item in tpl["tasks"]:
        due = None
        if item["offset_days"] is not None:
            day = start + timedelta(days=item["offset_days"])
            due = datetime(day.year, day.month, day.day, tzinfo=timezone.utc)  # día completo: medianoche UTC
        pos += 1
        task = Task(title=item["title"], description=item["description"], due_date=due, all_day=True,
                    priority=Priority(item["priority"]), difficulty=item["difficulty"], estimated_minutes=item["estimated_minutes"],
                    project_id=project.id, user_id=user.id, status=Status.TODO, position=pos, tags="")
        db.add(task)
        db.flush()
        for i, title in enumerate(item["subtasks"]):
            db.add(Task(title=title, parent_task_id=task.id, user_id=user.id, status=Status.TODO, position=i, tags="", all_day=True))
        created.append(task)
    if goal:
        db.add(GoalLink(goal_id=goal.id, kind="project", ref_id=project.id))
    db.commit()
    if created and user.google_account:
        for t in created:
            gcal.auto_sync(db, user, t)
    out = _with_stats(db, user, [project])[0]
    return {"project": out.model_dump(mode="json"), "tasks_created": len(created)}
