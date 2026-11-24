import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { ApiService } from '../core/api.service';
import { Goal, GoalDetail, GoalLinkKind, GoalStatus, Habit, Project, Task } from '../core/models';
import { ToastService } from '../core/toast.service';
import { formatDay, taskDay, today } from '../core/util';
import { IconComponent } from '../shared/icon.component';

const COLORS = ['#7c5cff', '#2a78d6', '#1baf7a', '#eda100', '#eb6834', '#e34948', '#e87ba4', '#6b7280'];
const TABS: { id: GoalStatus; label: string }[] = [{ id: 'active', label: 'En marcha' }, { id: 'done', label: 'Cumplidos' }, { id: 'archived', label: 'Archivados' }];
const IDEAS = ['Aprobar las oposiciones', 'Correr una media maratón', 'Leer 12 libros este año', 'Lanzar mi proyecto personal'];

/** «quedan 12 días», «vence hoy», «venció hace 3 días» */
export function deadlineLabel(g: Goal): string {
  const d = g.progress.days_left;
  if (!g.deadline || d === null) return 'Sin fecha límite';
  if (g.status === 'done') return `Fecha límite: ${formatDay(g.deadline)}`;
  if (d > 1) return `Quedan ${d} días · ${formatDay(g.deadline)}`;
  if (d === 1) return 'Vence mañana';
  if (d === 0) return 'Vence hoy';
  return `Venció hace ${-d} ${d === -1 ? 'día' : 'días'}`;
}

