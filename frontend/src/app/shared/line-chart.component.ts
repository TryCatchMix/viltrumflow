import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, Input, OnDestroy, computed, inject, signal } from '@angular/core';

export interface Series { name: string; color: string; values: number[]; }

const M = { l: 34, r: 92, t: 12, b: 26 };
const H = 230;

/** Gráfico de líneas SVG: un solo eje, rejilla discreta, etiquetas directas y tooltip con cursor. */
@Component({
  selector: 'app-line-chart',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  @if (seriesS().length > 1) {
    <div class="legend">
      @for (s of seriesS(); track s.name) { <span><i [style.background]="s.color"></i>{{ s.name }}</span> }
    </div>
  }
  <div class="plot" (mousemove)="move($event)" (mouseleave)="hover.set(null)">
    <svg [attr.width]="w()" [attr.height]="H" role="img" [attr.aria-label]="label">
      @for (t of yTicks(); track t.v) {
        <line [attr.x1]="M.l" [attr.x2]="w() - M.r" [attr.y1]="t.y" [attr.y2]="t.y" class="grid" />
        <text [attr.x]="M.l - 8" [attr.y]="t.y + 4" text-anchor="end" class="tick">{{ t.v }}</text>
      }
      @for (t of xTicks(); track t.i) {
        <text [attr.x]="t.x" [attr.y]="H - 6" text-anchor="middle" class="tick">{{ t.label }}</text>
      }
      @if (hover(); as h) { <line [attr.x1]="h.x" [attr.x2]="h.x" [attr.y1]="M.t" [attr.y2]="H - M.b" class="cross" /> }
      @for (p of paths(); track p.name) {
        <path [attr.d]="p.d" fill="none" [attr.stroke]="p.color" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
        <text [attr.x]="w() - M.r + 8" [attr.y]="p.labelY + 4" class="direct">{{ p.name }}</text>
        @if (hover(); as h) { <circle [attr.cx]="h.x" [attr.cy]="p.ys[h.i]" r="4" [attr.fill]="p.color" class="marker" /> }
      }
    </svg>
    @if (hover(); as h) {
      <div class="tip" [style.left.px]="h.x" [class.flip]="h.x > w() * 0.6">
        <strong>{{ labelsS()[h.i] }}</strong>
        @for (s of seriesS(); track s.name) {
          <div><i [style.background]="s.color"></i>{{ s.name }}<b>{{ s.values[h.i] }}</b></div>
        }
      </div>
    }
  </div>`,
  styles: [`
    :host { display: block; }
    .legend { display: flex; gap: 14px; font-size: 12px; color: var(--text-2); margin-bottom: 4px; span { display: inline-flex; align-items: center; gap: 6px; } }
    i { width: 10px; height: 10px; border-radius: 2px; display: inline-block; flex: none; }
    .plot { position: relative; cursor: crosshair; }
    svg { display: block; }
    .grid { stroke: var(--grid); stroke-width: 1; }
    .cross { stroke: var(--text-3); stroke-width: 1; }
    .tick { fill: var(--text-3); font-size: 11px; font-variant-numeric: tabular-nums; }
    .direct { fill: var(--text-2); font-size: 12px; }
    .marker { stroke: var(--surface); stroke-width: 2; }
    .tip { position: absolute; top: 8px; transform: translateX(12px); pointer-events: none; background: var(--surface-3); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 6px 10px; font-size: 12px; box-shadow: var(--shadow); white-space: nowrap; z-index: 2;
      &.flip { transform: translateX(calc(-100% - 12px)); }
      div { display: flex; align-items: center; gap: 6px; color: var(--text-2); } b { margin-left: auto; padding-left: 14px; color: var(--text); font-variant-numeric: tabular-nums; } }
  `],
})
export class LineChartComponent implements AfterViewInit, OnDestroy {
  private el = inject(ElementRef<HTMLElement>);
  private ro?: ResizeObserver;
  M = M; H = H;
  @Input() label = 'Gráfico de líneas';
  labelsS = signal<string[]>([]);
  seriesS = signal<Series[]>([]);
  @Input() set labels(v: string[]) { this.labelsS.set(v); }
  @Input() set series(v: Series[]) { this.seriesS.set(v); }
  /** Escala fija (p. ej. 1-5): máximo del eje y marcas a mostrar. Sin ella, se calcula con los datos. */
  @Input() set scale(v: { max: number; ticks: number[] } | null) { this.scaleS.set(v); }
  private scaleS = signal<{ max: number; ticks: number[] } | null>(null);

  w = signal(600);
  hover = signal<{ i: number; x: number } | null>(null);

  private max = computed(() => {
    const fixed = this.scaleS();
    if (fixed) return fixed.max;
    const m = Math.max(1, ...this.seriesS().flatMap(s => s.values));
    const step = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000].find(s => m / s <= 4) ?? Math.ceil(m / 4);
    return Math.ceil(m / step) * step;
  });
  private x = (i: number) => {
    const n = Math.max(this.labelsS().length - 1, 1);
    return M.l + (i / n) * (this.w() - M.l - M.r);
  };
  private y = (v: number) => M.t + (1 - v / this.max()) * (H - M.t - M.b);

  yTicks = computed(() => (this.scaleS()?.ticks.map(v => ({ v })) ?? [0, 1, 2, 3, 4].map(k => ({ v: (this.max() / 4) * k })))
    .filter(t => Number.isInteger(t.v)).map(t => ({ ...t, y: this.y(t.v) })));
  xTicks = computed(() => {
    const n = this.labelsS().length;
    const count = Math.max(2, Math.min(7, Math.floor((this.w() - M.l - M.r) / 80)));
    const step = Math.max(1, Math.ceil((n - 1) / (count - 1)));
    const out = [];
    for (let i = n - 1; i >= 0; i -= step) out.push({ i, x: this.x(i), label: this.labelsS()[i] });
    return out;
  });
  paths = computed(() => {
    const ps = this.seriesS().map(s => {
      const ys = s.values.map(v => this.y(v));
      return { name: s.name, color: s.color, ys, d: ys.map((y, i) => `${i ? 'L' : 'M'}${this.x(i).toFixed(1)},${y.toFixed(1)}`).join(''), labelY: ys[ys.length - 1] ?? 0 };
    });
    // Separa las etiquetas directas que se pisarían
    const sorted = [...ps].sort((a, b) => a.labelY - b.labelY);
    for (let i = 1; i < sorted.length; i++) if (sorted[i].labelY - sorted[i - 1].labelY < 14) sorted[i].labelY = sorted[i - 1].labelY + 14;
    return ps;
  });

  ngAfterViewInit() {
    this.ro = new ResizeObserver(e => this.w.set(Math.max(280, Math.floor(e[0].contentRect.width))));
    this.ro.observe(this.el.nativeElement);
  }
  ngOnDestroy() { this.ro?.disconnect(); }

  move(e: MouseEvent) {
    const n = this.labelsS().length;
    if (!n) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const ratio = (e.clientX - rect.left - M.l) / (this.w() - M.l - M.r);
    const i = Math.max(0, Math.min(n - 1, Math.round(ratio * (n - 1))));
    this.hover.set({ i, x: this.x(i) });
  }
}
