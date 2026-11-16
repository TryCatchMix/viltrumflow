export type Status = 'todo' | 'in_progress' | 'review' | 'completed' | 'archived';
export type Priority = 'low' | 'medium' | 'high' | 'urgent';

export const STATUS_LABEL: Record<Status, string> = {
  todo: 'Por hacer', in_progress: 'En curso', review: 'En revisión', completed: 'Completada', archived: 'Archivada',
};
export const PRIORITY_LABEL: Record<Priority, string> = { low: 'Baja', medium: 'Media', high: 'Alta', urgent: 'Urgente' };
export type Recurrence = 'none' | 'daily' | 'weekdays' | 'weekly' | 'biweekly' | 'monthly' | 'yearly';
export const RECURRENCE_LABEL: Record<Recurrence, string> = {
  none: 'No se repite', daily: 'Cada día', weekdays: 'Días laborables (lun–vie)', weekly: 'Cada semana',
  biweekly: 'Cada 2 semanas', monthly: 'Cada mes', yearly: 'Cada año',
};
/** Minutos antes del vencimiento. En tareas de día completo el vencimiento se toma a las 9:00. */
export const REMINDER_OPTIONS: { value: number; timed: string; allDay: string }[] = [
  { value: 0, timed: 'A la hora de la tarea', allDay: 'Ese día a las 9:00' },
  { value: 10, timed: '10 minutos antes', allDay: 'Ese día a las 8:50' },
  { value: 30, timed: '30 minutos antes', allDay: 'Ese día a las 8:30' },
  { value: 60, timed: '1 hora antes', allDay: 'Ese día a las 8:00' },
  { value: 1440, timed: '1 día antes', allDay: 'El día anterior a las 9:00' },
];
export const BOARD_STATUSES: Status[] = ['todo', 'in_progress', 'review', 'completed'];
export const PRIORITIES: Priority[] = ['urgent', 'high', 'medium', 'low'];

export interface User {
  id: number; email: string; username: string; full_name?: string | null; avatar_url?: string | null;
  bio?: string | null; theme: 'light' | 'dark' | 'auto'; language: string; timezone: string;
  email_reminders: boolean; daily_digest: boolean; digest_hour: number; created_at: string; last_login?: string | null;
}
export interface Token { access_token: string; refresh_token: string; token_type: string; }

export interface Project {
  id: number; name: string; description?: string | null; color: string; is_archived: boolean;
  created_at: string; updated_at: string; total_tasks: number; completed_tasks: number;
}

export interface Subtask { id: number; title: string; status: Status; }
export interface Task {
  id: number; title: string; description?: string | null; status: Status; priority: Priority;
  due_date?: string | null; all_day: boolean; completed_at?: string | null; estimated_hours?: number | null;
  tags: string[]; position: number; project_id?: number | null; parent_task_id?: number | null;
  note_id?: number | null; google_event_id?: string | null; recurrence: Recurrence; reminder_minutes?: number | null;
  created_at: string; updated_at: string; subtasks: Subtask[];
}
export type TaskInput = Partial<Pick<Task, 'title' | 'description' | 'status' | 'priority' | 'due_date' | 'all_day'
  | 'estimated_hours' | 'tags' | 'project_id' | 'parent_task_id' | 'note_id' | 'recurrence' | 'reminder_minutes'>>;
export interface Comment { id: number; content: string; task_id: number; author_id: number; author_name: string; created_at: string; }

export interface NoteSummary {
  id: number; title: string; folder: string; tags: string[]; is_pinned: boolean; is_daily: boolean;
  created_at: string; updated_at: string; snippet?: string | null;
}
export interface NoteRef { id: number | null; title: string; context?: string | null; }
export interface Note extends NoteSummary { content: string; backlinks: NoteRef[]; outgoing: NoteRef[]; }
export interface GraphNode { id: string; label: string; kind: 'note' | 'ghost' | 'tag'; note_id?: number | null; degree: number; folder: string; }
export interface GraphEdge { source: string; target: string; kind: 'link' | 'tag'; }
export interface Graph { nodes: GraphNode[]; edges: GraphEdge[]; }
export interface TagCount { tag: string; count: number; }
export interface ChecklistItem { note_id: number; note_title: string; line: number; text: string; checked: boolean; }
export interface SearchResult { kind: 'note' | 'task' | 'project'; id: number; title: string; snippet?: string | null; }

export interface DayPoint { date: string; created: number; completed: number; open: number; }
export interface Overview {
  total: number; by_status: Record<Status, number>; by_priority: Record<Priority, number>;
  overdue: number; due_today: number; due_week: number; completed_week: number; completion_rate: number;
  notes: number; links: number; timeline: DayPoint[];
  projects: { id: number; name: string; color: string; total: number; completed: number }[];
  top_tags: { tag: string; count: number }[];
}

export interface Reminder { task_id: number; title: string; due_date: string; all_day: boolean; }
export interface ImportResult { created: number; updated: number; skipped: number; errors: string[]; }

export interface CalendarStatus { configured: boolean; connected: boolean; email?: string | null; auto_sync: boolean; }
export interface CalendarEvent { id: string; title: string; start: string; end: string; all_day: boolean; html_link?: string | null; task_id?: number | null; }
