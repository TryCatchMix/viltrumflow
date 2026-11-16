import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { BOARD_STATUSES, Overview, PRIORITIES, PRIORITY_LABEL, STATUS_LABEL, Task } from '../core/models';
import { addDays, formatDay, isOverdue, parseDay, taskDay, today } from '../core/util';
import { Bar, BarListComponent } from '../shared/bar-list.component';
import { IconComponent } from '../shared/icon.component';
import { LineChartComponent, Series } from '../shared/line-chart.component';
import { TaskDialogService } from '../shared/task-dialog.service';

const SHORT = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' });

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [RouterLink, LineChartComponent, BarListComponent, IconComponent],
  template: `
  <div class="page">
    <div class="page-head">
      <div><h1>{{ greeting }}, {{ name() }}</h1><p>{{ dateLabel }}</p></div>
      <span class="spacer"></span>
      <div class="row" role="group" aria-label="Periodo">
        @for (d of ranges; track d) { <button class="btn sm" [class.active]="days() === d" (click)="setDays(d)">{{ d }} días</button> }
      </div>
    </div>

    @if (data(); as o) {
      <div class="tiles">
        <a class="card tile" routerLink="/tasks"><span>Abiertas</span><strong>{{ open() }}</strong><small>de {{ o.total }} tareas</small></a>
        <a class="card tile" routerLink="/tasks" [queryParams]="{ due: 'overdue' }">
          <span>@if (o.overdue) { <app-icon name="alert" [size]="13" class="crit" /> } Atrasadas</span><strong>{{ o.overdue }}</strong>
          <small>{{ o.overdue ? 'requieren atención' : 'todo al día' }}</small></a>
        <a class="card tile" routerLink="/tasks" [queryParams]="{ due: 'today' }"><span>Para hoy</span><strong>{{ o.due_today }}</strong><small>{{ o.due_week }} en los próximos 7 días</small></a>
        <div class="card tile"><span>Completadas (7 días)</span><strong>{{ o.completed_week }}</strong><small>{{ o.completion_rate }}% del total</small></div>
        <a class="card tile" routerLink="/graph"><span>Notas</span><strong>{{ o.notes }}</strong><small>{{ o.links }} enlaces entre ellas</small></a>
      </div>

      <div class="grid">
        <section class="card panel wide">
          <header class="row">
            <h2>Actividad: tareas creadas y completadas por día</h2><span class="spacer"></span>
            <button class="btn ghost sm" (click)="table.set(!table())"><app-icon [name]="table() ? 'graph' : 'table'" [size]="14" /> {{ table() ? 'Ver gráfico' : 'Ver tabla' }}</button>
          </header>
          @if (table()) {
            <div class="tbl"><table>
              <thead><tr><th>Día</th><th>Creadas</th><th>Completadas</th><th>Abiertas</th></tr></thead>
              <tbody>@for (p of reversed(); track p.date) { <tr><td>{{ p.date }}</td><td>{{ p.created }}</td><td>{{ p.completed }}</td><td>{{ p.open }}</td></tr> }</tbody>
            </table></div>
          } @else {
            <app-line-chart [labels]="labels()" [series]="activity()" label="Tareas creadas y completadas por día" />
          }
        </section>

        <section class="card panel wide">
          <header><h2>Carga pendiente: tareas abiertas al final de cada día</h2></header>
          <app-line-chart [labels]="labels()" [series]="backlog()" label="Tareas abiertas por día" />
        </section>

        <section class="card panel"><header><h2>Por estado</h2></header><app-bar-list [bars]="statusBars()" /></section>
        <section class="card panel"><header><h2>Abiertas por prioridad</h2></header><app-bar-list [bars]="priorityBars()" /></section>
        <section class="card panel">
          <header class="row"><h2>Avance por proyecto</h2><span class="spacer"></span><a routerLink="/projects">Ver todos</a></header>
          <app-bar-list [bars]="projectBars()" [progress]="true" empty="Aún no hay proyectos" />
        </section>
        <section class="card panel">
          <header class="row"><h2>Próximas tareas</h2><span class="spacer"></span><a routerLink="/tasks">Ver todas</a></header>
          @for (t of upcoming(); track t.id) {
            <button class="up row" (click)="dialog.edit(t)">
              <span class="truncate">{{ t.title }}</span><span class="spacer"></span>
              <span class="chip" [class.late]="overdue(t)">@if (overdue(t)) { <app-icon name="alert" [size]="11" /> }{{ fmt(day(t)!) }}</span>
            </button>
          } @empty { <p class="muted">No hay tareas con fecha. <a routerLink="/tasks">Añade una</a>.</p> }
        </section>
      </div>
    } @else {
      <div class="tiles">@for (i of [1,2,3,4,5]; track i) { <div class="skeleton" style="height:92px"></div> }</div>
      <div class="skeleton" style="height:300px;margin-top:16px"></div>
    }
  </div>`,
  styles: [`
    .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; }
    .tile { padding: 14px 16px; display: grid; gap: 2px; color: var(--text); &:hover { text-decoration: none; }
      span { font-size: 12px; color: var(--text-2); display: flex; align-items: center; gap: 5px; } strong { font-size: 28px; font-weight: 600; line-height: 1.2; font-variant-numeric: tabular-nums; } small { color: var(--text-3); font-size: 12px; } }
    a.tile:hover { border-color: var(--text-3); }
    .crit { color: var(--critical); }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 12px; }
    .panel { padding: 16px 18px; display: grid; gap: 14px; align-content: start; min-width: 0; header a { font-size: 13px; } }
    .wide { grid-column: 1 / -1; }
    .up { background: none; border: none; padding: 5px 6px; margin: 0 -6px; border-radius: var(--radius-sm); text-align: left; width: calc(100% + 12px); &:hover { background: var(--surface-2); } }
    .late { color: var(--critical); }
    .tbl { max-height: 240px; overflow: auto; } table { width: 100%; border-collapse: collapse; font-size: 13px; font-variant-numeric: tabular-nums; }
    th, td { text-align: right; padding: 5px 10px; border-bottom: 1px solid var(--border); } th:first-child, td:first-child { text-align: left; } th { color: var(--text-3); font-weight: 500; position: sticky; top: 0; background: var(--surface); }
    @media (max-width: 900px) { .grid { grid-template-columns: minmax(0, 1fr); } }
  `],
})
export class DashboardComponent implements OnInit {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  dialog = inject(TaskDialogService);