@Component({
  selector: 'app-goals',
  standalone: true,
  imports: [FormsModule, RouterLink, IconComponent],
  template: `
  <div class="page">
    @if (!id()) {
      <div class="page-head">
        <div><h1>Objetivos</h1><p>Metas a largo plazo. Liga proyectos, tareas y rutinas y mira si vas a buen ritmo.</p></div>
        <span class="spacer"></span>
        <button class="btn primary" (click)="startNew()"><app-icon name="plus" [size]="15" /> Nuevo objetivo</button>
      </div>

      @if (draft(); as d) {
        <form class="card new" (ngSubmit)="create()">
          <label class="field">¿Qué quieres conseguir?
            <input class="input" name="title" [(ngModel)]="d.title" required maxlength="200" [placeholder]="idea" autofocus />
          </label>
          <div class="row wrap">
            <label class="field">Fecha límite (opcional) <input class="input" type="date" name="deadline" [(ngModel)]="d.deadline" [min]="todayStr" /></label>
            <div class="field">Color
              <div class="swatches" role="radiogroup" aria-label="Color">
                @for (c of colors; track c) {
                  <button type="button" class="swatch" role="radio" [attr.aria-checked]="d.color === c" [attr.aria-label]="c"
                    [style.background]="c" [class.on]="d.color === c" (click)="d.color = c"></button>
                }
              </div>
            </div>
          </div>
          <div class="row"><span class="spacer"></span>
            <button type="button" class="btn" (click)="draft.set(null)">Cancelar</button>
            <button class="btn primary" [disabled]="!d.title.trim() || busy()">Crear objetivo</button>
          </div>
        </form>
      }

      <div class="tabs" role="tablist">
        @for (t of tabs; track t.id) {
          <button role="tab" class="tab" [class.on]="tab() === t.id" [attr.aria-selected]="tab() === t.id" (click)="setTab(t.id)">{{ t.label }}</button>
        }
      </div>

      <div class="grid">
        @for (g of list() ?? []; track g.id) {
          <a class="card goal" [routerLink]="['/goals', g.id]" [style.--c]="g.color">
            <div class="row top"><app-icon [name]="g.status === 'done' ? 'check' : 'mountain'" [size]="18" /><h3>{{ g.title }}</h3></div>
            <span class="muted small">{{ deadline(g) }}</span>
            <div class="meter">
              <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" [attr.aria-valuenow]="g.progress.percent ?? 0" [attr.aria-label]="'Avance de ' + g.title">
                <span [style.width.%]="g.status === 'done' ? 100 : (g.progress.percent ?? 0)"></span>
                @if (g.progress.expected !== null) { <i class="mark" [style.left.%]="g.progress.expected" title="Donde deberías ir según el tiempo transcurrido"></i> }
              </div>
              <strong>{{ g.status === 'done' ? '✓' : g.progress.percent === null ? '—' : g.progress.percent + ' %' }}</strong>
            </div>
            <div class="row wrap small">
              @if (g.status === 'active' && g.progress.expected !== null) {
                <span class="chip" [class.good]="g.progress.on_track" [class.bad]="!g.progress.on_track">{{ g.progress.on_track ? 'Vas a buen ritmo' : 'Vas con retraso' }}</span>
              }
              <span class="muted">{{ summary(g) }}</span>
            </div>
          </a>
        } @empty {
          @if (list()) {
            <div class="empty card">
              <app-icon name="mountain" [size]="28" />
              @switch (tab()) {
                @case ('active') { <p><strong>Aún no tienes objetivos.</strong> Piensa en algo que quieras lograr este año: «{{ idea }}».</p>
                  <button class="btn primary" (click)="startNew()">Crear el primero</button> }
                @case ('done') { <p class="muted">Cuando cumplas un objetivo aparecerá aquí, con la experiencia que te dio.</p> }
                @default { <p class="muted">No hay objetivos archivados.</p> }
              }
            </div>
          } @else { @for (i of [1, 2]; track i) { <div class="skeleton" style="height:150px"></div> } }
        }
      </div>
    } @else {
      @if (goal(); as g) {
        <a class="back muted" routerLink="/goals"><app-icon name="left" [size]="14" /> Objetivos</a>
        <header class="card head" [style.--c]="g.color">
          <input class="title" [(ngModel)]="edit.title" (blur)="save({ title: edit.title.trim() })" (keydown.enter)="$any($event.target).blur()"
            maxlength="200" aria-label="Título del objetivo" [disabled]="g.status === 'done'" />
          <textarea class="input desc" rows="2" [(ngModel)]="edit.description" (blur)="save({ description: edit.description.trim() || null })"
            placeholder="¿Por qué es importante para ti? ¿Cómo sabrás que lo has conseguido?" maxlength="5000" aria-label="Descripción"></textarea>
          <div class="row wrap">
            <label class="field inline">Fecha límite
              <input class="input" type="date" [(ngModel)]="edit.deadline" (change)="save({ deadline: edit.deadline || null })" />
            </label>
            <div class="swatches" role="radiogroup" aria-label="Color">
              @for (c of colors; track c) {
                <button type="button" class="swatch" role="radio" [attr.aria-checked]="g.color === c" [attr.aria-label]="c"
                  [style.background]="c" [class.on]="g.color === c" (click)="save({ color: c })"></button>
              }
            </div>
          </div>

          <div class="big">
            <div class="meter">
              <div class="bar lg" role="progressbar" aria-valuemin="0" aria-valuemax="100" [attr.aria-valuenow]="g.progress.percent ?? 0" aria-label="Avance">
                <span [style.width.%]="g.status === 'done' ? 100 : (g.progress.percent ?? 0)"></span>
                @if (g.progress.expected !== null) { <i class="mark" [style.left.%]="g.progress.expected"></i> }
              </div>
              <strong>{{ g.status === 'done' ? 'Cumplido' : g.progress.percent === null ? '—' : g.progress.percent + ' %' }}</strong>
            </div>
            <p class="muted small">{{ deadline(g) }}
              @if (g.status === 'active' && g.progress.expected !== null) {
                · el tiempo va por el {{ g.progress.expected }} %:
                <strong [class.good-t]="g.progress.on_track" [class.bad-t]="!g.progress.on_track">{{ g.progress.on_track ? 'vas a buen ritmo' : 'vas con retraso' }}</strong>
              }
              @if (g.progress.percent === null && g.status === 'active') { · Añade hitos o tareas para medir el avance. }
            </p>
          </div>

          <div class="row wrap actions">
            @switch (g.status) {
              @case ('active') {
                <button class="btn primary" (click)="complete()" [disabled]="busy()"><app-icon name="check" [size]="15" /> Marcar como cumplido · +{{ g.xp }} XP</button>
                <button class="btn" (click)="save({ archived: true })" [disabled]="busy()">Archivar</button>
              }
              @case ('done') { <span class="chip good">Cumplido</span><button class="btn" (click)="reopen()" [disabled]="busy()">Reabrir</button> }
              @default { <span class="chip">Archivado</span><button class="btn" (click)="save({ archived: false })" [disabled]="busy()">Recuperar</button> }
            }
            <span class="spacer"></span>
            <button class="btn ghost danger" (click)="remove()" [disabled]="busy()"><app-icon name="trash" [size]="15" /> Eliminar</button>
          </div>
        </header>

        <div class="cols">
          <section class="card sec">
            <h2>Hitos <span class="muted">{{ g.progress.milestones_done }}/{{ g.progress.milestones_total }}</span></h2>
            <p class="muted small">Pasos intermedios que marcas tú. Cuentan en el avance igual que una tarea.</p>
            <ul class="list">
              @for (m of g.milestones; track m.id) {
                <li class="row">
                  <input type="checkbox" [checked]="m.done" (change)="toggleMilestone(m.id, $any($event.target).checked)" [attr.aria-label]="m.title" />
                  <span class="grow" [class.done]="m.done">{{ m.title }}</span>
                  <button class="btn ghost icon sm" (click)="removeMilestone(m.id)" [attr.aria-label]="'Quitar ' + m.title"><app-icon name="x" [size]="14" /></button>
                </li>
              }
            </ul>
            <form class="row" (ngSubmit)="addMilestone()">
              <input class="input grow" name="ms" [(ngModel)]="newMilestone" placeholder="Nuevo hito, p. ej. «Terminar el temario»" maxlength="200" />
              <button class="btn" [disabled]="!newMilestone.trim()">Añadir</button>
            </form>
          </section>

          <section class="card sec">
            <h2>Rutinas <span class="muted">{{ g.progress.habit_rate === null ? '' : 'constancia ' + g.progress.habit_rate + ' %' }}</span></h2>
            <p class="muted small">Hábitos que te acercan al objetivo. Se mide lo que cumples en los últimos 28 días.</p>
            <ul class="list">
              @for (h of g.habits; track h.id) {
                <li class="row"><i class="dot" [style.background]="h.color"></i><span class="grow">{{ h.title }}</span>
                  <span class="muted small">{{ h.rate === null ? 'sin datos' : h.rate + ' %' }}</span>
                  <button class="btn ghost icon sm" (click)="unlink('habit', h.id)" [attr.aria-label]="'Desvincular ' + h.title"><app-icon name="x" [size]="14" /></button></li>
              }
            </ul>
            @if (habitOptions().length) {
              <select class="input" [ngModel]="''" (ngModelChange)="link('habit', +$event)" aria-label="Vincular rutina">
                <option value="" disabled>Vincular una rutina…</option>
                @for (h of habitOptions(); track h.id) { <option [value]="h.id">{{ h.title }}</option> }
              </select>
            } @else if (!g.habits.length) { <a class="small" routerLink="/today">Crea rutinas en «Hoy»</a> }
          </section>
        </div>

        <section class="card sec">
          <h2>Proyectos y tareas <span class="muted">{{ g.progress.tasks_done }}/{{ g.progress.tasks_total }} hechas</span></h2>
          @if (g.projects.length) {
            <div class="projects">
              @for (p of g.projects; track p.id) {
                <div class="proj row"><i class="dot" [style.background]="p.color"></i><a class="grow" routerLink="/projects">{{ p.name }}</a>
                  <span class="muted small">{{ p.done }}/{{ p.total }}</span>
                  <button class="btn ghost icon sm" (click)="unlink('project', p.id)" [attr.aria-label]="'Desvincular ' + p.name"><app-icon name="x" [size]="14" /></button></div>
              }
            </div>
          }
          <ul class="list tasks">
            @for (t of g.tasks; track t.id) {
              <li class="row">
                <input type="checkbox" [checked]="t.status === 'completed'" (change)="toggleTask(t.id, $any($event.target).checked)" [attr.aria-label]="t.title" />
                <span class="grow" [class.done]="t.status === 'completed'">{{ t.title }}</span>
                @if (t.due_date) { <span class="muted small">{{ fmt(dayOf(t)) }}</span> }
                @if (t.linked) {
                  <button class="btn ghost icon sm" (click)="unlink('task', t.id)" [attr.aria-label]="'Desvincular ' + t.title"><app-icon name="x" [size]="14" /></button>
                } @else { <span class="muted small" title="Viene de un proyecto vinculado">proyecto</span> }
              </li>
            } @empty { <li class="muted small">Sin tareas todavía. Crea una aquí o vincula un proyecto entero.</li> }
          </ul>
          <form class="row" (ngSubmit)="addTask()">
            <input class="input grow" name="task" [(ngModel)]="newTask" placeholder="Nueva tarea para este objetivo" maxlength="200" />
            <button class="btn" [disabled]="!newTask.trim() || busy()">Crear</button>
          </form>
          <div class="row wrap">
            @if (projectOptions().length) {
              <select class="input" [ngModel]="''" (ngModelChange)="link('project', +$event)" aria-label="Vincular proyecto">
                <option value="" disabled>Vincular un proyecto…</option>
                @for (p of projectOptions(); track p.id) { <option [value]="p.id">{{ p.name }}</option> }
              </select>
            }
            @if (taskOptions().length) {
              <select class="input" [ngModel]="''" (ngModelChange)="link('task', +$event)" aria-label="Vincular tarea existente">
                <option value="" disabled>Vincular una tarea existente…</option>
                @for (t of taskOptions(); track t.id) { <option [value]="t.id">{{ t.title }}</option> }
              </select>
            }
          </div>
        </section>
      } @else {
        <div class="skeleton" style="height:240px"></div>
      }
    }
  </div>`,
  styles: [`
    .new { padding: 18px; display: grid; gap: 12px; margin-bottom: 16px; max-width: 640px; }
    .wrap { flex-wrap: wrap; gap: 12px; }
    .swatches { display: flex; gap: 6px; padding-top: 4px; }
    .swatch { width: 22px; height: 22px; border-radius: 50%; border: 2px solid transparent; cursor: pointer; padding: 0;
      &.on { border-color: var(--text); box-shadow: 0 0 0 2px var(--surface); } }
    .tabs { display: flex; gap: 4px; margin-bottom: 14px; border-bottom: 1px solid var(--border); }
    .tab { background: none; border: none; padding: 8px 12px; cursor: pointer; color: var(--text-muted); border-bottom: 2px solid transparent; font: inherit;
      &.on { color: var(--text); border-bottom-color: var(--accent); font-weight: 550; } }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px; }
    .goal { padding: 16px; display: grid; gap: 8px; color: inherit; text-decoration: none; border-top: 3px solid var(--c);
      &:hover { border-color: var(--border-strong); border-top-color: var(--c); }
      h3 { margin: 0; font-size: 15px; font-weight: 600; } app-icon { color: var(--c); } }
    .top { gap: 8px; align-items: center; }
    .meter { display: flex; align-items: center; gap: 10px; strong { font-variant-numeric: tabular-nums; min-width: 44px; text-align: right; } }
    .bar { position: relative; flex: 1; height: 8px; background: var(--surface-3); border-radius: 4px;
      span { display: block; height: 100%; background: var(--c, var(--accent)); border-radius: 4px; transition: width .4s; }
      &.lg { height: 12px; border-radius: 6px; span { border-radius: 6px; } } }
    .mark { position: absolute; top: -3px; bottom: -3px; width: 2px; background: var(--text); opacity: .55; border-radius: 1px; }
    .small { font-size: 12.5px; }
    .chip.good { background: color-mix(in srgb, var(--good) 18%, transparent); color: var(--text); }
    .chip.bad { background: color-mix(in srgb, var(--warning) 22%, transparent); color: var(--text); }
    .good-t { color: var(--good); } .bad-t { color: var(--warning); }
    .empty { grid-column: 1 / -1; padding: 28px; display: grid; justify-items: center; gap: 10px; text-align: center; app-icon { color: var(--accent); } }
    .back { display: inline-flex; align-items: center; gap: 4px; margin-bottom: 10px; text-decoration: none; font-size: 13px; }
    .head { padding: 20px; display: grid; gap: 12px; border-top: 4px solid var(--c); margin-bottom: 14px; }
    .title { font-family: inherit; font-size: 22px; font-weight: 650; line-height: 1.3; border: none; background: none; color: var(--text); padding: 0; width: 100%; outline: none;
      &:focus { box-shadow: 0 2px 0 var(--accent); } }
    .desc { resize: vertical; }
    .field.inline { display: flex; align-items: center; gap: 8px; input { width: auto; } }
    .big { display: grid; gap: 6px; p { margin: 0; } }
    .actions { align-items: center; }
    .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 14px; }
    @media (max-width: 760px) { .cols { grid-template-columns: 1fr; } }
    .sec { padding: 18px; display: grid; gap: 10px; align-content: start;
      h2 { margin: 0; font-size: 15px; display: flex; gap: 8px; align-items: baseline; span { font-weight: 400; font-size: 13px; } }
      p { margin: 0; } select { max-width: 100%; } }
    .list { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px;
      li { gap: 8px; align-items: center; padding: 5px 2px; border-radius: var(--radius-sm); &:hover { background: var(--surface-2); } } }
    .grow { flex: 1; min-width: 0; overflow-wrap: anywhere; }
    .done { text-decoration: line-through; color: var(--text-muted); }
    .dot { width: 9px; height: 9px; border-radius: 50%; flex: none; display: inline-block; }
    .projects { display: grid; gap: 4px; } .proj { gap: 8px; align-items: center; }
  `],
})
export class GoalsComponent {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  private router = inject(Router);

