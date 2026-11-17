import { Component, HostListener, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { Comment, DIFFICULTY_LABEL, Member, PRIORITIES, PRIORITY_LABEL, Priority, Project, RECURRENCE_LABEL, REMINDER_OPTIONS, Recurrence, STATUS_LABEL, Status, Subtask, Task } from '../core/models';
import { ToastService } from '../core/toast.service';
import { formatDuration, relativeTime, spentSeconds, taskDay, taskTime, toDue } from '../core/util';
import { IconComponent } from './icon.component';
import { TaskDialogService } from './task-dialog.service';

@Component({
  selector: 'app-task-dialog',
  standalone: true,
  imports: [FormsModule, RouterLink, IconComponent],
  template: `
  @if (svc.state(); as st) {
    <div class="scrim" (click)="svc.close()"></div>
    <aside class="drawer" role="dialog" aria-modal="true" [attr.aria-label]="st.mode === 'create' ? 'Nueva tarea' : 'Editar tarea'">
      <header class="row">
        <h2>{{ st.mode === 'create' ? 'Nueva tarea' : 'Tarea' }}</h2>
        <span class="spacer"></span>
        @if (task && !readOnly()) { <button class="btn ghost icon danger" title="Eliminar tarea" (click)="remove()"><app-icon name="trash" /></button> }
        <button class="btn ghost icon" title="Cerrar (Esc)" (click)="svc.close()"><app-icon name="x" /></button>
      </header>

      @if (readOnly()) {
        <p class="ro"><app-icon name="eye" [size]="14" /> Tienes permiso de solo lectura en este proyecto. Puedes comentar, pero no modificar la tarea.</p>
      }
      <form class="body" (ngSubmit)="save()">
       <fieldset [disabled]="readOnly()">
        <input class="input title" name="title" [(ngModel)]="f.title" placeholder="¿Qué hay que hacer?" required maxlength="200" #titleInput />
        <textarea class="input" name="description" [(ngModel)]="f.description" rows="4" placeholder="Descripción (opcional)"></textarea>

        <div class="grid">
          <label class="field">Estado
            <select class="input" name="status" [(ngModel)]="f.status">
              @for (s of statuses; track s) { <option [value]="s">{{ statusLabel[s] }}</option> }
            </select>
          </label>
          <label class="field">Prioridad
            <select class="input" name="priority" [(ngModel)]="f.priority">
              @for (p of priorities; track p) { <option [value]="p">{{ priorityLabel[p] }}</option> }
            </select>
          </label>
          <label class="field">Dificultad
            <select class="input" name="difficulty" [(ngModel)]="f.difficulty" title="Decide la experiencia que da completarla">
              @for (d of [1, 2, 3, 4]; track d) { <option [ngValue]="d">{{ difficultyLabel[d] }} · {{ xpBase[d] }} XP</option> }
            </select>
          </label>
          <label class="field">Estimación (horas)
            <input class="input" type="number" min="0" name="hours" [(ngModel)]="f.estimated_hours" />
          </label>
          <label class="field">Fecha
            <input class="input" type="date" name="day" [(ngModel)]="f.day" />
          </label>
          <label class="field">Hora (vacía = todo el día)
            <input class="input" type="time" name="time" [(ngModel)]="f.time" [disabled]="!f.day" />
          </label>
          <label class="field">Repetir
            <select class="input" name="recurrence" [(ngModel)]="f.recurrence">
              @for (r of recurrences; track r) { <option [value]="r">{{ recurrenceLabel[r] }}</option> }
            </select>
          </label>
          <label class="field">Recordatorio
            <select class="input" name="reminder" [(ngModel)]="f.reminder_minutes" [disabled]="!f.day">
              <option [ngValue]="null">{{ f.day ? 'Sin recordatorio' : 'Pon una fecha primero' }}</option>
              @for (r of reminders; track r.value) { <option [ngValue]="r.value">{{ f.time ? r.timed : r.allDay }}</option> }
            </select>
          </label>
          <label class="field">Proyecto
            <select class="input" name="project" [(ngModel)]="f.project_id" (ngModelChange)="onProject($event)">
              <option [ngValue]="null">Sin proyecto</option>
              @for (p of writable(); track p.id) { <option [ngValue]="p.id">{{ p.name }}</option> }
            </select>
          </label>
          @if (members().length > 1) {
            <label class="field">Responsable
              <select class="input" name="assignee" [(ngModel)]="f.assignee_id">
                <option [ngValue]="null">Sin asignar</option>
                @for (m of members(); track m.user_id) { <option [ngValue]="m.user_id">{{ m.name }}</option> }
              </select>
            </label>
          }
        </div>
        @if (f.recurrence !== 'none') {
          <p class="note"><app-icon name="repeat" [size]="13" /> Al completarla se creará la siguiente{{ f.day ? '' : ' (contando desde hoy)' }}.</p>
        }
        <label class="field">Etiquetas (separadas por comas)
          <input class="input" name="tags" [(ngModel)]="f.tags" placeholder="trabajo, urgente" />
        </label>

        <div class="row actions">
          @if (task?.google_event_id) { <span class="chip" title="Esta tarea tiene un evento en Google Calendar"><app-icon name="calendar" [size]="12" /> En Google Calendar</span> }
          <span class="spacer"></span>
          <button type="button" class="btn" (click)="svc.close()">Cancelar</button>
          <button class="btn primary" [disabled]="saving() || !f.title.trim()">{{ task ? 'Guardar' : 'Crear tarea' }}</button>
        </div>
       </fieldset>
      </form>

      @if (task?.pending) {
        <p class="ro"><app-icon name="offline" [size]="14" /> Creada sin conexión. Se enviará al reconectar; entonces podrás añadirle subtareas y comentarios.</p>
      }
      @if (task && !task.pending) {
        <section class="timer">
          <h3>Tiempo dedicado</h3>
          <div class="row">
            <strong class="clock" [class.on]="running()">{{ duration(elapsed()) }}</strong>
            @if (f.estimated_hours) { <span class="muted">de {{ f.estimated_hours }} h estimadas</span> }
            <span class="spacer"></span>
            @if (!readOnly()) {
              @if (running()) { <button class="btn" (click)="timer(false)"><app-icon name="stop" /> Parar</button> }
              @else { <button class="btn" (click)="timer(true)" [disabled]="f.status === 'completed'"><app-icon name="play" /> Empezar</button> }
            }
          </div>
          @if (!readOnly() && !running()) {
            <label class="row adjust muted">Corregir a mano:
              <input class="input" type="number" min="0" step="5" [ngModel]="minutes()" (change)="setMinutes($any($event.target).value)" [ngModelOptions]="{ standalone: true }" aria-label="Minutos dedicados" /> min</label>
          }
        </section>
        <section>
          <h3>Subtareas @if (subtasks().length) { <span class="muted">{{ doneCount() }}/{{ subtasks().length }}</span> }</h3>
          @if (task.note_title) {
            <a class="from row" [routerLink]="['/notes', task.note_id]" (click)="svc.close()"><app-icon name="note" [size]="13" /> Viene de la nota «{{ task.note_title }}»</a>
          }
          @if (task.user_id !== me() || task.assignee_name) {
            <p class="muted by">Creada por {{ task.owner_name }}@if (task.assignee_name) { · Responsable: {{ task.assignee_name }} }</p>
          }
          @for (s of subtasks(); track s.id) {
            <div class="row sub">
              <input type="checkbox" class="check" [checked]="s.status === 'completed'" [disabled]="readOnly()" (change)="toggleSub(s)" [attr.aria-label]="'Completar ' + s.title" />
              <span class="truncate" [class.done]="s.status === 'completed'">{{ s.title }}</span>
              <span class="spacer"></span>
              @if (!readOnly()) { <button class="btn ghost icon sm" title="Eliminar subtarea" (click)="removeSub(s)"><app-icon name="x" [size]="13" /></button> }
            </div>
          }
          @if (!readOnly()) {
            <form class="row" (ngSubmit)="addSub()">
              <input class="input" name="sub" [(ngModel)]="newSub" placeholder="Añadir subtarea y pulsar Intro" maxlength="200" />
            </form>
          }
        </section>

        <section>
          <h3>Comentarios</h3>
          @for (c of comments(); track c.id) {
            <div class="comment">
              <div class="row"><strong>{{ c.author_name }}</strong><span class="muted">{{ rel(c.created_at) }}</span><span class="spacer"></span>
                <button class="btn ghost icon sm" title="Eliminar comentario" (click)="removeComment(c)"><app-icon name="x" [size]="13" /></button></div>
              <p>{{ c.content }}</p>
            </div>
          }
          <form class="row" (ngSubmit)="addComment()">
            <input class="input" name="comment" [(ngModel)]="newComment" placeholder="Escribe un comentario…" maxlength="5000" />
            <button class="btn" [disabled]="!newComment.trim()">Enviar</button>
          </form>
        </section>
      }
    </aside>
  }`,
  styles: [`
    .scrim { position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 60; }
    .drawer { position: fixed; top: 0; right: 0; bottom: 0; width: min(480px, 100vw); z-index: 61; background: var(--surface);
      border-left: 1px solid var(--border); box-shadow: var(--shadow); overflow-y: auto; padding: 16px 20px 32px; display: grid; gap: 20px; align-content: start; }
    .body fieldset { display: grid; gap: 12px; border: none; padding: 0; margin: 0; min-width: 0; }
    .ro { display: flex; gap: 8px; align-items: center; font-size: 13px; background: var(--surface-2); border-radius: var(--radius-sm); padding: 8px 10px; color: var(--text-2); }
    .by { font-size: 12px; margin-top: -4px; }
    .clock { font-size: 20px; font-variant-numeric: tabular-nums; font-weight: 600; &.on { color: var(--accent-text); } }
    .adjust { font-size: 12px; .input { width: 84px; height: 26px; } }
    .from { font-size: 13px; gap: 6px; }
    .title { height: 38px; font-size: 16px; font-weight: 500; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    section { display: grid; gap: 8px; border-top: 1px solid var(--border); padding-top: 16px; }
    h3 { display: flex; gap: 8px; align-items: baseline; }
    .note { display: flex; gap: 6px; align-items: center; font-size: 12px; color: var(--text-3); margin-top: -4px; }
    .sub { min-height: 28px; } .done { color: var(--text-3); text-decoration: line-through; }
    .comment { background: var(--surface-2); border-radius: var(--radius-sm); padding: 8px 10px; font-size: 13px; p { white-space: pre-wrap; overflow-wrap: anywhere; } .muted { font-size: 12px; } }
  `],
})
export class TaskDialogComponent implements OnDestroy {
  ngOnDestroy() { clearInterval(this.interval); }
  svc = inject(TaskDialogService);
  private api = inject(ApiService);
  private toast = inject(ToastService);

  statuses: Status[] = ['todo', 'in_progress', 'review', 'completed', 'archived'];
  priorities = PRIORITIES;
  statusLabel = STATUS_LABEL;
  priorityLabel = PRIORITY_LABEL;
  difficultyLabel = DIFFICULTY_LABEL;
  xpBase: Record<number, number> = { 1: 10, 2: 20, 3: 40, 4: 80 };
  recurrences = Object.keys(RECURRENCE_LABEL) as Recurrence[];
  recurrenceLabel = RECURRENCE_LABEL;
  reminders = REMINDER_OPTIONS;
  rel = relativeTime;

  task: Task | null = null;
  f = this.blank();
  projects = signal<Project[]>([]);
  members = signal<Member[]>([]);
  readOnly = signal(false);
  private auth = inject(AuthService);
  me = () => this.auth.user()?.id;
  /** Proyectos donde se pueden crear o mover tareas (los de solo lectura no). */
  writable = () => this.projects().filter(p => p.role !== 'viewer' || p.id === this.task?.project_id);
  subtasks = signal<Subtask[]>([]);
  comments = signal<Comment[]>([]);
  saving = signal(false);
  duration = formatDuration;
  /** Tarea con los datos de tiempo al día (el panel puede arrancar y parar el cronómetro sin cerrarse). */
  private timed = signal<Task | null>(null);
  private tick = signal(Date.now());
  private interval?: ReturnType<typeof setInterval>;
  running = computed(() => !!this.timed()?.timer_started_at);
  elapsed = computed(() => (this.timed() ? spentSeconds(this.timed()!, this.tick()) : 0));
  minutes = computed(() => Math.round((this.timed()?.time_spent_seconds ?? 0) / 60));
  newSub = '';
  newComment = '';
  doneCount = () => this.subtasks().filter(s => s.status === 'completed').length;

  constructor() {
    effect(() => {
      const st = this.svc.state();
      clearInterval(this.interval);
      this.timed.set(st?.mode === 'edit' ? st.task : null);
      if (!st) return;
      this.interval = setInterval(() => { if (this.running()) this.tick.set(Date.now()); }, 1000);
      this.newSub = this.newComment = '';
      this.api.projects().subscribe(p => this.projects.set(p));
      if (st.mode === 'edit') {
        const t = (this.task = st.task);
        this.f = {
          title: t.title, description: t.description ?? '', status: t.status, priority: t.priority,
          day: taskDay(t) ?? '', time: taskTime(t), project_id: t.project_id ?? null,
          estimated_hours: t.estimated_hours ?? null, tags: t.tags.join(', '),
          recurrence: t.recurrence ?? 'none', reminder_minutes: t.reminder_minutes ?? null, assignee_id: t.assignee_id ?? null,
          difficulty: t.difficulty ?? 2,
        };
        this.readOnly.set(t.can_edit === false);
        this.loadMembers(t.project_id ?? null);
        this.subtasks.set(t.subtasks);
        this.comments.set([]);
        this.api.comments(t.id).subscribe(c => this.comments.set(c));
      } else {
        this.task = null;
        this.readOnly.set(false);
        const d = st.defaults;
        this.loadMembers(d.project_id ?? null);
        this.f = { ...this.blank(), title: d.title ?? '', status: d.status ?? 'todo', priority: d.priority ?? 'medium',
          day: d.day ?? '', project_id: d.project_id ?? null };
        this.subtasks.set([]);
        this.comments.set([]);
      }
      setTimeout(() => document.querySelector<HTMLInputElement>('.drawer .title')?.focus());
    });
  }

  @HostListener('document:keydown.escape') onEsc() { if (this.svc.state()) this.svc.close(); }

  private blank() {
    return { title: '', description: '', status: 'todo' as Status, priority: 'medium' as Priority, day: '', time: '',
      project_id: null as number | null, estimated_hours: null as number | null, tags: '',
      recurrence: 'none' as Recurrence, reminder_minutes: null as number | null, assignee_id: null as number | null, difficulty: 2 };
  }

  timer(start: boolean) {
    const t = this.task;
    if (!t) return;
    (start ? this.api.startTimer(t.id) : this.api.stopTimer(t.id)).subscribe({
      next: saved => { this.timed.set(saved); this.tick.set(Date.now()); }, error: e => this.toast.error(e),
    });
  }
  setMinutes(value: string) {
    const m = Math.max(0, Math.round(Number(value) || 0));
    if (!this.task) return;
    this.api.updateTask(this.task.id, { time_spent_seconds: m * 60 }).subscribe({ next: saved => this.timed.set(saved), error: e => this.toast.error(e) });
  }

  onProject(id: number | null) { this.f.assignee_id = null; this.loadMembers(id); }
  private loadMembers(projectId: number | null) {
    this.members.set([]);
    if (projectId) this.api.members(projectId).subscribe({ next: m => this.members.set(m), error: () => {} });
  }

  save() {
    const title = this.f.title.trim();
    if (!title || this.saving()) return;
    const data = {
      title, description: this.f.description.trim() || null, status: this.f.status, priority: this.f.priority,
      ...toDue(this.f.day, this.f.time), project_id: this.f.project_id,
      estimated_hours: this.f.estimated_hours === null || (this.f.estimated_hours as unknown) === '' ? null : Number(this.f.estimated_hours),
      tags: this.f.tags.split(',').map(t => t.trim()).filter(Boolean),
      recurrence: this.f.recurrence, reminder_minutes: this.f.day ? this.f.reminder_minutes : null,
      assignee_id: this.f.project_id ? this.f.assignee_id : null,
      difficulty: this.f.difficulty,
    };
    this.saving.set(true);
    const req = this.task ? this.api.updateTask(this.task.id, data) : this.api.createTask(data);
    req.subscribe({
      next: () => {
        this.saving.set(false);
        this.svc.close();
        if (data.status === 'completed' && data.recurrence !== 'none' && this.task?.status !== 'completed') this.toast.success('Tarea completada: se ha creado la siguiente repetición');
      },
      error: e => { this.saving.set(false); this.toast.error(e, 'No se pudo guardar la tarea'); },
    });
  }

  remove() {
    if (!this.task || !confirm(`¿Enviar «${this.task.title}» a la papelera? Podrás restaurarla durante 30 días.`)) return;
    this.api.deleteTask(this.task.id).subscribe({ next: () => this.svc.close(), error: e => this.toast.error(e) });
  }

  addSub() {
    const title = this.newSub.trim();
    if (!title || !this.task) return;
    this.newSub = '';
    this.api.createTask({ title, parent_task_id: this.task.id }).subscribe({
      next: t => this.subtasks.update(s => [...s, { id: t.id, title: t.title, status: t.status }]),
      error: e => this.toast.error(e),
    });
  }
  toggleSub(s: Subtask) {
    const status: Status = s.status === 'completed' ? 'todo' : 'completed';
    this.subtasks.update(list => list.map(x => (x.id === s.id ? { ...x, status } : x)));
    this.api.updateTask(s.id, { status }).subscribe({ error: e => this.toast.error(e) });
  }
  removeSub(s: Subtask) {
    this.api.deleteTask(s.id).subscribe({ next: () => this.subtasks.update(l => l.filter(x => x.id !== s.id)), error: e => this.toast.error(e) });
  }

  addComment() {
    const content = this.newComment.trim();
    if (!content || !this.task) return;
    this.newComment = '';
    this.api.addComment(this.task.id, content).subscribe({ next: c => this.comments.update(l => [...l, c]), error: e => this.toast.error(e) });
  }
  removeComment(c: Comment) {
    this.api.deleteComment(c.task_id, c.id).subscribe({ next: () => this.comments.update(l => l.filter(x => x.id !== c.id)), error: e => this.toast.error(e) });
  }
}
