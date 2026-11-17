import { AfterViewInit, Component, ElementRef, Input, OnChanges, OnDestroy, SimpleChanges, ViewChild, computed, inject, signal } from '@angular/core';
import { ApiService } from '../core/api.service';
import { CalendarEvent, HabitDayItem, PRIORITY_LABEL, Task } from '../core/models';
import { ToastService } from '../core/toast.service';
import { formatDuration, isOverdue, taskDay, toDue, today } from '../core/util';
import { TaskDialogService } from './task-dialog.service';

const HOUR_PX = 52;
const PPM = HOUR_PX / 60;          // píxeles por minuto
const SNAP = 15;                   // los bloques se colocan en tramos de 15 minutos
export const DEFAULT_BLOCK = 30;   // duración de una tarea con hora y sin estimación (igual que en Google Calendar)
const HABIT_BLOCK = 20;
const pad = (n: number) => String(n).padStart(2, '0');
const hhmm = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

interface Block {
  key: string; kind: 'task' | 'habit' | 'event'; title: string; start: number; minutes: number;
  done?: boolean; task?: Task; habit?: HabitDayItem; event?: CalendarEvent; lane: number; lanes: number;
}
type Drag = { kind: 'task' | 'habit'; id: number; minutes: number; grab: number };

/** Planificador de un día: franjas horarias donde colocar tareas y rutinas arrastrándolas. */
@Component({
  selector: 'app-day-planner',
  standalone: true,
  template: `
  <div class="planner">
    <aside class="pool card" [class.over]="overPool()" (dragover)="poolOver($event)" (dragleave)="overPool.set(false)" (drop)="dropOnPool($event)">
      <h3>Por colocar <span class="muted">{{ unplaced().length }}</span></h3>
      <p class="muted small">Arrastra a una hora. Suéltalo aquí para quitarle la hora.</p>
      @for (t of unplaced(); track t.id) {
        <div class="chipblock" [class.late]="overdue(t)" [attr.draggable]="t.can_edit" (dragstart)="startDrag($event, 'task', t.id, t.estimated_minutes || defaultBlock)" (dragend)="endDrag()"
             (click)="dialog.edit(t)" tabindex="0" (keydown.enter)="dialog.edit(t)" [title]="t.can_edit ? 'Arrastra a una hora para planificarla' : 'Solo lectura'">
          <span class="truncate">{{ t.title }}</span>
          <span class="muted">{{ duration((t.estimated_minutes || defaultBlock) * 60) }}{{ overdue(t) ? ' · atrasada' : '' }}</span>
        </div>
      } @empty { <p class="muted small">Todo lo de este día ya tiene hora.</p> }
      @if (habitsNoTime().length) {
        <h3>Rutinas sin hora</h3>
        @for (h of habitsNoTime(); track h.id) {
          <div class="chipblock habit" draggable="true" (dragstart)="startDrag($event, 'habit', h.id, habitBlock)" (dragend)="endDrag()" title="Arrastra para fijar su hora prevista (todos los días)">
            <span class="truncate"><i class="dot" [style.background]="h.color"></i> {{ h.title }}</span>
          </div>
        }
      }
      @if (undated().length) {
        <details>
          <summary>Sin fecha <span class="muted">{{ undated().length }}</span></summary>
          @for (t of undated(); track t.id) {
            <div class="chipblock" [attr.draggable]="t.can_edit" (dragstart)="startDrag($event, 'task', t.id, t.estimated_minutes || defaultBlock)" (dragend)="endDrag()" (click)="dialog.edit(t)">
              <span class="truncate">{{ t.title }}</span><span class="muted">{{ priority[t.priority] }}</span>
            </div>
          }
        </details>
      }
      @if (allDayEvents().length) {
        <h3>Eventos de todo el día</h3>
        @for (e of allDayEvents(); track e.id) { <div class="chipblock event"><span class="truncate">{{ e.title }}</span></div> }
      }
    </aside>

    <div class="card timeline-wrap" #scroller>
      <div class="timeline" #timeline [style.height.px]="dayHeight" (dragover)="lineOver($event)" (dragleave)="lineLeave($event)" (drop)="dropOnLine($event)">
        @for (h of hours; track h) {
          <div class="hour" [style.top.px]="h * hourPx"><span>{{ pad(h) }}:00</span></div>
        }
        @if (nowTop() !== null) { <div class="now" [style.top.px]="nowTop()" aria-hidden="true"></div> }
        @if (ghost(); as g) {
          <div class="ghost" [style.top.px]="g.start * ppm" [style.height.px]="g.minutes * ppm"><span>{{ fmt(g.start) }} – {{ fmt(g.start + g.minutes) }}</span></div>
        }
        @for (b of blocks(); track b.key) {
          <div class="block" [class]="b.kind" [class.done]="b.done" [class.compact]="b.minutes < 30" [class.dragging]="drag?.id === b.task?.id && b.kind === 'task'"
               [style.top.px]="b.start * ppm" [style.height.px]="b.minutes * ppm - 2"
               [style.left]="'calc(' + (100 * b.lane / b.lanes) + '% + 2px)'" [style.width]="'calc(' + (100 / b.lanes) + '% - 4px)'"
               [attr.draggable]="movable(b)" (dragstart)="blockDrag($event, b)" (dragend)="endDrag()"
               (click)="open(b)" [title]="b.title + ' · ' + fmt(b.start) + '–' + fmt(b.start + b.minutes)">
            @if (b.kind === 'task') {
              <input type="checkbox" class="check" [checked]="b.done" [disabled]="!b.task!.can_edit" (click)="$event.stopPropagation()" (change)="toggle(b.task!)" [attr.aria-label]="'Completar ' + b.title" />
            } @else if (b.kind === 'habit') {
              <input type="checkbox" class="check" [checked]="b.done" (click)="$event.stopPropagation()" (change)="toggleHabit(b.habit!)" [attr.aria-label]="'Marcar ' + b.title" />
            }
            <div class="text"><strong class="truncate">{{ b.title }}</strong>
              @if (b.minutes >= 30) { <small>{{ fmt(b.start) }} – {{ fmt(b.start + b.minutes) }}</small> }</div>
            @if (b.kind === 'task' && b.task!.can_edit) {
              <span class="resize" (pointerdown)="resizeStart($event, b)" title="Arrastra para cambiar la duración" aria-hidden="true"></span>
            }
          </div>
        }
      </div>
    </div>
  </div>`,
  styles: [`
    .planner { display: grid; grid-template-columns: 250px minmax(0, 1fr); gap: 12px; align-items: start; }
    .pool { padding: 12px; display: grid; gap: 6px; align-content: start; max-height: 76vh; overflow-y: auto; position: sticky; top: 0;
      &.over { border-color: var(--accent); background: var(--accent-soft); }
      h3 { font-size: 12.5px; color: var(--text-2); margin-top: 6px; display: flex; gap: 6px; } .small { font-size: 12px; }
      details summary { cursor: pointer; font-size: 12.5px; color: var(--text-2); margin: 8px 0 4px; font-weight: 600; } }
    .chipblock { display: grid; gap: 1px; padding: 6px 9px; border-radius: var(--radius-sm); background: var(--surface-2); border-left: 3px solid var(--accent); font-size: 13px; cursor: grab;
      &.late { border-left-color: var(--critical); } &.habit { border-left-color: var(--series-3); } &.event { border-left-color: var(--series-1); cursor: default; }
      .muted { font-size: 11.5px; } &:hover { background: var(--surface-3); } }
    .timeline-wrap { max-height: 76vh; overflow-y: auto; position: relative; }
    .timeline { position: relative; margin-left: 52px; border-left: 1px solid var(--border); }
    .hour { position: absolute; left: 0; right: 0; border-top: 1px solid var(--grid); span { position: absolute; left: -48px; top: -8px; font-size: 11px; color: var(--text-3); font-variant-numeric: tabular-nums; } }
    .now { position: absolute; left: -4px; right: 0; border-top: 2px solid var(--critical); z-index: 3; &::before { content: ""; position: absolute; left: 0; top: -5px; width: 8px; height: 8px; border-radius: 50%; background: var(--critical); } }
    .ghost { position: absolute; left: 2px; right: 2px; border: 2px dashed var(--accent); border-radius: var(--radius-sm); background: var(--accent-soft); z-index: 4; pointer-events: none;
      span { font-size: 11px; padding: 2px 6px; color: var(--accent-text); } }
    .block { position: absolute; z-index: 2; border-radius: var(--radius-sm); padding: 3px 6px; display: flex; gap: 6px; align-items: flex-start; overflow: hidden; cursor: pointer; font-size: 12.5px;
      background: color-mix(in srgb, var(--accent) 22%, var(--surface)); border-left: 3px solid var(--accent); color: var(--text);
      &.habit { background: color-mix(in srgb, var(--series-3) 20%, var(--surface)); border-left-color: var(--series-3); }
      &.event { background: color-mix(in srgb, var(--series-1) 18%, var(--surface)); border-left-color: var(--series-1); cursor: default; }
      &.done { opacity: .55; strong { text-decoration: line-through; } } &.dragging { opacity: .3; }
      &[draggable=true] { cursor: grab; }
      .text { display: grid; min-width: 0; } strong { font-weight: 500; } small { font-size: 11px; color: var(--text-2); font-variant-numeric: tabular-nums; }
      .check { width: 14px; height: 14px; margin-top: 1px; }
      &.compact { padding: 0 6px; align-items: center; .check { width: 12px; height: 12px; margin: 0; } strong { font-size: 11.5px; line-height: 1.1; } }
      .resize { position: absolute; left: 0; right: 0; bottom: 0; height: 7px; cursor: ns-resize; &:hover { background: color-mix(in srgb, var(--accent) 40%, transparent); } } }
    @media (max-width: 760px) { .planner { grid-template-columns: minmax(0, 1fr); } .pool { position: static; max-height: none; } }
  `],
})
export class DayPlannerComponent implements OnChanges, AfterViewInit, OnDestroy {
  private tick?: ReturnType<typeof setInterval>;
  ngOnDestroy() { clearInterval(this.tick); }
  private api = inject(ApiService);
  private toast = inject(ToastService);
  dialog = inject(TaskDialogService);
  @ViewChild('timeline') timelineRef!: ElementRef<HTMLElement>;
  @ViewChild('scroller') scrollerRef!: ElementRef<HTMLElement>;

