import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

// Diseño propio: escudo con galones (1–3) y estrellas (0–3) que crecen con el rango.
const TIERS = [
  { chevrons: 1, stars: 0, color: '#8a8f98' }, { chevrons: 2, stars: 0, color: '#8a8f98' }, { chevrons: 3, stars: 0, color: '#b0763f' },
  { chevrons: 1, stars: 1, color: '#b0763f' }, { chevrons: 2, stars: 1, color: '#5f8fc4' }, { chevrons: 3, stars: 1, color: '#5f8fc4' },
  { chevrons: 1, stars: 2, color: '#d0a030' }, { chevrons: 2, stars: 2, color: '#d0a030' }, { chevrons: 3, stars: 2, color: '#d0493f' },
  { chevrons: 3, stars: 3, color: '#8b6cff' },
];
const STAR = 'M0,-5 1.5,-1.6 5,-1.5 2.3,0.8 3.1,4.5 0,2.5 -3.1,4.5 -2.3,0.8 -5,-1.5 -1.5,-1.6Z';

@Component({
  selector: 'app-rank-insignia',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <svg [attr.width]="size" [attr.height]="size * 1.15" viewBox="0 0 60 69" role="img" [attr.aria-label]="label" [class.locked]="locked">
    <path d="M30 3 54 12v20c0 16-10 27-24 33C16 59 6 48 6 32V12z" [attr.fill]="t.color" fill-opacity=".16" [attr.stroke]="t.color" stroke-width="2.5" stroke-linejoin="round" />
    @for (s of stars; track s) { <path [attr.d]="star" [attr.fill]="t.color" [attr.transform]="'translate(' + s + ' 19) scale(1.15)'" /> }
    @for (y of chevrons; track y) {
      <path [attr.d]="'M18 ' + y + ' 30 ' + (y + 8) + ' 42 ' + y" fill="none" [attr.stroke]="t.color" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" />
    }
  </svg>`,
  styles: [':host { display: inline-flex; flex: none; } .locked { filter: grayscale(1); opacity: .35; }'],
})
export class RankInsigniaComponent {
  @Input() size = 48;
  @Input() label = 'Insignia de rango';
  @Input() locked = false;
  star = STAR;
  t = TIERS[0];
  stars: number[] = [];
  chevrons: number[] = [];
  @Input({ required: true }) set rank(i: number) {
    this.t = TIERS[Math.max(0, Math.min(TIERS.length - 1, i))];
    this.stars = Array.from({ length: this.t.stars }, (_, k) => 30 + (k - (this.t.stars - 1) / 2) * 13);
    const top = this.t.stars ? 30 : 22;
    this.chevrons = Array.from({ length: this.t.chevrons }, (_, k) => top + k * 9);
  }
}
