import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { tap } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import {
  CalendarEvent, CalendarStatus, ChecklistItem, Comment, Graph, ImportResult, Note, NoteSummary, Overview, Project,
  Reminder, SearchResult, Status, TagCount, Task, TaskInput,
} from './models';

type Query = Record<string, string | number | boolean | null | undefined>;

function params(q?: Query): HttpParams {
  let p = new HttpParams();
  for (const [k, v] of Object.entries(q ?? {})) {
    if (v !== null && v !== undefined && v !== '') p = p.set(k, String(v));
  }
  return p;
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);
  readonly base = `${environment.apiUrl}/api/v1`;

  /** Se emite cuando cambian tareas o notas, para que las vistas abiertas se refresquen. */
  readonly tasksChanged = new Subject<void>();
  readonly notesChanged = new Subject<void>();
  private t = <T>(o: Observable<T>) => o.pipe(tap(() => this.tasksChanged.next()));
  private n = <T>(o: Observable<T>) => o.pipe(tap(() => this.notesChanged.next()));

  // Tareas
  tasks(q?: Query) { return this.http.get<Task[]>(`${this.base}/tasks`, { params: params(q) }); }
  task(id: number) { return this.http.get<Task>(`${this.base}/tasks/${id}`); }
  createTask(data: TaskInput) { return this.t(this.http.post<Task>(`${this.base}/tasks`, data)); }
  updateTask(id: number, data: TaskInput) { return this.t(this.http.put<Task>(`${this.base}/tasks/${id}`, data)); }
  moveTask(id: number, status: Status, position: number) {
    return this.http.patch<Task>(`${this.base}/tasks/${id}/move`, { status, position });
  }
  deleteTask(id: number) { return this.t(this.http.delete<void>(`${this.base}/tasks/${id}`)); }
  comments(taskId: number) { return this.http.get<Comment[]>(`${this.base}/tasks/${taskId}/comments`); }
  addComment(taskId: number, content: string) { return this.http.post<Comment>(`${this.base}/tasks/${taskId}/comments`, { content }); }
  deleteComment(taskId: number, id: number) { return this.http.delete<void>(`${this.base}/tasks/${taskId}/comments/${id}`); }

  // Proyectos
  projects(includeArchived = false) { return this.http.get<Project[]>(`${this.base}/projects`, { params: params({ include_archived: includeArchived }) }); }
  createProject(data: Partial<Project>) { return this.http.post<Project>(`${this.base}/projects`, data); }
  updateProject(id: number, data: Partial<Project>) { return this.http.put<Project>(`${this.base}/projects/${id}`, data); }
  deleteProject(id: number) { return this.http.delete<void>(`${this.base}/projects/${id}`); }

  // Notas
  notes(q?: Query) { return this.http.get<NoteSummary[]>(`${this.base}/notes`, { params: params(q) }); }
  note(id: number) { return this.http.get<Note>(`${this.base}/notes/${id}`); }
  noteByTitle(title: string) { return this.http.get<Note>(`${this.base}/notes/by-title/${encodeURIComponent(title)}`); }
  createNote(data: { title: string; content?: string; folder?: string }) { return this.n(this.http.post<Note>(`${this.base}/notes`, data)); }
  updateNote(id: number, data: Partial<Pick<Note, 'title' | 'content' | 'folder' | 'is_pinned'>>) {
    return this.n(this.http.put<Note>(`${this.base}/notes/${id}`, data));
  }
  deleteNote(id: number) { return this.n(this.http.delete<void>(`${this.base}/notes/${id}`)); }
  dailyNote(day: string) { return this.n(this.http.post<Note>(`${this.base}/notes/daily`, null, { params: params({ day }) })); }
  graph(includeTags: boolean) { return this.http.get<Graph>(`${this.base}/notes/graph`, { params: params({ include_tags: includeTags }) }); }
  tags() { return this.http.get<TagCount[]>(`${this.base}/notes/tags`); }
  checklist() { return this.http.get<ChecklistItem[]>(`${this.base}/notes/checklist`); }
  toggleChecklist(noteId: number, line: number, checked: boolean) {
    return this.http.patch<Note>(`${this.base}/notes/${noteId}/checklist`, { line, checked });
  }

  exportNotes() { return this.http.get(`${this.base}/notes/export`, { responseType: 'blob' }); }
  importNotes(files: File[], overwrite: boolean) {
    const form = new FormData();
    for (const f of files) form.append('files', f, f.name);
    return this.n(this.http.post<ImportResult>(`${this.base}/notes/import`, form, { params: params({ overwrite }) }));
  }

  // Recordatorios
  pollReminders() { return this.http.post<Reminder[]>(`${this.base}/reminders/poll`, null); }
  notificationStatus() { return this.http.get<{ email_configured: boolean }>(`${this.base}/reminders/status`); }

  // Estadísticas y búsqueda
  overview(days: number) {
    return this.http.get<Overview>(`${this.base}/stats/overview`, { params: params({ days, tz_offset: -new Date().getTimezoneOffset() }) });
  }
  search(q: string) { return this.http.get<SearchResult[]>(`${this.base}/search`, { params: params({ q }) }); }

  // Google Calendar
  calendarStatus() { return this.http.get<CalendarStatus>(`${this.base}/calendar/status`); }
  calendarAuthUrl() { return this.http.get<{ url: string }>(`${this.base}/calendar/auth-url`); }
  calendarEvents(start: string, end: string) { return this.http.get<CalendarEvent[]>(`${this.base}/calendar/events`, { params: params({ start, end }) }); }
  calendarSync() { return this.t(this.http.post<{ synced: number; failed: number }>(`${this.base}/calendar/sync`, null)); }
  calendarSettings(auto_sync: boolean) { return this.http.put<CalendarStatus>(`${this.base}/calendar/settings`, { auto_sync }); }
  calendarDisconnect() { return this.http.delete<void>(`${this.base}/calendar/disconnect`); }
}
