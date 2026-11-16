import { Component, ElementRef, HostListener, ViewChild, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subject, debounceTime, distinctUntilChanged, of, switchMap } from 'rxjs';
import { ApiService } from '../core/api.service';
import { STATUS_LABEL, Status } from '../core/models';
import { ThemeService } from '../core/theme.service';
import { ToastService } from '../core/toast.service';
import { today } from '../core/util';
import { IconComponent } from '../shared/icon.component';
import { TaskDialogService } from '../shared/task-dialog.service';

interface Item { icon: string; label: string; hint?: string; run: () => void; }

@Component({
  selector: 'app-command-palette',
  standalone: true,
  imports: [FormsModule, IconComponent],
  template: `
  @if (open()) {
    <div class="backdrop" (click)="close()">
      <div class="palette" role="dialog" aria-label="Buscador rápido" (click)="$event.stopPropagation()">
        <div class="row head">
          <app-icon name="search" />
          <input #input [(ngModel)]="query" (ngModelChange)="onQuery($event)" placeholder="Buscar notas y tareas, o ejecutar un comando…"
            (keydown)="onKey($event)" aria-label="Buscar" autocomplete="off" />
          <kbd>Esc</kbd>
        </div>
        <ul role="listbox">
          @for (it of items(); track $index) {
            <li role="option" [attr.aria-selected]="$index === active()" [class.active]="$index === active()"
                (mousemove)="active.set($index)" (click)="run(it)">
              <app-icon [name]="it.icon" />
              <span class="truncate">{{ it.label }}</span>
              @if (it.hint) { <span class="hint truncate">{{ it.hint }}</span> }
            </li>
          } @empty { <li class="none">Sin resultados</li> }
        </ul>
      </div>
    </div>
  }`,
  styles: [`
    .palette { width: 100%; max-width: 600px; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; box-shadow: var(--shadow); overflow: hidden; }
    .head { padding: 0 14px; border-bottom: 1px solid var(--border); color: var(--text-3);
      input { flex: 1; height: 46px; border: none; background: none; outline: none; font-size: 15px; color: var(--text); } }
    kbd { font: 11px var(--mono); border: 1px solid var(--border); border-radius: 4px; padding: 1px 5px; }
    ul { list-style: none; margin: 0; padding: 6px; max-height: 50vh; overflow-y: auto; }
    li { display: flex; align-items: center; gap: 10px; padding: 7px 10px; border-radius: var(--radius-sm); cursor: pointer; color: var(--text-2);
      &.active { background: var(--accent-soft); color: var(--text); } &.none { cursor: default; color: var(--text-3); } }
    .hint { margin-left: auto; font-size: 12px; color: var(--text-3); max-width: 50%; }
  `],
})
export class CommandPaletteComponent {
  private api = inject(ApiService);
  private router = inject(Router);
  private theme = inject(ThemeService);
  private dialog = inject(TaskDialogService);
  private toast = inject(ToastService);
  @ViewChild('input') input?: ElementRef<HTMLInputElement>;

  open = signal(false);
  items = signal<Item[]>([]);
  active = signal(0);
  query = '';
  private q$ = new Subject<string>();

  private commands: Item[] = [
    { icon: 'note', label: 'Nueva nota', run: () => this.newNote('') },
    { icon: 'calendar', label: 'Abrir nota diaria de hoy', run: () => this.daily() },
    { icon: 'plus', label: 'Nueva tarea', run: () => this.dialog.create() },
    { icon: 'home', label: 'Ir a Inicio', run: () => this.router.navigate(['/dashboard']) },
    { icon: 'check', label: 'Ir a Tareas', run: () => this.router.navigate(['/tasks']) },
    { icon: 'board', label: 'Ir a Tablero', run: () => this.router.navigate(['/kanban']) },
    { icon: 'note', label: 'Ir a Notas', run: () => this.router.navigate(['/notes']) },
    { icon: 'graph', label: 'Ir a Grafo', run: () => this.router.navigate(['/graph']) },
    { icon: 'calendar', label: 'Ir a Calendario', run: () => this.router.navigate(['/calendar']) },
    { icon: 'folder', label: 'Ir a Proyectos', run: () => this.router.navigate(['/projects']) },
    { icon: 'settings', label: 'Ir a Ajustes', run: () => this.router.navigate(['/settings']) },
    { icon: 'download', label: 'Exportar notas (.zip de Markdown)', run: () => this.router.navigate(['/settings'], { fragment: 'vault' }) },
    { icon: 'upload', label: 'Importar notas (Obsidian / .md)', run: () => this.router.navigate(['/settings'], { fragment: 'vault' }) },
    { icon: 'sun', label: 'Cambiar tema claro/oscuro', run: () => this.theme.toggle() },
  ];

