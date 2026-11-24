import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../core/api.service';
import { DIFFICULTY_LABEL, Goal, ProjectTemplate, TemplateTask } from '../core/models';
import { ToastService } from '../core/toast.service';
import { addDays, formatDay, today } from '../core/util';
import { IconComponent } from './icon.component';

const COLORS = ['#7c5cff', '#2a78d6', '#1baf7a', '#eda100', '#eb6834', '#e34948', '#e87ba4', '#6b7280'];
type Mode = 'pick' | 'apply' | 'edit';
interface Row { title: string; offset: number | null; difficulty: number; subtasks: string; src?: TemplateTask; }

function spanLabel(t: ProjectTemplate): string {
  const tasks = `${t.task_count} ${t.task_count === 1 ? 'tarea' : 'tareas'}`;
  if (t.span_days === null) return tasks;
  const weeks = Math.round(t.span_days / 7);
  return `${tasks} · ${t.span_days < 14 ? t.span_days + ' días' : weeks + ' semanas'}`;
}

/** Diálogo de plantillas de proyecto: elegir y aplicar, y crear o editar las propias. */
@Component({
  selector: 'app-project-templates',
  standalone: true,
  imports: [FormsModule, IconComponent],
  template: `
  <div class="backdrop" (click)="closed.emit()">
    <div class="modal tpl" role="dialog" aria-label="Plantillas de proyecto" (click)="$event.stopPropagation()">
      @switch (mode()) {
        @case ('pick') {
          <div class="row head"><h2>Plantillas de proyecto</h2><span class="spacer"></span>
            <button class="btn sm" (click)="edit()"><app-icon name="plus" [size]="14" /> Nueva plantilla</button></div>
          <p class="muted small">Un proyecto con sus tareas ya hechas. Las fechas se colocan a partir del día que elijas.</p>
          @if (data(); as d) {
            @if (d.mine.length) {
              <h3>Tus plantillas</h3>
              <ul class="list">
                @for (t of d.mine; track t.id) {
                  <li class="row">
                    <button class="pick grow" (click)="choose(t)"><i class="dot" [style.background]="t.color"></i>
                      <span><strong>{{ t.name }}</strong><small class="muted">{{ span(t) }}</small></span></button>
                    <button class="btn ghost icon sm" (click)="edit(t)" [attr.aria-label]="'Editar ' + t.name"><app-icon name="edit" /></button>
                    <button class="btn ghost icon sm danger" (click)="remove(t)" [attr.aria-label]="'Eliminar ' + t.name"><app-icon name="trash" /></button>
                  </li>
                }
              </ul>
            }
            <h3>Ejemplos</h3>
            <ul class="list">
              @for (t of d.examples; track t.key) {
                <li class="row"><button class="pick grow" (click)="choose(t)"><i class="dot" [style.background]="t.color"></i>
                  <span><strong>{{ t.name }}</strong><small class="muted">{{ span(t) }}</small></span></button></li>
              }
            </ul>
          } @else { <div class="skeleton" style="height:160px"></div> }
          <div class="actions"><button class="btn" (click)="closed.emit()">Cerrar</button></div>
        }

        @case ('apply') {
          @if (chosen(); as t) {
            <div class="row head"><button class="btn ghost icon sm" (click)="mode.set('pick')" aria-label="Volver"><app-icon name="left" /></button>
              <h2>{{ t.name }}</h2></div>
            @if (t.description) { <p class="muted small">{{ t.description }}</p> }
            <label class="field">Nombre del proyecto <input class="input" name="pname" [(ngModel)]="projectName" maxlength="100" /></label>
            <div class="row two">
              <label class="field">Día de inicio <input class="input" type="date" name="start" [(ngModel)]="start" /></label>
              @if (goals().length) {
                <label class="field">Objetivo (opcional)
                  <select class="input" name="goal" [(ngModel)]="goalId">
                    <option [ngValue]="null">Ninguno</option>
                    @for (g of goals(); track g.id) { <option [ngValue]="g.id">{{ g.title }}</option> }
                  </select></label>
              }
            </div>
            <ol class="preview">
              @for (task of t.tasks; track $index) {
                <li><span class="when">{{ when(task) }}</span><span class="grow">{{ task.title }}
                  @if (task.subtasks.length) { <small class="muted">· {{ task.subtasks.length }} subtareas</small> }</span></li>
              }
            </ol>
            <div class="actions">
              @if (!t.id) { <button class="btn" (click)="copy(t)" [disabled]="busy()">Hacer una copia editable</button> }
              <span class="spacer"></span>
              <button class="btn primary" (click)="apply(t)" [disabled]="busy() || !projectName.trim() || !start">Crear proyecto</button>
            </div>
          }
        }

        @case ('edit') {
          <div class="row head"><button class="btn ghost icon sm" (click)="mode.set('pick')" aria-label="Volver"><app-icon name="left" /></button>
            <h2>{{ editId ? 'Editar plantilla' : 'Nueva plantilla' }}</h2></div>
          <label class="field">Nombre <input class="input" name="tname" [(ngModel)]="form.name" maxlength="100" required /></label>
          <label class="field">Descripción <input class="input" name="tdesc" [(ngModel)]="form.description" maxlength="2000" placeholder="Por ejemplo: el día de inicio es el del examen" /></label>
          <div class="row colors" role="radiogroup" aria-label="Color">
            @for (c of colors; track c) {
              <button type="button" role="radio" [attr.aria-checked]="form.color === c" [attr.aria-label]="c" [style.background]="c" [class.sel]="form.color === c" (click)="form.color = c"></button>
            }
          </div>
          <p class="muted small">«Día» cuenta desde el inicio del proyecto: 0 es el primer día, 7 una semana después y −3 tres días antes. Vacío, sin fecha.</p>
          <div class="rows">
            @for (r of rows(); track $index; let i = $index) {
              <div class="trow">
                <input class="input" [(ngModel)]="r.title" [name]="'t' + i" placeholder="Tarea" maxlength="200" [attr.aria-label]="'Tarea ' + (i + 1)" />
                <input class="input day" type="number" [(ngModel)]="r.offset" [name]="'o' + i" placeholder="Día" min="-365" max="730" [attr.aria-label]="'Día de la tarea ' + (i + 1)" />
                <select class="input diff" [(ngModel)]="r.difficulty" [name]="'d' + i" [attr.aria-label]="'Dificultad de la tarea ' + (i + 1)">
                  @for (d of diffs; track d) { <option [ngValue]="d">{{ diffLabel[d] }}</option> }
                </select>
                <button type="button" class="btn ghost icon sm" (click)="removeRow(i)" [attr.aria-label]="'Quitar la tarea ' + (i + 1)"><app-icon name="x" /></button>
                <input class="input subs" [(ngModel)]="r.subtasks" [name]="'s' + i" placeholder="Subtareas separadas por ;" maxlength="2000" [attr.aria-label]="'Subtareas de la tarea ' + (i + 1)" />
              </div>
            }
          </div>
          <button type="button" class="btn sm add" (click)="addRow()"><app-icon name="plus" [size]="14" /> Añadir tarea</button>
          <div class="actions">
            <span class="spacer"></span>
            <button class="btn" (click)="mode.set('pick')">Cancelar</button>
            <button class="btn primary" (click)="saveTemplate()" [disabled]="busy() || !form.name.trim()">Guardar plantilla</button>
          </div>
        }
      }
    </div>
  </div>`,
  styles: [`
    .tpl { max-width: 620px; max-height: 84vh; overflow-y: auto; }
    .head { gap: 8px; align-items: center; h2 { margin: 0; } }
    h3 { margin: 4px 0 -6px; font-size: 13px; color: var(--text-2); font-weight: 600; }
    .small { font-size: 12.5px; margin: 0; }
    .list { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; li { gap: 4px; } }
    .pick { display: flex; gap: 10px; align-items: center; text-align: left; padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--radius-sm);
      background: var(--surface); color: var(--text); cursor: pointer; font: inherit;
      &:hover { border-color: var(--text-3); background: var(--surface-2); }
      span { display: grid; } small { font-size: 12px; } }
    .grow { flex: 1; min-width: 0; }
    .dot { width: 10px; height: 10px; border-radius: 50%; flex: none; display: inline-block; }
    .two { gap: 12px; align-items: flex-end; flex-wrap: wrap; .field { flex: 1; min-width: 160px; } }
    .preview { margin: 0; padding: 0; list-style: none; display: grid; gap: 2px; font-size: 13px; max-height: 260px; overflow-y: auto;
      li { display: flex; gap: 10px; padding: 4px 2px; border-bottom: 1px solid var(--border); } }
    .when { width: 96px; flex: none; white-space: nowrap; color: var(--text-2); font-variant-numeric: tabular-nums; }
    .colors { gap: 6px; button { width: 22px; height: 22px; border-radius: 50%; border: 2px solid transparent; padding: 0; cursor: pointer;
      &.sel { border-color: var(--text); box-shadow: 0 0 0 2px var(--surface) inset; } } }
    .rows { display: grid; gap: 10px; }
    .trow { display: grid; grid-template-columns: 1fr 72px 100px auto; gap: 6px; align-items: center;
      .subs { grid-column: 1 / 4; font-size: 12.5px; } }
    .add { justify-self: start; }
    .actions { display: flex; gap: 8px; align-items: center; }
    @media (max-width: 520px) { .trow { grid-template-columns: 1fr 64px auto; .diff { grid-column: 1 / 3; grid-row: 2; } .subs { grid-column: 1 / -1; } } }
  `],
})
export class ProjectTemplatesComponent implements OnInit {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  private router = inject(Router);

