import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../core/api.service';
import { CalendarEvent, CalendarStatus, Task } from '../core/models';
import { ToastService } from '../core/toast.service';
import { addDays, parseDay, taskDay, taskTime, today, ymd } from '../core/util';
import { IconComponent } from '../shared/icon.component';
import { TaskDialogService } from '../shared/task-dialog.service';

interface Entry { key: string; title: string; time: string; kind: 'task' | 'google'; done?: boolean; task?: Task; event?: CalendarEvent; }
const MONTH = new Intl.DateTimeFormat('es', { month: 'long', year: 'numeric' });
const LONG = new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long' });
const pad = (n: number) => String(n).padStart(2, '0');

@Component({
  selector: 'app-calendar',
  standalone: true,
  imports: [IconComponent],
  template: `
  <div class="page cal-page">
    <div class="page-head">
      <h1 class="month">{{ monthLabel() }}</h1>
      <div class="row">
        <button class="btn icon" (click)="shift(-1)" aria-label="Mes anterior"><app-icon name="left" /></button>
        <button class="btn" (click)="goToday()">Hoy</button>
        <button class="btn icon" (click)="shift(1)" aria-label="Mes siguiente"><app-icon name="right" /></button>
      </div>
      <span class="spacer"></span>
      <div class="legend row"><span><i class="task"></i> Tarea</span><span><i class="google"></i> Google Calendar</span></div>
    </div>

    <div class="layout">
      <div class="card grid" role="grid" [attr.aria-label]="monthLabel()">
        @for (d of weekdays; track d) { <div class="wd" role="columnheader">{{ d }}</div> }
        @for (c of cells(); track c.day) {
          <div class="cell" role="gridcell" [class.out]="!c.inMonth" [class.today]="c.day === todayStr" [class.sel]="c.day === selected()"
               (click)="selected.set(c.day)" (dblclick)="newTask(c.day)" tabindex="0" (keydown.enter)="selected.set(c.day)" [attr.aria-label]="c.aria">
            <span class="num">{{ c.num }}</span>
            @for (e of c.entries.slice(0, 3); track e.key) {
              <button class="ev" [class]="e.kind" [class.done]="e.done" [title]="e.title" (click)="openEntry(e, $event)">
                @if (e.time) { <b>{{ e.time }}</b> }{{ e.title }}
              </button>
            }
            @if (c.entries.length > 3) { <span class="more">+{{ c.entries.length - 3 }} más</span> }
          </div>
        }
      </div>

      <aside class="side">
        <section class="card box">
          <header class="row"><h2 class="cap">{{ selectedLabel() }}</h2><span class="spacer"></span>
            <button class="btn sm" (click)="newTask(selected())"><app-icon name="plus" [size]="13" /> Tarea</button></header>
          @for (e of selectedEntries(); track e.key) {
            <button class="line row" (click)="openEntry(e, $event)">
              <i [class]="e.kind"></i><span class="truncate" [class.done]="e.done">{{ e.title }}</span><span class="spacer"></span>
              <span class="muted">{{ e.time || 'Todo el día' }}</span>
            </button>
          } @empty { <p class="muted">Nada este día. Haz doble clic en un día para crear una tarea.</p> }
        </section>

        <section class="card box">
          <h2>Google Calendar</h2>
          @if (status(); as s) {
            @if (!s.configured) {
              <p class="muted">La integración no está configurada en el servidor. Define <code>GOOGLE_CLIENT_ID</code> y <code>GOOGLE_CLIENT_SECRET</code> en el archivo <code>.env</code> (pasos en el README) y reinicia el backend.</p>
            } @else if (!s.connected) {
              <p class="muted">Conecta tu cuenta para ver tus eventos aquí y enviar a Google las tareas con fecha.</p>
              <button class="btn primary" (click)="connect()" [disabled]="busy()"><app-icon name="link" /> Conectar Google Calendar</button>
            } @else {
              <p><span class="ok"></span> Conectado como <strong>{{ s.email || 'tu cuenta de Google' }}</strong></p>
              <label class="row"><input type="checkbox" [checked]="s.auto_sync" (change)="setAuto($any($event.target).checked)" /> Sincronizar tareas automáticamente</label>
              <div class="row wrap">
                <button class="btn" (click)="sync()" [disabled]="busy()"><app-icon name="sync" /> {{ busy() ? 'Sincronizando…' : 'Sincronizar ahora' }}</button>
                <button class="btn ghost danger" (click)="disconnect()" [disabled]="busy()">Desconectar</button>
              </div>
              <p class="muted small">Las tareas con fecha se crean como eventos en tu calendario principal. Los eventos de Google se muestran aquí en modo lectura.</p>
            }
          } @else { <div class="skeleton" style="height:60px"></div> }
        </section>
      </aside>
    </div>
  </div>`,
  styles: [`
    .cal-page { max-width: 1400px; }
    .month { min-width: 190px; } .month::first-letter, .cap::first-letter { text-transform: uppercase; }
    .legend { gap: 14px; font-size: 12px; color: var(--text-2); span { display: inline-flex; align-items: center; gap: 6px; } }
    i.task, i.google { width: 9px; height: 9px; border-radius: 2px; flex: none; display: inline-block; }
    i.task { background: var(--accent); } i.google { background: var(--series-1); }
    .layout { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 14px; align-items: start; }
    .grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); overflow: hidden; }
    .wd { padding: 8px 10px; font-size: 12px; font-weight: 500; color: var(--text-3); border-bottom: 1px solid var(--border); }
    .cell { min-height: 108px; padding: 6px; border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); display: flex; flex-direction: column; gap: 3px; cursor: pointer; min-width: 0;
      &:nth-child(7n) { border-right: none; } &:hover { background: var(--surface-2); } &.out .num { color: var(--text-3); opacity: .6; }
      &.sel { box-shadow: inset 0 0 0 2px var(--accent); } &.today .num { background: var(--accent); color: var(--on-accent); } }
    .num { width: 24px; height: 24px; border-radius: 50%; display: grid; place-content: center; font-size: 12.5px; font-weight: 500; font-variant-numeric: tabular-nums; }
    .ev { border: none; text-align: left; font-size: 12px; padding: 1px 6px; border-radius: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; width: 100%; line-height: 1.5; color: var(--text);
      &.task { background: var(--accent-soft); border-left: 2px solid var(--accent); } &.google { background: color-mix(in srgb, var(--series-1) 18%, transparent); border-left: 2px solid var(--series-1); }
      &.done { text-decoration: line-through; opacity: .6; } &:hover { filter: brightness(1.15); } b { font-weight: 500; margin-right: 4px; color: var(--text-2); } }
    .more { font-size: 11px; color: var(--text-3); padding-left: 6px; }
    .side { display: grid; gap: 14px; }
    .box { padding: 16px; display: grid; gap: 10px; }
    .line { background: none; border: none; text-align: left; padding: 5px 6px; margin: 0 -6px; border-radius: var(--radius-sm); width: calc(100% + 12px); font-size: 13px; &:hover { background: var(--surface-2); } .muted { font-size: 12px; white-space: nowrap; } }
    .done { text-decoration: line-through; color: var(--text-3); }
    .ok { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--good); margin-right: 4px; }
    .wrap { flex-wrap: wrap; } .small { font-size: 12px; }
    code { font: 12px var(--mono); background: var(--surface-2); padding: 1px 5px; border-radius: 4px; overflow-wrap: anywhere; }
    @media (max-width: 1000px) { .layout { grid-template-columns: minmax(0, 1fr); } .cell { min-height: 78px; } }
    @media (max-width: 600px) { .ev { font-size: 0; height: 6px; padding: 0; b { display: none; } } .cell { min-height: 58px; } .legend { display: none; } }
  `],
})
export class CalendarComponent implements OnInit {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private dialog = inject(TaskDialogService);

