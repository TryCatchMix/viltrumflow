import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { ReviewToday, DIFFICULTY_LABEL, Habit, HabitDayItem, HabitInput, HabitState, HabitStats, PRIORITY_LABEL, Task, WEEKDAY_NAME, WEEKDAY_SHORT } from '../core/models';
import { ToastService } from '../core/toast.service';
import { addDays, isOverdue, parseDay, taskDay, taskTime, toDue, today } from '../core/util';
import { Bar, BarListComponent } from '../shared/bar-list.component';
import { ColumnChartComponent } from '../shared/column-chart.component';
import { IconComponent } from '../shared/icon.component';
import { LineChartComponent, Series } from '../shared/line-chart.component';
import { TaskDialogService } from '../shared/task-dialog.service';

const LONG = new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long' });
const SHORT = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' });
const COLORS = ['#7c5cff', '#2a78d6', '#1baf7a', '#eda100', '#eb6834', '#e34948', '#e87ba4', '#6b7280'];
const STATE_LABEL: Record<HabitState, string> = { done: 'cumplida', missed: 'no cumplida', off: 'no tocaba', pending: 'pendiente (hoy)', partial: 'a medias', free: 'día libre (rutina semanal)' };
const clock = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

@Component({
  selector: 'app-today',
  standalone: true,
  imports: [FormsModule, RouterLink, IconComponent, LineChartComponent, BarListComponent, ColumnChartComponent],
  template: `
  <div class="page">
    <div class="page-head">
      <div><h1 class="cap">{{ isToday() ? 'Hoy' : dayLabel() }}</h1><p class="cap">{{ isToday() ? dayLabel() : 'Puedes marcar lo que se te olvidó anotar' }}</p></div>
      <span class="spacer"></span>
      @if (tab() === 'day') {
        <div class="row">
          <button class="btn icon" (click)="shift(-1)" [disabled]="day() <= minDay" aria-label="Día anterior"><app-icon name="left" /></button>
          <button class="btn" (click)="day.set(todayStr); loadDay()" [disabled]="isToday()">Hoy</button>
          <button class="btn icon" (click)="shift(1)" [disabled]="isToday()" aria-label="Día siguiente"><app-icon name="right" /></button>
        </div>
      }
    </div>

    <div class="tabs" role="tablist">
      <button role="tab" [class.active]="tab() === 'day'" (click)="setTab('day')">Mi día</button>
      <button role="tab" [class.active]="tab() === 'stats'" (click)="setTab('stats')">Estadísticas</button>
      <button role="tab" [class.active]="tab() === 'manage'" (click)="setTab('manage')">Rutinas</button>
    </div>

    <!-- ===== Mi día ===== -->
    @if (tab() === 'day') {
      @if (info()?.pending_review && isToday()) {
        <a class="card banner row" routerLink="/review"><app-icon name="history" /><span><strong>Tu revisión semanal está pendiente.</strong>
          Cinco minutos para cerrar la semana y fijar objetivos.</span><span class="spacer"></span><span class="btn sm primary">Hacer revisión</span></a>
      }
      <div class="summary card row">
        <svg viewBox="0 0 44 44" width="56" height="56" role="img" [attr.aria-label]="done() + ' de ' + total() + ' completado'">
          <circle cx="22" cy="22" r="18" fill="none" stroke="var(--surface-3)" stroke-width="5" />
          <circle cx="22" cy="22" r="18" fill="none" stroke="var(--accent)" stroke-width="5" stroke-linecap="round" transform="rotate(-90 22 22)"
                  [attr.stroke-dasharray]="113.1" [attr.stroke-dashoffset]="113.1 * (1 - (total() ? done() / total() : 0))" />
        </svg>
        <div><strong>{{ done() }} de {{ total() }}</strong>
          <p class="muted">{{ total() === 0 ? 'Nada programado para este día' : done() === total() ? 'Día completo. Buen trabajo.' : (total() - done()) + ' por hacer' }}</p></div>
      </div>

      @if (info()?.goals?.length) {
        <h3 class="group">Objetivos de la semana <span class="muted">{{ goalsDone() }}/{{ info()!.goals.length }}</span></h3>
        <div class="card list">
          @for (g of info()!.goals; track $index) {
            <div class="item row" [class.done]="g.done">
              <input type="checkbox" class="check big square" [checked]="g.done" (change)="toggleGoal($index, !g.done)" [id]="'goal' + $index" />
              <label class="title" [for]="'goal' + $index">{{ g.text }}</label>
            </div>
          }
        </div>
      }

      <h3 class="group">Rutinas <span class="muted">{{ habitsDone() }}/{{ habits().length }}</span></h3>
      <div class="card list">
        @for (h of habits(); track h.id) {
          <div class="item row" [class.done]="h.checked">
            <input type="checkbox" class="check big" [checked]="h.checked" (change)="toggleHabit(h)" [attr.aria-label]="h.title" [id]="'h' + h.id" />
            <i class="dot" [style.background]="h.color"></i>
            <label class="title truncate" [for]="'h' + h.id">{{ h.title }}</label>
            @if (h.target_time) { <span class="chip" title="Hora prevista"><app-icon [name]="h.remind ? 'bell' : 'clock'" [size]="11" />{{ h.target_time }}</span> }
            <span class="spacer"></span>
            @if (h.target_count > 1) {
              <span class="qty row" role="group" [attr.aria-label]="'Progreso de ' + h.title">
                <button class="btn ghost icon sm" (click)="step(h, -1)" [disabled]="h.count <= 0" aria-label="Uno menos">−</button>
                <span class="n" aria-live="polite"><strong>{{ h.count }}</strong>/{{ h.target_count }} {{ h.unit }}</span>
                <button class="btn ghost icon sm" (click)="step(h, 1)" aria-label="Uno más">+</button>
              </span>
            }
            @if (h.weekly_target) {
              <span class="chip" [class.met]="h.week_done >= h.weekly_target" title="Días cumplidos esta semana">{{ h.week_done }}/{{ h.weekly_target }} esta semana</span>
            }
            @if (h.streak > 1) { <span class="chip streak" [title]="h.weekly_target ? 'Racha de ' + h.streak + ' semanas cumpliendo el objetivo' : 'Racha de ' + h.streak + ' días programados seguidos'"><app-icon name="flame" [size]="12" />{{ h.streak }}{{ h.weekly_target ? ' sem' : '' }}</span> }
            @if (h.checked && h.checked_at) { <span class="muted when">a las {{ time(h.checked_at) }}</span> }
            <span class="chip xp" [class.got]="h.checked">+{{ h.xp }} XP</span>
          </div>
        } @empty {
          <p class="muted pad">{{ loaded() ? 'No hay rutinas para este día. Añade una abajo: aparecerá aquí cada día que le toque.' : 'Cargando…' }}</p>
        }
        @if (isToday()) {
          <form class="item row add" (ngSubmit)="quickHabit()">
            <app-icon name="plus" />
            <input name="habit" [(ngModel)]="newHabit" placeholder="Añadir rutina diaria (p. ej. «Leer 20 minutos»)" maxlength="200" aria-label="Añadir rutina diaria" />
          </form>
        }
      </div>

      <h3 class="group">Tareas de {{ isToday() ? 'hoy' : 'este día' }} <span class="muted">{{ tasksDone() }}/{{ dayTasks().length }}</span>
        <span class="spacer"></span><a class="plan" routerLink="/calendar" [queryParams]="{ view: 'day', day: day() }"><app-icon name="clock" [size]="13" /> Planificar por horas</a></h3>
      <div class="card list">
        @for (t of dayTasks(); track t.id) {
          <div class="item row" [class.done]="t.status === 'completed'" (click)="dialog.edit(t)" tabindex="0" (keydown.enter)="dialog.edit(t)">
            <input type="checkbox" class="check big" [checked]="t.status === 'completed'" [disabled]="!t.can_edit" (click)="$event.stopPropagation()" (change)="toggleTask(t)" [attr.aria-label]="'Completar ' + t.title" />
            <span class="title truncate">{{ t.title }}</span>
            @if (overdue(t)) { <span class="chip late"><app-icon name="alert" [size]="11" />atrasada</span> }
            @if (ttime(t)) { <span class="chip">{{ ttime(t) }}</span> }
            <span class="spacer"></span>
            <span class="chip">{{ difficulty[t.difficulty] }}</span>
            <span class="prio" [class]="t.priority">{{ priority[t.priority] }}</span>
          </div>
        } @empty { <p class="muted pad">Sin tareas con fecha para este día.</p> }
        @if (isToday()) {
          <form class="item row add" (ngSubmit)="quickTask()">
            <app-icon name="plus" />
            <input name="task" [(ngModel)]="newTask" placeholder="Añadir tarea para hoy" maxlength="200" aria-label="Añadir tarea para hoy" />
          </form>
        }
      </div>
    }

    <!-- ===== Estadísticas ===== -->
    @if (tab() === 'stats') {
      @if (stats(); as s) {
        @if (!s.habits.length) {
          <div class="empty card"><h3>Aún no hay rutinas</h3><p>Crea alguna en «Mi día» y aquí verás cuáles cumples y cuáles no.</p></div>
        } @else {
          <div class="row range" role="group" aria-label="Periodo">
            @for (d of ranges; track d) { <button class="btn sm" [class.active]="range() === d" (click)="range.set(d); loadStats()">{{ d }} días</button> }
          </div>
          <div class="tiles">
            <div class="card tile"><span>Cumplimiento</span><strong>{{ s.rate ?? 0 }}%</strong><small>{{ s.done }} de {{ s.scheduled }} checks</small></div>
            <div class="card tile"><span>Días completos</span><strong>{{ s.perfect_days }}</strong><small>todas las rutinas cumplidas</small></div>
            <div class="card tile"><span>Mejor racha</span><strong>{{ bestStreak() }}</strong><small>días programados seguidos</small></div>
            <div class="card tile"><span>Hora habitual</span><strong>{{ usualHour() }}</strong><small>a la que más marcas</small></div>
          </div>

          <div class="grid">
            <section class="card panel wide">
              <header class="row"><h2>Cumplimiento diario (% de rutinas cumplidas)</h2><span class="spacer"></span>
                <button class="btn ghost sm" (click)="table.set(!table())"><app-icon [name]="table() ? 'graph' : 'table'" [size]="14" /> {{ table() ? 'Ver gráfico' : 'Ver tabla' }}</button></header>
              @if (table()) {
                <div class="tbl"><table><thead><tr><th>Día</th><th>Cumplidas</th><th>Programadas</th><th>%</th></tr></thead>
                  <tbody>@for (d of dailyRows(); track d.date) { <tr><td>{{ d.date }}</td><td>{{ d.done }}</td><td>{{ d.scheduled }}</td><td>{{ d.pct }}</td></tr> }</tbody></table></div>
              } @else { <app-line-chart [labels]="dayLabels()" [series]="rateSeries()" label="Porcentaje de rutinas cumplidas cada día" /> }
            </section>

            <section class="card panel wide">
              <header class="row"><h2>Día a día: qué se cumplió y qué no</h2><span class="spacer"></span>
                <span class="legend"><i class="cell done"></i> cumplida <i class="cell partial"></i> a medias <i class="cell missed"></i> no cumplida <i class="cell pending"></i> pendiente <i class="cell off"></i> no tocaba o libre</span></header>
              <div class="heat">
                <table>
                  <thead><tr><th></th>@for (d of s.days; track d; let i = $index) { <th>{{ (s.days.length - 1 - i) % 5 === 0 ? dayNum(d) : '' }}</th> }</tr></thead>
                  <tbody>
                    @for (h of s.habits; track h.id) {
                      <tr><th class="truncate" [title]="h.title"><i class="dot" [style.background]="h.color"></i>{{ h.title }}</th>
                        @for (st of h.states; track $index) { <td><i class="cell" [class]="st" [title]="shortDay(s.days[$index]) + ': ' + stateLabel[st]"></i></td> }
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            </section>

            <section class="card panel wide">
              <header><h2>Por rutina</h2></header>
              <div class="tbl tall"><table>
                <thead><tr><th>Rutina</th><th>Cumplimiento</th><th>Racha</th><th>Mejor racha</th><th>Hora media</th><th>A tiempo</th></tr></thead>
                <tbody>
                  @for (h of s.habits; track h.id) {
                    <tr><td><i class="dot" [style.background]="h.color"></i> {{ h.title }}</td>
                      <td>{{ h.rate === null ? '—' : h.rate + '% (' + h.done + '/' + h.scheduled + (h.period === 'week' ? ' semanas' : '') + ')' }}</td>
                      <td>{{ h.streak }}{{ h.period === 'week' ? ' sem' : '' }}</td><td>{{ h.best_streak }}{{ h.period === 'week' ? ' sem' : '' }}</td>
                      <td>{{ h.avg_minute === null ? '—' : clock(h.avg_minute) }}</td>
                      <td [title]="h.target_time ? 'Marcada antes de las ' + h.target_time : 'Sin hora prevista'">{{ h.on_time_rate === null ? '—' : h.on_time_rate + '%' }}</td></tr>
                  }
                </tbody>
              </table></div>
            </section>

            <section class="card panel"><header><h2>Cumplimiento por día de la semana (%)</h2></header><app-bar-list [bars]="weekdayBars()" [progress]="true" [dots]="false" /></section>
            <section class="card panel"><header><h2>A qué hora las marcas (nº de checks)</h2></header>
              <app-column-chart [data]="hourData()" unit="checks" [tickCount]="8" label="Número de rutinas marcadas en cada hora del día" /></section>
          </div>
        }
      } @else { <div class="skeleton" style="height:300px"></div> }
    }

    <!-- ===== Gestionar rutinas ===== -->
    @if (tab() === 'manage') {
      <div class="row" style="margin-bottom:12px"><p class="muted">Cada rutina aparece en «Mi día» los días que elijas. La dificultad decide la experiencia que da.</p><span class="spacer"></span>
        <button class="btn primary" (click)="edit()"><app-icon name="plus" /> Nueva rutina</button></div>
      <div class="card list">
        @for (h of all(); track h.id) {
          <div class="item row" [class.arch]="h.is_archived">
            <i class="dot" [style.background]="h.color"></i><span class="title truncate">{{ h.title }}</span>
            @if (h.is_archived) { <span class="chip">Archivada</span> }
            <span class="spacer"></span>
            @if (h.weekly_target) { <span class="chip">{{ h.weekly_target }}× por semana</span> }
            @else { <span class="week" [attr.aria-label]="daysText(h)">@for (d of week; track $index) { <b [class.on]="h.days.includes('' + $index)">{{ d }}</b> }</span> }
            @if (h.target_count > 1) { <span class="chip">{{ h.target_count }} {{ h.unit }}</span> }
            @if (h.target_time) { <span class="chip"><app-icon name="clock" [size]="11" />{{ h.target_time }}</span> }
            <span class="chip">{{ difficulty[h.difficulty] }}</span>
            <button class="btn ghost icon sm" title="Editar rutina" (click)="edit(h)"><app-icon name="edit" /></button>
          </div>
        } @empty { <p class="muted pad">Aún no hay rutinas.</p> }
      </div>
    }
  </div>

  @if (editing(); as e) {
    <div class="backdrop" (click)="editing.set(null)">
      <form class="modal" (click)="$event.stopPropagation()" (ngSubmit)="save()">
        <h2>{{ e.id ? 'Editar rutina' : 'Nueva rutina' }}</h2>
        <label class="field">Nombre <input class="input" name="title" [(ngModel)]="e.title" required maxlength="200" /></label>
        <div class="field">Frecuencia
          <div class="row" role="radiogroup" aria-label="Frecuencia">
            <button type="button" class="btn sm" role="radio" [attr.aria-checked]="!e.weekly" [class.active]="!e.weekly" (click)="e.weekly = false">Días concretos</button>
            <button type="button" class="btn sm" role="radio" [attr.aria-checked]="e.weekly" [class.active]="e.weekly" (click)="e.weekly = true">Veces por semana</button>
          </div>
          @if (e.weekly) {
            <div class="row"><input class="input qtyin" type="number" name="weekly" min="1" max="7" [(ngModel)]="e.weekly_target" aria-label="Veces por semana" />
              <span class="muted">días a la semana, los que tú elijas</span></div>
          } @else {
            <div class="row daypick" role="group" aria-label="Días de la semana">
              @for (d of week; track $index) {
                <button type="button" [class.on]="e.days.includes('' + $index)" [attr.aria-pressed]="e.days.includes('' + $index)" [attr.aria-label]="weekName[$index]" (click)="toggleDay(e, $index)">{{ d }}</button>
              }
            </div>
          }
        </div>
        <div class="field">Cantidad diaria <span class="muted hint">(1 = un simple check)</span>
          <div class="row">
            <input class="input qtyin" type="number" name="count" min="1" max="1000" [(ngModel)]="e.target_count" aria-label="Cantidad objetivo" />
            <input class="input" name="unit" [(ngModel)]="e.unit" maxlength="20" placeholder="unidad: vasos, páginas, km…" aria-label="Unidad" [disabled]="e.target_count <= 1" />
          </div>
        </div>
        <div class="row two">
          <label class="field">Hora prevista (opcional) <input class="input" type="time" name="time" [(ngModel)]="e.target_time" /></label>
          <label class="field">Dificultad
            <select class="input" name="difficulty" [(ngModel)]="e.difficulty">@for (d of [1,2,3,4]; track d) { <option [ngValue]="d">{{ difficulty[d] }}</option> }</select></label>
        </div>
        <label class="row remind"><input type="checkbox" name="remind" [(ngModel)]="e.remind" [disabled]="!e.target_time" />
          Avisarme a la hora prevista si aún no la he hecho</label>
        <div class="field">Color
          <div class="row colors" role="radiogroup" aria-label="Color">
            @for (c of colors; track c) { <button type="button" role="radio" [attr.aria-checked]="e.color === c" [attr.aria-label]="c" [style.background]="c" [class.sel]="e.color === c" (click)="e.color = c"></button> }
          </div>
        </div>
        <div class="actions">
          @if (e.id) {
            <button type="button" class="btn danger" (click)="remove(e)">Eliminar</button>
            <button type="button" class="btn" (click)="archive(e)">{{ e.is_archived ? 'Reactivar' : 'Archivar' }}</button>
          }
          <span class="spacer"></span>
          <button type="button" class="btn" (click)="editing.set(null)">Cancelar</button>
          <button class="btn primary" [disabled]="!e.title.trim() || (!e.weekly && !e.days) || (e.weekly && !(e.weekly_target >= 1 && e.weekly_target <= 7)) || !(e.target_count >= 1)">Guardar</button>
        </div>
      </form>
    </div>
  }`,
  styles: [`
    .cap::first-letter { text-transform: uppercase; }
    .banner { padding: 12px 16px; gap: 12px; margin-bottom: 12px; color: var(--text); border-color: var(--accent); background: var(--accent-soft); &:hover { text-decoration: none; } span { font-size: 13.5px; } }
    .plan { font-weight: 400; font-size: 12.5px; display: inline-flex; gap: 4px; align-items: center; }
    .summary { padding: 14px 18px; gap: 16px; margin-bottom: 4px; strong { font-size: 20px; font-weight: 600; } }
    .group { margin: 18px 0 8px; display: flex; gap: 8px; align-items: baseline; font-size: 13px; color: var(--text-2); .muted { font-weight: 400; } }
    .list { overflow: hidden; }
    .item { padding: 0 14px; min-height: 48px; border-bottom: 1px solid var(--border); cursor: pointer; gap: 10px; &:last-child { border-bottom: none; } &:hover { background: var(--surface-2); }
      &.done .title { color: var(--text-3); text-decoration: line-through; } &.arch { opacity: .55; } }
    .check.big { width: 20px; height: 20px; &:checked::after { width: 10px; height: 5px; } &:disabled { opacity: .4; cursor: not-allowed; } }
    .title { flex: 0 1 auto; font-size: 15px; }
    .add { cursor: text; color: var(--text-3); input { flex: 1; border: none; background: none; outline: none; height: 46px; color: var(--text); } }
    .streak { color: var(--serious); } .late { color: var(--critical); } .when { font-size: 12px; white-space: nowrap; }
    .qty { gap: 2px; .n { font-size: 13px; font-variant-numeric: tabular-nums; min-width: 64px; text-align: center; color: var(--text-2); strong { color: var(--text); } } .btn { font-size: 16px; } }
    .met { background: color-mix(in srgb, var(--good) 18%, transparent); color: var(--text); }
    .qtyin { width: 90px; flex: none; } .hint { font-weight: 400; } .remind { font-size: 13px; color: var(--text-2); }
    label.title { cursor: pointer; }
    .xp { font-variant-numeric: tabular-nums; &.got { background: var(--accent-soft); color: var(--accent-text); } }
    .pad { padding: 14px; }
    .range { margin-bottom: 12px; }
    .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; }
    .tile { padding: 14px 16px; display: grid; gap: 2px; span { font-size: 12px; color: var(--text-2); } strong { font-size: 28px; font-weight: 600; line-height: 1.2; font-variant-numeric: tabular-nums; } small { color: var(--text-3); font-size: 12px; } }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 12px; }
    .panel { padding: 16px 18px; display: grid; gap: 14px; align-content: start; min-width: 0; }
    .wide { grid-column: 1 / -1; }
    .legend { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-2); flex-wrap: wrap; .cell { margin-left: 8px; } }
    /* Estado con forma además de color: relleno, borde, borde discontinuo y punto */
    .cell { display: inline-block; width: 14px; height: 14px; border-radius: 3px; vertical-align: middle; box-sizing: border-box;
      &.done { background: var(--good); } &.missed { border: 2px solid var(--critical); }
      &.pending { border: 2px dashed var(--text-3); } &.partial { background: linear-gradient(to top, var(--good) 50%, transparent 50%); border: 2px solid var(--good); }
      &.off, &.free { width: 4px; height: 4px; border-radius: 50%; background: var(--surface-3); margin: 5px; } }
    .heat { overflow-x: auto; table { border-collapse: separate; border-spacing: 2px; } th { font-size: 11px; font-weight: 400; color: var(--text-3); text-align: center; padding: 0; min-width: 14px; }
      tbody th { text-align: left; font-size: 13px; color: var(--text-2); max-width: 170px; padding-right: 10px; position: sticky; left: 0; background: var(--surface); .dot { display: inline-block; margin-right: 6px; } }
      td { padding: 0; line-height: 0; text-align: center; } }
    .tbl { max-height: 240px; overflow: auto; &.tall { max-height: none; } } .tbl table { width: 100%; border-collapse: collapse; font-size: 13px; font-variant-numeric: tabular-nums; }
    .tbl th, .tbl td { text-align: right; padding: 6px 10px; border-bottom: 1px solid var(--border); white-space: nowrap; } .tbl th:first-child, .tbl td:first-child { text-align: left; white-space: normal; }
    .tbl th { color: var(--text-3); font-weight: 500; position: sticky; top: 0; background: var(--surface); } .tbl .dot { display: inline-block; }
    .week { display: inline-flex; gap: 2px; b { width: 18px; height: 18px; border-radius: 4px; display: grid; place-content: center; font-size: 10px; font-weight: 500; color: var(--text-3); background: var(--surface-2); &.on { background: var(--accent-soft); color: var(--accent-text); } } }
    .daypick button { width: 34px; height: 34px; border-radius: 50%; border: 1px solid var(--border); background: var(--bg); color: var(--text-2); font-weight: 500; &.on { background: var(--accent); border-color: var(--accent); color: var(--on-accent); } }
    .two { align-items: end; .field { flex: 1; } }
    .colors button { width: 24px; height: 24px; border-radius: 50%; border: 2px solid transparent; &.sel { border-color: var(--text); box-shadow: 0 0 0 2px var(--surface) inset; } }
    .actions { display: flex; }
    @media (max-width: 900px) { .grid { grid-template-columns: minmax(0, 1fr); } }
    @media (max-width: 700px) { .item .prio, .item .when, .item .week { display: none; } }
  `],
})
export class TodayComponent implements OnInit {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  private route = inject(ActivatedRoute);
  dialog = inject(TaskDialogService);

