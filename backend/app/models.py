import enum
from datetime import date, datetime, timezone
from typing import List, Optional

from sqlalchemy import (
    Boolean, Date, DateTime, Enum, ForeignKey, Index, Integer, String, Text, UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Priority(str, enum.Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    URGENT = "urgent"


class Status(str, enum.Enum):
    TODO = "todo"
    IN_PROGRESS = "in_progress"
    REVIEW = "review"
    COMPLETED = "completed"
    ARCHIVED = "archived"


def _enum(e):
    # Guarda el *valor* ("todo") y no el nombre ("TODO"); sin tipo ENUM nativo para facilitar cambios.
    return Enum(e, values_callable=lambda x: [m.value for m in x], native_enum=False, length=20)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class User(TimestampMixin, Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    username: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    full_name: Mapped[Optional[str]] = mapped_column(String(100))
    hashed_password: Mapped[str] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    avatar_url: Mapped[Optional[str]] = mapped_column(String(500))
    bio: Mapped[Optional[str]] = mapped_column(Text)
    last_login: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    # Preferencias
    theme: Mapped[str] = mapped_column(String(10), default="auto")
    language: Mapped[str] = mapped_column(String(5), default="es")
    timezone: Mapped[str] = mapped_column(String(64), default="UTC")  # zona IANA; la envía el navegador

    # Avisos por email (requieren SMTP configurado en el servidor)
    email_reminders: Mapped[bool] = mapped_column(Boolean, default=False)
    daily_digest: Mapped[bool] = mapped_column(Boolean, default=False)
    digest_hour: Mapped[int] = mapped_column(Integer, default=8)  # hora local del resumen diario
    last_digest_on: Mapped[Optional[date]] = mapped_column(Date)
    # Ajustes del reloj Pomodoro (JSON); None = valores por defecto
    pomodoro: Mapped[Optional[str]] = mapped_column(Text)
    # Fin de la fase de Pomodoro en curso: el servidor avisa por push aunque la app esté cerrada
    pomodoro_ends_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), index=True)
    pomodoro_phase: Mapped[Optional[str]] = mapped_column(String(10))
    # Protectores de racha disponibles y último día ya revisado para gastarlos
    streak_freezes: Mapped[int] = mapped_column(Integer, default=0)
    freezes_checked_on: Mapped[Optional[date]] = mapped_column(Date)

    projects: Mapped[List["Project"]] = relationship(back_populates="owner", cascade="all, delete-orphan")
    tasks: Mapped[List["Task"]] = relationship(
        back_populates="owner", cascade="all, delete-orphan", foreign_keys="Task.user_id"
    )
    notes: Mapped[List["Note"]] = relationship(back_populates="owner", cascade="all, delete-orphan")
    google_account: Mapped[Optional["GoogleAccount"]] = relationship(
        back_populates="user", cascade="all, delete-orphan", uselist=False
    )


class Project(TimestampMixin, Base):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[Optional[str]] = mapped_column(Text)
    color: Mapped[str] = mapped_column(String(7), default="#7c5cff")
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)

    owner: Mapped[User] = relationship(back_populates="projects")
    tasks: Mapped[List["Task"]] = relationship(back_populates="project")
    members: Mapped[List["ProjectMember"]] = relationship(back_populates="project", cascade="all, delete-orphan")


