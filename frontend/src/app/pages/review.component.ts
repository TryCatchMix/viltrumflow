import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { DIFFICULTY_LABEL, WeekGoal, ReviewTask, WeeklyReview, XP_KIND_LABEL, XpKind } from '../core/models';
import { ToastService } from '../core/toast.service';
import { addDays, formatDay, parseDay, toDue, today } from '../core/util';
import { BarListComponent, Bar } from '../shared/bar-list.component';
import { IconComponent } from '../shared/icon.component';

const RANGE = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'long' });
type Step = 'week' | 'pending' | 'next';

@Component({
  selector: 'app-review',
  standalone: true,
  imports: [FormsModule, IconComponent, BarListComponent],
  template: `
  <div class="page narrow">
    <div class="page-head">
      <div><h1>Revisión semanal</h1><p>{{ rangeLabel() }}@if (r()?.completed_at) { · <strong>hecha</strong> }</p></div>
      <span class="spacer"></span>
      <div class="row">
        <button class="btn icon" (click)="shift(-7)" aria-label="Semana anterior"><app-icon name="left" /></button>
        <button class="btn icon" (click)="shift(7)" [disabled]="r()?.is_current" aria-label="Semana siguiente"><app-icon name="right" /></button>
      </div>
    </div>

    <ol class="steps" role="tablist">
      @for (s of steps; track s.id; let i = $index) {
        <li><button role="tab" [class.active]="step() === s.id" [attr.aria-selected]="step() === s.id" (click)="step.set(s.id)"><b>{{ i + 1 }}</b> {{ s.label }}</button></li>
      }
    </ol>

    @if (r(); as w) {
      @if (step() === 'week') {
        <div class="tiles">
          <div class="card tile"><span>Tareas completadas</span><strong>{{ w.completed.length }}</strong></div>
          <div class="card tile"><span>Rutinas cumplidas</span><strong>{{ w.habits.rate ?? '—' }}{{ w.habits.rate === null ? '' : '%' }}</strong><small>{{ w.habits.done }} de {{ w.habits.scheduled }}</small></div>
          <div class="card tile"><span>Concentración</span><strong>{{ w.focus_minutes }}</strong><small>minutos</small></div>
          <div class="card tile"><span>Experiencia</span><strong>{{ w.xp_total }}</strong><small>XP esta semana</small></div>
        </div>

        @if (w.previous_goals.length) {
          <section class="card box"><h2>Objetivos que te marcaste para esta semana</h2>
            @for (g of w.previous_goals; track $index) {
              <div class="goal row" [class.done]="g.done"><app-icon [name]="g.done ? 'check' : 'x'" [size]="14" /><span>{{ g.text }}</span></div>
            }
            <p class="muted small">{{ goalsDone() }} de {{ w.previous_goals.length }} cumplidos. Puedes marcarlos durante la semana desde «Hoy».</p>
          </section>
        }

        <div class="two">
          <section class="card box"><h2>Lo que completaste</h2>
            @for (t of w.completed; track t.id) {
              <div class="line row"><app-icon name="check" [size]="13" /><span class="truncate">{{ t.title }}</span><span class="spacer"></span><span class="chip">{{ difficulty[t.difficulty] }}</span></div>
            } @empty { <p class="muted">Ninguna tarea completada esta semana.</p> }
          </section>
          <section class="card box"><h2>Rutinas</h2>
            <app-bar-list [bars]="habitBars()" [progress]="true" [dots]="false" empty="No tienes rutinas" />
            @if (w.habits.perfect_days) { <p class="muted small">{{ w.habits.perfect_days }} día(s) con todas las rutinas cumplidas.</p> }
          </section>
        </div>
        <section class="card box"><h2>De dónde vino tu experiencia</h2><app-bar-list [bars]="xpBars()" empty="Sin experiencia esta semana" /></section>
        <div class="nav row"><span class="spacer"></span><button class="btn primary" (click)="step.set('pending')">Siguiente: pendientes <app-icon name="right" /></button></div>
      }

      @if (step() === 'pending') {
        <section class="card box">
          <h2>Se ha quedado atrás <span class="muted">{{ carried().length }}</span></h2>
          <p class="muted small">Decide qué hacer con cada una: reprogramarla, quitarle la fecha, darla por hecha o archivarla.</p>
          @for (t of carried(); track t.id) {
            <div class="pend">
              <div class="row"><strong class="truncate">{{ t.title }}</strong><span class="spacer"></span>
                <span class="chip late">{{ t.due_day ? fmt(t.due_day) : '' }}</span>@if (t.project) { <span class="chip">{{ t.project }}</span> }</div>
              @if (t.can_edit) {
                <div class="row acts">
                  <button class="btn sm" (click)="move(t, todayStr)">Hoy</button>
                  <button class="btn sm" (click)="move(t, addDays(todayStr, 1))">Mañana</button>
                  <button class="btn sm" (click)="move(t, nextMonday())">Próximo lunes</button>
                  <input class="input sm" type="date" [min]="todayStr" (change)="move(t, $any($event.target).value)" aria-label="Otra fecha" />
                  <span class="spacer"></span>
                  <button class="btn ghost sm" (click)="act(t, { due_date: null, all_day: true }, 'Sin fecha')">Quitar fecha</button>
                  <button class="btn ghost sm" (click)="act(t, { status: 'completed' }, 'Hecha')"><app-icon name="check" [size]="13" /> Hecha</button>
                  <button class="btn ghost sm danger" (click)="act(t, { status: 'archived' }, 'Archivada')">Archivar</button>
                </div>
              } @else { <p class="muted small">Solo lectura en este proyecto.</p> }
            </div>
          } @empty { <p class="muted">Nada pendiente de semanas anteriores. Bien hecho.</p> }
        </section>

        @if (w.no_date.length) {
          <section class="card box"><h2>Sin fecha <span class="muted">{{ undated().length }}</span></h2>
            <p class="muted small">¿Alguna toca la semana que viene?</p>
            @for (t of undated(); track t.id) {
              <div class="line row"><span class="truncate">{{ t.title }}</span><span class="spacer"></span>
                <button class="btn ghost sm" (click)="move(t, nextMonday())">Próxima semana</button></div>
            }
          </section>
        }
        <div class="nav row"><button class="btn" (click)="step.set('week')"><app-icon name="left" /> Atrás</button><span class="spacer"></span>
          <button class="btn primary" (click)="step.set('next')">Siguiente: próxima semana <app-icon name="right" /></button></div>
      }

      @if (step() === 'next') {
        <section class="card box">
          <h2>Objetivos para la semana que viene</h2>
          <p class="muted small">Hasta 5, concretos. Los verás en «Hoy» durante la semana y podrás marcarlos.
            @if (w.upcoming_next_week) { Ya tienes {{ w.upcoming_next_week }} tarea(s) con fecha esa semana. }</p>
          @for (g of goals; track $index) {
            <div class="row goalin">
              <span class="n">{{ $index + 1 }}</span>
              <input class="input" [(ngModel)]="g.text" [name]="'goal' + $index" maxlength="200" [attr.aria-label]="'Objetivo ' + ($index + 1)" placeholder="p. ej. Terminar el informe trimestral" />
              <button class="btn ghost icon sm" (click)="goals.splice($index, 1)" aria-label="Quitar objetivo"><app-icon name="x" /></button>
            </div>
          }
          @if (goals.length < 5) { <div><button class="btn sm" (click)="goals.push({ text: '', done: false })"><app-icon name="plus" [size]="13" /> Añadir objetivo</button></div> }
        </section>
        <section class="card box">
          <label class="field">Reflexión (opcional): ¿qué funcionó y qué cambiarías?
            <textarea class="input" rows="4" [(ngModel)]="reflection" name="reflection" maxlength="5000"></textarea></label>
        </section>
        <div class="nav row"><button class="btn" (click)="step.set('pending')"><app-icon name="left" /> Atrás</button>
          <span class="spacer"></span>
          <button class="btn" (click)="save()" [disabled]="busy()">Guardar borrador</button>
          <button class="btn primary" (click)="finish()" [disabled]="busy()">{{ w.completed_at ? 'Guardar cambios' : 'Terminar revisión · +' + w.xp_reward + ' XP' }}</button>
        </div>
      }
    } @else { <div class="skeleton" style="height:260px"></div> }
  </div>`,
  styles: [`
    .narrow { max-width: 900px; }
    .steps { list-style: none; display: flex; gap: 6px; margin: 0 0 16px; padding: 0; flex-wrap: wrap;
      button { display: flex; gap: 8px; align-items: center; background: none; border: 1px solid var(--border); border-radius: 18px; padding: 5px 14px 5px 6px; color: var(--text-2); font-weight: 500;
        b { width: 22px; height: 22px; border-radius: 50%; background: var(--surface-3); display: grid; place-content: center; font-size: 12px; }
        &.active { border-color: var(--accent); color: var(--text); b { background: var(--accent); color: var(--on-accent); } } } }
    .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; margin-bottom: 12px; }
    .tile { padding: 14px 16px; display: grid; gap: 2px; span { font-size: 12px; color: var(--text-2); } strong { font-size: 28px; font-weight: 600; line-height: 1.2; font-variant-numeric: tabular-nums; } small { color: var(--text-3); font-size: 12px; } }
    .box { padding: 16px 18px; display: grid; gap: 10px; margin-bottom: 12px; min-width: 0; h2 { display: flex; gap: 8px; align-items: baseline; } }
    .two { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .line { font-size: 13.5px; padding: 3px 0; border-bottom: 1px solid var(--border); &:last-child { border-bottom: none; } }
    .goal { font-size: 14px; color: var(--text-3); &.done { color: var(--text); app-icon { color: var(--good); } } }
    .pend { padding: 10px 0; border-bottom: 1px solid var(--border); display: grid; gap: 8px; &:last-child { border-bottom: none; } }
    .acts { flex-wrap: wrap; row-gap: 6px; .input.sm { width: auto; height: 26px; font-size: 12.5px; } }
    .late { color: var(--critical); }
    .goalin .n { width: 22px; text-align: center; color: var(--text-3); font-variant-numeric: tabular-nums; } .goalin .input { flex: 1; }
    .small { font-size: 12.5px; } .nav { margin: 4px 0 24px; }
    @media (max-width: 760px) { .two { grid-template-columns: minmax(0, 1fr); } }
  `],
})
export class ReviewComponent implements OnInit {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  steps: { id: Step; label: string }[] = [{ id: 'week', label: 'La semana' }, { id: 'pending', label: 'Pendientes' }, { id: 'next', label: 'Próxima semana' }];
  difficulty = DIFFICULTY_LABEL; fmt = formatDay; addDays = addDays; todayStr = today();

