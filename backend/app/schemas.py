from datetime import date, datetime, timezone
from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from .models import Priority, Status

HEX = r"^#[0-9A-Fa-f]{6}$"
Recurrence = Literal["none", "daily", "weekdays", "weekly", "biweekly", "monthly", "yearly"]


class Out(BaseModel):
    """
    Base de los modelos de respuesta. SQLite devuelve las fechas sin zona horaria; si salieran así,
    el navegador las interpretaría como hora local. Aquí se marcan siempre como UTC.
    """

    @field_validator("*", mode="after")
    @classmethod
    def _aware(cls, v):
        if isinstance(v, datetime) and v.tzinfo is None:
            return v.replace(tzinfo=timezone.utc)
        return v


class ORM(Out):
    model_config = ConfigDict(from_attributes=True)


def _split(v):
    """Las etiquetas se guardan como texto separado por comas y se exponen como lista."""
    if isinstance(v, str):
        return [t for t in v.split(",") if t]
    return v or []


def _to_utc(v):
    """Fechas siempre en UTC: SQLite descarta el desfase y una hora «+01:00» se leería como si fuera UTC."""
    if isinstance(v, datetime):
        return v.replace(tzinfo=timezone.utc) if v.tzinfo is None else v.astimezone(timezone.utc)
    return v


def _strong_password(v: str) -> str:
    if not (any(c.isdigit() for c in v) and any(c.isupper() for c in v) and any(c.islower() for c in v)):
        raise ValueError("La contraseña debe incluir mayúsculas, minúsculas y un número")
    return v


# ---------- Auth / usuarios ----------
class UserCreate(BaseModel):
    email: EmailStr
    username: str = Field(min_length=3, max_length=50, pattern=r"^[A-Za-z0-9_.-]+$")
    password: str = Field(min_length=8, max_length=72)
    full_name: Optional[str] = Field(None, max_length=100)

    _strong = field_validator("password")(_strong_password)


class UserUpdate(BaseModel):
    email: Optional[EmailStr] = None
    full_name: Optional[str] = Field(None, max_length=100)
    bio: Optional[str] = Field(None, max_length=2000)
    avatar_url: Optional[str] = Field(None, max_length=500)
    theme: Optional[Literal["light", "dark", "auto"]] = None
    language: Optional[str] = Field(None, max_length=5)
    timezone: Optional[str] = Field(None, max_length=64)
    email_reminders: Optional[bool] = None
    daily_digest: Optional[bool] = None
    digest_hour: Optional[int] = Field(None, ge=0, le=23)

    @field_validator("timezone")
    @classmethod
    def _tz(cls, v):
        if v is None:
            return v
        from zoneinfo import ZoneInfo
        try:
            ZoneInfo(v)
        except Exception:
            raise ValueError("Zona horaria no válida")
        return v


class PasswordChange(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=72)

    _strong = field_validator("new_password")(_strong_password)


class UserOut(ORM):
    id: int
    email: EmailStr
    username: str
    full_name: Optional[str] = None
    avatar_url: Optional[str] = None
    bio: Optional[str] = None
    theme: str
    language: str
    timezone: str
    email_reminders: bool
    daily_digest: bool
    digest_hour: int
    created_at: datetime
    last_login: Optional[datetime] = None