  /** Abre directamente la edición de esta plantilla (p. ej. recién guardada desde un proyecto). */
  readonly editTemplate = input<ProjectTemplate | null>(null);
  readonly closed = output<void>();

  colors = COLORS; diffLabel = DIFFICULTY_LABEL; diffs = [1, 2, 3, 4]; span = spanLabel;
  mode = signal<Mode>('pick');
  data = signal<{ mine: ProjectTemplate[]; examples: ProjectTemplate[] } | null>(null);
  goals = signal<Goal[]>([]);
  chosen = signal<ProjectTemplate | null>(null);
  busy = signal(false);
  rows = signal<Row[]>([]);
  projectName = ''; start = today(); goalId: number | null = null;
  form = { name: '', description: '', color: COLORS[0] };
  editId: number | null = null;

  ngOnInit() {
    this.load();
    this.api.goals().subscribe({ next: g => this.goals.set(g), error: () => {} });
    const t = this.editTemplate();
    if (t) this.edit(t);
  }

  private load() { this.api.projectTemplates().subscribe({ next: d => this.data.set(d), error: e => this.toast.error(e) }); }

  choose(t: ProjectTemplate) { this.chosen.set(t); this.projectName = t.name; this.start = today(); this.goalId = null; this.mode.set('apply'); }

