import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { BOARD_STATUSES, PRIORITY_LABEL, RECURRENCE_LABEL, Project, STATUS_LABEL, Status, Task } from '../core/models';
import { ToastService } from '../core/toast.service';
import { formatDay, isOverdue, taskDay } from '../core/util';
import { IconComponent } from '../shared/icon.component';
import { TaskDialogService } from '../shared/task-dialog.service';

@Component({
  selector: 'app-kanban',
  standalone: true,
  imports: [FormsModule, IconComponent],
  template: `
  <div class="page board-page">
    <div class="page-head">
      <div><h1>Tablero</h1><p>Arrastra las tarjetas entre columnas para cambiar su estado.</p></div>
      <span class="spacer"></span>
      <select class="input" style="width:auto" [ngModel]="project()" (ngModelChange)="project.set($event)" aria-label="Proyecto">
        <option [ngValue]="null">Todos los proyectos</option>
        @for (p of projects(); track p.id) { <option [ngValue]="p.id">{{ p.name }}</option> }
      </select>
    </div>

    <div class="board">
      @for (col of columns(); track col.status) {
        <section class="col" [class.over]="over()?.status === col.status"
                 (dragover)="onDragOver($event, col.status, col.tasks.length)" (drop)="onDrop($event)" (dragleave)="onLeave($event)">
          <header class="row">
            <h3>{{ label[col.status] }}</h3><span class="muted">{{ col.tasks.length }}</span><span class="spacer"></span>
            <button class="btn ghost icon sm" [title]="'Nueva tarea en ' + label[col.status]" (click)="dialog.create({ status: col.status, project_id: project() })"><app-icon name="plus" /></button>
          </header>
          <div class="cards">
            @for (t of col.tasks; track t.id; let i = $index) {
              @if (over()?.status === col.status && over()?.index === i) { <div class="slot"></div> }
              <article class="card kcard" [attr.draggable]="t.can_edit" [class.dragging]="dragging()?.id === t.id" tabindex="0"
                       (dragstart)="onDragStart($event, t)" (dragend)="onDragEnd()"
                       (dragover)="onDragOver($event, col.status, i, true)" (click)="dialog.edit(t)" (keydown.enter)="dialog.edit(t)">
                <p class="title">{{ t.title }} @if (t.pending) { <span class="chip" title="Creada sin conexión; se enviará al reconectar">pendiente</span> }</p>
                <div class="meta row">
                  <span class="prio" [class]="t.priority">{{ prio[t.priority] }}</span>
                  @if (t.assignee_name) { <span class="chip" [title]="'Responsable: ' + t.assignee_name"><app-icon name="users" [size]="11" />{{ t.assignee_name }}</span> }
                  @if (projectOf(t); as p) { <span class="chip"><i class="dot" [style.background]="p.color"></i>{{ p.name }}</span> }
                  @if (t.recurrence !== 'none') { <span class="chip" [title]="'Se repite: ' + rec[t.recurrence]"><app-icon name="repeat" [size]="11" /></span> }
                @if (t.reminder_minutes !== null && t.reminder_minutes !== undefined) { <span class="chip" title="Con recordatorio"><app-icon name="bell" [size]="11" /></span> }
                @if (t.subtasks.length) { <span class="chip">{{ subDone(t) }}/{{ t.subtasks.length }}</span> }
                  @if (day(t); as d) { <span class="chip" [class.late]="overdue(t)">@if (overdue(t)) { <app-icon name="alert" [size]="11" /> }{{ fmt(d) }}</span> }
                </div>
              </article>
            }
            @if (over()?.status === col.status && over()?.index === col.tasks.length) { <div class="slot"></div> }
            @if (!col.tasks.length && over()?.status !== col.status) { <p class="muted none">Sin tareas</p> }
          </div>
        </section>
      }
    </div>
  </div>`,
  styles: [`
    .board-page { max-width: none; display: flex; flex-direction: column; height: 100%; padding-bottom: 16px; }
    .board { display: grid; grid-template-columns: repeat(4, minmax(240px, 1fr)); gap: 12px; flex: 1; min-height: 0; overflow-x: auto; }
    .col { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); display: flex; flex-direction: column; min-height: 200px; max-height: 100%;
      &.over { border-color: var(--accent); }
      header { padding: 10px 10px 6px 14px; } }
    .cards { padding: 4px 8px 10px; display: grid; gap: 8px; align-content: start; overflow-y: auto; flex: 1; }
    .kcard { padding: 10px 12px; cursor: grab; background: var(--surface-2); display: grid; gap: 8px; &:hover { border-color: var(--text-3); } &.dragging { opacity: .35; } }
    .title { font-weight: 500; overflow-wrap: anywhere; }
    .meta { flex-wrap: wrap; gap: 6px; } .late { color: var(--critical); }
    .slot { height: 36px; border: 1.5px dashed var(--accent); border-radius: var(--radius); background: var(--accent-soft); }
    .none { text-align: center; padding: 18px 0; font-size: 13px; }
  `],
})
export class KanbanComponent implements OnInit {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  dialog = inject(TaskDialogService);
  label = STATUS_LABEL; prio = PRIORITY_LABEL;
  rec = RECURRENCE_LABEL;
  fmt = formatDay; day = taskDay; overdue = isOverdue;