class ProjectMember(Base):
    """Usuario con el que el propietario ha compartido un proyecto. role: editor | viewer."""

    __tablename__ = "project_members"
    __table_args__ = (UniqueConstraint("project_id", "user_id", name="uq_project_member"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(10), default="editor")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    project: Mapped[Project] = relationship(back_populates="members")
    user: Mapped[User] = relationship()


class Task(TimestampMixin, Base):
    __tablename__ = "tasks"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[Optional[str]] = mapped_column(Text)
    status: Mapped[Status] = mapped_column(_enum(Status), default=Status.TODO, index=True)
    priority: Mapped[Priority] = mapped_column(_enum(Priority), default=Priority.MEDIUM)
    due_date: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), index=True)
    all_day: Mapped[bool] = mapped_column(Boolean, default=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    estimated_minutes: Mapped[Optional[int]] = mapped_column(Integer)  # duración prevista; en el planificador, el alto del bloque
    tags: Mapped[str] = mapped_column(String(500), default="")  # separadas por comas
    position: Mapped[int] = mapped_column(Integer, default=0)
    google_event_id: Mapped[Optional[str]] = mapped_column(String(255))

    # Repetición: al completar la tarea se crea la siguiente (y `recurred` evita crearla dos veces)
    recurrence: Mapped[str] = mapped_column(String(20), default="none")
    recurred: Mapped[bool] = mapped_column(Boolean, default=False)

    # Recordatorio: minutos antes del vencimiento. Las marcas *_at evitan avisar dos veces por canal.
    reminder_minutes: Mapped[Optional[int]] = mapped_column(Integer)
    reminder_sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    reminder_emailed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    # Papelera: borrado lógico; se purga pasados 30 días
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), index=True)

    # Dificultad (1 fácil … 4 épica): decide la experiencia que da completarla
    difficulty: Mapped[int] = mapped_column(Integer, default=2)

    # Registro de tiempo: segundos acumulados y, si el cronómetro está en marcha, cuándo arrancó
    time_spent_seconds: Mapped[int] = mapped_column(Integer, default=0)
    timer_started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    # Responsable dentro de un proyecto compartido; assigned_notified_at evita avisarle dos veces
    assignee_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    assigned_notified_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    project_id: Mapped[Optional[int]] = mapped_column(ForeignKey("projects.id", ondelete="SET NULL"), index=True)
    parent_task_id: Mapped[Optional[int]] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), index=True)
    note_id: Mapped[Optional[int]] = mapped_column(ForeignKey("notes.id", ondelete="SET NULL"))

    owner: Mapped[User] = relationship(back_populates="tasks", foreign_keys=[user_id])
    assignee: Mapped[Optional[User]] = relationship(foreign_keys=[assignee_id])
    project: Mapped[Optional[Project]] = relationship(back_populates="tasks")
    note: Mapped[Optional["Note"]] = relationship()
    parent: Mapped[Optional["Task"]] = relationship(back_populates="subtasks", remote_side=[id])
    subtasks: Mapped[List["Task"]] = relationship(
        back_populates="parent", cascade="all, delete-orphan", order_by="Task.id"
    )
    comments: Mapped[List["Comment"]] = relationship(
        back_populates="task", cascade="all, delete-orphan", order_by="Comment.created_at"
    )


class Comment(TimestampMixin, Base):
    __tablename__ = "comments"

    id: Mapped[int] = mapped_column(primary_key=True)
    content: Mapped[str] = mapped_column(Text)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), index=True)
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))

    task: Mapped[Task] = relationship(back_populates="comments")
    author: Mapped[User] = relationship()


class Note(TimestampMixin, Base):
    """Nota Markdown del «vault» del usuario. El título es único por usuario (como en Obsidian)."""

    __tablename__ = "notes"
    __table_args__ = (UniqueConstraint("owner_id", "title", name="uq_note_owner_title"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(200))
    content: Mapped[str] = mapped_column(Text, default="")
    folder: Mapped[str] = mapped_column(String(300), default="")  # "Proyectos/Web", "" = raíz
    tags: Mapped[str] = mapped_column(String(1000), default="")  # derivadas de #etiquetas, separadas por comas
    is_pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    is_daily: Mapped[bool] = mapped_column(Boolean, default=False)
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), index=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)

    owner: Mapped[User] = relationship(back_populates="notes")
    links: Mapped[List["NoteLink"]] = relationship(
        back_populates="source", cascade="all, delete-orphan", foreign_keys="NoteLink.source_id"
    )
    # Cascada del ORM (no de la base de datos) para que al borrar la fila se borre también el fichero
    attachments: Mapped[List["Attachment"]] = relationship(back_populates="note", cascade="all, delete-orphan")
    versions: Mapped[List["NoteVersion"]] = relationship(
        back_populates="note", cascade="all, delete-orphan", order_by="NoteVersion.created_at.desc()"
    )


