import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { BOARD_STATUSES, ChecklistItem, PRIORITIES, PRIORITY_LABEL, RECURRENCE_LABEL, Priority, Project, STATUS_LABEL, Status, Task } from '../core/models';
import { ToastService } from '../core/toast.service';
import { hasMetadata } from '../core/quick-parse';
import { quickToTask } from '../core/quick-task';
import { addDays, formatDay, isOverdue, taskDay, taskTime, today } from '../core/util';
import { IconComponent } from '../shared/icon.component';
import { TaskDialogService } from '../shared/task-dialog.service';

type Group = 'due' | 'status' | 'project' | 'priority' | 'none';
type Due = '' | 'overdue' | 'today' | 'week' | 'none';

@Component({
  selector: 'app-tasks',
  standalone: true,
  imports: [FormsModule, RouterLink, IconComponent],
  template: `
  <div class="page">
    <div class="page-head">
      <div><h1>Tareas</h1><p>{{ openCount() }} abiertas · {{ doneCount() }} completadas</p></div>
      <span class="spacer"></span>
      <button class="btn primary" (click)="dialog.create({ project_id: project() })"><app-icon name="plus" /> Nueva tarea</button>
    </div>

    <div class="tabs" role="tablist">
      <button role="tab" [class.active]="tab() === 'tasks'" (click)="tab.set('tasks')">Mis tareas</button>
      <button role="tab" [class.active]="tab() === 'notes'" (click)="tab.set('notes')">Casillas de notas @if (pendingChecks()) { <span class="chip">{{ pendingChecks() }}</span> }</button>
    </div>

    @if (tab() === 'tasks') {
      <form class="quick row" (ngSubmit)="quickAdd()">
        <app-icon name="plus" />
        <input name="quick" [(ngModel)]="quick" (ngModelChange)="onQuick($event)" maxlength="200" aria-label="Añadir tarea rápida"
          placeholder="Añadir tarea: «Llamar a Juan mañana a las 10 #trabajo !alta»" />
      </form>
      @if (preview(); as q) {
        <div class="preview row" aria-live="polite">
          <span class="muted">Se creará:</span><strong class="truncate">{{ q.input.title }}</strong>
          @if (q.parsed.day) { <span class="chip"><app-icon name="calendar" [size]="11" />{{ fmt(q.parsed.day) }} {{ q.parsed.time ?? '' }}</span> }
          @if (q.parsed.recurrence; as r) { <span class="chip"><app-icon name="repeat" [size]="11" />{{ rec[r] }}</span> }
          @if (q.parsed.priority; as pr) { <span class="prio" [class]="pr">{{ priorityLabel[pr] }}</span> }
          @if (q.project; as pj) { <span class="chip"><i class="dot" [style.background]="pj.color"></i>{{ pj.name }}</span> }
          @for (tag of q.parsed.tags; track tag) { <span class="chip tag">#{{ tag }}</span> }
        </div>
      }

      <div class="filters row">
        <input class="input search" [ngModel]="q()" (ngModelChange)="q.set($event)" placeholder="Filtrar…" aria-label="Filtrar tareas" />
        <select class="input" [ngModel]="status()" (ngModelChange)="status.set($event)" aria-label="Estado">
          <option value="open">Abiertas</option><option value="">Todas</option>
          @for (s of statuses; track s) { <option [value]="s">{{ statusLabel[s] }}</option> }
        </select>
        <select class="input" [ngModel]="priority()" (ngModelChange)="priority.set($event)" aria-label="Prioridad">
          <option value="">Cualquier prioridad</option>
          @for (p of priorities; track p) { <option [value]="p">{{ priorityLabel[p] }}</option> }
        </select>
        <select class="input" [ngModel]="project()" (ngModelChange)="project.set($event)" aria-label="Proyecto">
          <option [ngValue]="null">Todos los proyectos</option>
          @for (p of projects(); track p.id) { <option [ngValue]="p.id">{{ p.name }}</option> }
        </select>
        <select class="input" [ngModel]="due()" (ngModelChange)="due.set($event)" aria-label="Fecha">
          <option value="">Cualquier fecha</option><option value="overdue">Atrasadas</option><option value="today">Hoy</option>
          <option value="week">Próximos 7 días</option><option value="none">Sin fecha</option>
        </select>
        <label class="row mine"><input type="checkbox" [ngModel]="mine()" (ngModelChange)="mine.set($event)" /> Asignadas a mí</label>
        <select class="input" [ngModel]="group()" (ngModelChange)="group.set($event)" aria-label="Agrupar por">
          <option value="due">Agrupar por fecha</option><option value="status">Agrupar por estado</option>
          <option value="project">Agrupar por proyecto</option><option value="priority">Agrupar por prioridad</option><option value="none">Sin agrupar</option>
        </select>
      </div>

      @if (!loaded()) {
        @for (i of [1,2,3,4]; track i) { <div class="skeleton" style="height:40px;margin-bottom:6px"></div> }
      } @else {
        @for (g of groups(); track g.label) {
          @if (g.label) { <h3 class="group">{{ g.label }} <span class="muted">{{ g.tasks.length }}</span></h3> }
          <div class="card list">
            @for (t of g.tasks; track t.id) {
              <div class="task row" [class.done]="t.status === 'completed'" (click)="dialog.edit(t)" tabindex="0" (keydown.enter)="dialog.edit(t)">
                <input type="checkbox" class="check" [checked]="t.status === 'completed'" [disabled]="!t.can_edit" (click)="$event.stopPropagation()" (change)="toggle(t)" [attr.aria-label]="'Completar ' + t.title" />
                <span class="title truncate">{{ t.title }}</span>
                @if (t.timer_started_at) { <span class="chip tag" title="Cronómetro en marcha"><app-icon name="clock" [size]="11" />en curso</span> }
                @if (t.pending) { <span class="chip" title="Creada sin conexión; se enviará al reconectar"><app-icon name="offline" [size]="11" />pendiente</span> }
                @if (t.recurrence !== 'none') { <span class="chip" [title]="'Se repite: ' + rec[t.recurrence]"><app-icon name="repeat" [size]="11" /></span> }
                @if (t.reminder_minutes !== null && t.reminder_minutes !== undefined) { <span class="chip" title="Con recordatorio"><app-icon name="bell" [size]="11" /></span> }
                @if (t.subtasks.length) { <span class="chip" title="Subtareas">{{ subDone(t) }}/{{ t.subtasks.length }}</span> }
                @for (tag of t.tags.slice(0, 3); track tag) { <span class="chip tag">#{{ tag }}</span> }
                <span class="spacer"></span>
                @if (projectOf(t); as p) { <span class="chip"><i class="dot" [style.background]="p.color"></i>{{ p.name }}</span> }
                @if (t.status === 'in_progress' || t.status === 'review' || t.status === 'archived') { <span class="chip">{{ statusLabel[t.status] }}</span> }
                @if (t.assignee_name) { <span class="chip" [title]="'Responsable: ' + t.assignee_name"><app-icon name="users" [size]="11" />{{ t.assignee_name }}</span> }
                <span class="prio" [class]="t.priority">{{ priorityLabel[t.priority] }}</span>
                @if (day(t); as d) {
                  <span class="chip due" [class.late]="overdue(t)">@if (overdue(t)) { <app-icon name="alert" [size]="11" /> }{{ fmt(d) }} {{ time(t) }}</span>
                }
              </div>
            }
          </div>
        } @empty {
          <div class="empty card">
            <h3>{{ tasks().length ? 'Ninguna tarea coincide con los filtros' : 'Todavía no hay tareas' }}</h3>
            <p>{{ tasks().length ? 'Prueba a cambiar o quitar algún filtro.' : 'Escribe arriba para añadir la primera.' }}</p>
            @if (tasks().length) { <button class="btn" (click)="clearFilters()">Quitar filtros</button> }
          </div>
        }
      }
    } @else {
      <p class="muted intro">Las casillas <code>- [ ]</code> que escribes en tus notas aparecen aquí. Al marcarlas se actualiza la nota. Si una necesita fecha, prioridad o proyecto, conviértela en tarea.</p>
      @for (g of checkGroups(); track g.id) {
        <h3 class="group"><a [routerLink]="['/notes', g.id]">{{ g.title }}</a> <span class="muted">{{ g.pending }} pendientes</span></h3>
        <div class="card list">
          @for (c of g.items; track c.line) {
            <div class="task row" [class.done]="c.checked">
              <label class="row" style="flex:1;min-width:0;cursor:pointer">
                <input type="checkbox" class="check square" [checked]="c.checked" (change)="toggleCheck(c)" />
                <span class="title">{{ c.text }}</span>
              </label>
              @if (!c.checked) {
                <button class="btn ghost sm convert" title="Convertirla en una tarea con fecha, prioridad y proyecto" (click)="convert(c)"><app-icon name="check" [size]="13" /> Convertir en tarea</button>
              }
            </div>
          }
        </div>
      } @empty {
        <div class="empty card"><h3>No hay casillas en tus notas</h3><p>Escribe <code>- [ ] algo</code> en cualquier nota y aparecerá aquí.</p></div>
      }
    }
  </div>`,
  styles: [`
    .quick { height: 40px; padding: 0 12px; border: 1px dashed var(--border); border-radius: var(--radius); color: var(--text-3); margin-bottom: 12px;
      &:focus-within { border-style: solid; border-color: var(--accent); }
      input { flex: 1; border: none; background: none; outline: none; height: 100%; color: var(--text); } }
    .mine { font-size: 13px; color: var(--text-2); white-space: nowrap; cursor: pointer; }
    .check:disabled { opacity: .4; cursor: not-allowed; }
    .preview { font-size: 13px; margin: -6px 0 12px; padding: 0 12px; flex-wrap: wrap; row-gap: 4px; strong { font-weight: 500; max-width: 40%; } }
    .convert { opacity: 0; } .task:hover .convert, .convert:focus-visible { opacity: 1; }
    .filters { flex-wrap: wrap; margin-bottom: 8px; .input { width: auto; flex: 0 1 auto; } .search { flex: 1 1 160px; } }
    .group { margin: 18px 0 8px; display: flex; gap: 8px; align-items: baseline; font-size: 13px; color: var(--text-2); .muted { font-weight: 400; } }
    .list { overflow: hidden; }
    .task { padding: 0 12px; min-height: 40px; cursor: pointer; border-bottom: 1px solid var(--border); &:last-child { border-bottom: none; } &:hover { background: var(--surface-2); }
      &.done .title { color: var(--text-3); text-decoration: line-through; } }
    .title { flex: 0 1 auto; }
    .due.late { color: var(--critical); }
    .intro { margin-bottom: 4px; } code { font: 12px var(--mono); background: var(--surface-2); padding: 1px 5px; border-radius: 4px; }
    @media (max-width: 700px) { .task .prio, .task .tag { display: none; } }
  `],
})
export class TasksComponent implements OnInit {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  dialog = inject(TaskDialogService);