  @Input({ required: true }) day!: string;
  @Input() tasks: Task[] = [];
  @Input() events: CalendarEvent[] = [];

  hourPx = HOUR_PX; ppm = PPM; dayHeight = HOUR_PX * 24; defaultBlock = DEFAULT_BLOCK; habitBlock = HABIT_BLOCK;
  hours = Array.from({ length: 24 }, (_, i) => i);
  priority = PRIORITY_LABEL; duration = formatDuration; overdue = isOverdue; pad = pad; fmt = hhmm;

  private tasksS = signal<Task[]>([]);
  private eventsS = signal<CalendarEvent[]>([]);
  private dayS = signal('');
  habits = signal<HabitDayItem[]>([]);
  /** Cambios ya enviados que aún no han vuelto del servidor (evita que el bloque «salte» atrás). */
  private overrides = signal(new Map<number, Partial<Task>>());
  ghost = signal<{ start: number; minutes: number } | null>(null);
  overPool = signal(false);
  drag: Drag | null = null;
  private resizing = false;
  private clock = signal(Date.now());

  ngOnChanges(ch: SimpleChanges) {
    if (ch['tasks']) { this.tasksS.set(this.tasks); this.overrides.set(new Map()); }
    if (ch['events']) this.eventsS.set(this.events);
    if (ch['day']) { this.dayS.set(this.day); this.loadHabits(); setTimeout(() => this.scrollToStart()); }
  }
  ngAfterViewInit() {
    this.scrollToStart();
    this.tick = setInterval(() => this.clock.set(Date.now()), 60_000);
  }

