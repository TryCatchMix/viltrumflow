import { Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { PomodoroSettings, PomodoroStats, Task } from '../core/models';
import { PHASE_LABEL, PomodoroService } from '../core/pomodoro.service';
import { ToastService } from '../core/toast.service';
import { parseDay } from '../core/util';
import { Bar, BarListComponent } from '../shared/bar-list.component';
import { ColumnChartComponent } from '../shared/column-chart.component';
import { IconComponent } from '../shared/icon.component';

const SHORT = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' });
const R = 104, CIRC = 2 * Math.PI * R;

@Component({
  selector: 'app-focus',
  standalone: true,
  imports: [FormsModule, IconComponent, ColumnChartComponent, BarListComponent],
  template: `
  <div class="page">
    <div class="page-head"><div><h1>Enfoque</h1><p>Reloj Pomodoro: bloques de concentración con descansos. Cada bloque suma tiempo a la tarea y experiencia.</p></div></div>

    <div class="layout">
      <section class="card clock" [class.break]="p.phase() !== 'focus'">
        <div class="phase" aria-live="polite">{{ phaseLabel[p.phase()] }}</div>
        <div class="ring">
          <svg viewBox="0 0 240 240" role="img" [attr.aria-label]="'Quedan ' + p.clock()">
            <circle cx="120" cy="120" [attr.r]="r" class="track" />
            <circle cx="120" cy="120" [attr.r]="r" class="arc" transform="rotate(-90 120 120)" [attr.stroke-dasharray]="circ" [attr.stroke-dashoffset]="offset()" />
          </svg>
          <div class="time" role="timer">{{ p.clock() }}</div>
        </div>
        <div class="cycles" [attr.aria-label]="'Bloque ' + current() + ' de ' + p.settings().cycles">
          @for (i of dots(); track i) { <i [class.done]="i < p.done() % p.settings().cycles || (p.phase() === 'long')" [class.now]="p.phase() === 'focus' && i === p.done() % p.settings().cycles"></i> }
          <span class="muted">Bloque {{ current() }} de {{ p.settings().cycles }}</span>
        </div>
        <div class="row controls">
          @if (p.running()) { <button class="btn primary big" (click)="p.pause()"><app-icon name="pause" /> Pausar</button> }
          @else { <button class="btn primary big" (click)="p.start()"><app-icon name="play" /> {{ p.active() ? 'Continuar' : 'Empezar' }}</button> }
          <button class="btn" (click)="p.skip()" [title]="p.phase() === 'focus' ? 'Terminar el bloque ahora (cuenta el tiempo trabajado)' : 'Saltar el descanso'"><app-icon name="skip" /> {{ p.phase() === 'focus' ? 'Terminar' : 'Saltar' }}</button>
          <button class="btn ghost" (click)="p.reset()" title="Volver al principio de esta fase sin registrar nada"><app-icon name="undo" /> Reiniciar</button>
        </div>
        <label class="field task">¿En qué vas a trabajar?
          <select class="input" [ngModel]="p.taskId()" (ngModelChange)="pickTask($event)" aria-label="Tarea">
            <option [ngValue]="null">Sin tarea concreta</option>
            @for (t of tasks(); track t.id) { <option [ngValue]="t.id">{{ t.title }}</option> }
          </select>
        </label>
      </section>

      <div class="side">
        <section class="card box">
          <h2>Hoy</h2>
          <div class="row stats">
            <div><strong>{{ stats()?.today_sessions ?? 0 }}</strong><span class="muted">bloques</span></div>
            <div><strong>{{ stats()?.today_minutes ?? 0 }}</strong><span class="muted">minutos</span></div>
            <div><strong>{{ p.done() }}</strong><span class="muted">en esta serie</span></div>
          </div>
        </section>

        <form class="card box" (ngSubmit)="save()" (input)="dirty = true" (change)="dirty = true">
          <h2>Ajustes del reloj</h2>
          <div class="grid2">
            <label class="field">Concentración (min) <input class="input" type="number" name="focus" min="1" max="180" [(ngModel)]="s.focus_minutes" required /></label>
            <label class="field">Descanso corto (min) <input class="input" type="number" name="short" min="1" max="60" [(ngModel)]="s.short_break_minutes" required /></label>
            <label class="field">Descanso largo (min) <input class="input" type="number" name="long" min="1" max="120" [(ngModel)]="s.long_break_minutes" required /></label>
            <label class="field">Bloques por serie <input class="input" type="number" name="cycles" min="1" max="12" [(ngModel)]="s.cycles" required /></label>
          </div>
          <label class="row"><input type="checkbox" name="auto" [(ngModel)]="s.auto_start" /> Empezar la siguiente fase automáticamente</label>
          <label class="row"><input type="checkbox" name="sound" [(ngModel)]="s.sound" /> Sonido al terminar</label>
          <label class="row"><input type="checkbox" name="notify" [(ngModel)]="s.notify" /> Notificación del navegador</label>
          <div class="row">
            @for (preset of presets; track preset.name) { <button type="button" class="btn sm" (click)="apply(preset)">{{ preset.name }}</button> }
            <span class="spacer"></span><button class="btn primary" [disabled]="!valid()">Guardar</button>
          </div>
        </form>
      </div>
    </div>

    @if (stats(); as st) {
      <div class="charts">
        <section class="card box"><h2>Minutos de concentración por día</h2>
          <app-column-chart [data]="daily()" unit="min" label="Minutos de concentración por día" /></section>
        <section class="card box"><h2>Tareas con más concentración (minutos)</h2>
          <app-bar-list [bars]="byTask()" empty="Elige una tarea antes de empezar un bloque y aparecerá aquí" /></section>
      </div>
    }
  </div>`,
  styles: [`
    .layout { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 14px; align-items: start; }
    .clock { padding: 24px; display: grid; justify-items: center; gap: 16px; --tone: var(--accent); &.break { --tone: var(--series-3); } }
    .phase { font-size: 13px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--tone); }
    .ring { position: relative; width: min(280px, 70vw); aspect-ratio: 1; svg { width: 100%; height: 100%; } }
    .track { fill: none; stroke: var(--surface-3); stroke-width: 10; }
    .arc { fill: none; stroke: var(--tone); stroke-width: 10; stroke-linecap: round; transition: stroke-dashoffset .5s linear; }
    .time { position: absolute; inset: 0; display: grid; place-content: center; font-size: clamp(44px, 9vw, 64px); font-weight: 600; font-variant-numeric: tabular-nums; letter-spacing: -.02em; }
    .cycles { display: flex; align-items: center; gap: 6px; font-size: 13px; i { width: 10px; height: 10px; border-radius: 50%; border: 2px solid var(--text-3); &.done { background: var(--tone); border-color: var(--tone); } &.now { border-color: var(--tone); } } span { margin-left: 6px; } }
    .controls { flex-wrap: wrap; justify-content: center; } .big { height: 40px; padding: 0 20px; min-width: 150px; }
    .task { width: 100%; max-width: 420px; }
    .side { display: grid; gap: 14px; }
    .box { padding: 16px 18px; display: grid; gap: 12px; align-content: start; min-width: 0; }
    .stats { gap: 24px; div { display: grid; } strong { font-size: 26px; font-weight: 600; font-variant-numeric: tabular-nums; line-height: 1.2; } span { font-size: 12px; } }
    .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .charts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin-top: 14px; }
    @media (max-width: 980px) { .layout, .charts { grid-template-columns: minmax(0, 1fr); } }
  `],
})
export class FocusComponent implements OnInit {
  p = inject(PomodoroService);
  private api = inject(ApiService);
  private toast = inject(ToastService);
  phaseLabel = PHASE_LABEL; r = R; circ = CIRC;
  presets: { name: string; v: Partial<PomodoroSettings> }[] = [
    { name: '25 / 5', v: { focus_minutes: 25, short_break_minutes: 5, long_break_minutes: 15, cycles: 4 } },
    { name: '50 / 10', v: { focus_minutes: 50, short_break_minutes: 10, long_break_minutes: 30, cycles: 2 } },
    { name: '90 / 20', v: { focus_minutes: 90, short_break_minutes: 20, long_break_minutes: 30, cycles: 2 } },
  ];

  s: PomodoroSettings = { ...this.p.settings() };
  tasks = signal<Task[]>([]);
  stats = signal<PomodoroStats | null>(null);

  offset = computed(() => CIRC * (1 - Math.max(0, Math.min(1, this.p.remaining() / this.p.total()))));
  current = computed(() => (this.p.phase() === 'long' ? this.p.settings().cycles : (this.p.done() % this.p.settings().cycles) + 1));
  dots = computed(() => Array.from({ length: this.p.settings().cycles }, (_, i) => i));
  daily = computed(() => ({ labels: this.stats()!.daily.map(d => SHORT.format(parseDay(d.date))), values: this.stats()!.daily.map(d => d.minutes) }));
  byTask = computed<Bar[]>(() => this.stats()!.by_task.map(t => ({ label: t.title, value: t.minutes })));

  constructor() {
    // Los ajustes llegan del servidor después de crear la página; y cada bloque registrado refresca las cifras
    let first = true;
    effect(() => { const v = this.p.settings(); if (first || !this.dirty) this.s = { ...v }; first = false; });
    effect(() => { this.p.logged(); this.loadStats(); });
  }
  // Al tocar el formulario, los ajustes que lleguen tarde del servidor ya no pisan lo que se está escribiendo
  dirty = false;

  ngOnInit() {
    this.p.init();
    this.api.tasks().subscribe({ next: t => this.tasks.set(t.filter(x => x.status !== 'completed' && x.can_edit && !x.pending)), error: () => {} });
  }
  private loadStats() { this.api.pomodoroStats(14).subscribe({ next: s => this.stats.set(s), error: () => {} }); }

  pickTask(id: number | null) { this.p.setTask(id, this.tasks().find(t => t.id === id)?.title ?? ''); }
  apply(preset: { v: Partial<PomodoroSettings> }) { this.s = { ...this.s, ...preset.v }; this.dirty = true; }
  valid() {
    const s = this.s, ok = (v: number, min: number, max: number) => Number.isInteger(Number(v)) && v >= min && v <= max;
    return ok(s.focus_minutes, 1, 180) && ok(s.short_break_minutes, 1, 60) && ok(s.long_break_minutes, 1, 120) && ok(s.cycles, 1, 12);
  }
  save() {
    const s = { ...this.s, focus_minutes: Number(this.s.focus_minutes), short_break_minutes: Number(this.s.short_break_minutes),
      long_break_minutes: Number(this.s.long_break_minutes), cycles: Number(this.s.cycles) };
    this.p.saveSettings(s).subscribe({ next: () => { this.dirty = false; this.toast.success('Ajustes guardados'); }, error: e => this.toast.error(e) });
  }
}