  r = signal<WeeklyReview | null>(null);
  step = signal<Step>('week');
  busy = signal(false);
  /** Tareas ya resueltas en esta sesión (desaparecen de la lista sin recargar). */
  private handled = signal(new Set<number>());
  goals: WeekGoal[] = [];
  reflection = '';

  rangeLabel = computed(() => {
    const w = this.r();
    return w ? `Del ${RANGE.format(parseDay(w.week_start))} al ${RANGE.format(parseDay(w.week_end))}` : '';
  });
  carried = computed(() => this.r()!.carried_over.filter(t => !this.handled().has(t.id)));
  undated = computed(() => this.r()!.no_date.filter(t => !this.handled().has(t.id)));
  goalsDone = computed(() => this.r()!.previous_goals.filter(g => g.done).length);
  habitBars = computed<Bar[]>(() => this.r()!.habits.items.map(h => ({
    label: h.title, value: h.done, total: h.scheduled,
    hint: `${h.done} de ${h.scheduled} ${h.period === 'week' ? 'semanas' : 'días'} cumplidos`,
  })));
  xpBars = computed<Bar[]>(() => (Object.keys(XP_KIND_LABEL) as XpKind[]).map(k => ({ label: XP_KIND_LABEL[k], value: this.r()!.xp[k] ?? 0 })).filter(b => b.value > 0));

