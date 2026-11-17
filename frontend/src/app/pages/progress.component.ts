import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ApiService } from '../core/api.service';
import { GameService } from '../core/game.service';
import { GameHistory, XP_KIND_LABEL, XpKind } from '../core/models';
import { parseDay, relativeTime } from '../core/util';
import { Bar, BarListComponent } from '../shared/bar-list.component';
import { ColumnChartComponent } from '../shared/column-chart.component';
import { IconComponent } from '../shared/icon.component';
import { RankInsigniaComponent } from '../shared/rank-insignia.component';

const SHORT = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' });
const KIND_ICON: Record<XpKind, string> = { task: 'check', habit: 'flame', focus: 'target', review: 'calendar', mission: 'flag' };

@Component({
  selector: 'app-progress',
  standalone: true,
  imports: [IconComponent, RankInsigniaComponent, ColumnChartComponent, BarListComponent],
  template: `
  <div class="page">
    <div class="page-head"><div><h1>Progreso</h1><p>Tu carrera en el Imperio: cada tarea, rutina y bloque de concentración te da experiencia.</p></div></div>

    @if (game.profile(); as p) {
      <section class="card hero">
        <app-rank-insignia [rank]="p.rank_index" [size]="96" [label]="'Rango: ' + p.rank" />
        <div class="info">
          <span class="muted">Rango actual</span>
          <h2 class="rank">{{ p.rank }}</h2>
          <div class="row lvl"><strong>Nivel {{ p.level }}</strong><span class="spacer"></span><span class="muted">{{ p.xp - p.level_start_xp }} / {{ p.next_level_xp - p.level_start_xp }} XP</span></div>
          <div class="bar" role="progressbar" [attr.aria-valuenow]="game.progress()" aria-valuemin="0" aria-valuemax="100" aria-label="Progreso hacia el siguiente nivel"><span [style.width.%]="game.progress()"></span></div>
          <p class="muted">Faltan <strong>{{ p.next_level_xp - p.xp }} XP</strong> para el nivel {{ p.level + 1 }}.
            @if (p.next_rank) { Siguiente rango: <strong>{{ p.next_rank }}</strong> en el nivel {{ p.next_rank_level }}. } @else { Has alcanzado el rango más alto. }</p>
        </div>
      </section>

      @if (history(); as h) {
        <div class="tiles">
          <div class="card tile"><span>Hoy</span><strong>{{ h.today_xp }}</strong><small>XP ganados</small></div>
          <div class="card tile"><span>Últimos 7 días</span><strong>{{ h.week_xp }}</strong><small>XP ganados</small></div>
          <div class="card tile"><span>Total</span><strong>{{ p.xp }}</strong><small>XP acumulados</small></div>
          <div class="card tile"><span>Logros</span><strong>{{ unlocked() }}/{{ h.achievements.length }}</strong><small>desbloqueados</small></div>
        </div>

        <div class="grid">
          <section class="card panel wide"><h2>Experiencia ganada por día</h2>
            <app-column-chart [data]="daily()" unit="XP" color="var(--accent)" label="Experiencia ganada cada día" /></section>

          <section class="card panel wide">
            <h2>Rangos del Imperio</h2>
            <ol class="ladder">
              @for (r of p.ranks; track r.name; let i = $index) {
                <li [class.current]="i === p.rank_index" [class.locked]="i > p.rank_index" [attr.aria-current]="i === p.rank_index ? 'step' : null">
                  <app-rank-insignia [rank]="i" [size]="44" [locked]="i > p.rank_index" [label]="r.name" />
                  <strong>{{ r.name }}</strong>
                  <small class="muted">@if (i > p.rank_index) { <app-icon name="lock" [size]="10" /> }Nivel {{ r.min_level }}</small>
                  <small class="muted">{{ r.min_xp }} XP</small>
                </li>
              }
            </ol>
          </section>

          <section class="card panel"><h2>De dónde viene tu experiencia</h2><app-bar-list [bars]="byKind()" empty="Todavía no has ganado experiencia" /></section>

          <section class="card panel"><h2>Cómo se gana</h2>
            <ul class="rules">
              <li><app-icon name="check" /> <span><strong>Tareas</strong>: 10, 20, 40 u 80 XP según la dificultad (fácil, normal, difícil, épica).</span></li>
              <li><app-icon name="clock" /> <span><strong>Esfuerzo</strong>: +1 XP por cada 5 minutos registrados en la tarea (hasta 60). Sin tiempo registrado, +1 por cada 12 minutos estimados (hasta 40).</span></li>
              <li><app-icon name="calendar" /> <span><strong>A tiempo</strong>: +25 % si la terminas antes de su fecha. Prioridad alta +3, urgente +5. Cada subtarea, 5 XP.</span></li>
              <li><app-icon name="flame" /> <span><strong>Rutinas</strong>: 5, 10, 15 o 25 XP según la dificultad al completarlas, más 1 por cada día (o semana) de racha (hasta 10).</span></li>
              <li><app-icon name="target" /> <span><strong>Concentración</strong>: 1 XP por cada 5 minutos de bloque Pomodoro terminado.</span></li>
              <li><app-icon name="calendar" /> <span><strong>Revisión semanal</strong>: 30 XP al terminarla, una vez por semana.</span></li>
              <li><app-icon name="flag" /> <span><strong>Misiones semanales</strong>: de 40 a 80 XP cada una, más monedas para tus recompensas.</span></li>
            </ul>
            <p class="muted small">Reabrir una tarea o desmarcar una rutina retira su experiencia. Cada nivel pide 100 XP más que el anterior.</p>
          </section>

          <section class="card panel wide"><h2>Logros</h2>
            <div class="ach">
              @for (a of h.achievements; track a.id) {
                <div class="a" [class.on]="a.unlocked">
                  <app-icon [name]="a.unlocked ? 'shield' : 'lock'" [size]="20" />
                  <div><strong>{{ a.name }}</strong><small class="muted">{{ a.description }}</small>
                    <div class="bar thin" role="progressbar" [attr.aria-valuenow]="a.progress" aria-valuemin="0" [attr.aria-valuemax]="a.goal" [attr.aria-label]="a.name"><span [style.width.%]="(100 * a.progress) / a.goal"></span></div>
                    <small class="muted">{{ a.unlocked ? 'Conseguido' : a.progress + ' de ' + a.goal }}</small></div>
                </div>
              }
            </div>
          </section>

          <section class="card panel wide"><h2>Últimos movimientos</h2>
            @for (e of h.recent; track $index) {
              <div class="ev row"><app-icon [name]="icon[e.kind]" /><span class="truncate">{{ e.detail || kindLabel[e.kind] }}</span>
                <span class="spacer"></span><span class="muted when">{{ rel(e.created_at) }}</span><span class="chip xp">+{{ e.amount }} XP</span></div>
            } @empty { <p class="muted">Completa una tarea o marca una rutina y verás aquí la experiencia ganada.</p> }
          </section>
        </div>
      }
    } @else { <div class="skeleton" style="height:180px"></div> }
  </div>`,
  styles: [`
    .hero { padding: 22px 24px; display: flex; gap: 24px; align-items: center; }
    .info { flex: 1; min-width: 0; display: grid; gap: 6px; } .rank { font-size: 26px; letter-spacing: -.01em; } .lvl { font-size: 14px; margin-top: 4px; }
    .bar { height: 10px; background: var(--surface-3); border-radius: 5px; overflow: hidden; span { display: block; height: 100%; background: var(--accent); border-radius: 5px; transition: width .4s; }
      &.thin { height: 5px; margin: 5px 0 3px; } }
    .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; margin-top: 12px; }
    .tile { padding: 14px 16px; display: grid; gap: 2px; span { font-size: 12px; color: var(--text-2); } strong { font-size: 28px; font-weight: 600; line-height: 1.2; font-variant-numeric: tabular-nums; } small { color: var(--text-3); font-size: 12px; } }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 12px; }
    .panel { padding: 16px 18px; display: grid; gap: 14px; align-content: start; min-width: 0; } .wide { grid-column: 1 / -1; }
    .ladder { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(104px, 1fr)); gap: 8px;
      li { display: grid; justify-items: center; text-align: center; gap: 4px; padding: 12px 6px; border-radius: var(--radius); border: 1px solid transparent; font-size: 13px;
        &.current { border-color: var(--accent); background: var(--accent-soft); } &.locked strong { color: var(--text-3); } small { font-size: 11px; display: inline-flex; gap: 3px; align-items: center; } } }
    .rules { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; font-size: 13px; li { display: flex; gap: 10px; color: var(--text-2); app-icon { margin-top: 2px; color: var(--accent-text); } strong { color: var(--text); font-weight: 500; } } }
    .small { font-size: 12px; }
    .ach { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 10px; }
    .a { display: flex; gap: 12px; padding: 12px; border: 1px solid var(--border); border-radius: var(--radius); color: var(--text-3); div { flex: 1; min-width: 0; display: grid; } strong { color: var(--text-2); font-weight: 500; font-size: 13.5px; } small { font-size: 12px; }
      &.on { color: var(--accent-text); border-color: var(--accent); strong { color: var(--text); } } }
    .ev { padding: 6px 0; border-bottom: 1px solid var(--border); font-size: 13.5px; color: var(--text-2); &:last-child { border-bottom: none; } .when { font-size: 12px; white-space: nowrap; } }
    .xp { background: var(--accent-soft); color: var(--accent-text); font-variant-numeric: tabular-nums; }
    @media (max-width: 900px) { .grid { grid-template-columns: minmax(0, 1fr); } }
    @media (max-width: 560px) { .hero { flex-direction: column; text-align: center; } }
  `],
})
export class ProgressComponent implements OnInit {
  game = inject(GameService);
  private api = inject(ApiService);
  history = signal<GameHistory | null>(null);
  icon = KIND_ICON; kindLabel = XP_KIND_LABEL; rel = relativeTime;

  unlocked = computed(() => this.history()!.achievements.filter(a => a.unlocked).length);
  daily = computed(() => ({ labels: this.history()!.daily.map(d => SHORT.format(parseDay(d.date))), values: this.history()!.daily.map(d => d.total) }));
  byKind = computed<Bar[]>(() => (Object.keys(XP_KIND_LABEL) as XpKind[]).map(k => ({ label: XP_KIND_LABEL[k], value: this.history()!.by_kind[k] })).filter(b => b.value > 0));

  ngOnInit() {
    this.game.refresh();
    this.api.gameHistory(30).subscribe({ next: h => this.history.set(h), error: () => {} });
  }
}