  ranges = [7, 30, 90];
  days = signal(30);
  table = signal(false);
  data = signal<Overview | null>(null);
  tasks = signal<Task[]>([]);
  fmt = formatDay; day = taskDay; overdue = isOverdue;

  name = () => this.auth.user()?.full_name?.split(' ')[0] || this.auth.user()?.username || '';
  greeting = (h => (h < 6 ? 'Buenas noches' : h < 13 ? 'Buenos días' : h < 21 ? 'Buenas tardes' : 'Buenas noches'))(new Date().getHours());
  dateLabel = new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());

  open = computed(() => { const o = this.data()!; return o.total - o.by_status.completed; });
  labels = computed(() => this.data()!.timeline.map(p => SHORT.format(parseDay(p.date))));
  reversed = computed(() => [...this.data()!.timeline].reverse());
  activity = computed<Series[]>(() => [
    { name: 'Creadas', color: 'var(--series-1)', values: this.data()!.timeline.map(p => p.created) },
    { name: 'Completadas', color: 'var(--series-2)', values: this.data()!.timeline.map(p => p.completed) },
  ]);
  backlog = computed<Series[]>(() => [{ name: 'Abiertas', color: 'var(--series-1)', values: this.data()!.timeline.map(p => p.open) }]);
  statusBars = computed<Bar[]>(() => BOARD_STATUSES.map(s => ({ label: STATUS_LABEL[s], value: this.data()!.by_status[s] })));
  priorityBars = computed<Bar[]>(() => PRIORITIES.map(p => ({ label: PRIORITY_LABEL[p], value: this.data()!.by_priority[p] })));
  projectBars = computed<Bar[]>(() => this.data()!.projects.map(p => ({ label: p.name, value: p.completed, total: p.total, color: p.color })));
  upcoming = computed(() => this.tasks()
    .filter(t => t.due_date && t.status !== 'completed' && taskDay(t)! <= addDays(today(), 14))
    .sort((a, b) => a.due_date!.localeCompare(b.due_date!)).slice(0, 7));

  constructor() { this.api.tasksChanged.pipe(takeUntilDestroyed()).subscribe(() => this.load()); }
  ngOnInit() { this.load(); }
  setDays(d: number) { this.days.set(d); this.load(); }

  private load() {
    this.api.overview(this.days()).subscribe(o => this.data.set(o));
    this.api.tasks().subscribe(t => this.tasks.set(t));
  }
}
