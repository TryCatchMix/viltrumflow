import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { Project } from '../core/models';
import { ToastService } from '../core/toast.service';
import { IconComponent } from '../shared/icon.component';

const COLORS = ['#7c5cff', '#2a78d6', '#1baf7a', '#eda100', '#eb6834', '#e34948', '#e87ba4', '#6b7280'];

@Component({
  selector: 'app-projects',
  standalone: true,
  imports: [FormsModule, RouterLink, IconComponent],
  template: `
  <div class="page">
    <div class="page-head">
      <div><h1>Proyectos</h1><p>Agrupa tus tareas y sigue su avance.</p></div>
      <span class="spacer"></span>
      <label class="row muted"><input type="checkbox" [ngModel]="archived()" (ngModelChange)="archived.set($event); load()" /> Mostrar archivados</label>
      <button class="btn primary" (click)="open()"><app-icon name="plus" /> Nuevo proyecto</button>
    </div>

    <div class="grid">
      @for (p of projects(); track p.id) {
        <article class="card proj" [class.arch]="p.is_archived">
          <header class="row">
            <i class="dot" [style.background]="p.color"></i><h2 class="truncate">{{ p.name }}</h2>
            @if (p.is_archived) { <span class="chip">Archivado</span> }
            <span class="spacer"></span>
            <button class="btn ghost icon sm" title="Editar" (click)="open(p)"><app-icon name="edit" /></button>
          </header>
          <p class="muted desc">{{ p.description || 'Sin descripción' }}</p>
          <div class="progress" role="progressbar" [attr.aria-valuenow]="pct(p)" aria-valuemin="0" aria-valuemax="100" [attr.aria-label]="'Avance de ' + p.name">
            <span [style.width.%]="pct(p)" [style.background]="p.color"></span>
          </div>
          <footer class="row"><span class="muted">{{ p.completed_tasks }} de {{ p.total_tasks }} tareas · {{ pct(p) }}%</span><span class="spacer"></span>
            <a [routerLink]="['/tasks']" [queryParams]="{ project: p.id }">Ver tareas</a></footer>
        </article>
      } @empty {
        @if (loaded()) {
          <div class="empty card full"><h3>Aún no hay proyectos</h3><p>Crea uno para organizar tus tareas.</p><button class="btn primary" (click)="open()">Nuevo proyecto</button></div>
        }
      }
    </div>
  </div>

  @if (editing(); as e) {
    <div class="backdrop" (click)="editing.set(null)">
      <form class="modal" (click)="$event.stopPropagation()" (ngSubmit)="save()">
        <h2>{{ e.id ? 'Editar proyecto' : 'Nuevo proyecto' }}</h2>
        <label class="field">Nombre <input class="input" name="name" [(ngModel)]="e.name" required maxlength="100" #nameInput /></label>
        <label class="field">Descripción <textarea class="input" name="desc" [(ngModel)]="e.description" rows="3"></textarea></label>
        <div class="field">Color
          <div class="row colors" role="radiogroup" aria-label="Color">
            @for (c of colors; track c) {
              <button type="button" role="radio" [attr.aria-checked]="e.color === c" [attr.aria-label]="c" [style.background]="c" [class.sel]="e.color === c" (click)="e.color = c"></button>
            }
          </div>
        </div>
        <div class="actions">
          @if (e.id) {
            <button type="button" class="btn danger" (click)="remove(e)">Eliminar</button>
            <button type="button" class="btn" (click)="archive(e)">{{ e.is_archived ? 'Desarchivar' : 'Archivar' }}</button>
          }
          <span class="spacer"></span>
          <button type="button" class="btn" (click)="editing.set(null)">Cancelar</button>
          <button class="btn primary" [disabled]="!e.name?.trim()">Guardar</button>
        </div>
      </form>
    </div>
  }`,
  styles: [`
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
    .proj { padding: 16px; display: grid; gap: 10px; &.arch { opacity: .65; } footer { font-size: 13px; } }
    .desc { font-size: 13px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; min-height: 39px; }
    .progress { height: 6px; background: var(--surface-2); border-radius: 3px; overflow: hidden; span { display: block; height: 100%; border-radius: 3px; } }
    .full { grid-column: 1 / -1; }
    .colors button { width: 24px; height: 24px; border-radius: 50%; border: 2px solid transparent; &.sel { border-color: var(--text); box-shadow: 0 0 0 2px var(--surface) inset; } }
    .actions { display: flex; }
  `],
})
export class ProjectsComponent implements OnInit {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  colors = COLORS;
  projects = signal<Project[]>([]);
  archived = signal(false);
  loaded = signal(false);
  editing = signal<Partial<Project> | null>(null);
  pct = (p: Project) => (p.total_tasks ? Math.round((100 * p.completed_tasks) / p.total_tasks) : 0);

  ngOnInit() { this.load(); }
  load() { this.api.projects(this.archived()).subscribe({ next: p => { this.projects.set(p); this.loaded.set(true); }, error: e => this.toast.error(e) }); }

  open(p?: Project) {
    this.editing.set(p ? { ...p } : { name: '', description: '', color: COLORS[0] });
    setTimeout(() => document.querySelector<HTMLInputElement>('.modal input')?.focus());
  }
  save() {
    const e = this.editing()!;
    const data = { name: e.name!.trim(), description: e.description?.trim() || null, color: e.color };
    (e.id ? this.api.updateProject(e.id, data) : this.api.createProject(data)).subscribe({
      next: () => { this.editing.set(null); this.load(); }, error: err => this.toast.error(err),
    });
  }
  archive(e: Partial<Project>) {
    this.api.updateProject(e.id!, { is_archived: !e.is_archived }).subscribe({ next: () => { this.editing.set(null); this.load(); }, error: err => this.toast.error(err) });
  }
  remove(e: Partial<Project>) {
    if (!confirm(`¿Eliminar el proyecto «${e.name}»? Sus tareas se conservan sin proyecto.`)) return;
    this.api.deleteProject(e.id!).subscribe({ next: () => { this.editing.set(null); this.load(); }, error: err => this.toast.error(err) });
  }
}
