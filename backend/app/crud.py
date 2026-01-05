from sqlalchemy.orm import Session
from sqlalchemy import and_, or_
from typing import Optional, List
from datetime import datetime
from . import models, schemas
from .auth import get_password_hash


# ============ User CRUD ============

def get_user(db: Session, user_id: int) -> Optional[models.User]:
    """Obtener usuario por ID"""
    return db.query(models.User).filter(models.User.id == user_id).first()


def get_user_by_email(db: Session, email: str) -> Optional[models.User]:
    """Obtener usuario por email"""
    return db.query(models.User).filter(models.User.email == email).first()


def get_user_by_username(db: Session, username: str) -> Optional[models.User]:
    """Obtener usuario por username"""
    return db.query(models.User).filter(models.User.username == username).first()


def get_users(db: Session, skip: int = 0, limit: int = 100) -> List[models.User]:
    """Obtener lista de usuarios"""
    return db.query(models.User).offset(skip).limit(limit).all()


def create_user(db: Session, user: schemas.UserCreate) -> models.User:
    """Crear nuevo usuario"""
    hashed_password = get_password_hash(user.password)
    db_user = models.User(
        email=user.email,
        username=user.username,
        full_name=user.full_name,
        phone=user.phone,
        bio=user.bio,
        hashed_password=hashed_password,
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user


def update_user(db: Session, user_id: int, user: schemas.UserUpdate) -> Optional[models.User]:
    """Actualizar usuario"""
    db_user = get_user(db, user_id)
    if not db_user:
        return None
    
    update_data = user.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(db_user, field, value)
    
    db.commit()
    db.refresh(db_user)
    return db_user


def delete_user(db: Session, user_id: int) -> bool:
    """Eliminar usuario"""
    db_user = get_user(db, user_id)
    if not db_user:
        return False
    
    db.delete(db_user)
    db.commit()
    return True


# ============ Project CRUD ============

def get_project(db: Session, project_id: int) -> Optional[models.Project]:
    """Obtener proyecto por ID"""
    return db.query(models.Project).filter(models.Project.id == project_id).first()


def get_project_by_slug(db: Session, slug: str) -> Optional[models.Project]:
    """Obtener proyecto por slug"""
    return db.query(models.Project).filter(models.Project.slug == slug).first()


def get_projects(
    db: Session, 
    owner_id: Optional[int] = None,
    skip: int = 0, 
    limit: int = 100
) -> List[models.Project]:
    """Obtener lista de proyectos"""
    query = db.query(models.Project)
    
    if owner_id:
        query = query.filter(models.Project.owner_id == owner_id)
    
    return query.offset(skip).limit(limit).all()


def create_project(db: Session, project: schemas.ProjectCreate, owner_id: int) -> models.Project:
    """Crear nuevo proyecto"""
    from slugify import slugify
    
    slug = slugify(project.name)
    # Asegurar slug único
    base_slug = slug
    counter = 1
    while get_project_by_slug(db, slug):
        slug = f"{base_slug}-{counter}"
        counter += 1
    
    db_project = models.Project(
        **project.model_dump(),
        slug=slug,
        owner_id=owner_id
    )
    db.add(db_project)
    db.commit()
    db.refresh(db_project)
    return db_project


def update_project(
    db: Session, 
    project_id: int, 
    project: schemas.ProjectUpdate
) -> Optional[models.Project]:
    """Actualizar proyecto"""
    db_project = get_project(db, project_id)
    if not db_project:
        return None
    
    update_data = project.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(db_project, field, value)
    
    db.commit()
    db.refresh(db_project)
    return db_project


def delete_project(db: Session, project_id: int) -> bool:
    """Eliminar proyecto"""
    db_project = get_project(db, project_id)
    if not db_project:
        return False
    
    db.delete(db_project)
    db.commit()
    return True


# ============ Task CRUD ============

def get_task(db: Session, task_id: int) -> Optional[models.Task]:
    """Obtener tarea por ID"""
    return db.query(models.Task).filter(models.Task.id == task_id).first()


def get_tasks(
    db: Session,
    user_id: Optional[int] = None,
    project_id: Optional[int] = None,
    status: Optional[models.Status] = None,
    priority: Optional[models.Priority] = None,
    skip: int = 0,
    limit: int = 100
) -> List[models.Task]:
    """Obtener lista de tareas con filtros"""
    query = db.query(models.Task)
    
    if user_id:
        query = query.filter(models.Task.user_id == user_id)
    
    if project_id:
        query = query.filter(models.Task.project_id == project_id)
    
    if status:
        query = query.filter(models.Task.status == status)
    
    if priority:
        query = query.filter(models.Task.priority == priority)
    
    return query.order_by(models.Task.created_at.desc()).offset(skip).limit(limit).all()


def create_task(db: Session, task: schemas.TaskCreate, user_id: int) -> models.Task:
    """Crear nueva tarea"""
    task_data = task.model_dump(exclude={'assignee_ids'})
    db_task = models.Task(**task_data, user_id=user_id)
    
    db.add(db_task)
    db.commit()
    db.refresh(db_task)
    
    # Asignar usuarios si se especificaron
    if task.assignee_ids:
        for assignee_id in task.assignee_ids:
            assignment = models.TaskAssignment(
                task_id=db_task.id,
                user_id=assignee_id
            )
            db.add(assignment)
        db.commit()
        db.refresh(db_task)
    
    return db_task


def update_task(db: Session, task_id: int, task: schemas.TaskUpdate) -> Optional[models.Task]:
    """Actualizar tarea"""
    db_task = get_task(db, task_id)
    if not db_task:
        return None
    
    update_data = task.model_dump(exclude_unset=True, exclude={'assignee_ids'})
    
    # Actualizar completed_at si el status cambió a completed
    if 'status' in update_data and update_data['status'] == models.Status.COMPLETED:
        update_data['completed_at'] = datetime.utcnow()
    
    for field, value in update_data.items():
        setattr(db_task, field, value)
    
    # Actualizar asignaciones si se especificaron
    if task.assignee_ids is not None:
        # Eliminar asignaciones actuales
        db.query(models.TaskAssignment).filter(
            models.TaskAssignment.task_id == task_id
        ).delete()
        
        # Crear nuevas asignaciones
        for assignee_id in task.assignee_ids:
            assignment = models.TaskAssignment(
                task_id=task_id,
                user_id=assignee_id
            )
            db.add(assignment)
    
    db.commit()
    db.refresh(db_task)
    return db_task


def delete_task(db: Session, task_id: int) -> bool:
    """Eliminar tarea"""
    db_task = get_task(db, task_id)
    if not db_task:
        return False
    
    db.delete(db_task)
    db.commit()
    return True


# ============ Comment CRUD ============

def get_comment(db: Session, comment_id: int) -> Optional[models.Comment]:
    """Obtener comentario por ID"""
    return db.query(models.Comment).filter(models.Comment.id == comment_id).first()


def get_comments_by_task(db: Session, task_id: int) -> List[models.Comment]:
    """Obtener comentarios de una tarea"""
    return db.query(models.Comment).filter(
        models.Comment.task_id == task_id
    ).order_by(models.Comment.created_at.desc()).all()


def create_comment(
    db: Session, 
    comment: schemas.CommentCreate, 
    author_id: int
) -> models.Comment:
    """Crear nuevo comentario"""
    db_comment = models.Comment(
        content=comment.content,
        task_id=comment.task_id,
        author_id=author_id
    )
    db.add(db_comment)
    db.commit()
    db.refresh(db_comment)
    return db_comment


def update_comment(
    db: Session, 
    comment_id: int, 
    comment: schemas.CommentUpdate
) -> Optional[models.Comment]:
    """Actualizar comentario"""
    db_comment = get_comment(db, comment_id)
    if not db_comment:
        return None
    
    db_comment.content = comment.content
    db.commit()
    db.refresh(db_comment)
    return db_comment


def delete_comment(db: Session, comment_id: int) -> bool:
    """Eliminar comentario"""
    db_comment = get_comment(db, comment_id)
    if not db_comment:
        return False
    
    db.delete(db_comment)
    db.commit()
    return True