import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { Member, Project, ProjectTemplate, ROLE_LABEL, Role } from '../core/models';
import { ToastService } from '../core/toast.service';
import { IconComponent } from '../shared/icon.component';
import { ProjectTemplatesComponent } from '../shared/project-templates.component';

const COLORS = ['#7c5cff', '#2a78d6', '#1baf7a', '#eda100', '#eb6834', '#e34948', '#e87ba4', '#6b7280'];

@Component({
  selector: 'app-projects',
  standalone: true,
  imports: [FormsModule, RouterLink, IconComponent, ProjectTemplatesComponent],
  template: `
  <div class="page">
    <div class="page-head">
      <div><h1>Proyectos</h1><p>Agrupa tus tareas y sigue su avance.</p></div>
      <span class="spacer"></span>
      <label class="row muted"><input type="checkbox" [ngModel]="archived()" (ngModelChange)="archived.set($event); load()" /> Mostrar archivados</label>
      <button class="btn" (click)="templates.set({ edit: null })"><app-icon name="template" /> Desde plantilla</button>
      <button class="btn primary" (click)="open()"><app-icon name="plus" /> Nuevo proyecto</button>
    </div>

    <div class="grid">
      @for (p of projects(); track p.id) {
        <article class="card proj" [class.arch]="p.is_archived">
          <header class="row">
            <i class="dot" [style.background]="p.color"></i><h2 class="truncate">{{ p.name }}</h2>
            @if (p.is_archived) { <span class="chip">Archivado</span> }
            @if (p.role !== 'owner') { <span class="chip" [title]="'Compartido por ' + p.owner_name">{{ roleLabel[p.role] }}</span> }
            <span class="spacer"></span>
            <button class="btn ghost sm" [title]="p.role === 'owner' ? 'Compartir proyecto' : 'Ver quién tiene acceso'" (click)="share(p)">
              <app-icon name="users" />@if (p.member_count) { {{ p.member_count + 1 }} }</button>
            <button class="btn ghost icon sm" title="Guardar como plantilla" [attr.aria-label]="'Guardar ' + p.name + ' como plantilla'" (click)="saveAsTemplate(p)"><app-icon name="template" /></button>
            @if (p.role === 'owner') { <button class="btn ghost icon sm" title="Editar" (click)="open(p)"><app-icon name="edit" /></button> }
          </header>
          <p class="muted desc">{{ p.description || (p.role === 'owner' ? 'Sin descripción' : 'Compartido por ' + p.owner_name) }}</p>
          <div class="progress" role="progressbar" [attr.aria-valuenow]="pct(p)" aria-valuemin="0" aria-valuemax="100" [attr.aria-label]="'Avance de ' + p.name">
            <span [style.width.%]="pct(p)" [style.background]="p.color"></span>
          </div>
          <footer class="row"><span class="muted">{{ p.completed_tasks }} de {{ p.total_tasks }} tareas · {{ pct(p) }}%</span><span class="spacer"></span>
            <a [routerLink]="['/tasks']" [queryParams]="{ project: p.id }">Ver tareas</a></footer>
        </article>
      } @empty {
        @if (loaded()) {
          <div class="empty card full"><h3>Aún no hay proyectos</h3><p>Crea uno para organizar tus tareas, o parte de una plantilla («Mudanza», «Preparar un examen», «Viaje»…).</p>
            <div class="row"><button class="btn" (click)="templates.set({ edit: null })">Ver plantillas</button><button class="btn primary" (click)="open()">Nuevo proyecto</button></div></div>
        }
      }
    </div>
  </div>

  @if (templates(); as t) { <app-project-templates [editTemplate]="t.edit" (closed)="templates.set(null)" /> }

  @if (sharing(); as p) {
    <div class="backdrop" (click)="sharing.set(null)">
      <div class="modal wide" role="dialog" [attr.aria-label]="'Compartir ' + p.name" (click)="$event.stopPropagation()">
        <h2>Compartir «{{ p.name }}»</h2>
        @if (p.role === 'owner') {
          <form class="row invite" (ngSubmit)="invite(p)">
            <input class="input" name="who" [(ngModel)]="who" placeholder="Nombre de usuario o email" maxlength="255" aria-label="Nombre de usuario o email" autocomplete="off" />
            <select class="input role" name="role" [(ngModel)]="inviteRole" aria-label="Permiso">
              <option value="editor">Puede editar</option><option value="viewer">Solo lectura</option>
            </select>
            <button class="btn primary" [disabled]="who.trim().length < 3">Invitar</button>
          </form>
          <p class="muted small">La persona debe tener ya una cuenta en ViltrumFlow. Verá el proyecto y todas sus tareas; tus notas y las tareas sin proyecto siguen siendo privadas.</p>
        }
        <ul class="members">
          @for (m of members(); track m.user_id) {
            <li class="row">
              <span class="avatar">{{ m.name.charAt(0).toUpperCase() }}</span>
              <span class="truncate"><strong>{{ m.name }}</strong> <span class="muted">&#64;{{ m.username }}@if (m.user_id === me()) { (tú) }</span></span>
              <span class="spacer"></span>
              @if (m.role === 'owner' || p.role !== 'owner') { <span class="chip">{{ roleLabel[m.role] }}</span> }
              @else {
                <select class="input role" [ngModel]="m.role" (ngModelChange)="setRole(p, m, $event)" [ngModelOptions]="{ standalone: true }" [attr.aria-label]="'Permiso de ' + m.name">
                  <option value="editor">Puede editar</option><option value="viewer">Solo lectura</option>
                </select>
                <button class="btn ghost icon sm danger" [title]="'Quitar acceso a ' + m.name" (click)="removeMember(p, m)"><app-icon name="x" /></button>
              }
            </li>
          }
        </ul>
        <div class="actions">
          @if (p.role !== 'owner') { <button class="btn danger" (click)="leave(p)">Salir del proyecto</button> }
          <span class="spacer"></span>
          <button class="btn" (click)="sharing.set(null)">Cerrar</button>
        </div>
      </div>
    </div>
  }

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
    .wide { max-width: 520px; } .invite .role, .members .role { width: 140px; flex: none; } .small { font-size: 12px; }
    .members { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; li { min-height: 36px; } .muted { margin-left: 6px; } }
    .avatar { width: 26px; height: 26px; border-radius: 50%; background: var(--surface-3); display: grid; place-content: center; font-size: 12px; font-weight: 600; flex: none; }
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
  sharing = signal<Project | null>(null);
  templates = signal<{ edit: ProjectTemplate | null } | null>(null);
  members = signal<Member[]>([]);
  roleLabel = ROLE_LABEL;
  who = '';
  inviteRole: Role = 'editor';
  private auth = inject(AuthService);
  me = () => this.auth.user()?.id;
  pct = (p: Project) => (p.total_tasks ? Math.round((100 * p.completed_tasks) / p.total_tasks) : 0);

  ngOnInit() { this.load(); }
  load() { this.api.projects(this.archived()).subscribe({ next: p => { this.projects.set(p); this.loaded.set(true); }, error: e => this.toast.error(e) }); }

  share(p: Project) {
    this.who = '';
    this.members.set([]);
    this.sharing.set(p);
    this.api.members(p.id).subscribe({ next: m => this.members.set(m), error: e => this.toast.error(e) });
  }
  invite(p: Project) {
    this.api.addMember(p.id, this.who.trim(), this.inviteRole).subscribe({
      next: m => { this.members.set(m); this.who = ''; this.load(); this.toast.success('Proyecto compartido'); },
      error: e => this.toast.error(e, 'No se pudo compartir'),
    });
  }
  setRole(p: Project, m: Member, role: Role) {
    this.api.updateMember(p.id, m.user_id, role).subscribe({ next: list => this.members.set(list), error: e => this.toast.error(e) });
  }
  removeMember(p: Project, m: Member) {
    if (!confirm(`¿Quitar el acceso de ${m.name} a «${p.name}»? Dejará de ver sus tareas.`)) return;
    this.api.removeMember(p.id, m.user_id).subscribe({
      next: () => { this.members.update(l => l.filter(x => x.user_id !== m.user_id)); this.load(); }, error: e => this.toast.error(e),
    });
  }
  leave(p: Project) {
    if (!confirm(`¿Salir de «${p.name}»? Dejarás de ver sus tareas, incluidas las que creaste dentro.`)) return;
    this.api.removeMember(p.id, this.me()!).subscribe({ next: () => { this.sharing.set(null); this.load(); }, error: e => this.toast.error(e) });
  }

  saveAsTemplate(p: Project) {
    this.api.templateFromProject(p.id).subscribe({
      next: t => { this.toast.success(`«${p.name}» guardado como plantilla`); this.templates.set({ edit: t }); },
      error: e => this.toast.error(e, 'No se pudo guardar como plantilla'),
    });
  }

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
