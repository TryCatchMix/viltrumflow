import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, Subject, of } from 'rxjs';
import { map, tap } from 'rxjs/operators';
import { Outbox, asNote, asTask } from './outbox';
import { environment } from '../../environments/environment';
import {
  GameHistory, GameProfile, Habit, HabitDayItem, HabitInput, HabitStats, PomodoroSettings, PomodoroStats,
  CalendarEvent, CalendarInfo, CalendarStatus, ChecklistItem, Mention, NoteVersion, Comment, Graph, ImportResult, Member, Note, NoteSummary, Overview, Project,
  Reminder, Role, SearchResult, TrashItem, Status, TagCount, Task, TaskInput,
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
  private outbox = inject(Outbox);
  readonly base = `${environment.apiUrl}/api/v1`;

  /** Se emite cuando cambian tareas o notas, para que las vistas abiertas se refresquen. */
  readonly tasksChanged = new Subject<void>();
  readonly notesChanged = new Subject<void>();
  /** La experiencia puede haber cambiado (rutina marcada); las tareas avisan por `tasksChanged`. */
  readonly xpChanged = new Subject<void>();
  private t = <T>(o: Observable<T>) => o.pipe(tap(() => this.tasksChanged.next()));
  private n = <T>(o: Observable<T>) => o.pipe(tap(() => this.notesChanged.next()));

  // Tareas
  /** Incluye, al principio, las tareas creadas sin conexión que aún no se han enviado. */
  tasks(q?: Query) {
    return this.http.get<Task[]>(`${this.base}/tasks`, { params: params(q) }).pipe(
      map(list => (q?.['note_id'] || q?.['assigned_to_me'] ? list : [...this.outbox.tasks().map(asTask), ...list])),
    );
  }
  task(id: number) { return this.http.get<Task>(`${this.base}/tasks/${id}`); }
  createTask(data: TaskInput) {
    // Sin conexión, la tarea se guarda en el dispositivo y se envía al reconectar (las subtareas necesitan a su padre)
    if (!navigator.onLine && !data.parent_task_id) return this.t(of(asTask(this.outbox.addTask(data))));
    return this.t(this.postTask(data));
  }
  /** Envío real al servidor, sin pasar por la cola. */
  postTask(data: TaskInput) { return this.http.post<Task>(`${this.base}/tasks`, data); }
  updateTask(id: number, data: TaskInput) {
    if (id < 0) return this.t(of(asTask(this.outbox.updateTask(id, data)!)));
    return this.t(this.http.put<Task>(`${this.base}/tasks/${id}`, data));
  }
  moveTask(id: number, status: Status, position: number) {
    if (id < 0) return of(asTask(this.outbox.updateTask(id, { status })!));
    return this.http.patch<Task>(`${this.base}/tasks/${id}/move`, { status, position });
  }
  deleteTask(id: number) {
    if (id < 0) { this.outbox.removeTask(id); return this.t(of(undefined as void)); }
    return this.t(this.http.delete<void>(`${this.base}/tasks/${id}`));
  }
  comments(taskId: number) { if (taskId < 0) return of([] as Comment[]); return this.http.get<Comment[]>(`${this.base}/tasks/${taskId}/comments`); }
  addComment(taskId: number, content: string) { return this.http.post<Comment>(`${this.base}/tasks/${taskId}/comments`, { content }); }
  deleteComment(taskId: number, id: number) { return this.http.delete<void>(`${this.base}/tasks/${taskId}/comments/${id}`); }

  // Proyectos
  projects(includeArchived = false) { return this.http.get<Project[]>(`${this.base}/projects`, { params: params({ include_archived: includeArchived }) }); }
  createProject(data: Partial<Project>) { return this.http.post<Project>(`${this.base}/projects`, data); }
  updateProject(id: number, data: Partial<Project>) { return this.http.put<Project>(`${this.base}/projects/${id}`, data); }
  deleteProject(id: number) { return this.http.delete<void>(`${this.base}/projects/${id}`); }

  members(projectId: number) { return this.http.get<Member[]>(`${this.base}/projects/${projectId}/members`); }
  addMember(projectId: number, identifier: string, role: Role) { return this.http.post<Member[]>(`${this.base}/projects/${projectId}/members`, { identifier, role }); }
  updateMember(projectId: number, userId: number, role: Role) { return this.http.put<Member[]>(`${this.base}/projects/${projectId}/members/${userId}`, { role }); }
  removeMember(projectId: number, userId: number) { return this.t(this.http.delete<void>(`${this.base}/projects/${projectId}/members/${userId}`)); }

  // Papelera
  trash() { return this.http.get<TrashItem[]>(`${this.base}/trash`); }
  restore(kind: 'note' | 'task', id: number) {
    const o = this.http.post<{ message: string }>(`${this.base}/trash/${kind}/${id}/restore`, null);
    return kind === 'note' ? this.n(o) : this.t(o);
  }
  deleteForever(kind: 'note' | 'task', id: number) { return this.http.delete<void>(`${this.base}/trash/${kind}/${id}`); }
  emptyTrash() { return this.http.delete<void>(`${this.base}/trash`); }

  // Notas
  notes(q?: Query) {
    return this.http.get<NoteSummary[]>(`${this.base}/notes`, { params: params(q) }).pipe(
      map(list => (q?.['q'] || q?.['tag'] ? list : [...this.outbox.notes().map(asNote), ...list])),
    );
  }
  note(id: number): Observable<Note> {
    if (id < 0) {
      const p = this.outbox.notes().find(n => n.id === id);
      return p ? of(asNote(p)) : this.http.get<Note>(`${this.base}/notes/0`);  // ya sincronizada o inexistente → 404
    }
    return this.http.get<Note>(`${this.base}/notes/${id}`);
  }
  /** Lee la nota directamente del servidor, sin pasar por la copia guardada para uso sin conexión. */
  noteFresh(id: number) { return this.http.get<Note>(`${this.base}/notes/${id}`, { headers: { 'ngsw-bypass': 'true' } }); }
  /** Nota creada solo en el dispositivo, para cuando no hay conexión. */
  createLocalNote(title: string, folder = ''): Note { const n = asNote(this.outbox.addNote(title, '', folder)); this.notesChanged.next(); return n; }
  noteByTitle(title: string) { return this.http.get<Note>(`${this.base}/notes/by-title/${encodeURIComponent(title)}`); }
  createNote(data: { title: string; content?: string; folder?: string; template_id?: number; day?: string; time?: string }) { return this.n(this.http.post<Note>(`${this.base}/notes`, data)); }
  updateNote(id: number, data: Partial<Pick<Note, 'title' | 'content' | 'folder' | 'is_pinned'>> & { base_updated_at?: string }) {
    if (id < 0) {
      const { is_pinned, base_updated_at, ...local } = data;
      return this.n(of(asNote(this.outbox.updateNote(id, local)!)));
    }
    return this.n(this.http.put<Note>(`${this.base}/notes/${id}`, data));
  }
  deleteNote(id: number) {
    if (id < 0) { this.outbox.removeNote(id); return this.n(of(undefined as void)); }
    return this.n(this.http.delete<void>(`${this.base}/notes/${id}`));
  }
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

  convertChecklist(noteId: number, line: number, extra: TaskInput = {}) {
    return this.t(this.n(this.http.post<Task>(`${this.base}/notes/${noteId}/checklist/convert`, { line, ...extra })));
  }

  versions(noteId: number) { return this.http.get<NoteVersion[]>(`${this.base}/notes/${noteId}/versions`); }
  version(noteId: number, id: number) { return this.http.get<NoteVersion>(`${this.base}/notes/${noteId}/versions/${id}`); }
  restoreVersion(noteId: number, id: number) { return this.n(this.http.post<Note>(`${this.base}/notes/${noteId}/versions/${id}/restore`, null)); }
  mentions(noteId: number) { return this.http.get<Mention[]>(`${this.base}/notes/${noteId}/mentions`); }
  linkMention(noteId: number, sourceId: number) { return this.n(this.http.post<Note>(`${this.base}/notes/${noteId}/mentions/${sourceId}/link`, null)); }
  startTimer(taskId: number) { return this.t(this.http.post<Task>(`${this.base}/tasks/${taskId}/timer/start`, null)); }
  stopTimer(taskId: number) { return this.t(this.http.post<Task>(`${this.base}/tasks/${taskId}/timer/stop`, null)); }

  // Rutinas
  habits(includeArchived = false) { return this.http.get<Habit[]>(`${this.base}/habits`, { params: params({ include_archived: includeArchived }) }); }
  habitsOfDay(day: string) { return this.http.get<HabitDayItem[]>(`${this.base}/habits/day`, { params: params({ day }) }); }
  createHabit(data: HabitInput) { return this.http.post<Habit>(`${this.base}/habits`, data); }
  updateHabit(id: number, data: HabitInput) { return this.http.put<Habit>(`${this.base}/habits/${id}`, data); }
  deleteHabit(id: number) { return this.http.delete<void>(`${this.base}/habits/${id}`); }
  checkHabit(id: number, day: string, checked: boolean) {
    return this.http.put<{ item: HabitDayItem; xp_gained: number }>(`${this.base}/habits/${id}/check`, { day, checked }).pipe(tap(() => this.xpChanged.next()));
  }
  habitStats(days: number) { return this.http.get<HabitStats>(`${this.base}/habits/stats`, { params: params({ days }) }); }

  // Pomodoro
  pomodoroSettings() { return this.http.get<PomodoroSettings>(`${this.base}/pomodoro/settings`); }
  savePomodoroSettings(s: PomodoroSettings) { return this.http.put<PomodoroSettings>(`${this.base}/pomodoro/settings`, s); }
  logPomodoro(seconds: number, task_id: number | null) {
    return this.t(this.http.post<{ xp_gained: number; task_title?: string | null }>(`${this.base}/pomodoro/sessions`, { seconds, task_id }));
  }
  pomodoroStats(days: number) { return this.http.get<PomodoroStats>(`${this.base}/pomodoro/stats`, { params: params({ days }) }); }

  // Progreso
  gameProfile() { return this.http.get<GameProfile>(`${this.base}/game/profile`); }
  gameHistory(days: number) { return this.http.get<GameHistory>(`${this.base}/game/history`, { params: params({ days }) }); }

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
  calendarSettings(data: { auto_sync?: boolean; calendar_id?: string }) { return this.http.put<CalendarStatus>(`${this.base}/calendar/settings`, data); }
  calendars() { return this.http.get<CalendarInfo[]>(`${this.base}/calendar/calendars`); }
  calendarDisconnect() { return this.http.delete<void>(`${this.base}/calendar/disconnect`); }
}