  /** Parámetro de ruta (/goals/:id) */
  readonly id = input<string | undefined>();

  colors = COLORS; tabs = TABS; todayStr = today(); fmt = formatDay; deadline = deadlineLabel;
  idea = IDEAS[Math.floor(Math.random() * IDEAS.length)];
  tab = signal<GoalStatus>('active');
  list = signal<Goal[] | null>(null);
  goal = signal<GoalDetail | null>(null);
  draft = signal<{ title: string; deadline: string; color: string } | null>(null);
  busy = signal(false);
  edit = { title: '', description: '', deadline: '' };
  newMilestone = ''; newTask = '';
  private projects = signal<Project[]>([]);
  private habits = signal<Habit[]>([]);
  private tasks = signal<Task[]>([]);

  projectOptions = computed(() => { const g = this.goal(); const used = new Set(g?.projects.map(p => p.id)); return this.projects().filter(p => !used.has(p.id)); });
  habitOptions = computed(() => { const g = this.goal(); const used = new Set(g?.habits.map(h => h.id)); return this.habits().filter(h => !used.has(h.id)); });
  taskOptions = computed(() => {
    const g = this.goal(); const used = new Set(g?.tasks.map(t => t.id));
    return this.tasks().filter(t => t.id > 0 && !t.parent_task_id && t.status !== 'completed' && t.status !== 'archived' && !used.has(t.id)).slice(0, 200);
  });