  statuses = [...BOARD_STATUSES, 'archived' as Status];
  priorities = PRIORITIES;
  statusLabel = STATUS_LABEL; priorityLabel = PRIORITY_LABEL;
  rec = RECURRENCE_LABEL;
  fmt = formatDay; day = taskDay; time = taskTime; overdue = isOverdue;

  tab = signal<'tasks' | 'notes'>('tasks');
  tasks = signal<Task[]>([]);
  projects = signal<Project[]>([]);
  checks = signal<ChecklistItem[]>([]);
  loaded = signal(false);
  quick = '';
  private quickText = signal('');
  /** Se recalcula también cuando terminan de cargar los proyectos (para resolver «@proyecto»). */
  preview = computed(() => {
    const text = this.quickText().trim();
    const q = text ? quickToTask(text, this.projects()) : null;
    return q && hasMetadata(q.parsed) ? q : null;
  });

  q = signal('');
  status = signal<Status | 'open' | ''>('open');
  priority = signal<Priority | ''>('');
  project = signal<number | null>(null);
  due = signal<Due>('');
  group = signal<Group>('due');
  mine = signal(false);
  private auth = inject(AuthService);

  openCount = computed(() => this.tasks().filter(t => t.status !== 'completed' && t.status !== 'archived').length);
  doneCount = computed(() => this.tasks().filter(t => t.status === 'completed').length);
  pendingChecks = computed(() => this.checks().filter(c => !c.checked).length);
  private projectMap = computed(() => new Map(this.projects().map(p => [p.id, p])));
  projectOf = (t: Task) => (t.project_id ? this.projectMap().get(t.project_id) : undefined);
  subDone = (t: Task) => t.subtasks.filter(s => s.status === 'completed').length;