  when(task: TemplateTask): string {
    if (task.offset_days === null) return 'Sin fecha';
    return this.start ? formatDay(addDays(this.start, task.offset_days)) : `Día ${task.offset_days}`;
  }

  apply(t: ProjectTemplate) {
    this.busy.set(true);
    const ref = t.id !== null ? { template_id: t.id } : { example: t.key! };
    this.api.applyProjectTemplate({ ...ref, name: this.projectName.trim(), start: this.start, goal_id: this.goalId }).subscribe({
      next: r => {
        this.busy.set(false);
        this.toast.success(`Proyecto «${r.project.name}» creado con ${r.tasks_created} tareas`);
        this.closed.emit();
        this.router.navigate(['/tasks'], { queryParams: { project: r.project.id } });
      },
      error: e => { this.busy.set(false); this.toast.error(e, 'No se pudo crear el proyecto'); },
    });
  }

  copy(t: ProjectTemplate) {
    this.busy.set(true);
    this.api.createProjectTemplate({ name: t.name, description: t.description, color: t.color, tasks: t.tasks }).subscribe({
      next: c => { this.busy.set(false); this.toast.success('Copia guardada en tus plantillas'); this.load(); this.edit(c); },
      error: e => { this.busy.set(false); this.toast.error(e); },
    });
  }

  edit(t?: ProjectTemplate) {
    this.editId = t?.id ?? null;
    this.form = { name: t?.name ?? '', description: t?.description ?? '', color: t?.color ?? COLORS[0] };
    this.rows.set(t?.tasks.length
      ? t.tasks.map(x => ({ title: x.title, offset: x.offset_days, difficulty: x.difficulty, subtasks: x.subtasks.join('; '), src: x }))
      : [{ title: '', offset: 0, difficulty: 2, subtasks: '' }]);
    this.mode.set('edit');
  }
  addRow() {
    const last = this.rows().at(-1);
    this.rows.update(r => [...r, { title: '', offset: last?.offset ?? 0, difficulty: 2, subtasks: '' }]);
    setTimeout(() => document.querySelector<HTMLInputElement>('.trow:last-child input')?.focus());
  }
  removeRow(i: number) { this.rows.update(r => r.filter((_, k) => k !== i)); }

  saveTemplate() {
    const tasks: TemplateTask[] = this.rows().filter(r => r.title.trim()).map(r => ({
      ...(r.src ?? { priority: 'medium', estimated_minutes: null, description: null }),
      title: r.title.trim(),
      offset_days: r.offset === null || (r.offset as unknown) === '' ? null : Math.round(Number(r.offset)),
      difficulty: r.difficulty,
      subtasks: r.subtasks.split(';').map(s => s.trim()).filter(Boolean),
    }) as TemplateTask);
    const data = { name: this.form.name.trim(), description: this.form.description.trim() || null, color: this.form.color, tasks };
    this.busy.set(true);
    (this.editId ? this.api.updateProjectTemplate(this.editId, data) : this.api.createProjectTemplate(data)).subscribe({
      next: () => { this.busy.set(false); this.toast.success('Plantilla guardada'); this.load(); this.mode.set('pick'); },
      error: e => { this.busy.set(false); this.toast.error(e, 'No se pudo guardar la plantilla'); },
    });
  }

  remove(t: ProjectTemplate) {
    if (!confirm(`¿Eliminar la plantilla «${t.name}»? Los proyectos creados con ella no cambian.`)) return;
    this.api.deleteProjectTemplate(t.id!).subscribe({ next: () => this.load(), error: e => this.toast.error(e) });
  }
}