  private view = computed(() => {
    const o = this.overrides();
    return this.tasksS().map(t => (o.has(t.id) ? { ...t, ...o.get(t.id) } : t));
  });
  private minuteOf(iso: string) { const d = new Date(iso); return d.getHours() * 60 + d.getMinutes(); }

  unplaced = computed(() => {
    const d = this.dayS(), isToday = d === today();
    return this.view().filter(t => {
      if (t.status === 'archived' || t.parent_task_id) return false;
      const td = taskDay(t);
      if (td === d) return t.all_day && t.status !== 'completed';
      return isToday && !!td && td < d && t.status !== 'completed';  // hoy también las atrasadas
    });
  });
  undated = computed(() => this.view().filter(t => !t.due_date && t.status !== 'completed' && t.status !== 'archived' && t.can_edit).slice(0, 30));
  habitsNoTime = computed(() => this.habits().filter(h => !h.target_time));
  allDayEvents = computed(() => this.eventsS().filter(e => !e.task_id && e.all_day && e.start <= this.dayS() && this.dayS() < e.end));

  blocks = computed<Block[]>(() => {
    const d = this.dayS();
    const out: Block[] = [];
    for (const t of this.view()) {
      if (t.all_day || !t.due_date || taskDay(t) !== d || t.status === 'archived') continue;
      out.push({ key: 't' + t.id, kind: 'task', title: t.title, start: this.minuteOf(t.due_date), minutes: Math.max(SNAP, t.estimated_minutes || DEFAULT_BLOCK),
        done: t.status === 'completed', task: t, lane: 0, lanes: 1 });
    }
    for (const h of this.habits()) {
      if (!h.target_time) continue;
      const [hh, mm] = h.target_time.split(':').map(Number);
      out.push({ key: 'h' + h.id, kind: 'habit', title: h.title, start: hh * 60 + mm, minutes: HABIT_BLOCK, done: h.checked, habit: h, lane: 0, lanes: 1 });
    }
    for (const e of this.eventsS()) {
      if (e.task_id || e.all_day) continue;
      const s = new Date(e.start), en = new Date(e.end);
      const dayStart = new Date(d + 'T00:00:00').getTime(), dayEnd = dayStart + 86_400_000;
      if (en.getTime() <= dayStart || s.getTime() >= dayEnd) continue;
      const start = Math.max(0, (s.getTime() - dayStart) / 60_000), end = Math.min(1440, (en.getTime() - dayStart) / 60_000);
      out.push({ key: 'e' + e.id, kind: 'event', title: e.title, start, minutes: Math.max(SNAP, end - start), event: e, lane: 0, lanes: 1 });
    }
    return layout(out);
  });

