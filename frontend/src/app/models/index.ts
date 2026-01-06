// Enums
export enum UserRole {
  ADMIN = 'admin',
  MANAGER = 'manager',
  USER = 'user',
  GUEST = 'guest'
}

export enum Priority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  URGENT = 'urgent'
}

export enum Status {
  TODO = 'todo',
  IN_PROGRESS = 'in_progress',
  REVIEW = 'review',
  COMPLETED = 'completed',
  ARCHIVED = 'archived'
}

// User interfaces
export interface User {
  id: number;
  email: string;
  username: string;
  full_name?: string;
  role: UserRole;
  is_active: boolean;
  is_verified: boolean;
  avatar_url?: string;
  bio?: string;
  phone?: string;
  created_at: string;
  updated_at: string;
  last_login?: string;
}

export interface UserCreate {
  email: string;
  username: string;
  password: string;
  full_name?: string;
  phone?: string;
  bio?: string;
}

export interface UserUpdate {
  email?: string;
  username?: string;
  full_name?: string;
  phone?: string;
  bio?: string;
  avatar_url?: string;
}

// Auth interfaces
export interface LoginRequest {
  username: string;
  password: string;
}

export interface Token {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

// Project interfaces
export interface Project {
  id: number;
  name: string;
  description?: string;
  slug: string;
  color: string;
  icon?: string;
  is_active: boolean;
  is_archived: boolean;
  start_date?: string;
  end_date?: string;
  owner_id: number;
  created_at: string;
  updated_at: string;
}

export interface ProjectCreate {
  name: string;
  description?: string;
  color?: string;
  icon?: string;
  start_date?: string;
  end_date?: string;
}

export interface ProjectUpdate {
  name?: string;
  description?: string;
  color?: string;
  icon?: string;
  start_date?: string;
  end_date?: string;
  is_active?: boolean;
  is_archived?: boolean;
}

// Task interfaces
export interface TaskAssignee {
  id: number;
  username: string;
  full_name?: string;
  avatar_url?: string;
}

export interface Task {
  id: number;
  title: string;
  description?: string;
  status: Status;
  priority: Priority;
  due_date?: string;
  start_date?: string;
  completed_at?: string;
  estimated_hours?: number;
  actual_hours?: number;
  progress: number;
  tags?: string;
  user_id: number;
  project_id?: number;
  parent_task_id?: number;
  created_at: string;
  updated_at: string;
  assignees: TaskAssignee[];
}

export interface TaskCreate {
  title: string;
  description?: string;
  status?: Status;
  priority?: Priority;
  due_date?: string;
  start_date?: string;
  estimated_hours?: number;
  tags?: string;
  project_id?: number;
  parent_task_id?: number;
  assignee_ids?: number[];
}

export interface TaskUpdate {
  title?: string;
  description?: string;
  status?: Status;
  priority?: Priority;
  due_date?: string;
  start_date?: string;
  estimated_hours?: number;
  actual_hours?: number;
  progress?: number;
  tags?: string;
  project_id?: number;
  assignee_ids?: number[];
}

// Comment interfaces
export interface Comment {
  id: number;
  content: string;
  task_id: number;
  author_id: number;
  created_at: string;
  updated_at: string;
  author: User;
}

export interface CommentCreate {
  content: string;
  task_id: number;
}

export interface CommentUpdate {
  content: string;
}

// Generic response
export interface Message {
  message: string;
}