  weekdays = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  todayStr = today();
  month = signal(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  selected = signal(today());
  tasks = signal<Task[]>([]);
  events = signal<CalendarEvent[]>([]);
  status = signal<CalendarStatus | null>(null);
  busy = signal(false);

  monthLabel = computed(() => MONTH.format(this.month()));
  selectedLabel = computed(() => LONG.format(parseDay(this.selected())));

  /** Primer día visible: el lunes de la semana en que empieza el mes. */
  private gridStart = computed(() => {
    const m = this.month();
    return addDays(ymd(m), -((m.getDay() + 6) % 7));
  });

  private byDay = computed(() => {
    const map = new Map<string, Entry[]>();
    const put = (day: string, e: Entry) => { if (!map.has(day)) map.set(day, []); map.get(day)!.push(e); };
    const mirrored = new Set<number>();
    for (const t of this.tasks()) {
      const d = taskDay(t);
      if (!d) continue;
      mirrored.add(t.id);
      put(d, { key: 't' + t.id, title: t.title, time: taskTime(t), kind: 'task', done: t.status === 'completed', task: t });
    }
    for (const ev of this.events()) {
      if (ev.task_id && mirrored.has(ev.task_id)) continue;  // ya se muestra como tarea
      if (ev.all_day) {
        // Google usa fin exclusivo: un evento de varios días ocupa [start, end)
        for (let d = ev.start, i = 0; d < ev.end && i < 62; d = addDays(d, 1), i++) put(d, { key: `g${ev.id}${d}`, title: ev.title, time: '', kind: 'google', event: ev });
      } else {
        const s = new Date(ev.start);
        put(ymd(s), { key: 'g' + ev.id, title: ev.title, time: `${pad(s.getHours())}:${pad(s.getMinutes())}`, kind: 'google', event: ev });
      }
    }
    for (const list of map.values()) list.sort((a, b) => (a.time || '').localeCompare(b.time || '') || a.title.localeCompare(b.title));
    return map;
  });

  cells = computed(() => {
    const start = this.gridStart(), m = this.month().getMonth(), by = this.byDay();
    return Array.from({ length: 42 }, (_, i) => {
      const day = addDays(start, i), date = parseDay(day), entries = by.get(day) ?? [];
      return { day, num: date.getDate(), inMonth: date.getMonth() === m, entries, aria: `${LONG.format(date)}, ${entries.length} elementos` };
    });
  });
  selectedEntries = computed(() => this.byDay().get(this.selected()) ?? []);

  constructor() { this.api.tasksChanged.pipe(takeUntilDestroyed()).subscribe(() => this.loadTasks()); }

  ngOnInit() {
    // Resultado del flujo OAuth (el backend redirige aquí con ?google=…)
    const result = this.route.snapshot.queryParamMap.get('google');
    if (result) {
      if (result === 'connected') this.toast.success('Google Calendar conectado');
      else this.toast.error(result === 'denied' ? 'Has cancelado la conexión con Google' : 'No se pudo conectar con Google Calendar');
      this.router.navigate([], { queryParams: {}, replaceUrl: true });
    }
    this.loadTasks();
    this.api.calendarStatus().subscribe({ next: s => { this.status.set(s); this.loadEvents(); }, error: e => this.toast.error(e) });
  }

  private loadTasks() { this.api.tasks().subscribe({ next: t => this.tasks.set(t), error: e => this.toast.error(e) }); }
  private loadEvents() {
    if (!this.status()?.connected) { this.events.set([]); return; }
    const start = parseDay(this.gridStart()), end = parseDay(addDays(this.gridStart(), 42));
    this.api.calendarEvents(start.toISOString(), end.toISOString()).subscribe({
      next: e => this.events.set(e),
      error: err => {
        this.toast.error(err, 'No se pudieron cargar los eventos de Google');
        if (err.status === 409) this.api.calendarStatus().subscribe(s => { this.status.set(s); this.events.set([]); });
      },
    });
  }

  shift(n: number) { const m = this.month(); this.month.set(new Date(m.getFullYear(), m.getMonth() + n, 1)); this.loadEvents(); }
  goToday() { const d = new Date(); this.month.set(new Date(d.getFullYear(), d.getMonth(), 1)); this.selected.set(today()); this.loadEvents(); }
  newTask(day: string) { this.dialog.create({ day }); }
  openEntry(e: Entry, ev: Event) {
    ev.stopPropagation();
    if (e.task) this.dialog.edit(e.task);
    else if (e.event?.html_link?.startsWith('https://')) window.open(e.event.html_link, '_blank', 'noopener');
  }

  connect() {
    this.busy.set(true);
    this.api.calendarAuthUrl().subscribe({ next: r => (location.href = r.url), error: e => { this.busy.set(false); this.toast.error(e); } });
  }
  sync() {
    this.busy.set(true);
    this.api.calendarSync().subscribe({
      next: r => { this.busy.set(false); this.toast.show(r.failed ? `${r.synced} tareas sincronizadas, ${r.failed} con error` : `${r.synced} tareas sincronizadas`, r.failed ? 'error' : 'success'); this.loadEvents(); },
      error: e => { this.busy.set(false); this.toast.error(e); this.api.calendarStatus().subscribe(s => this.status.set(s)); },
    });
  }
  setAuto(on: boolean) { this.api.calendarSettings(on).subscribe({ next: s => this.status.set(s), error: e => this.toast.error(e) }); }
  disconnect() {
    if (!confirm('¿Desconectar Google Calendar? Los eventos ya creados en Google se conservan.')) return;
    this.api.calendarDisconnect().subscribe({
      next: () => { this.events.set([]); this.api.calendarStatus().subscribe(s => this.status.set(s)); this.toast.show('Google Calendar desconectado'); },
      error: e => this.toast.error(e),
    });
  }
}