  constructor() {
    effect(() => {
      const id = this.id();
      this.goal.set(null);
      if (id) this.loadGoal(+id);
      else this.loadList();
    });
  }


  summary(g: Goal): string {
    const p = g.progress, parts: string[] = [];
    if (p.tasks_total) parts.push(`${p.tasks_done}/${p.tasks_total} tareas`);
    if (p.milestones_total) parts.push(`${p.milestones_done}/${p.milestones_total} hitos`);
    if (p.habit_rate !== null) parts.push(`rutinas ${p.habit_rate} %`);
    return parts.join(' · ') || 'Sin pasos todavía';
  }
  dayOf(t: GoalDetail['tasks'][number]) { return taskDay(t) ?? ''; }

  setTab(t: GoalStatus) { this.tab.set(t); this.loadList(); }
  startNew() { this.draft.set({ title: '', deadline: '', color: COLORS[0] }); }

  private loadList() {
    this.list.set(null);
    this.api.goals(this.tab()).subscribe({ next: l => this.list.set(l), error: e => { this.list.set([]); this.toast.error(e); } });
  }

  private loadGoal(id: number) {
    this.api.goal(id).subscribe({
      next: g => this.show(g),
      error: e => { this.toast.error(e, 'No se encontró el objetivo'); this.router.navigate(['/goals']); },
    });
    forkJoin({ projects: this.api.projects(), habits: this.api.habits(), tasks: this.api.tasks() }).subscribe({
      next: r => { this.projects.set(r.projects); this.habits.set(r.habits); this.tasks.set(r.tasks); },
      error: () => {},
    });
  }

