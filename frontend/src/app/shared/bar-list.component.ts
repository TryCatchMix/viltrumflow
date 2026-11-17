import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

export interface Bar { label: string; value: number; total?: number; color?: string; hint?: string; }

/** Barras horizontales con etiqueta y valor siempre visibles. Con `total`, la barra muestra el avance sobre él. */
@Component({
  selector: 'app-bar-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  @for (b of bars; track b.label) {
    <div class="bar" [title]="b.hint ?? (b.total !== undefined ? b.value + ' de ' + b.total : b.label + ': ' + b.value)">
      <span class="label truncate">@if (b.color && dots) { <i [style.background]="b.color"></i> }{{ b.label }}</span>
      <span class="track"><span class="fill" [style.width.%]="pct(b)" [style.background]="progress ? (b.color || 'var(--series-1)') : 'var(--series-1)'"></span></span>
      <span class="value">{{ b.total !== undefined ? b.value + '/' + b.total : b.value }}</span>
    </div>
  } @empty { <p class="muted">{{ empty }}</p> }`,
  styles: [`
    :host { display: grid; gap: 10px; }
    .bar { display: grid; grid-template-columns: minmax(80px, 34%) 1fr auto; align-items: center; gap: 10px; font-size: 13px; }
    .label { color: var(--text-2); display: flex; align-items: center; gap: 6px; } i { width: 8px; height: 8px; border-radius: 50%; flex: none; }
    .track { height: 10px; border-radius: 4px; background: var(--surface-2); overflow: hidden; }
    .fill { display: block; height: 100%; border-radius: 0 4px 4px 0; min-width: 0; transition: width .3s; }
    .bar:hover .fill { filter: brightness(1.15); }
    .value { font-variant-numeric: tabular-nums; min-width: 2ch; text-align: right; }
  `],
})
export class BarListComponent {
  @Input() bars: Bar[] = [];
  @Input() empty = 'Sin datos';
  @Input() progress = false;
  /** Punto de color junto a la etiqueta (identifica al proyecto); desactívalo si el color es un estado. */
  @Input() dots = true;
  private get max() { return Math.max(1, ...this.bars.map(b => b.value)); }
  pct(b: Bar) { return Math.min(100, b.total !== undefined ? (b.total ? (100 * b.value) / b.total : 0) : (100 * b.value) / this.max); }
}
