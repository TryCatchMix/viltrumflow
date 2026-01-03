from sqlalchemy import (
    Column, Integer, String, Boolean, DateTime, 
    ForeignKey, Text, Enum, Index, UniqueConstraint
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from datetime import datetime
import enum
from .database import Base


class Priority(str, enum.Enum):
    """Prioridad de las tareas"""
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    URGENT = "urgent"


class Status(str, enum.Enum):
    """Estado de las tareas"""
    TODO = "todo"
    IN_PROGRESS = "in_progress"
    REVIEW = "review"
    COMPLETED = "completed"
    ARCHIVED = "archived"


class UserRole(str, enum.Enum):
    """Roles de usuario"""
    ADMIN = "admin"
    MANAGER = "manager"
    USER = "user"
    GUEST = "guest"


class User(Base):
    """Modelo de Usuario"""
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    username = Column(String(50), unique=True, index=True, nullable=False)
    full_name = Column(String(100), nullable=True)
    hashed_password = Column(String(255), nullable=False)
    
    # Roles y permisos
    role = Column(Enum(UserRole), default=UserRole.USER, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    is_superuser = Column(Boolean, default=False, nullable=False)
    is_verified = Column(Boolean, default=False, nullable=False)
    
    # Información adicional
    avatar_url = Column(String(500), nullable=True)
    bio = Column(Text, nullable=True)
    phone = Column(String(20), nullable=True)
    
    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    last_login = Column(DateTime(timezone=True), nullable=True)
    
    # Relaciones
    tasks = relationship("Task", back_populates="owner", cascade="all, delete-orphan")
    assigned_tasks = relationship("Task", secondary="task_assignments", back_populates="assignees")
    comments = relationship("Comment", back_populates="author", cascade="all, delete-orphan")
    projects = relationship("Project", back_populates="owner", cascade="all, delete-orphan")
    
    # Índices
    __table_args__ = (
        Index('idx_user_email', 'email'),
        Index('idx_user_username', 'username'),
        Index('idx_user_active', 'is_active'),
    )

    def __repr__(self):
        return f"<User(id={self.id}, username={self.username}, email={self.email})>"


class Project(Base):
    """Modelo de Proyecto"""
    __tablename__ = "projects"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    slug = Column(String(100), unique=True, index=True, nullable=False)
    
    # Color y personalización
    color = Column(String(7), default="#3B82F6", nullable=False)  # Hex color
    icon = Column(String(50), nullable=True)
    
    # Estado
    is_active = Column(Boolean, default=True, nullable=False)
    is_archived = Column(Boolean, default=False, nullable=False)
    
    # Fechas
    start_date = Column(DateTime(timezone=True), nullable=True)
    end_date = Column(DateTime(timezone=True), nullable=True)
    
    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    
    # Foreign Keys
    owner_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    
    # Relaciones
    owner = relationship("User", back_populates="projects")
    tasks = relationship("Task", back_populates="project", cascade="all, delete-orphan")
    
    # Índices
    __table_args__ = (
        Index('idx_project_slug', 'slug'),
        Index('idx_project_owner', 'owner_id'),
        Index('idx_project_active', 'is_active'),
    )

    def __repr__(self):
        return f"<Project(id={self.id}, name={self.name}, slug={self.slug})>"


class Task(Base):
    """Modelo de Tarea"""
    __tablename__ = "tasks"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    
    # Estado y prioridad
    status = Column(Enum(Status), default=Status.TODO, nullable=False, index=True)
    priority = Column(Enum(Priority), default=Priority.MEDIUM, nullable=False, index=True)
    
    # Fechas
    due_date = Column(DateTime(timezone=True), nullable=True)
    start_date = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    
    # Estimación y seguimiento
    estimated_hours = Column(Integer, nullable=True)
    actual_hours = Column(Integer, nullable=True)
    progress = Column(Integer, default=0, nullable=False)  # 0-100
    
    # Etiquetas
    tags = Column(String(500), nullable=True)  # JSON array como string
    
    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    
    # Foreign Keys
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=True)
    parent_task_id = Column(Integer, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=True)
    
    # Relaciones
    owner = relationship("User", back_populates="tasks", foreign_keys=[user_id])
    project = relationship("Project", back_populates="tasks")
    assignees = relationship("User", secondary="task_assignments", back_populates="assigned_tasks")
    comments = relationship("Comment", back_populates="task", cascade="all, delete-orphan")
    subtasks = relationship("Task", backref="parent_task", remote_side=[id])
    
    # Índices
    __table_args__ = (
        Index('idx_task_status', 'status'),
        Index('idx_task_priority', 'priority'),
        Index('idx_task_user', 'user_id'),
        Index('idx_task_project', 'project_id'),
        Index('idx_task_due_date', 'due_date'),
        Index('idx_task_created', 'created_at'),
    )

    def __repr__(self):
        return f"<Task(id={self.id}, title={self.title}, status={self.status})>"


class TaskAssignment(Base):
    """Tabla intermedia para asignación de tareas"""
    __tablename__ = "task_assignments"

    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(Integer, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    assigned_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    
    __table_args__ = (
        UniqueConstraint('task_id', 'user_id', name='uq_task_user_assignment'),
        Index('idx_assignment_task', 'task_id'),
        Index('idx_assignment_user', 'user_id'),
    )


class Comment(Base):
    """Modelo de Comentario"""
    __tablename__ = "comments"

    id = Column(Integer, primary_key=True, index=True)
    content = Column(Text, nullable=False)
    
    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    
    # Foreign Keys
    task_id = Column(Integer, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False)
    author_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    
    # Relaciones
    task = relationship("Task", back_populates="comments")
    author = relationship("User", back_populates="comments")
    
    # Índices
    __table_args__ = (
        Index('idx_comment_task', 'task_id'),
        Index('idx_comment_author', 'author_id'),
        Index('idx_comment_created', 'created_at'),
    )

    def __repr__(self):
        return f"<Comment(id={self.id}, task_id={self.task_id}, author_id={self.author_id})>"