  difficulty = DIFFICULTY_LABEL; priority = PRIORITY_LABEL; week = WEEKDAY_SHORT; weekName = WEEKDAY_NAME;
  colors = COLORS; stateLabel = STATE_LABEL; clock = clock; overdue = isOverdue; ttime = taskTime;
  ranges = [14, 30, 90];
  todayStr = today();
  minDay = addDays(this.todayStr, -7);

  tab = signal<'day' | 'stats' | 'manage'>('day');
  day = signal(this.todayStr);
  habits = signal<HabitDayItem[]>([]);
  tasks = signal<Task[]>([]);
  all = signal<Habit[]>([]);
  stats = signal<HabitStats | null>(null);
  range = signal(30);
  table = signal(false);
  loaded = signal(false);
  editing = signal<{ id?: number; title: string; days: string; target_time: string; difficulty: number; color: string; is_archived?: boolean;
    weekly: boolean; weekly_target: number; target_count: number; unit: string; remind: boolean } | null>(null);
  newHabit = '';
  info = signal<ReviewToday | null>(null);
  goalsDone = computed(() => this.info()?.goals.filter(g => g.done).length ?? 0);
  newTask = '';

  isToday = computed(() => this.day() === this.todayStr);
  dayLabel = computed(() => LONG.format(parseDay(this.day())));
  /** Tareas del día; hoy incluye también las atrasadas que siguen abiertas. */
  dayTasks = computed(() => {
    const d = this.day(), isToday = this.isToday();
    return this.tasks().filter(t => {
      const td = taskDay(t);
      if (!td || t.status === 'archived') return false;
      return td === d || (isToday && td < d && t.status !== 'completed');
    }).sort((a, b) => Number(a.status === 'completed') - Number(b.status === 'completed') || (a.due_date ?? '').localeCompare(b.due_date ?? ''));
  });
  habitsDone = computed(() => this.habits().filter(h => h.checked).length);
  tasksDone = computed(() => this.dayTasks().filter(t => t.status === 'completed').length);
  total = computed(() => this.habits().length + this.dayTasks().length);
  done = computed(() => this.habitsDone() + this.tasksDone());