  ngOnInit() { this.load(); }

  private load(week?: string) {
    this.api.review(week).subscribe({
      next: w => {
        this.r.set(w);
        this.handled.set(new Set());
        this.goals = w.goals.length ? w.goals.map(g => ({ ...g })) : [{ text: '', done: false }];
        this.reflection = w.reflection;
      },
      error: e => this.toast.error(e, 'No se pudo cargar la revisión'),
    });
  }
  shift(days: number) { const w = this.r(); if (w) { this.r.set(null); this.step.set('week'); this.load(addDays(w.week_start, days)); } }
  nextMonday() { const d = parseDay(this.todayStr); return addDays(this.todayStr, ((8 - d.getDay()) % 7) || 7); }

  move(t: ReviewTask, day: string) { if (day) this.act(t, toDue(day, ''), `Movida a ${formatDay(day).toLowerCase()}`); }
  act(t: ReviewTask, change: object, label: string) {
    this.handled.update(s => new Set(s).add(t.id));
    this.api.updateTask(t.id, change).subscribe({
      next: () => this.toast.show(`${label}: ${t.title}`, 'success', 2500),
      error: e => { this.toast.error(e); this.handled.update(s => { const n = new Set(s); n.delete(t.id); return n; }); },
    });
  }

  private cleanGoals(): WeekGoal[] { return this.goals.map(g => ({ text: g.text.trim(), done: g.done })).filter(g => g.text).slice(0, 5); }
  save() {
    this.busy.set(true);
    this.api.saveReview(this.r()!.week_start, this.cleanGoals(), this.reflection).subscribe({
      next: () => { this.busy.set(false); this.toast.success('Borrador guardado'); }, error: e => { this.busy.set(false); this.toast.error(e); },
    });
  }
  finish() {
    this.busy.set(true);
    const w = this.r()!;
    this.api.completeReview(w.week_start, this.cleanGoals(), this.reflection).subscribe({
      next: r => {
        this.busy.set(false);
        this.toast.success(r.xp_gained ? `Revisión terminada · +${r.xp_gained} XP` : 'Revisión guardada');
        this.load(w.week_start);
      },
      error: e => { this.busy.set(false); this.toast.error(e); },
    });
  }
}