class NoteVersion(Base):
    """Copia del contenido de una nota antes de un cambio, para poder volver atrás."""

    __tablename__ = "note_versions"

    id: Mapped[int] = mapped_column(primary_key=True)
    note_id: Mapped[int] = mapped_column(ForeignKey("notes.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    note: Mapped[Note] = relationship(back_populates="versions")


class Attachment(Base):
    """Imagen subida a una nota. El contenido vive en UPLOAD_DIR/<owner_id>/<id>."""

    __tablename__ = "attachments"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)  # uuid4 en hexadecimal: no adivinable
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    note_id: Mapped[Optional[int]] = mapped_column(ForeignKey("notes.id", ondelete="CASCADE"), index=True)
    filename: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column(String(50))
    size: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    note: Mapped[Optional[Note]] = relationship(back_populates="attachments")


class NoteLink(Base):
    """Arista [[wikilink]]. target_id es NULL mientras la nota destino no exista (enlace sin resolver)."""

    __tablename__ = "note_links"
    __table_args__ = (Index("idx_notelink_target_title", "target_title"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    source_id: Mapped[int] = mapped_column(ForeignKey("notes.id", ondelete="CASCADE"), index=True)
    target_id: Mapped[Optional[int]] = mapped_column(ForeignKey("notes.id", ondelete="SET NULL"), index=True)
    target_title: Mapped[str] = mapped_column(String(200))

    source: Mapped[Note] = relationship(back_populates="links", foreign_keys=[source_id])
    target: Mapped[Optional[Note]] = relationship(foreign_keys=[target_id])


class Habit(TimestampMixin, Base):
    """Rutina: un check que se repite los días de la semana indicados (como una lista diaria)."""

    __tablename__ = "habits"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    days: Mapped[str] = mapped_column(String(7), default="0123456")  # días activos: 0 = lunes … 6 = domingo
    target_time: Mapped[Optional[str]] = mapped_column(String(5))  # hora prevista "HH:MM" (opcional)
    difficulty: Mapped[int] = mapped_column(Integer, default=2)
    color: Mapped[str] = mapped_column(String(7), default="#7c5cff")
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False)
    position: Mapped[int] = mapped_column(Integer, default=0)
    start_day: Mapped[date] = mapped_column(Date)  # día (local del usuario) desde el que cuenta
    # Cantidad diaria («8 vasos»): se da por cumplida al llegar a target_count
    target_count: Mapped[int] = mapped_column(Integer, default=1)
    unit: Mapped[str] = mapped_column(String(20), default="")
    # «N veces por semana»: si tiene valor, aparece todos los días y se cumple al llegar a N días en la semana
    weekly_target: Mapped[Optional[int]] = mapped_column(Integer)
    remind: Mapped[bool] = mapped_column(Boolean, default=False)  # avisar a la hora prevista si sigue pendiente
    last_reminded_on: Mapped[Optional[date]] = mapped_column(Date)

    checks: Mapped[List["HabitCheck"]] = relationship(back_populates="habit", cascade="all, delete-orphan")


class HabitCheck(Base):
    """La rutina se cumplió ese día. `checked_at` guarda a qué hora se marcó."""

    __tablename__ = "habit_checks"
    __table_args__ = (UniqueConstraint("habit_id", "day", name="uq_habit_day"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    habit_id: Mapped[int] = mapped_column(ForeignKey("habits.id", ondelete="CASCADE"), index=True)
    day: Mapped[date] = mapped_column(Date, index=True)
    count: Mapped[int] = mapped_column(Integer, default=1)
    checked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    habit: Mapped[Habit] = relationship(back_populates="checks")


class HabitFreeze(Base):
    """Día fallado de una rutina que un protector de racha salvó: no rompe la racha (tampoco la alarga)."""

    __tablename__ = "habit_freezes"
    __table_args__ = (UniqueConstraint("habit_id", "day", name="uq_habit_freeze_day"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    habit_id: Mapped[int] = mapped_column(ForeignKey("habits.id", ondelete="CASCADE"), index=True)
    day: Mapped[date] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class WeeklyMission(Base):
    """Misión de una semana. El progreso se calcula con lo hecho esa semana; la recompensa se reclama una vez."""

    __tablename__ = "weekly_missions"
    __table_args__ = (UniqueConstraint("user_id", "week_start", "key", name="uq_mission_user_week_key"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    week_start: Mapped[date] = mapped_column(Date)
    key: Mapped[str] = mapped_column(String(30))
    target: Mapped[int] = mapped_column(Integer)
    reward_xp: Mapped[int] = mapped_column(Integer)
    reward_coins: Mapped[int] = mapped_column(Integer)
    claimed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))


class CoinEntry(Base):
    """Movimiento de monedas aparte de las que da la experiencia: premios de misiones (+) y compras (−)."""

    __tablename__ = "coin_entries"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    amount: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str] = mapped_column(String(20))  # mission | chest | reward | freeze
    ref: Mapped[str] = mapped_column(String(60), default="")
    detail: Mapped[str] = mapped_column(String(200), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class Reward(Base):
    """Premio que el usuario se pone a sí mismo y canjea con monedas."""

    __tablename__ = "rewards"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(120))
    cost: Mapped[int] = mapped_column(Integer)
    emoji: Mapped[str] = mapped_column(String(16), default="")
    repeatable: Mapped[bool] = mapped_column(Boolean, default=True)
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class XpEvent(Base):
    """Experiencia ganada. (kind, ref) es único: una misma tarea o check no puntúa dos veces."""

    __tablename__ = "xp_events"
    __table_args__ = (UniqueConstraint("kind", "ref", name="uq_xp_kind_ref"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(20))  # task | subtask | habit | focus
    ref: Mapped[str] = mapped_column(String(60))
    amount: Mapped[int] = mapped_column(Integer)
    detail: Mapped[str] = mapped_column(String(200), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class PomodoroSession(Base):
    """Bloque de concentración terminado."""

    __tablename__ = "pomodoro_sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    task_id: Mapped[Optional[int]] = mapped_column(ForeignKey("tasks.id", ondelete="SET NULL"))
    seconds: Mapped[int] = mapped_column(Integer)
    ended_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class PushSubscription(Base):
    """Navegador o dispositivo que recibe notificaciones push (Web Push)."""

    __tablename__ = "push_subscriptions"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    endpoint: Mapped[str] = mapped_column(String(1000), unique=True)
    p256dh: Mapped[str] = mapped_column(String(200))
    auth: Mapped[str] = mapped_column(String(100))
    user_agent: Mapped[str] = mapped_column(String(300), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ServerKey(Base):
    """Claves propias del servidor generadas al primer uso (p. ej. las VAPID de Web Push)."""

    __tablename__ = "server_keys"

    name: Mapped[str] = mapped_column(String(50), primary_key=True)
    value: Mapped[str] = mapped_column(Text)


class WeeklyReview(TimestampMixin, Base):
    """Revisión de una semana (de lunes a domingo) y objetivos para la siguiente."""

    __tablename__ = "weekly_reviews"
    __table_args__ = (UniqueConstraint("user_id", "week_start", name="uq_review_user_week"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    week_start: Mapped[date] = mapped_column(Date)
    goals: Mapped[str] = mapped_column(Text, default="[]")  # JSON: [{"text": ..., "done": bool}]
    reflection: Mapped[str] = mapped_column(Text, default="")
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))


class GoogleAccount(TimestampMixin, Base):
    __tablename__ = "google_accounts"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True)
    email: Mapped[Optional[str]] = mapped_column(String(255))
    access_token_enc: Mapped[str] = mapped_column(Text)
    refresh_token_enc: Mapped[Optional[str]] = mapped_column(Text)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    calendar_id: Mapped[str] = mapped_column(String(255), default="primary")
    # Última vez que se trajeron de Google los cambios hechos allí en los eventos de tareas
    last_pull_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    auto_sync: Mapped[bool] = mapped_column(Boolean, default=True)

    user: Mapped[User] = relationship(back_populates="google_account")