class Token(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class ForgotPassword(BaseModel):
    email: EmailStr


class ResetPassword(BaseModel):
    token: str
    new_password: str = Field(min_length=8, max_length=72)

    _strong = field_validator("new_password")(_strong_password)


class RefreshRequest(BaseModel):
    refresh_token: str


class Message(BaseModel):
    message: str


# ---------- Proyectos ----------
class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: Optional[str] = None
    color: str = Field("#7c5cff", pattern=HEX)


class ProjectUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = None
    color: Optional[str] = Field(None, pattern=HEX)
    is_archived: Optional[bool] = None


class ProjectOut(ORM):
    id: int
    name: str
    description: Optional[str] = None
    color: str
    is_archived: bool
    created_at: datetime
    updated_at: datetime
    total_tasks: int = 0
    completed_tasks: int = 0
    role: Literal["owner", "editor", "viewer"] = "owner"
    owner_name: str = ""
    member_count: int = 0  # personas con acceso además del propietario


class MemberInvite(BaseModel):
    identifier: str = Field(min_length=3, max_length=255, description="Nombre de usuario o email exactos")
    role: Literal["editor", "viewer"] = "editor"


class MemberUpdate(BaseModel):
    role: Literal["editor", "viewer"]


class MemberOut(BaseModel):
    user_id: int
    username: str
    name: str
    role: Literal["owner", "editor", "viewer"]


# ---------- Tareas ----------
class TaskCreate(BaseModel):
    difficulty: int = Field(2, ge=1, le=4)  # 1 fácil · 2 normal · 3 difícil · 4 épica
    _utc = field_validator("due_date")(_to_utc)

    title: str = Field(min_length=1, max_length=200)
    description: Optional[str] = None
    status: Status = Status.TODO
    priority: Priority = Priority.MEDIUM
    due_date: Optional[datetime] = None
    all_day: bool = True
    estimated_hours: Optional[int] = Field(None, ge=0, le=10000)
    tags: List[str] = []
    project_id: Optional[int] = None
    parent_task_id: Optional[int] = None
    note_id: Optional[int] = None
    recurrence: Recurrence = "none"
    reminder_minutes: Optional[int] = Field(None, ge=0, le=40320)
    assignee_id: Optional[int] = None


class TaskUpdate(BaseModel):
    difficulty: Optional[int] = Field(None, ge=1, le=4)  # 1 fácil · 2 normal · 3 difícil · 4 épica
    _utc = field_validator("due_date")(_to_utc)

    title: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = None
    status: Optional[Status] = None
    priority: Optional[Priority] = None
    due_date: Optional[datetime] = None
    all_day: Optional[bool] = None
    estimated_hours: Optional[int] = Field(None, ge=0, le=10000)
    tags: Optional[List[str]] = None
    project_id: Optional[int] = None
    note_id: Optional[int] = None
    recurrence: Optional[Recurrence] = None
    reminder_minutes: Optional[int] = Field(None, ge=0, le=40320)
    assignee_id: Optional[int] = None
    time_spent_seconds: Optional[int] = Field(None, ge=0, le=36_000_000)  # corrección manual del tiempo


class TaskMove(BaseModel):
    status: Status
    position: int = Field(ge=0)


class SubtaskOut(ORM):
    id: int
    title: str
    status: Status


class TaskOut(ORM):
    id: int
    title: str
    description: Optional[str] = None
    status: Status
    priority: Priority
    due_date: Optional[datetime] = None
    all_day: bool
    completed_at: Optional[datetime] = None
    estimated_hours: Optional[int] = None
    tags: List[str] = []
    position: int
    project_id: Optional[int] = None
    parent_task_id: Optional[int] = None
    note_id: Optional[int] = None
    google_event_id: Optional[str] = None
    recurrence: str = "none"
    reminder_minutes: Optional[int] = None
    difficulty: int = 2
    time_spent_seconds: int = 0
    timer_started_at: Optional[datetime] = None
    user_id: int
    note_title: Optional[str] = None  # solo para quien es dueño de la nota
    owner_name: str = ""
    assignee_id: Optional[int] = None
    assignee_name: Optional[str] = None
    can_edit: bool = True
    created_at: datetime
    updated_at: datetime
    subtasks: List[SubtaskOut] = []

    _tags = field_validator("tags", mode="before")(_split)


class CommentCreate(BaseModel):
    content: str = Field(min_length=1, max_length=5000)


class CommentOut(ORM):
    id: int
    content: str
    task_id: int
    author_id: int
    author_name: str = ""
    created_at: datetime


# ---------- Notas ----------
TITLE_FORBIDDEN = set('[]|#^\\')


def _clean_title(v: str) -> str:
    v = " ".join(v.split())
    if not v:
        raise ValueError("El título no puede estar vacío")
    if TITLE_FORBIDDEN & set(v):
        raise ValueError("El título no puede contener [ ] | # ^ \\")
    return v


def _clean_folder(v: str) -> str:
    parts = [p.strip() for p in v.replace("\\", "/").split("/")]
    return "/".join(p for p in parts if p and p not in (".", ".."))


class NoteCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    content: str = Field("", max_length=1_000_000)
    folder: str = Field("", max_length=300)
    # Plantilla (nota de la carpeta «Plantillas») de la que copiar el contenido, con la fecha y hora del cliente
    template_id: Optional[int] = None
    day: Optional[str] = Field(None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    time: Optional[str] = Field(None, pattern=r"^\d{2}:\d{2}$")

    _t = field_validator("title")(_clean_title)
    _f = field_validator("folder")(_clean_folder)


class NoteUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    content: Optional[str] = Field(None, max_length=1_000_000)
    folder: Optional[str] = Field(None, max_length=300)
    is_pinned: Optional[bool] = None

    @field_validator("title")
    @classmethod
    def _t(cls, v):
        return _clean_title(v) if v is not None else v

    @field_validator("folder")
    @classmethod
    def _f(cls, v):
        return _clean_folder(v) if v is not None else v


class NoteSummary(ORM):
    id: int
    title: str
    folder: str
    tags: List[str] = []
    is_pinned: bool
    is_daily: bool
    created_at: datetime
    updated_at: datetime
    snippet: Optional[str] = None

    _tags = field_validator("tags", mode="before")(_split)


class NoteRef(BaseModel):
    id: Optional[int] = None  # None = enlace sin resolver
    title: str
    context: Optional[str] = None


class NoteOut(NoteSummary):
    content: str
    backlinks: List[NoteRef] = []
    outgoing: List[NoteRef] = []


class NoteVersionOut(ORM):
    id: int
    title: str
    created_at: datetime
    size: int = 0
    preview: str = ""


class NoteVersionDetail(NoteVersionOut):
    content: str


class MentionOut(Out):
    note_id: int
    title: str
    context: str


class GraphNode(BaseModel):
    id: str
    label: str
    kind: Literal["note", "ghost", "tag"]
    note_id: Optional[int] = None
    degree: int = 0
    folder: str = ""


class GraphEdge(BaseModel):
    source: str
    target: str
    kind: Literal["link", "tag"] = "link"


class Graph(BaseModel):
    nodes: List[GraphNode]
    edges: List[GraphEdge]


class TagCount(BaseModel):
    tag: str
    count: int


class ChecklistItem(BaseModel):
    note_id: int
    note_title: str
    line: int
    text: str
    checked: bool


class ChecklistToggle(BaseModel):
    line: int = Field(ge=0)
    checked: bool


class ChecklistConvert(BaseModel):
    _utc = field_validator("due_date")(_to_utc)

    line: int = Field(ge=0)
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    due_date: Optional[datetime] = None
    all_day: bool = True
    priority: Priority = Priority.MEDIUM
    tags: List[str] = []
    project_id: Optional[int] = None


class SearchResult(BaseModel):
    kind: Literal["note", "task", "project"]
    id: int
    title: str
    snippet: Optional[str] = None


class ImportResult(BaseModel):
    created: int = 0
    updated: int = 0
    skipped: int = 0
    errors: List[str] = []


# ---------- Recordatorios ----------
class ReminderOut(Out):
    kind: Literal["reminder", "assigned"] = "reminder"
    task_id: int
    title: str
    due_date: Optional[datetime] = None
    all_day: bool = True
    by: Optional[str] = None  # quién asignó la tarea


# ---------- Papelera ----------
class TrashItem(Out):
    kind: Literal["note", "task"]
    id: int
    title: str
    detail: Optional[str] = None
    deleted_at: datetime
    purge_at: datetime


class NotificationStatus(BaseModel):
    email_configured: bool


# ---------- Calendario ----------
class CalendarStatus(BaseModel):
    configured: bool
    connected: bool
    email: Optional[str] = None
    auto_sync: bool = True
    calendar_id: str = "primary"


class CalendarSettings(BaseModel):
    auto_sync: Optional[bool] = None
    calendar_id: Optional[str] = Field(None, min_length=1, max_length=255)


class CalendarInfo(BaseModel):
    id: str
    name: str
    primary: bool = False


class CalendarEvent(BaseModel):
    id: str
    title: str
    start: str  # fecha (YYYY-MM-DD) si all_day, ISO datetime si no
    end: str
    all_day: bool
    html_link: Optional[str] = None
    task_id: Optional[int] = None  # evento creado por ViltrumFlow a partir de una tarea


class SyncResult(BaseModel):
    synced: int
    failed: int


# ---------- Rutinas ----------
def _days(v: str) -> str:
    if not v or any(c not in "0123456" for c in v):
        raise ValueError("Días no válidos: usa dígitos de 0 (lunes) a 6 (domingo)")
    return "".join(sorted(set(v)))


class HabitIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    days: str = Field("0123456", min_length=1, max_length=7)
    target_time: Optional[str] = Field(None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    difficulty: int = Field(2, ge=1, le=4)
    color: str = Field("#7c5cff", pattern=HEX)

    _d = field_validator("days")(_days)


class HabitUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    days: Optional[str] = Field(None, min_length=1, max_length=7)
    target_time: Optional[str] = Field(None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    difficulty: Optional[int] = Field(None, ge=1, le=4)
    color: Optional[str] = Field(None, pattern=HEX)
    is_archived: Optional[bool] = None

    @field_validator("days")
    @classmethod
    def _d(cls, v):
        return _days(v) if v is not None else v


class HabitOut(ORM):
    id: int
    title: str
    days: str
    target_time: Optional[str] = None
    difficulty: int
    color: str
    is_archived: bool
    start_day: date


class HabitDayItem(HabitOut):
    checked: bool = False
    checked_at: Optional[datetime] = None
    streak: int = 0
    xp: int = 0  # experiencia que da (o dio) marcarla ese día


class HabitCheckIn(BaseModel):
    day: date
    checked: bool


class HabitCheckResult(BaseModel):
    item: HabitDayItem
    xp_gained: int


# ---------- Pomodoro ----------
class PomodoroSettings(BaseModel):
    focus_minutes: int = Field(25, ge=1, le=180)
    short_break_minutes: int = Field(5, ge=1, le=60)
    long_break_minutes: int = Field(15, ge=1, le=120)
    cycles: int = Field(4, ge=1, le=12, description="Bloques de concentración antes del descanso largo")
    auto_start: bool = False
    sound: bool = True
    notify: bool = True


class PomodoroSessionIn(BaseModel):
    seconds: int = Field(ge=60, le=10800)
    task_id: Optional[int] = None


class PomodoroSessionOut(Out):
    id: int
    seconds: int
    ended_at: datetime
    task_id: Optional[int] = None
    task_title: Optional[str] = None
    xp_gained: int = 0
