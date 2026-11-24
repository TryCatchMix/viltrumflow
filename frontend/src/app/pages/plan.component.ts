import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { DayPlanState, PRIORITY_LABEL, PlanTask, Task } from '../core/models';
import { quickToTask } from '../core/quick-task';
import { ToastService } from '../core/toast.service';
import { addDays, formatDay, toDue, today } from '../core/util';
import { DayPlannerComponent } from '../shared/day-planner.component';
import { IconComponent } from '../shared/icon.component';
import { MoodCheckinComponent } from '../shared/mood-checkin.component';
import { VoiceButtonComponent } from '../shared/voice-button.component';

type Mode = 'start' | 'close';
const MAX = 3;
const CLOSE_FROM_HOUR = 16;  // a partir de esta hora se propone el cierre si el día ya está planificado

/** Ritual del día: por la mañana, 3 prioridades, intención y horario; por la noche, cierre y lo pendiente a mañana. */
@Component({
  selector: 'app-plan',
  standalone: true,
  imports: [FormsModule, NgTemplateOutlet, RouterLink, IconComponent, DayPlannerComponent, MoodCheckinComponent, VoiceButtonComponent],
  template: `
  <div class="page">
    <div class="page-head">
      <div><h1>{{ mode() === 'start' ? (isTomorrow() ? 'Prepara mañana' : 'Empieza el día') : 'Cierra el día' }}</h1>
        <p class="cap">{{ dayLabel() }}@if (s()?.streak) { · {{ s()!.streak }} {{ s()!.streak === 1 ? 'día planificado' : 'días seguidos planificando' }} }</p></div>
      <span class="spacer"></span>
      <div class="seg" role="tablist">
        <button role="tab" class="btn sm" [class.primary]="mode() === 'start'" [attr.aria-selected]="mode() === 'start'" (click)="setMode('start')">
          <app-icon name="sun" [size]="14" /> Inicio</button>
        <button role="tab" class="btn sm" [class.primary]="mode() === 'close'" [attr.aria-selected]="mode() === 'close'" (click)="setMode('close')" [disabled]="isTomorrow()">
          <app-icon name="moon" [size]="14" /> Cierre</button>
      </div>
    </div>

    @if (s(); as st) {
      @if (mode() === 'start') {
        <section class="card sec">
          <h2><span class="n">1</span> Tus {{ max }} prioridades</h2>
          <p class="muted small">Lo que, si lo haces, hará que el día merezca la pena. Elige como mucho tres.</p>
          <ol class="slots">
            @for (i of [0, 1, 2]; track i) {
              @if (chosen()[i]; as t) {
                <li class="slot full"><span class="star" aria-hidden="true">★</span><span class="grow">{{ t.title }}</span>
                  @if (t.due_day && t.due_day < st.day) { <span class="chip late">Atrasada</span> }
                  <button class="btn ghost icon sm" (click)="toggle(t)" [attr.aria-label]="'Quitar ' + t.title + ' de las prioridades'"><app-icon name="x" /></button></li>
              } @else { <li class="slot empty muted">Prioridad {{ i + 1 }}</li> }
            }
          </ol>
          <form class="row quick" (ngSubmit)="addNew()">
            <input class="input grow" name="newp" [(ngModel)]="newTitle" placeholder="Nueva tarea como prioridad («preparar la reunión a las 12»)" maxlength="200" aria-label="Nueva prioridad" #np />
            <app-voice-button (heard)="newTitle = $event; np.focus()" />
            <button class="btn sm" [disabled]="!newTitle.trim() || chosen().length >= max">Añadir</button>
          </form>
          @if (st.due.length) {
            <h3>Para {{ isTomorrow() ? 'mañana' : 'hoy' }} y atrasadas</h3>
            <ul class="pick">@for (t of st.due; track t.id) { <ng-container *ngTemplateOutlet="row; context: { $implicit: t }" /> }</ul>
          }
          @if (st.candidates.length) {
            <details [open]="!st.due.length">
              <summary>Otras tareas abiertas ({{ st.candidates.length }})</summary>
              <ul class="pick">@for (t of st.candidates; track t.id) { <ng-container *ngTemplateOutlet="row; context: { $implicit: t }" /> }</ul>
            </details>
          }
          <ng-template #row let-t>
            <li class="row">
              <button type="button" class="star-btn" [class.on]="isChosen(t)" (click)="toggle(t)" [disabled]="!isChosen(t) && chosen().length >= max"
                [attr.aria-pressed]="isChosen(t)" [attr.aria-label]="(isChosen(t) ? 'Quitar ' : 'Elegir ') + t.title + ' como prioridad'">{{ isChosen(t) ? '★' : '☆' }}</button>
              <span class="grow">{{ t.title }}</span>
              @if (t.project) { <span class="chip"><i class="dot" [style.background]="t.project.color"></i>{{ t.project.name }}</span> }
              @if (t.due_day) { <span class="muted small" [class.late-t]="t.due_day < st.day">{{ fmt(t.due_day) }}</span> }
              @if (t.priority === 'high' || t.priority === 'urgent') { <span class="prio" [class]="t.priority">{{ prioLabel(t) }}</span> }
            </li>
          </ng-template>
        </section>

        <section class="card sec">
          <h2><span class="n">2</span> Intención</h2>
          <input class="input" [(ngModel)]="intention" maxlength="300" placeholder="¿Qué haría que hoy fuera un buen día? («Terminar el informe con calma»)" aria-label="Intención del día" />
        </section>

        <section class="card sec">
          <h2><span class="n">3</span> Organiza tus horas <span class="muted opt">opcional</span></h2>
          <p class="muted small">Arrastra las tareas a su hora. Lo que tenga hora te avisará con el recordatorio.</p>
          <app-day-planner [day]="st.day" [tasks]="tasks()" />
        </section>

        <div class="row end">
          @if (st.planned_at) { <span class="muted small">Plan guardado · puedes cambiarlo cuando quieras</span> }
          <span class="spacer"></span>
          <button class="btn primary big" (click)="savePlan()" [disabled]="busy()">{{ st.planned_at ? 'Guardar cambios' : (isTomorrow() ? 'Dejar listo mañana' : 'Empezar el día') }}</button>
        </div>
      } @else {
        <section class="card sec">
          <h2>Lo que has hecho hoy</h2>
          <div class="row stats">
            <div class="stat"><strong>{{ st.done.length }}</strong><span>{{ st.done.length === 1 ? 'tarea completada' : 'tareas completadas' }}</span></div>
            <div class="stat"><strong>+{{ st.xp }}</strong><span>XP</span></div>
            @if (st.priorities.length) {
              <div class="stat"><strong>{{ prioritiesDone() }}/{{ st.priorities.length }}</strong><span>prioridades</span></div>
            }
          </div>
          @if (st.priorities.length) {
            <ul class="pick">
              @for (t of st.priorities; track t.id) {
                <li class="row"><span class="star" aria-hidden="true">★</span><span class="grow" [class.done]="t.status === 'completed'">{{ t.title }}</span>
                  <span class="muted small">{{ t.status === 'completed' ? 'Hecha' : 'Pendiente' }}</span></li>
              }
            </ul>
          }
          @if (doneOthers().length) {
            <details><summary>Ver las {{ doneOthers().length }} {{ doneOthers().length === 1 ? 'tarea' : 'tareas' }} completadas</summary>
              <ul class="pick">@for (t of doneOthers(); track t.id) { <li class="row"><span class="grow done">{{ t.title }}</span></li> }</ul></details>
          } @else if (!st.done.length) { <p class="muted small">Ningún día es perfecto. Mañana, otra oportunidad.</p> }
        </section>

        <section class="card sec">
          <h2>Lo que queda pendiente</h2>
          @if (pending().length) {
            <p class="muted small">Lo marcado pasa a mañana (conserva su hora). Si en realidad ya está hecho, márcalo como hecho.</p>
            <ul class="pick">
              @for (t of pending(); track t.id) {
                <li class="row">
                  <input type="checkbox" [checked]="moving().has(t.id)" (change)="toggleMove(t.id)" [attr.aria-label]="'Pasar a mañana: ' + t.title" />
                  <span class="grow">{{ t.title }}@if (isPriority(t)) { <span class="star" aria-label="prioridad"> ★</span> }</span>
                  @if (t.due_day && t.due_day < st.day) { <span class="muted small late-t">{{ fmt(t.due_day) }}</span> }
                  <button class="btn sm" (click)="complete(t)">Hecha</button>
                </li>
              }
            </ul>
          } @else { <p class="muted small">Nada pendiente para hoy. 👏</p> }
        </section>

        <section class="sec-plain"><app-mood-checkin [showLink]="false" /></section>

        <section class="card sec">
          <h2>Reflexión <span class="muted opt">opcional</span></h2>
          <textarea class="input" rows="3" [(ngModel)]="reflection" maxlength="5000" aria-label="Reflexión del día"
            placeholder="¿Qué ha ido bien? ¿Qué harías distinto mañana?"></textarea>
        </section>

        <div class="row end">
          @if (st.closed_at) { <span class="muted small">Día cerrado</span> }
          <span class="spacer"></span>
          <button class="btn primary big" (click)="close()" [disabled]="busy()">
            {{ moving().size ? 'Cerrar el día y pasar ' + moving().size + ' a mañana' : 'Cerrar el día' }}</button>
        </div>
      }
    } @else { <div class="skeleton" style="height:320px"></div> }
  </div>`,
  styles: [`
    .seg { display: flex; gap: 4px; }
    .sec { padding: 18px; display: grid; gap: 10px; margin-bottom: 14px; h2 { margin: 0; font-size: 15px; display: flex; align-items: center; gap: 8px; } }
    .sec-plain { margin-bottom: 14px; }
    h3 { margin: 6px 0 0; font-size: 13px; color: var(--text-2); font-weight: 600; }
    .n { width: 22px; height: 22px; border-radius: 50%; background: var(--accent-soft); color: var(--accent-text); display: inline-grid; place-content: center; font-size: 12px; }
    .opt { font-weight: 400; font-size: 12px; }
    .small { font-size: 12.5px; margin: 0; }
    .slots { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
    .slot { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border-radius: var(--radius-sm); min-height: 42px;
      &.full { background: var(--accent-soft); } &.empty { border: 1px dashed var(--border); font-size: 13px; } }
    .star { color: var(--warning); }
    .grow { flex: 1; min-width: 0; overflow-wrap: anywhere; }
    .pick { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px;
      li { gap: 8px; align-items: center; padding: 5px 4px; border-radius: var(--radius-sm); &:hover { background: var(--surface-2); } } }
    .star-btn { background: none; border: none; font-size: 18px; line-height: 1; cursor: pointer; color: var(--text-3); padding: 2px 4px;
      &.on { color: var(--warning); } &:disabled { opacity: .35; cursor: default; } }
    .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 4px; }
    .late, .late-t { color: var(--critical); }
    details summary { cursor: pointer; font-size: 13px; color: var(--text-2); padding: 4px 0; }
    .end { margin: 4px 0 24px; gap: 12px; align-items: center; } .big { height: 40px; padding: 0 18px; }
    .stats { gap: 24px; flex-wrap: wrap; }
    .stat { display: grid; strong { font-size: 26px; font-weight: 600; font-variant-numeric: tabular-nums; } span { font-size: 12px; color: var(--text-2); } }
    .done { text-decoration: line-through; color: var(--text-muted); }
    .quick { gap: 6px; }
  `],
})
export class PlanComponent implements OnInit {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  max = MAX; fmt = formatDay;
  s = signal<DayPlanState | null>(null);
  mode = signal<Mode>('start');
  day = signal(today());
  chosen = signal<PlanTask[]>([]);
  moving = signal(new Set<number>());
  tasks = signal<Task[]>([]);
  busy = signal(false);
  intention = ''; reflection = ''; newTitle = '';