  filtered = computed(() => {
    const q = this.q().trim().toLowerCase(), st = this.status(), pr = this.priority(), pj = this.project(), due = this.due();
    const t0 = today(), week = addDays(t0, 6);
    const onlyMine = this.mine(), me = this.auth.user()?.id;
    return this.tasks().filter(t => {
      if (st === 'open' ? t.status === 'completed' || t.status === 'archived' : st ? t.status !== st : t.status === 'archived') return false;
      if (pr && t.priority !== pr) return false;
      if (onlyMine && t.assignee_id !== me) return false;
      if (pj !== null && t.project_id !== pj) return false;
      if (q && !(t.title.toLowerCase().includes(q) || (t.description ?? '').toLowerCase().includes(q) || t.tags.some(x => x.includes(q.replace(/^#/, ''))))) return false;
      const d = taskDay(t);
      if (due === 'overdue' && !isOverdue(t)) return false;
      if (due === 'today' && d !== t0) return false;
      if (due === 'week' && !(d && d >= t0 && d <= week)) return false;
      if (due === 'none' && d) return false;
      return true;
    });
  });

  groups = computed(() => {
    const list = this.filtered(), by = this.group();
    if (!list.length) return [];
    const order: string[] = [], map = new Map<string, Task[]>();
    const put = (k: string, t: Task) => { if (!map.has(k)) { map.set(k, []); order.push(k); } map.get(k)!.push(t); };
    if (by === 'none') return [{ label: '', tasks: list }];
    if (by === 'due') {
      const t0 = today(), week = addDays(t0, 6);
      const keys = ['Atrasadas', 'Hoy', 'Próximos 7 días', 'Más adelante', 'Sin fecha', 'Completadas'];
      const sorted = [...list].sort((a, b) => (a.due_date ?? '9').localeCompare(b.due_date ?? '9'));
      for (const t of sorted) {
        const d = taskDay(t);
        put(t.status === 'completed' ? keys[5] : !d ? keys[4] : isOverdue(t) ? keys[0] : d === t0 ? keys[1] : d <= week ? keys[2] : keys[3], t);
      }
      return keys.filter(k => map.has(k)).map(k => ({ label: k, tasks: map.get(k)! }));
    }
    if (by === 'status') { for (const s of this.statuses) for (const t of list) if (t.status === s) put(STATUS_LABEL[s], t); }
    else if (by === 'priority') { for (const p of PRIORITIES) for (const t of list) if (t.priority === p) put(PRIORITY_LABEL[p], t); }
    else { for (const t of list) put(this.projectOf(t)?.name ?? 'Sin proyecto', t); order.sort((a, b) => (a === 'Sin proyecto' ? 1 : b === 'Sin proyecto' ? -1 : a.localeCompare(b))); }
    return order.map(k => ({ label: k, tasks: map.get(k)! }));
  });

  checkGroups = computed(() => {
    const map = new Map<number, { id: number; title: string; items: ChecklistItem[]; pending: number }>();
    for (const c of this.checks()) {
      if (!map.has(c.note_id)) map.set(c.note_id, { id: c.note_id, title: c.note_title, items: [], pending: 0 });
      const g = map.get(c.note_id)!;
      g.items.push(c);
      if (!c.checked) g.pending++;
    }
    return [...map.values()];
  });

  constructor() {
    this.api.tasksChanged.pipe(takeUntilDestroyed()).subscribe(() => this.load());
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe(p => {
      if (p.has('project')) this.project.set(Number(p.get('project')));
      if (p.has('due')) this.due.set(p.get('due') as Due);
      if (p.get('tab') === 'notes') this.tab.set('notes');
    });
  }
  ngOnInit() {
    this.load();
    this.api.projects(true).subscribe(p => this.projects.set(p));
    this.api.checklist().subscribe(c => this.checks.set(c));
  }

  private load() {
    this.api.tasks({ include_archived: true }).subscribe({
      next: t => { this.tasks.set(t); this.loaded.set(true); },
      error: e => { this.loaded.set(true); this.toast.error(e, 'No se pudieron cargar las tareas'); },
    });
  }

  onQuick(text: string) { this.quickText.set(text); }

  quickAdd() {
    const text = this.quick.trim();
    if (!text) return;
    const { input } = quickToTask(text, this.projects());
    this.quick = '';
    this.quickText.set('');
    this.api.createTask({ project_id: this.project(), ...input }).subscribe({ error: e => { this.quick = text; this.onQuick(text); this.toast.error(e); } });
  }

  toggle(t: Task) {
    const status: Status = t.status === 'completed' ? 'todo' : 'completed';
    this.tasks.update(l => l.map(x => (x.id === t.id ? { ...x, status } : x)));  // optimista
    this.api.updateTask(t.id, { status }).subscribe({
      next: () => { if (status === 'completed' && t.recurrence !== 'none') this.toast.success('Hecha. Se ha creado la siguiente repetición'); },
      error: e => { this.toast.error(e); this.load(); },
    });
  }

  toggleCheck(c: ChecklistItem) {
    const checked = !c.checked;
    this.checks.update(l => l.map(x => (x.note_id === c.note_id && x.line === c.line ? { ...x, checked } : x)));
    this.api.toggleChecklist(c.note_id, c.line, checked).subscribe({
      error: e => { this.toast.error(e, 'La nota ha cambiado; se ha recargado la lista'); this.api.checklist().subscribe(x => this.checks.set(x)); },
    });
  }

  /** La casilla pasa a ser una tarea real enlazada a su nota; el texto admite la misma sintaxis que la captura rápida. */
  convert(c: ChecklistItem) {
    const { input } = quickToTask(c.text, this.projects());
    this.api.convertChecklist(c.note_id, c.line, input).subscribe({
      next: t => {
        this.checks.update(l => l.filter(x => !(x.note_id === c.note_id && x.line === c.line)));
        this.toast.success(`Tarea creada: ${t.title}`);
      },
      error: e => { this.toast.error(e, 'La nota ha cambiado; se ha recargado la lista'); this.api.checklist().subscribe(x => this.checks.set(x)); },
    });
  }

  clearFilters() {
    this.q.set(''); this.status.set('open'); this.priority.set(''); this.project.set(null); this.due.set(''); this.mine.set(false);
    this.router.navigate([], { queryParams: {} });
  }
}