  // ---- Estadísticas ----
  dayLabels = computed(() => this.stats()!.days.map(d => SHORT.format(parseDay(d))));
  rateSeries = computed<Series[]>(() => [{ name: '% cumplido', color: 'var(--series-1)', values: this.stats()!.daily.map(d => (d.scheduled ? Math.round((100 * d.done) / d.scheduled) : 0)) }]);
  dailyRows = computed(() => [...this.stats()!.daily].reverse().map(d => ({ ...d, pct: d.scheduled ? Math.round((100 * d.done) / d.scheduled) + '%' : '—' })));
  weekdayBars = computed<Bar[]>(() => this.stats()!.weekday.map((r, i) => ({ label: WEEKDAY_NAME[i], value: r ?? 0, total: 100, hint: r === null ? 'Sin rutinas programadas ese día' : `${r}% cumplido` })));
  hourData = computed(() => ({ labels: Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`), values: this.stats()!.hours }));
  bestStreak = computed(() => Math.max(0, ...this.stats()!.habits.map(h => h.best_streak)));
  usualHour = computed(() => {
    const hours = this.stats()!.hours, max = Math.max(...hours);
    return max ? `${String(hours.indexOf(max)).padStart(2, '0')}:00` : '—';
  });

  constructor() {
    this.api.tasksChanged.pipe(takeUntilDestroyed()).subscribe(() => this.loadTasks());
    const tab = this.route.snapshot.queryParamMap.get('tab');
    if (tab === 'stats' || tab === 'manage') this.tab.set(tab);
  }
  ngOnInit() { this.loadDay(); this.loadTasks(); this.api.reviewToday().subscribe({ next: i => this.info.set(i), error: () => {} }); if (this.tab() !== 'day') this.setTab(this.tab()); }

  time = (iso: string) => new Date(iso).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  dayNum = (d: string) => parseDay(d).getDate();
  shortDay = (d: string) => SHORT.format(parseDay(d));
  daysText = (h: Habit) => (h.days.length === 7 ? 'Todos los días' : [...h.days].map(d => WEEKDAY_NAME[Number(d)]).join(', '));

  setTab(t: 'day' | 'stats' | 'manage') {
    this.tab.set(t);
    if (t === 'stats') this.loadStats();
    if (t === 'manage') this.loadAll();
    if (t === 'day') this.loadDay();
  }
  shift(n: number) { this.day.set(addDays(this.day(), n)); this.loadDay(); }

  loadDay() {
    this.api.habitsOfDay(this.day()).subscribe({
      next: h => { this.habits.set(h); this.loaded.set(true); },
      error: e => { this.loaded.set(true); this.toast.error(e, 'No se pudieron cargar las rutinas'); },
    });
  }
  private loadTasks() { this.api.tasks().subscribe({ next: t => this.tasks.set(t), error: () => {} }); }
  loadStats() { this.api.habitStats(this.range()).subscribe({ next: s => this.stats.set(s), error: e => this.toast.error(e) }); }
  private loadAll() { this.api.habits(true).subscribe({ next: h => this.all.set(h), error: e => this.toast.error(e) }); }

  toggleHabit(h: HabitDayItem) {
    const checked = !h.checked;
    this.habits.update(l => l.map(x => (x.id === h.id ? { ...x, checked, count: checked ? x.target_count : 0 } : x)));  // optimista
    this.api.checkHabit(h.id, this.day(), checked).subscribe({
      next: r => this.habits.update(l => l.map(x => (x.id === h.id ? r.item : x))),
      error: e => { this.toast.error(e); this.loadDay(); },
    });
  }
  toggleTask(t: Task) {
    const status = t.status === 'completed' ? 'todo' : 'completed';
    this.tasks.update(l => l.map(x => (x.id === t.id ? { ...x, status } : x)));
    this.api.updateTask(t.id, { status }).subscribe({ error: e => { this.toast.error(e); this.loadTasks(); } });
  }
  toggleGoal(index: number, done: boolean) {
    const i = this.info()!;
    this.info.set({ ...i, goals: i.goals.map((g, k) => (k === index ? { ...g, done } : g)) });
    this.api.toggleGoal(i.goals_week, index, done).subscribe({ error: e => this.toast.error(e) });
  }

  /** Suma o resta uno en una rutina con cantidad. */
  step(h: HabitDayItem, delta: number) {
    const count = Math.max(0, h.count + delta);
    this.habits.update(l => l.map(x => (x.id === h.id ? { ...x, count, checked: count >= x.target_count } : x)));
    this.api.habitCount(h.id, this.day(), count).subscribe({
      next: r => this.habits.update(l => l.map(x => (x.id === h.id ? r.item : x))),
      error: e => { this.toast.error(e); this.loadDay(); },
    });
  }

  quickHabit() {
    const title = this.newHabit.trim();
    if (!title) return;
    this.newHabit = '';
    this.api.createHabit({ title }).subscribe({ next: () => this.loadDay(), error: e => { this.newHabit = title; this.toast.error(e); } });
  }
  quickTask() {
    const title = this.newTask.trim();
    if (!title) return;
    this.newTask = '';
    this.api.createTask({ title, ...toDue(this.todayStr, '') }).subscribe({ error: e => { this.newTask = title; this.toast.error(e); } });
  }

  // ---- Gestión ----
  edit(h?: Habit) {
    this.editing.set(h ? { id: h.id, title: h.title, days: h.days, target_time: h.target_time ?? '', difficulty: h.difficulty, color: h.color, is_archived: h.is_archived,
        weekly: !!h.weekly_target, weekly_target: h.weekly_target ?? 3, target_count: h.target_count, unit: h.unit, remind: h.remind }
      : { title: '', days: '0123456', target_time: '', difficulty: 2, color: COLORS[0], weekly: false, weekly_target: 3, target_count: 1, unit: '', remind: false });
    setTimeout(() => document.querySelector<HTMLInputElement>('.modal input')?.focus());
  }
  toggleDay(e: { days: string }, i: number) {
    const d = String(i);
    e.days = e.days.includes(d) ? e.days.replace(d, '') : [...e.days, d].sort().join('');
  }
  save() {
    const e = this.editing()!;
    const count = Math.max(1, Math.round(Number(e.target_count) || 1));
    const data: HabitInput = { title: e.title.trim(), days: e.days || '0123456', target_time: e.target_time || null, difficulty: e.difficulty, color: e.color,
      weekly_target: e.weekly ? Number(e.weekly_target) : null, target_count: count, unit: count > 1 ? e.unit.trim() : '', remind: !!e.target_time && e.remind };
    (e.id ? this.api.updateHabit(e.id, data) : this.api.createHabit(data)).subscribe({
      next: () => { this.editing.set(null); this.loadAll(); this.loadDay(); }, error: err => this.toast.error(err, 'No se pudo guardar la rutina'),
    });
  }
  archive(e: { id?: number; is_archived?: boolean }) {
    this.api.updateHabit(e.id!, { is_archived: !e.is_archived }).subscribe({ next: () => { this.editing.set(null); this.loadAll(); }, error: err => this.toast.error(err) });
  }
  remove(e: { id?: number; title: string }) {
    if (!confirm(`¿Eliminar la rutina «${e.title}» y todo su historial? La experiencia ganada se conserva. Si solo quieres dejar de verla, archívala.`)) return;
    this.api.deleteHabit(e.id!).subscribe({ next: () => { this.editing.set(null); this.loadAll(); }, error: err => this.toast.error(err) });
  }
}