  private show(g: GoalDetail) {
    this.goal.set(g);
    this.edit = { title: g.title, description: g.description ?? '', deadline: g.deadline ?? '' };
  }

  private run(obs: ReturnType<ApiService['goal']>, ok?: (g: GoalDetail) => void) {
    this.busy.set(true);
    obs.subscribe({
      next: g => { this.busy.set(false); this.show(g); ok?.(g); },
      error: e => { this.busy.set(false); this.toast.error(e); const cur = this.goal(); if (cur) this.show(cur); },
    });
  }

  create() {
    const d = this.draft();
    if (!d?.title.trim()) return;
    this.busy.set(true);
    this.api.createGoal({ title: d.title.trim(), deadline: d.deadline || null, color: d.color }).subscribe({
      next: g => { this.busy.set(false); this.draft.set(null); this.router.navigate(['/goals', g.id]); },
      error: e => { this.busy.set(false); this.toast.error(e); },
    });
  }

  save(data: Parameters<ApiService['updateGoal']>[1]) {
    const g = this.goal();
    if (!g) return;
    if (data.title !== undefined && (!data.title || data.title === g.title)) { this.edit.title = g.title; return; }
    if (data.description !== undefined && data.description === (g.description ?? null)) return;
    if (data.deadline !== undefined && data.deadline === (g.deadline ?? null)) return;
    this.run(this.api.updateGoal(g.id, data), () => {
      if (data.archived !== undefined) this.toast.success(data.archived ? 'Objetivo archivado' : 'Objetivo recuperado');
    });
  }

