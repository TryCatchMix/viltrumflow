import { ChangeDetectionStrategy, Component, Input, signal } from '@angular/core';

/** Columnas verticales de una sola serie, con rejilla discreta y tooltip por columna. */
@Component({
  selector: 'app-column-chart',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div class="chart" role="img" [attr.aria-label]="label" (mouseleave)="hover.set(-1)">
    <div class="axis"><span>{{ max }}</span><span>{{ max / 2 }}</span><span>0</span></div>
    <div class="plot">
      <i class="grid" style="top:0"></i><i class="grid" style="top:50%"></i>
      @for (v of values; track $index) {
        <div class="col" (mouseenter)="hover.set($index)" [class.on]="hover() === $index">
          <span class="bar" [style.height.%]="max ? (100 * v) / max : 0" [style.background]="color"></span>
          @if (hover() === $index) { <span class="tip" [class.flip]="$index > values.length * 0.6"><strong>{{ labels[$index] }}</strong>{{ v }} {{ unit }}</span> }
        </div>
      }
    </div>
  </div>
  <div class="x">@for (t of ticks; track t.i) { <span [style.left.%]="t.pos">{{ t.label }}</span> }</div>`,
  styles: [`
    :host { display: block; }
    .chart { display: flex; gap: 6px; height: 150px; }
    .axis { display: flex; flex-direction: column; justify-content: space-between; font-size: 11px; color: var(--text-3); text-align: right; min-width: 22px; font-variant-numeric: tabular-nums; margin: -6px 0; }
    .plot { flex: 1; display: flex; align-items: flex-end; gap: 2px; position: relative; border-bottom: 1px solid var(--grid); min-width: 0; }
    .grid { position: absolute; left: 0; right: 0; border-top: 1px solid var(--grid); }
    .col { flex: 1; height: 100%; display: flex; align-items: flex-end; position: relative; min-width: 0; &.on { background: var(--surface-2); } }
    .bar { width: 100%; border-radius: 4px 4px 0 0; min-height: 0; transition: height .3s; }
    .tip { position: absolute; bottom: 100%; left: 50%; transform: translate(-20%, -4px); z-index: 3; pointer-events: none; white-space: nowrap; background: var(--surface-3); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 4px 8px; font-size: 12px; box-shadow: var(--shadow); display: grid;
      &.flip { transform: translate(-80%, -4px); } strong { font-weight: 500; color: var(--text-2); } }
    .x { position: relative; height: 18px; margin-left: 28px; font-size: 11px; color: var(--text-3); span { position: absolute; top: 4px; transform: translateX(-50%); white-space: nowrap; } }
  `],
})
export class ColumnChartComponent {
  @Input() label = 'Gráfico de columnas';
  @Input() color = 'var(--series-1)';
  @Input() unit = '';
  /** Nº aproximado de etiquetas en el eje X. */
  @Input() tickCount = 6;
  labels: string[] = [];
  values: number[] = [];
  max = 1;
  ticks: { i: number; pos: number; label: string }[] = [];
  hover = signal(-1);

  @Input() set data(d: { labels: string[]; values: number[] }) {
    this.labels = d.labels; this.values = d.values;
    const m = Math.max(1, ...d.values);
    const step = [2, 4, 10, 20, 40, 50, 100, 200, 400, 500, 1000, 2000, 5000].find(s => s >= m) ?? Math.ceil(m / 100) * 100;
    this.max = step;
    const n = d.labels.length, every = Math.max(1, Math.round(n / this.tickCount));
    this.ticks = [];
    for (let i = n - 1; i >= 0; i -= every) this.ticks.push({ i, pos: ((i + 0.5) / n) * 100, label: d.labels[i] });
  }
}
