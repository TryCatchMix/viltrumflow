import { Injectable, computed, signal } from '@angular/core';
import { Note, Task, TaskInput } from './models';

export interface PendingTask { id: number; data: TaskInput; created_at: string; }
export interface PendingNote { id: number; title: string; content: string; folder: string; created_at: string; }
const KEY = 'vf-outbox';

/**
 * Tareas y notas creadas sin conexión. Se guardan en el dispositivo con un id negativo provisional
 * y se muestran mezcladas con las del servidor hasta que se pueden enviar.
 */
@Injectable({ providedIn: 'root' })
export class Outbox {
  readonly tasks = signal<PendingTask[]>([]);
  readonly notes = signal<PendingNote[]>([]);
  readonly count = computed(() => this.tasks().length + this.notes().length);

  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
      this.tasks.set(saved.tasks ?? []);
      this.notes.set(saved.notes ?? []);
    } catch { /* almacenamiento ilegible: se empieza vacío */ }
  }

  private save() {
    try { localStorage.setItem(KEY, JSON.stringify({ tasks: this.tasks(), notes: this.notes() })); } catch { /* sin espacio */ }
  }
  private nextId(): number {
    return Math.min(0, ...this.tasks().map(t => t.id), ...this.notes().map(n => n.id)) - 1;
  }

  addTask(data: TaskInput): PendingTask {
    const t = { id: this.nextId(), data, created_at: new Date().toISOString() };
    this.tasks.update(l => [t, ...l]);
    this.save();
    return t;
  }
  updateTask(id: number, data: TaskInput): PendingTask | undefined {
    this.tasks.update(l => l.map(t => (t.id === id ? { ...t, data: { ...t.data, ...data } } : t)));
    this.save();
    return this.tasks().find(t => t.id === id);
  }
  removeTask(id: number) { this.tasks.update(l => l.filter(t => t.id !== id)); this.save(); }

  addNote(title: string, content = '', folder = ''): PendingNote {
    const n = { id: this.nextId(), title, content, folder, created_at: new Date().toISOString() };
    this.notes.update(l => [n, ...l]);
    this.save();
    return n;
  }
  updateNote(id: number, data: Partial<Pick<PendingNote, 'title' | 'content' | 'folder'>>): PendingNote | undefined {
    this.notes.update(l => l.map(n => (n.id === id ? { ...n, ...data } : n)));
    this.save();
    return this.notes().find(n => n.id === id);
  }
  removeNote(id: number) { this.notes.update(l => l.filter(n => n.id !== id)); this.save(); }

  clear() { this.tasks.set([]); this.notes.set([]); localStorage.removeItem(KEY); }
}

/** Forma de tarea completa para pintar una pendiente en las listas. */
export function asTask(p: PendingTask): Task {
  const d = p.data;
  return {
    id: p.id, title: d.title ?? '', description: d.description ?? null, status: d.status ?? 'todo', priority: d.priority ?? 'medium',
    due_date: d.due_date ?? null, all_day: d.all_day ?? true, completed_at: null, estimated_minutes: d.estimated_minutes ?? null,
    tags: d.tags ?? [], position: -1, project_id: d.project_id ?? null, parent_task_id: null, note_id: null, google_event_id: null,
    recurrence: d.recurrence ?? 'none', reminder_minutes: d.reminder_minutes ?? null, difficulty: d.difficulty ?? 2, time_spent_seconds: 0, user_id: 0, owner_name: '',
    assignee_id: d.assignee_id ?? null, assignee_name: null, can_edit: true, created_at: p.created_at, updated_at: p.created_at,
    subtasks: [], pending: true,
  };
}

export function asNote(p: PendingNote): Note {
  return {
    id: p.id, title: p.title, folder: p.folder, content: p.content, tags: [], is_pinned: false, is_daily: false,
    created_at: p.created_at, updated_at: p.created_at, backlinks: [], outgoing: [], pending: true,
  };
}
