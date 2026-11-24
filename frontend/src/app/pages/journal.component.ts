import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { ENERGY_LEVELS, MOOD_LEVELS, MoodBand, MoodEntry, MoodInsights, MoodLog } from '../core/models';
import { ApiService } from '../core/api.service';
import { ToastService } from '../core/toast.service';
import { addDays, formatDay, parseDay } from '../core/util';
import { Bar, BarListComponent } from '../shared/bar-list.component';
import { ColumnChartComponent } from '../shared/column-chart.component';
import { IconComponent } from '../shared/icon.component';
import { LineChartComponent, Series } from '../shared/line-chart.component';
import { MoodCheckinComponent } from '../shared/mood-checkin.component';

const WEEKDAYS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
const SHORT_WD = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const RANGES = [30, 90, 180];
const num = (v: number | null | undefined, digits = 1) =>
  v === null || v === undefined ? '—' : v.toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: digits });

/** Cómo de fuerte es una correlación, en palabras (nunca solo el número). */
function strength(r: number | null): string | null {
  if (r === null || Math.abs(r) < 0.3) return null;
  return Math.abs(r) >= 0.6 ? 'muy clara' : 'clara';
}

@Component({
  selector: 'app-journal',
  standalone: true,
  imports: [RouterLink, MoodCheckinComponent, LineChartComponent, ColumnChartComponent, BarListComponent, IconComponent],
  template: `
  <div class="page">
    <div class="page-head">
      <div><h1>Diario de ánimo y energía</h1><p>Un registro de diez segundos al día, cruzado con lo que haces: tareas, rutinas y concentración.</p></div>
      <span class="spacer"></span>
      <div class="seg" role="group" aria-label="Periodo">
        @for (r of ranges; track r) {
          <button class="btn sm" [class.primary]="days() === r" [attr.aria-pressed]="days() === r" (click)="setDays(r)">{{ r }} días</button>
        }
      </div>
    </div>

    <app-mood-checkin [showLink]="false" (changed)="load()" />
    <p class="remind muted"><app-icon name="bell" [size]="13" />
      @if (auth.user()?.mood_reminder) { Aviso por la tarde a las {{ auth.user()?.mood_reminder_hour }}:00 si aún no lo has registrado · <a routerLink="/settings" fragment="mood">Cambiar</a> }
      @else { ¿Se te olvida? <a routerLink="/settings" fragment="mood">Activa un aviso por la tarde</a> }
    </p>

    @if (ins(); as s) {
      <div class="tiles">
        <div class="card tile"><span>Días registrados</span><strong>{{ s.logged }}</strong><small>de los últimos {{ s.days }}</small></div>
        <div class="card tile"><span>Racha de registro</span><strong>{{ s.streak }}</strong><small>{{ s.streak === 1 ? 'día seguido' : 'días seguidos' }}</small></div>
        <div class="card tile"><span>Ánimo medio</span><strong>{{ num(s.avg_mood) }}</strong><small>{{ s.avg_mood ? moodWord(s.avg_mood) : 'sin datos' }} · sobre 5</small></div>
        <div class="card tile"><span>Energía media</span><strong>{{ num(s.avg_energy) }}</strong><small>{{ s.avg_energy ? energyWord(s.avg_energy) : 'sin datos' }} · sobre 5</small></div>
      </div>

      @if (s.logged < 3) {
        <div class="card hint row"><app-icon name="smile" [size]="20" />
          <p>Registra unos días más para ver conclusiones. Con una semana ya se ve qué días y a qué horas rindes más.</p></div>
      }

      <div class="grid">
        @if (findings().length) {
          <section class="card panel wide">
            <header><h2>Lo que dicen tus datos</h2></header>
            <ul class="findings">@for (f of findings(); track f) { <li>{{ f }}</li> }</ul>
          </section>
        }

        <section class="card panel wide">
          <header><h2>Ánimo y energía (1 a 5)</h2></header>
          @if (lineLabels().length > 1) {
            <app-line-chart [labels]="lineLabels()" [series]="lineSeries()" [scale]="scale" label="Ánimo y energía por día registrado" />
          } @else { <p class="muted">Cuando tengas al menos dos días registrados verás aquí su evolución.</p> }
        </section>

        <section class="card panel">
          <header class="row wrap"><h2>Calendario de ánimo</h2><span class="spacer"></span>
            <span class="legend" aria-hidden="true">@for (m of moods; track m.v) { <span><i [class]="'c' + m.v"></i>{{ m.label }}</span> }</span></header>
          <div class="cal-wrap">
            <div class="cal" role="grid" aria-label="Ánimo de cada día" [style.--cs.px]="cellSize()">
              <div class="wd" aria-hidden="true">@for (d of shortWd; track $index) { <span>{{ d }}</span> }</div>
              @for (w of weeks(); track $index) {
                <div class="week" role="row">
                  @for (c of w; track $index) {
                    @if (c) {
                      <span role="gridcell" class="cell" [class]="'cell c' + (c.entry?.mood ?? 0)" [class.future]="c.future" [title]="cellTitle(c)"
                        [attr.aria-label]="cellTitle(c)"></span>
                    } @else { <span class="cell blank"></span> }
                  }
                </div>
              }
            </div>
          </div>
        </section>

        <section class="card panel">
          <header><h2>Ánimo medio por día de la semana</h2></header>
          <app-bar-list [bars]="weekdayBars()" [progress]="true" [dots]="false" empty="Aún sin datos" />
        </section>

        <section class="card panel wide">
          <header><h2>Lo que haces según tu energía</h2></header>
          <div class="tbl"><table>
            <thead><tr><th>Energía</th><th>Días</th><th>Tareas / día</th><th>Rutinas cumplidas</th><th>Enfoque / día</th></tr></thead>
            <tbody>
              @for (b of energyRows(); track b.label) {
                <tr><td>{{ b.label }}</td><td>{{ b.band.days }}</td><td>{{ num(b.band.tasks) }}</td>
                  <td>{{ b.band.habits === null ? '—' : b.band.habits + ' %' }}</td><td>{{ b.band.focus === null ? '—' : num(b.band.focus, 0) + ' min' }}</td></tr>
              }
            </tbody>
          </table></div>
          <header><h2>… y según tu ánimo</h2></header>
          <div class="tbl"><table>
            <thead><tr><th>Ánimo</th><th>Días</th><th>Tareas / día</th><th>Rutinas cumplidas</th><th>Enfoque / día</th></tr></thead>
            <tbody>
              @for (b of moodRows(); track b.label) {
                <tr><td>{{ b.label }}</td><td>{{ b.band.days }}</td><td>{{ num(b.band.tasks) }}</td>
                  <td>{{ b.band.habits === null ? '—' : b.band.habits + ' %' }}</td><td>{{ b.band.focus === null ? '—' : num(b.band.focus, 0) + ' min' }}</td></tr>
              }
            </tbody>
          </table></div>
        </section>

        <section class="card panel">
          <header><h2>Tareas completadas por hora</h2></header>
          <app-column-chart [data]="hourData(s.hours.tasks)" unit="tareas" label="Tareas completadas por hora del día" />
        </section>
        <section class="card panel">
          <header><h2>Minutos de enfoque por hora</h2></header>
          <app-column-chart [data]="hourData(s.hours.focus)" unit="min" color="var(--series-2)" label="Minutos de concentración por hora del día" />
        </section>

        <section class="card panel">
          <header><h2>Qué te influye</h2></header>
          @if (s.factors.length) {
            <ul class="factors">
              @for (f of s.factors; track f.key) {
                <li><strong>{{ f.label }}</strong><span class="muted days">{{ f.days }} días</span><br />
                  <span>Ánimo {{ num(f.mood_with) }} con · {{ num(f.mood_without) }} sin</span>
                  <span class="delta">{{ delta(f.mood_with - f.mood_without) }}</span><br />
                  <span>Energía {{ num(f.energy_with) }} con · {{ num(f.energy_without) }} sin</span>
                  <span class="delta">{{ delta(f.energy_with - f.energy_without) }}</span></li>
              }
            </ul>
          } @else { <p class="muted">Marca factores al registrar el día («Dormí bien», «Ejercicio»…). Con tres días con y tres sin, aquí verás cómo te afectan.</p> }
        </section>

        @if (notes().length) {
          <section class="card panel wide">
            <header><h2>Notas recientes</h2></header>
            <ul class="notes">
              @for (n of notes(); track n.day) {
                <li><span class="face" aria-hidden="true">{{ moods[n.mood - 1].emoji }}</span>
                  <div><strong class="cap">{{ fmt(n.day) }}</strong> <span class="muted">· {{ moods[n.mood - 1].label }}, energía {{ energies[n.energy - 1].label.toLowerCase() }}</span>
                    <p>{{ n.note }}</p></div></li>
              }
            </ul>
          </section>
        }
      </div>
    } @else {
      <div class="tiles">@for (i of [1, 2, 3, 4]; track i) { <div class="skeleton" style="height:92px"></div> }</div>
    }
  </div>`,
  styles: [`
    .seg { display: flex; gap: 4px; }
    app-mood-checkin { margin-bottom: 8px; }
    .remind { display: flex; align-items: center; gap: 6px; font-size: 12.5px; margin: 0 0 14px; }
    .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; }
    .tile { padding: 14px 16px; display: grid; gap: 2px;
      span { font-size: 12px; color: var(--text-2); } strong { font-size: 28px; font-weight: 600; line-height: 1.2; font-variant-numeric: tabular-nums; } small { color: var(--text-3); font-size: 12px; } }
    .hint { margin-top: 12px; padding: 12px 16px; gap: 10px; align-items: center; p { margin: 0; } app-icon { color: var(--accent); } }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 12px; }
    .panel { padding: 16px 18px; display: grid; gap: 14px; align-content: start; min-width: 0; h2 { margin: 0; font-size: 15px; } }
    .wide { grid-column: 1 / -1; }
    @media (max-width: 900px) { .grid { grid-template-columns: minmax(0, 1fr); } }
    .findings { margin: 0; padding-left: 18px; display: grid; gap: 6px; }
    .legend { display: flex; gap: 10px; flex-wrap: wrap; font-size: 12px; color: var(--text-2);
      span { display: inline-flex; align-items: center; gap: 4px; } i { width: 10px; height: 10px; border-radius: 2px; display: inline-block; } }
    .cal-wrap { overflow-x: auto; }
    .cal { display: flex; gap: 3px; width: max-content; }
    .wd, .week { display: grid; grid-template-rows: repeat(7, var(--cs)); gap: 3px; }
    .wd span { font-size: 10px; color: var(--text-3); line-height: var(--cs); padding-right: 4px; }
    .cell { width: var(--cs); height: var(--cs); border-radius: 3px; background: var(--surface-2); }
    .wrap { flex-wrap: wrap; gap: 8px; }
    .cell.blank { background: transparent; } .cell.future { opacity: .35; }
    .c1 { background: var(--div-neg); }
    .c2 { background: color-mix(in srgb, var(--div-neg) 45%, var(--div-mid)); }
    .c3 { background: var(--div-mid); outline: 1px solid var(--border); outline-offset: -1px; }
    .c4 { background: color-mix(in srgb, var(--series-1) 45%, var(--div-mid)); }
    .c5 { background: var(--series-1); }
    .tbl { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; font-variant-numeric: tabular-nums; }
    th, td { text-align: right; padding: 6px 10px; border-bottom: 1px solid var(--border); white-space: nowrap; }
    th:first-child, td:first-child { text-align: left; } th { color: var(--text-3); font-weight: 500; }
    .factors, .notes { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; font-size: 13px; }
    .days { margin-left: 6px; }
    .delta { color: var(--text-2); margin-left: 6px; font-variant-numeric: tabular-nums; }
    .notes li { display: flex; gap: 10px; p { margin: 2px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; } }
    .face { font-size: 20px; line-height: 1.2; }
  `],
})
export class JournalComponent implements OnInit {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  auth = inject(AuthService);

