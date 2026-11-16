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

    projects: Mapped[List["Project"]] = relationship(back_populates="owner", cascade="all, delete-orphan")
    tasks: Mapped[List["Task"]] = relationship(back_populates="owner", cascade="all, delete-orphan")
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
    estimated_hours: Mapped[Optional[int]] = mapped_column(Integer)
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

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    project_id: Mapped[Optional[int]] = mapped_column(ForeignKey("projects.id", ondelete="SET NULL"), index=True)
    parent_task_id: Mapped[Optional[int]] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), index=True)
    note_id: Mapped[Optional[int]] = mapped_column(ForeignKey("notes.id", ondelete="SET NULL"))

    owner: Mapped[User] = relationship(back_populates="tasks")
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
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)

    owner: Mapped[User] = relationship(back_populates="notes")
    links: Mapped[List["NoteLink"]] = relationship(
        back_populates="source", cascade="all, delete-orphan", foreign_keys="NoteLink.source_id"
    )


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


class GoogleAccount(TimestampMixin, Base):
    __tablename__ = "google_accounts"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True)
    email: Mapped[Optional[str]] = mapped_column(String(255))
    access_token_enc: Mapped[str] = mapped_column(Text)
    refresh_token_enc: Mapped[Optional[str]] = mapped_column(Text)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    calendar_id: Mapped[str] = mapped_column(String(255), default="primary")
    auto_sync: Mapped[bool] = mapped_column(Boolean, default=True)

    user: Mapped[User] = relationship(back_populates="google_account")
