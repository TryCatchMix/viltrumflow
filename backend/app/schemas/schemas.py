from pydantic import BaseModel, EmailStr, Field, validator
from typing import Optional, List
from datetime import datetime
from .models import Priority, Status, UserRole


# ============ User Schemas ============
class UserBase(BaseModel):
    email: EmailStr
    username: str = Field(..., min_length=3, max_length=50)
    full_name: Optional[str] = Field(None, max_length=100)
    phone: Optional[str] = None
    bio: Optional[str] = None


class UserCreate(UserBase):
    password: str = Field(..., min_length=8, max_length=100)
    
    @validator('password')
    def validate_password(cls, v):
        if not any(char.isdigit() for char in v):
            raise ValueError('Password must contain at least one digit')
        if not any(char.isupper() for char in v):
            raise ValueError('Password must contain at least one uppercase letter')
        if not any(char.islower() for char in v):
            raise ValueError('Password must contain at least one lowercase letter')
        return v


class UserUpdate(BaseModel):
    email: Optional[EmailStr] = None
    username: Optional[str] = Field(None, min_length=3, max_length=50)
    full_name: Optional[str] = Field(None, max_length=100)
    phone: Optional[str] = None
    bio: Optional[str] = None
    avatar_url: Optional[str] = None


class UserUpdatePassword(BaseModel):
    current_password: str
    new_password: str = Field(..., min_length=8, max_length=100)


class User(UserBase):
    id: int
    role: UserRole
    is_active: bool
    is_verified: bool
    avatar_url: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    last_login: Optional[datetime] = None

    class Config:
        from_attributes = True


class UserInDB(User):
    hashed_password: str


# ============ Auth Schemas ============
class Token(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class TokenPayload(BaseModel):
    sub: Optional[int] = None
    exp: Optional[int] = None


class LoginRequest(BaseModel):
    username: str
    password: str


# ============ Project Schemas ============
class ProjectBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = None
    color: str = Field(default="#3B82F6", regex=r'^#[0-9A-Fa-f]{6}$')
    icon: Optional[str] = None
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None


class ProjectCreate(ProjectBase):
    pass


class ProjectUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = None
    color: Optional[str] = Field(None, regex=r'^#[0-9A-Fa-f]{6}$')
    icon: Optional[str] = None
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    is_active: Optional[bool] = None
    is_archived: Optional[bool] = None


class Project(ProjectBase):
    id: int
    slug: str
    is_active: bool
    is_archived: bool
    owner_id: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ProjectWithStats(Project):
    total_tasks: int = 0
    completed_tasks: int = 0
    in_progress_tasks: int = 0
    completion_percentage: float = 0.0


# ============ Task Schemas ============
class TaskBase(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    status: Status = Status.TODO
    priority: Priority = Priority.MEDIUM
    due_date: Optional[datetime] = None
    start_date: Optional[datetime] = None
    estimated_hours: Optional[int] = Field(None, ge=0)
    tags: Optional[str] = None
    project_id: Optional[int] = None
    parent_task_id: Optional[int] = None


class TaskCreate(TaskBase):
    assignee_ids: Optional[List[int]] = []


class TaskUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = None
    status: Optional[Status] = None
    priority: Optional[Priority] = None
    due_date: Optional[datetime] = None
    start_date: Optional[datetime] = None
    estimated_hours: Optional[int] = Field(None, ge=0)
    actual_hours: Optional[int] = Field(None, ge=0)
    progress: Optional[int] = Field(None, ge=0, le=100)
    tags: Optional[str] = None
    project_id: Optional[int] = None
    assignee_ids: Optional[List[int]] = None


class TaskAssignee(BaseModel):
    id: int
    username: str
    full_name: Optional[str]
    avatar_url: Optional[str]

    class Config:
        from_attributes = True


class Task(TaskBase):
    id: int
    user_id: int
    progress: int
    actual_hours: Optional[int]
    completed_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime
    assignees: List[TaskAssignee] = []

    class Config:
        from_attributes = True


class TaskWithDetails(Task):
    owner: User
    project: Optional[Project] = None
    subtasks_count: int = 0


# ============ Comment Schemas ============
class CommentBase(BaseModel):
    content: str = Field(..., min_length=1)


class CommentCreate(CommentBase):
    task_id: int


class CommentUpdate(BaseModel):
    content: str = Field(..., min_length=1)


class Comment(CommentBase):
    id: int
    task_id: int
    author_id: int
    created_at: datetime
    updated_at: datetime
    author: User

    class Config:
        from_attributes = True


# ============ Pagination Schema ============
class PaginationParams(BaseModel):
    skip: int = Field(default=0, ge=0)
    limit: int = Field(default=20, ge=1, le=100)


class PaginatedResponse(BaseModel):
    total: int
    skip: int
    limit: int
    data: List[BaseModel]


# ============ Generic Response ============
class Message(BaseModel):
    message: str
    

class ErrorResponse(BaseModel):
    detail: str