  ranges = RANGES; moods = MOOD_LEVELS; energies = ENERGY_LEVELS; shortWd = SHORT_WD; num = num;
  scale = { max: 5, ticks: [1, 2, 3, 4, 5] };
  days = signal(30);
  ins = signal<MoodInsights | null>(null);
  log = signal<MoodLog | null>(null);

  ngOnInit() { this.load(); }

  setDays(d: number) { this.days.set(d); this.load(); }

  load() {
    this.api.moodInsights(this.days()).subscribe({ next: r => this.ins.set(r), error: e => this.toast.error(e) });
    this.api.moodLog(this.days()).subscribe({ next: r => this.log.set(r), error: () => {} });
  }

  fmt(day: string) { return formatDay(day); }
  moodWord(v: number) { return MOOD_LEVELS[Math.min(4, Math.max(0, Math.round(v) - 1))].label.toLowerCase(); }
  energyWord(v: number) { return ENERGY_LEVELS[Math.min(4, Math.max(0, Math.round(v) - 1))].label.toLowerCase(); }
  delta(d: number) { return d === 0 ? '=' : `${d > 0 ? '▲ +' : '▼ '}${num(d)}`; }
  hourData(values: number[]) { return { labels: values.map((_, h) => `${h}:00`), values }; }

  private entries = computed(() => this.log()?.entries ?? []);
  notes = computed(() => [...this.entries()].filter(e => e.note).reverse().slice(0, 8));
  lineLabels = computed(() => this.entries().map(e => formatDay(e.day)));
  lineSeries = computed<Series[]>(() => [
    { name: 'Ánimo', color: 'var(--series-1)', values: this.entries().map(e => e.mood) },
    { name: 'Energía', color: 'var(--series-2)', values: this.entries().map(e => e.energy) },
  ]);