  isTomorrow = computed(() => this.day() > today());
  dayLabel = computed(() => {
    const d = this.day();
    const name = new Date(d + 'T12:00:00').toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
    return d === today() ? `Hoy, ${name}` : d === addDays(today(), 1) ? `Mañana, ${name}` : name;
  });
  pending = computed(() => {
    const s = this.s();
    if (!s) return [];
    const seen = new Set<number>(), out: PlanTask[] = [];
    for (const t of [...s.priorities, ...s.due]) {
      if (t.status !== 'completed' && t.status !== 'archived' && !seen.has(t.id)) { seen.add(t.id); out.push(t); }
    }
    return out;
  });
  prioritiesDone = computed(() => this.s()?.priorities.filter(t => t.status === 'completed').length ?? 0);
  doneOthers = computed(() => { const s = this.s(); const p = new Set(s?.priorities.map(t => t.id)); return (s?.done ?? []).filter(t => !p.has(t.id)); });

  constructor() { this.api.tasksChanged.pipe(takeUntilDestroyed()).subscribe(() => this.loadTasks()); }

  ngOnInit() {
    const q = this.route.snapshot.queryParamMap;
    const day = q.get('day');
    if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) this.day.set(day);
    const m = q.get('mode');
    this.load(m === 'start' || m === 'close' ? m : null);
    this.loadTasks();
  }

  setMode(m: Mode) { this.mode.set(m); this.router.navigate([], { queryParams: { mode: m, day: this.day() !== today() ? this.day() : null }, replaceUrl: true }); }

  private load(forced: Mode | null = null) {
    this.api.dayPlan(this.day()).subscribe({
      next: s => {
        this.apply(s);
        if (forced) this.mode.set(forced);
        else if (!this.isTomorrow()) this.mode.set(s.planned_at && new Date().getHours() >= CLOSE_FROM_HOUR ? 'close' : 'start');
      },
      error: e => this.toast.error(e),
    });
  }

  private apply(s: DayPlanState) {
    this.s.set(s);
    this.chosen.set(s.priorities.filter(t => t.status !== 'archived'));
    this.intention = s.intention ?? '';
    this.reflection = s.reflection ?? '';
    // Por defecto, todo lo pendiente pasa a mañana
    this.moving.set(new Set(this.pending().map(t => t.id)));
  }

  private loadTasks() { this.api.tasks().subscribe({ next: t => this.tasks.set(t), error: () => {} }); }

  prioLabel(t: PlanTask) { return PRIORITY_LABEL[t.priority]; }
  isChosen(t: PlanTask) { return this.chosen().some(c => c.id === t.id); }
  isPriority(t: PlanTask) { return !!this.s()?.priorities.some(c => c.id === t.id); }
  toggle(t: PlanTask) {
    if (this.isChosen(t)) this.chosen.update(l => l.filter(c => c.id !== t.id));
    else if (this.chosen().length < MAX) this.chosen.update(l => [...l, t]);
  }
  toggleMove(id: number) {
    const s = new Set(this.moving());
    if (s.has(id)) s.delete(id); else s.add(id);
    this.moving.set(s);
  }

  addNew() {
    const text = this.newTitle.trim();
    if (!text || this.chosen().length >= MAX) return;
    const { input, parsed } = quickToTask(text, []);
    const data = parsed.day ? input : { ...input, ...toDue(this.day(), parsed.time ?? '') };
    this.busy.set(true);
    this.api.postTask(data).subscribe({
      next: t => {
        this.busy.set(false);
        this.newTitle = '';
        this.api.tasksChanged.next();
        this.chosen.update(l => [...l, { ...t, due_day: this.day(), project: null } as unknown as PlanTask]);
      },
      error: e => { this.busy.set(false); this.toast.error(e); },
    });
  }

  savePlan() {
    this.busy.set(true);
    this.api.saveDayPlan(this.day(), { priorities: this.chosen().map(t => t.id), intention: this.intention.trim() || null }).subscribe({
      next: s => {
        this.busy.set(false);
        this.apply(s);
        if (this.isTomorrow()) { this.toast.success('Mañana ya está listo. ¡Descansa!'); this.router.navigate(['/today']); }
        else { this.toast.success('¡A por el día!'); this.router.navigate(['/today']); }
      },
      error: e => { this.busy.set(false); this.toast.error(e); },
    });
  }

  complete(t: PlanTask) {
    this.api.updateTask(t.id, { status: 'completed' }).subscribe({
      next: () => { this.api.xpChanged.next(); this.load('close'); },
      error: e => this.toast.error(e),
    });
  }

  close() {
    this.busy.set(true);
    const s = this.s()!;
    this.api.closeDay(s.day, { reflection: this.reflection.trim() || null, move_to_tomorrow: [...this.moving()] }).subscribe({
      next: r => {
        this.busy.set(false);
        this.apply(r);
        const moved = r.moved ?? 0;
        this.toast.success(moved ? `Día cerrado. ${moved} ${moved === 1 ? 'tarea pasa' : 'tareas pasan'} a mañana` : 'Día cerrado. ¡Buen trabajo!');
        // Siguiente paso natural: dejar listo mañana
        this.day.set(addDays(s.day, 1));
        this.router.navigate([], { queryParams: { mode: 'start', day: this.day() }, replaceUrl: true });
        this.load('start');
      },
      error: e => { this.busy.set(false); this.toast.error(e); },
    });
  }
}