  complete() {
    const g = this.goal();
    if (!g) return;
    this.run(this.api.completeGoal(g.id), r => this.toast.success(`¡Objetivo cumplido! +${r.xp_gained ?? 0} XP`));
  }
  reopen() { const g = this.goal(); if (g) this.run(this.api.reopenGoal(g.id)); }

  remove() {
    const g = this.goal();
    if (!g || !confirm(`¿Eliminar «${g.title}»? Sus hitos se borran; los proyectos, tareas y rutinas vinculados no.`)) return;
    this.busy.set(true);
    this.api.deleteGoal(g.id).subscribe({
      next: () => { this.busy.set(false); this.toast.success('Objetivo eliminado'); this.router.navigate(['/goals']); },
      error: e => { this.busy.set(false); this.toast.error(e); },
    });
  }

  addMilestone() {
    const g = this.goal(), title = this.newMilestone.trim();
    if (!g || !title) return;
    this.run(this.api.addMilestone(g.id, title), () => (this.newMilestone = ''));
  }
  toggleMilestone(id: number, done: boolean) { this.run(this.api.updateMilestone(id, { done })); }
  removeMilestone(id: number) { this.run(this.api.deleteMilestone(id)); }

  link(kind: GoalLinkKind, refId: number) {
    const g = this.goal();
    if (g && refId) this.run(this.api.linkGoal(g.id, kind, refId));
  }
  unlink(kind: GoalLinkKind, refId: number) { const g = this.goal(); if (g) this.run(this.api.unlinkGoal(g.id, kind, refId)); }

  addTask() {
    const g = this.goal(), title = this.newTask.trim();
    if (!g || !title) return;
    this.busy.set(true);
    this.api.postTask({ title }).subscribe({
      next: t => { this.newTask = ''; this.api.tasksChanged.next(); this.run(this.api.linkGoal(g.id, 'task', t.id)); },
      error: e => { this.busy.set(false); this.toast.error(e); },
    });
  }

  toggleTask(id: number, done: boolean) {
    const g = this.goal();
    if (!g) return;
    this.api.updateTask(id, { status: done ? 'completed' : 'todo' }).subscribe({
      next: () => { this.api.xpChanged.next(); this.loadGoal(g.id); },
      error: e => { this.toast.error(e); this.show(g); },
    });
  }
}