  /** Casillas grandes en periodos cortos; pequeñas para que medio año quepa en media tarjeta. */
  cellSize = computed(() => (this.days() <= 31 ? 26 : this.days() <= 90 ? 18 : 13));

  /** Semanas (columnas, de lunes a domingo) del periodo, como en un calendario de contribuciones. */
  weeks = computed(() => {
    const log = this.log();
    if (!log) return [];
    const byDay = new Map(log.entries.map(e => [e.day, e]));
    const last = log.today, first = addDays(last, -(this.days() - 1));
    const start = addDays(first, -((parseDay(first).getDay() + 6) % 7));
    const weeks: ({ day: string; entry?: MoodEntry; future: boolean } | null)[][] = [];
    for (let d = start; d <= last || weeks[weeks.length - 1]?.length < 7; d = addDays(d, 1)) {
      if (!weeks.length || weeks[weeks.length - 1].length === 7) weeks.push([]);
      weeks[weeks.length - 1].push(d < first ? null : { day: d, entry: byDay.get(d), future: d > last });
    }
    return weeks;
  });

  cellTitle(c: { day: string; entry?: MoodEntry; future: boolean }) {
    const day = formatDay(c.day);
    if (c.future) return day;
    if (!c.entry) return `${day}: sin registro`;
    return `${day}: ${MOOD_LEVELS[c.entry.mood - 1].label}, energía ${ENERGY_LEVELS[c.entry.energy - 1].label.toLowerCase()}`;
  }