  tasks = signal<Task[]>([]);
  projects = signal<Project[]>([]);
  project = signal<number | null>(null);
  dragging = signal<Task | null>(null);
  over = signal<{ status: Status; index: number } | null>(null);

  private projectMap = computed(() => new Map(this.projects().map(p => [p.id, p])));
  projectOf = (t: Task) => (t.project_id ? this.projectMap().get(t.project_id) : undefined);
  subDone = (t: Task) => t.subtasks.filter(s => s.status === 'completed').length;

  columns = computed(() => {
    const pj = this.project();
    const list = this.tasks().filter(t => pj === null || t.project_id === pj);
    return BOARD_STATUSES.map(status => ({ status, tasks: list.filter(t => t.status === status).sort((a, b) => a.position - b.position) }));
  });

  constructor() { this.api.tasksChanged.pipe(takeUntilDestroyed()).subscribe(() => this.load()); }
  ngOnInit() { this.load(); this.api.projects().subscribe(p => this.projects.set(p)); }
  private load() { this.api.tasks().subscribe({ next: t => this.tasks.set(t), error: e => this.toast.error(e) }); }

  onDragStart(e: DragEvent, t: Task) {
    if (!t.can_edit) { e.preventDefault(); return; }
    e.dataTransfer?.setData('text/plain', String(t.id));
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => this.dragging.set(t));  // tras capturar la imagen de arrastre
  }
  onDragEnd() { this.dragging.set(null); this.over.set(null); }

  onDragOver(e: DragEvent, status: Status, index: number, onCard = false) {
    if (!this.dragging()) return;
    e.preventDefault();
    e.stopPropagation();
    if (onCard) {
      // Mitad superior: antes de la tarjeta; inferior: después
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      if (e.clientY > r.top + r.height / 2) index++;
    }
    const o = this.over();
    if (!o || o.status !== status || o.index !== index) this.over.set({ status, index });
  }
  onLeave(e: DragEvent) {
    const to = e.relatedTarget as Node | null;
    if (!to || !(e.currentTarget as HTMLElement).contains(to)) this.over.set(null);
  }

  onDrop(e: DragEvent) {
    e.preventDefault();
    const t = this.dragging(), o = this.over();
    this.onDragEnd();
    if (!t || !o) return;
    const col = this.columns().find(c => c.status === o.status)!.tasks;
    const from = col.findIndex(x => x.id === t.id);
    let index = o.index;
    if (from >= 0 && from < index) index--;  // la tarjeta sale de su hueco antes de insertarse
    if (from === index) return;

    // Optimista: se recoloca en local. La posición enviada es relativa a la columna completa (sin filtro de proyecto).
    const next = col.filter(x => x.id !== t.id);
    next.splice(index, 0, { ...t, status: o.status });
    const full = this.tasks().filter(x => x.status === o.status && x.id !== t.id).sort((a, b) => a.position - b.position);
    const anchor = next[index + 1];
    const serverIndex = anchor ? full.findIndex(x => x.id === anchor.id) : full.length;
    const pos = new Map(next.map((x, i) => [x.id, i]));
    this.tasks.update(all => all.map(x => (pos.has(x.id) ? { ...x, status: o.status, position: pos.get(x.id)! } : x)));
    this.api.moveTask(t.id, o.status, serverIndex).subscribe({ next: () => this.load(), error: err => { this.toast.error(err); this.load(); } });
  }
}