  nowTop = computed(() => {
    this.clock();
    if (this.dayS() !== today()) return null;
    const n = new Date();
    return (n.getHours() * 60 + n.getMinutes()) * PPM;
  });

  private scrollToStart() {
    const el = this.scrollerRef?.nativeElement;
    if (!el) return;
    const first = Math.min(...this.blocks().map(b => b.start), 7 * 60);
    const target = this.dayS() === today() ? Math.min(first, new Date().getHours() * 60 - 60) : first;
    el.scrollTop = Math.max(0, target - 30) * PPM;
  }

  private loadHabits() {
    this.api.habitsOfDay(this.day).subscribe({ next: h => this.habits.set(h), error: () => this.habits.set([]) });
  }

  // ---- Arrastrar ----
  movable(b: Block) { return b.kind === 'habit' || (b.kind === 'task' && !!b.task!.can_edit); }
  startDrag(e: DragEvent, kind: 'task' | 'habit', id: number, minutes: number, grab = 0) {
    this.drag = { kind, id, minutes, grab };
    e.dataTransfer?.setData('text/plain', `${kind}:${id}`);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  }
  blockDrag(e: DragEvent, b: Block) {
    if (this.resizing || !this.movable(b)) { e.preventDefault(); return; }
    const grab = (e.offsetY || 0) / PPM;  // dónde se agarró el bloque, para que no salte al soltar
    this.startDrag(e, b.kind as 'task' | 'habit', b.kind === 'task' ? b.task!.id : b.habit!.id, b.minutes, grab);
  }
  endDrag() { this.drag = null; this.ghost.set(null); this.overPool.set(false); }