  constructor() {
    this.q$.pipe(
      debounceTime(150), distinctUntilChanged(),
      switchMap(q => (q ? this.api.search(q) : of([]))),
    ).subscribe({
      next: results => {
        const q = this.query.trim();
        if (!q) return this.set(this.commands);
        const found: Item[] = results.map(r => r.kind === 'note'
          ? { icon: 'note', label: r.title, hint: r.snippet ?? 'Nota', run: () => this.router.navigate(['/notes', r.id]) }
          : r.kind === 'task'
            ? { icon: 'check', label: r.title, hint: STATUS_LABEL[r.snippet as Status] ?? 'Tarea', run: () => this.api.task(r.id).subscribe(t => this.dialog.edit(t)) }
            : { icon: 'folder', label: r.title, hint: 'Proyecto', run: () => this.router.navigate(['/tasks'], { queryParams: { project: r.id } }) });
        const cmds = this.commands.filter(c => c.label.toLowerCase().includes(q.toLowerCase()));
        const exact = results.some(r => r.kind === 'note' && r.title.toLowerCase() === q.toLowerCase());
        const create: Item[] = exact ? [] : [
          { icon: 'plus', label: `Crear nota «${q}»`, run: () => this.newNote(q) },
          { icon: 'plus', label: `Crear tarea «${q}»`, run: () => this.dialog.create({ title: q }) },
        ];
        this.set([...found, ...cmds, ...create]);
      },
    });
  }

  @HostListener('document:keydown', ['$event'])
  onGlobalKey(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); this.toggle(); }
    else if (e.key === 'Escape' && this.open()) { e.stopPropagation(); this.close(); }
  }

  toggle() { this.open() ? this.close() : this.show(); }
  show() {
    this.query = '';
    this.set(this.commands);
    this.open.set(true);
    setTimeout(() => this.input?.nativeElement.focus());
  }
  close() { this.open.set(false); }
  onQuery(q: string) { this.q$.next(q.trim()); }

  onKey(e: KeyboardEvent) {
    const n = this.items().length;
    if (e.key === 'ArrowDown') { e.preventDefault(); this.active.update(i => (i + 1) % Math.max(n, 1)); this.scroll(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); this.active.update(i => (i - 1 + n) % Math.max(n, 1)); this.scroll(); }
    else if (e.key === 'Enter') { e.preventDefault(); const it = this.items()[this.active()]; if (it) this.run(it); }
  }
  run(it: Item) { this.close(); it.run(); }

  private set(items: Item[]) { this.items.set(items); this.active.set(0); }
  private scroll() { setTimeout(() => document.querySelector('.palette li.active')?.scrollIntoView({ block: 'nearest' })); }

  private newNote(title: string) {
    const t = title || `Sin título ${new Date().toLocaleString('es', { dateStyle: 'short', timeStyle: 'medium' }).replace(/[\/,]/g, '-')}`;
    this.api.createNote({ title: t, content: '' }).subscribe({
      next: n => this.router.navigate(['/notes', n.id], { queryParams: { edit: 1 } }),
      error: e => this.toast.error(e, 'No se pudo crear la nota'),
    });
  }
  private daily() {
    this.api.dailyNote(today()).subscribe({ next: n => this.router.navigate(['/notes', n.id]), error: e => this.toast.error(e) });
  }
}