  private rows(b: MoodInsights['by_energy'], labels: [string, string, string]) {
    return [{ label: labels[0], band: b.high }, { label: labels[1], band: b.mid }, { label: labels[2], band: b.low }];
  }
  energyRows = computed(() => { const s = this.ins(); return s ? this.rows(s.by_energy, ['Alta (4-5)', 'Normal (3)', 'Baja (1-2)']) : []; });
  moodRows = computed(() => { const s = this.ins(); return s ? this.rows(s.by_mood, ['Bien (4-5)', 'Normal (3)', 'Mal (1-2)']) : []; });

  weekdayBars = computed<Bar[]>(() => (this.ins()?.weekdays ?? []).filter(w => w.mood !== null).map(w => ({
    label: WEEKDAYS[w.weekday], value: w.mood!, total: 5, display: num(w.mood),
    hint: `${w.days} ${w.days === 1 ? 'día' : 'días'} · energía ${num(w.energy)}`,
  })));

  /** Conclusiones en frases, solo cuando hay datos suficientes para que tengan sentido. */
  findings = computed(() => {
    const s = this.ins();
    if (!s || s.logged < 5) return [];
    const out: string[] = [];
    const cmp = (hi: MoodBand, lo: MoodBand, what: string) => {
      if (hi.days < 2 || lo.days < 2) return;
      if (hi.tasks !== null && lo.tasks !== null && hi.tasks !== lo.tasks) {
        out.push(`Los días de ${what} alta completas ${num(hi.tasks)} tareas de media; los de ${what} baja, ${num(lo.tasks)}.`);
      }
      if (hi.habits !== null && lo.habits !== null && Math.abs(hi.habits - lo.habits) >= 10) {
        out.push(`Con ${what} alta cumples el ${hi.habits} % de tus rutinas; con ${what} baja, el ${lo.habits} %.`);
      }
    };
    cmp(s.by_energy.high, s.by_energy.low, 'energía');
    const corr = s.correlations;
    const st = strength(corr.mood_tasks);
    if (st) out.push(corr.mood_tasks! > 0
      ? `Hay una relación ${st} entre tu ánimo y las tareas que terminas: los días buenos haces más.`
      : `Curiosamente, los días de peor ánimo terminas más tareas (relación ${st}).`);
    const sf = strength(corr.energy_focus);
    if (sf && corr.energy_focus! > 0) out.push(`Tu energía y tu tiempo de concentración van de la mano (relación ${sf}).`);
    const peak = (v: number[]) => { const m = Math.max(...v); return m > 0 ? v.indexOf(m) : -1; };
    const ht = peak(s.hours.tasks), hf = peak(s.hours.focus);
    if (ht >= 0) out.push(`La hora en la que más tareas completas es hacia las ${ht}:00.`);
    if (hf >= 0 && hf !== ht) out.push(`Te concentras más entre las ${hf}:00 y las ${hf + 1}:00.`);
    const wds = s.weekdays.filter(w => w.days >= 2 && w.mood !== null);
    if (wds.length >= 3) {
      const best = wds.reduce((a, b) => (b.mood! > a.mood! ? b : a)), worst = wds.reduce((a, b) => (b.mood! < a.mood! ? b : a));
      if (best.mood! - worst.mood! >= 0.5) out.push(`Tu mejor día suele ser el ${WEEKDAYS[best.weekday]} (ánimo ${num(best.mood)}); el más flojo, el ${WEEKDAYS[worst.weekday]} (${num(worst.mood)}).`);
    }
    const f = s.factors[0];
    if (f && Math.abs(f.mood_with - f.mood_without) >= 0.5) {
      out.push(`«${f.label}» es lo que más cambia tu ánimo: ${num(f.mood_with)} esos días frente a ${num(f.mood_without)} el resto.`);
    }
    return out;
  });
}