  private minuteAt(e: DragEvent): number {
    const rect = this.timelineRef.nativeElement.getBoundingClientRect();
    const raw = (e.clientY - rect.top) / PPM - (this.drag?.grab ?? 0);
    const snapped = Math.round(raw / SNAP) * SNAP;
    return Math.max(0, Math.min(1440 - SNAP, snapped));
  }
  lineOver(e: DragEvent) {
    if (!this.drag) return;
    e.preventDefault();
    const start = this.minuteAt(e);
    const g = this.ghost();
    if (!g || g.start !== start) this.ghost.set({ start, minutes: this.drag.minutes });
  }
  lineLeave(e: DragEvent) {
    const to = e.relatedTarget as Node | null;
    if (!to || !this.timelineRef.nativeElement.contains(to)) this.ghost.set(null);
  }
  dropOnLine(e: DragEvent) {
    e.preventDefault();
    const d = this.drag, start = this.minuteAt(e);
    this.endDrag();
    if (!d) return;
    if (d.kind === 'habit') {
      this.habits.update(l => l.map(h => (h.id === d.id ? { ...h, target_time: hhmm(start) } : h)));
      this.api.updateHabit(d.id, { target_time: hhmm(start) }).subscribe({ error: err => { this.toast.error(err); this.loadHabits(); } });
      return;
    }
    this.save(d.id, toDue(this.day, hhmm(start)));
  }
  poolOver(e: DragEvent) { if (this.drag) { e.preventDefault(); this.overPool.set(true); } }
  dropOnPool(e: DragEvent) {
    e.preventDefault();
    const d = this.drag;
    this.endDrag();
    if (!d) return;
    if (d.kind === 'habit') {
      this.habits.update(l => l.map(h => (h.id === d.id ? { ...h, target_time: null } : h)));
      this.api.updateHabit(d.id, { target_time: null, remind: false }).subscribe({ error: err => { this.toast.error(err); this.loadHabits(); } });
      return;
    }
    const t = this.view().find(x => x.id === d.id);
    if (t && (!t.all_day || taskDay(t) !== this.day)) this.save(d.id, toDue(this.day, ''));  // se queda en el día, sin hora
  }

  // ---- Cambiar la duración ----
  resizeStart(e: PointerEvent, b: Block) {
    e.preventDefault();
    e.stopPropagation();
    this.resizing = true;
    const el = (e.target as HTMLElement).parentElement!;
    const top = el.getBoundingClientRect().top;
    let minutes = b.minutes;
    const move = (ev: PointerEvent) => {
      minutes = Math.max(SNAP, Math.min(1440 - b.start, Math.round((ev.clientY - top) / PPM / SNAP) * SNAP));
      el.style.height = `${minutes * PPM - 2}px`;
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setTimeout(() => (this.resizing = false));
      if (minutes !== b.minutes) this.save(b.task!.id, { estimated_minutes: minutes });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  private save(id: number, change: Partial<Task>) {
    this.overrides.update(m => new Map(m).set(id, { ...(m.get(id) ?? {}), ...change }));
    this.api.updateTask(id, change).subscribe({
      error: err => { this.toast.error(err, 'No se pudo planificar la tarea'); this.overrides.update(m => { const n = new Map(m); n.delete(id); return n; }); },
    });
  }

  open(b: Block) {
    if (this.resizing) return;
    if (b.task) this.dialog.edit(b.task);
    else if (b.event?.html_link?.startsWith('https://')) window.open(b.event.html_link, '_blank', 'noopener');
  }
  toggle(t: Task) {
    const status = t.status === 'completed' ? 'todo' : 'completed';
    this.save(t.id, { status });
  }
  toggleHabit(h: HabitDayItem) {
    this.api.checkHabit(h.id, this.day, !h.checked).subscribe({
      next: r => this.habits.update(l => l.map(x => (x.id === h.id ? r.item : x))), error: err => this.toast.error(err),
    });
  }
}

/** Reparte en columnas los bloques que se solapan (como un calendario de escritorio). */
function layout(blocks: Block[]): Block[] {
  const sorted = [...blocks].sort((a, b) => a.start - b.start || b.minutes - a.minutes);
  let cluster: Block[] = [], laneEnds: number[] = [], clusterEnd = -1;
  const close = () => { for (const b of cluster) b.lanes = laneEnds.length; cluster = []; laneEnds = []; };
  for (const b of sorted) {
    if (b.start >= clusterEnd) close();
    let lane = laneEnds.findIndex(end => end <= b.start);
    if (lane < 0) { lane = laneEnds.length; laneEnds.push(0); }
    laneEnds[lane] = b.start + b.minutes;
    b.lane = lane;
    cluster.push(b);
    clusterEnd = Math.max(clusterEnd, b.start + b.minutes);
  }
  close();
  return sorted;
}
