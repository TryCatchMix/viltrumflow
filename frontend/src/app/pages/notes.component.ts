import { Component, HostListener, OnDestroy, ViewChild, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subject, debounceTime, distinctUntilChanged, of, switchMap } from 'rxjs';
import { ApiService } from '../core/api.service';
import { OfflineService } from '../core/offline.service';
import { Note, NoteSummary, TagCount, Task } from '../core/models';
import { TaskDialogService } from '../shared/task-dialog.service';
import { ToastService } from '../core/toast.service';
import { isOffline, relativeTime, today } from '../core/util';
import { EditorComponent } from '../shared/editor.component';
import { IconComponent } from '../shared/icon.component';
import { headings, toggleCheckboxLine } from '../shared/markdown';
import { MarkdownViewComponent } from '../shared/markdown-view.component';

type Mode = 'edit' | 'split' | 'preview';

@Component({
  selector: 'app-notes',
  standalone: true,
  imports: [FormsModule, RouterLink, IconComponent, EditorComponent, MarkdownViewComponent],
  template: `
  <div class="notes" [class.no-side]="!side()" [class.list-open]="listOpen()">
    <!-- Explorador -->
    <aside class="tree">
      <div class="row top">
        <input class="input" [ngModel]="query()" (ngModelChange)="onSearch($event)" placeholder="Buscar en notas…" aria-label="Buscar en notas" />
        <button class="btn icon" title="Nueva nota" (click)="create()"><app-icon name="plus" /></button>
        <button class="btn icon" title="Nota diaria de hoy" (click)="daily()"><app-icon name="calendar" /></button>
      </div>
      @if (tag()) {
        <div class="row filter"><span class="chip tag">#{{ tag() }}</span><span class="muted">{{ visible().length }} notas</span><span class="spacer"></span>
          <button class="btn ghost icon sm" title="Quitar filtro" (click)="tag.set('')"><app-icon name="x" [size]="13" /></button></div>
      }
      <div class="scroll">
        @if (query().trim()) {
          @for (n of results(); track n.id) {
            <a class="item result" [routerLink]="['/notes', n.id]" [class.active]="n.id === note()?.id" (click)="listOpen.set(false)">
              <span class="truncate">{{ n.title }}</span>
              @if (n.snippet) { <small class="muted">{{ n.snippet }}</small> }
            </a>
          } @empty { <p class="muted pad">Sin resultados para «{{ query() }}»</p> }
        } @else {
          @for (f of folders(); track f.name) {
            @if (f.name) {
              <button class="folder row" (click)="toggleFolder(f.name)" [attr.aria-expanded]="!collapsed().has(f.name)">
                <app-icon [name]="collapsed().has(f.name) ? 'right' : 'down'" [size]="13" /><span class="truncate">{{ f.name }}</span><span class="muted">{{ f.notes.length }}</span>
              </button>
            }
            @if (!f.name || !collapsed().has(f.name)) {
              @for (n of f.notes; track n.id) {
                <a class="item row" [class.nested]="f.name" [routerLink]="['/notes', n.id]" [class.active]="n.id === note()?.id" (click)="listOpen.set(false)">
                  @if (n.is_pinned) { <app-icon name="pin" [size]="12" /> }
                  <span class="truncate">{{ n.title }}</span>
                </a>
              }
            }
          } @empty { <p class="muted pad">{{ tag() ? 'Ninguna nota con esa etiqueta' : 'Aún no hay notas' }}</p> }

          @if (tags().length) {
            <h4>Etiquetas</h4>
            <div class="tags">
              @for (t of tags(); track t.tag) {
                <button class="chip tag" [class.on]="tag() === t.tag" (click)="tag.set(tag() === t.tag ? '' : t.tag)">#{{ t.tag }} <span>{{ t.count }}</span></button>
              }
            </div>
          }
        }
      </div>
    </aside>

    <!-- Nota -->
    <section class="doc">
      @if (note(); as n) {
        <header class="row bar">
          <button class="btn ghost icon only-narrow" title="Lista de notas" (click)="listOpen.set(true)"><app-icon name="folder" /></button>
          <input class="title" [(ngModel)]="title" (blur)="rename()" (keydown.enter)="$any($event.target).blur()" maxlength="200" aria-label="Título de la nota" />
          <span class="muted status" aria-live="polite">{{ status() }}</span>
          <div class="row modes" role="group" aria-label="Modo de vista">
            <button class="btn ghost icon sm" [class.active]="mode() === 'edit'" title="Editar" (click)="setMode('edit')"><app-icon name="edit" /></button>
            <button class="btn ghost icon sm hide-narrow" [class.active]="mode() === 'split'" title="Dividido" (click)="setMode('split')"><app-icon name="split" /></button>
            <button class="btn ghost icon sm" [class.active]="mode() === 'preview'" title="Lectura" (click)="setMode('preview')"><app-icon name="eye" /></button>
          </div>
          <button class="btn ghost icon sm" [class.active]="n.is_pinned" [title]="n.is_pinned ? 'Desfijar' : 'Fijar'" (click)="pin()"><app-icon name="pin" /></button>
          <button class="btn ghost icon sm hide-narrow" [class.active]="side()" title="Panel de enlaces" (click)="toggleSide()"><app-icon name="panel" /></button>
          <button class="btn ghost icon sm danger" title="Eliminar nota" (click)="remove()"><app-icon name="trash" /></button>
        </header>
        <div class="row sub">
          <app-icon name="folder" [size]="13" />
          <input class="folder-input" [(ngModel)]="folder" (blur)="moveFolder()" (keydown.enter)="$any($event.target).blur()" placeholder="Sin carpeta" list="folders" aria-label="Carpeta" maxlength="300" />
          <datalist id="folders">@for (f of folderNames(); track f) { <option [value]="f"></option> }</datalist>
          @for (t of n.tags; track t) { <button class="chip tag" (click)="tag.set(t)">#{{ t }}</button> }
          <span class="spacer"></span><span class="muted">Editada {{ rel(n.updated_at) }}</span>
        </div>
        <div class="panes" [class]="mode()">
          @if (mode() !== 'preview') {
            <app-editor class="pane" [doc]="content()" [titles]="titleList()" (changed)="onEdit($event)" (save)="flush()" />
          }
          @if (mode() !== 'edit') {
            <div class="pane read" #reader>
              <app-markdown [content]="content()" [titles]="titleSet()" (openLink)="openLink($event)" (openTag)="tag.set($event)" (toggle)="onToggle($event)" />
              @if (!content().trim()) { <p class="muted">Nota vacía. Cambia a edición para empezar a escribir.</p> }
            </div>
          }
        </div>
      } @else if (loading()) {
        <div class="center"><div class="skeleton" style="width:60%;height:28px"></div></div>
      } @else {
        <div class="empty center">
          <button class="btn ghost only-narrow" (click)="listOpen.set(true)"><app-icon name="folder" /> Ver notas</button>
          <h3>{{ missing() ? 'Esa nota no existe' : 'Tu vault está vacío' }}</h3>
          <p>Crea una nota y enlázala con otras usando <code>[[dobles corchetes]]</code>.</p>
          <button class="btn primary" (click)="create()"><app-icon name="plus" /> Nueva nota</button>
        </div>
      }
    </section>

    <!-- Panel derecho -->
    @if (note(); as n) {
      <aside class="side">
        <h4>Enlaces entrantes <span class="muted">{{ n.backlinks.length }}</span></h4>
        @for (b of n.backlinks; track b.id) {
          <a class="back" [routerLink]="['/notes', b.id]"><strong>{{ b.title }}</strong>@if (b.context) { <small>{{ b.context }}</small> }</a>
        } @empty { <p class="muted">Ninguna nota enlaza a esta todavía.</p> }

        <h4>Enlaces salientes <span class="muted">{{ n.outgoing.length }}</span></h4>
        @for (o of n.outgoing; track o.title) {
          <button class="out row" [class.ghost]="!o.id" (click)="openLink(o.title)" [title]="o.id ? '' : 'No existe: se creará al abrirla'">
            <app-icon [name]="o.id ? 'note' : 'plus'" [size]="13" /><span class="truncate">{{ o.title }}</span>
          </button>
        } @empty { <p class="muted">Sin enlaces. Escribe <code>[[</code> para crear uno.</p> }

        @if (linked().length) {
          <h4>Tareas de esta nota <span class="muted">{{ linked().length }}</span></h4>
          @for (t of linked(); track t.id) {
            <button class="out row" [class.done]="t.status === 'completed'" (click)="dialog.edit(t)">
              <app-icon name="check" [size]="13" /><span class="truncate">{{ t.title }}</span>
            </button>
          }
        }

        <h4>Esquema</h4>
        @for (h of outline(); track h.line) {
          <button class="out truncate" [style.padding-left.px]="6 + (h.level - 1) * 12" (click)="goTo(h.line, $index)">{{ h.text }}</button>
        } @empty { <p class="muted">Sin encabezados.</p> }
        <a class="btn sm graph-link" [routerLink]="['/graph']" [queryParams]="{ focus: n.id }"><app-icon name="graph" [size]="14" /> Ver en el grafo</a>
      </aside>
    }
  </div>`,
  styles: [`
    :host { display: block; height: 100%; min-height: 0; }
    .notes { display: grid; grid-template-columns: 250px minmax(0, 1fr) 260px; height: 100%; &.no-side { grid-template-columns: 250px minmax(0, 1fr); .side { display: none; } } }
    .tree { border-right: 1px solid var(--border); background: var(--surface); display: flex; flex-direction: column; min-height: 0; }
    .top { padding: 10px; gap: 6px; } .filter { padding: 0 10px 8px; font-size: 12px; }
    .scroll { overflow-y: auto; padding: 0 6px 16px; flex: 1; }
    .item { display: flex; align-items: center; gap: 6px; padding: 5px 8px; border-radius: var(--radius-sm); color: var(--text-2); font-size: 13.5px;
      &:hover { background: var(--surface-2); color: var(--text); text-decoration: none; } &.active { background: var(--accent-soft); color: var(--accent-text); }
      &.nested { padding-left: 26px; } &.result { display: grid; gap: 1px; small { font-size: 12px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; } } }
    .folder { width: 100%; background: none; border: none; padding: 5px 8px; gap: 5px; color: var(--text-3); font-size: 12.5px; font-weight: 600; border-radius: var(--radius-sm); text-align: left; margin-top: 4px;
      &:hover { background: var(--surface-2); } .truncate { flex: 1; } .muted { font-weight: 400; } }
    h4 { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--text-3); margin: 18px 8px 8px; display: flex; gap: 6px; .muted { font-weight: 400; } }
    .tags { display: flex; flex-wrap: wrap; gap: 5px; padding: 0 8px; .chip { border: none; cursor: pointer; span { opacity: .7; } &.on { background: var(--accent); color: var(--on-accent); } } }
    .pad { padding: 10px 8px; font-size: 13px; }

    .doc { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
    .bar { padding: 10px 16px 4px 24px; gap: 4px; }
    .title { flex: 1; min-width: 0; font-size: 20px; font-weight: 650; border: none; background: none; outline: none; color: var(--text); padding: 2px 4px; margin-left: -4px; border-radius: var(--radius-sm); &:focus { background: var(--surface-2); } }
    .status { font-size: 12px; white-space: nowrap; margin-right: 6px; }
    .modes { gap: 0; background: var(--surface-2); border-radius: var(--radius-sm); padding: 2px; margin-right: 4px; }
    .sub { padding: 0 16px 8px 24px; font-size: 12px; color: var(--text-3); border-bottom: 1px solid var(--border); flex-wrap: wrap; row-gap: 4px; .chip { border: none; cursor: pointer; } }
    .folder-input { border: none; background: none; outline: none; color: var(--text-2); width: 140px; padding: 2px 4px; border-radius: 4px; &:focus { background: var(--surface-2); } }
    .panes { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr); &.split { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); .read { border-left: 1px solid var(--border); } } }
    .pane { min-height: 0; overflow: hidden; }
    .read { overflow-y: auto; padding: 20px 28px 30vh; app-markdown { max-width: 760px; margin: 0 auto; } }
    .center { margin: auto; padding: 24px; width: 100%; max-width: 440px; }
    code { font: 12px var(--mono); background: var(--surface-2); padding: 1px 5px; border-radius: 4px; }

    .side { border-left: 1px solid var(--border); background: var(--surface); overflow-y: auto; padding: 0 10px 20px; font-size: 13px;
      h4 { margin-left: 4px; } p { padding: 0 4px; } }
    .back { display: grid; gap: 2px; padding: 7px 8px; border-radius: var(--radius-sm); color: var(--text); background: var(--surface-2); margin-bottom: 6px; &:hover { text-decoration: none; background: var(--surface-3); }
      small { color: var(--text-3); overflow-wrap: anywhere; } }
    .out.done { text-decoration: line-through; opacity: .6; }
    .out { display: flex; width: 100%; background: none; border: none; text-align: left; padding: 4px 6px; border-radius: var(--radius-sm); color: var(--text-2); gap: 6px; &:hover { background: var(--surface-2); color: var(--text); } &.ghost { opacity: .6; } }
    .graph-link { margin: 18px 4px 0; }
    .only-narrow { display: none; }
    @media (max-width: 1100px) { .notes, .notes.no-side { grid-template-columns: 230px minmax(0, 1fr); } .side { display: none; } .hide-narrow { display: none; } }
    @media (max-width: 820px) {
      .notes, .notes.no-side { grid-template-columns: minmax(0, 1fr); }
      .tree { display: none; } .list-open .tree { display: flex; position: absolute; inset: 0; z-index: 6; }
      .only-narrow { display: inline-flex; } .panes.split { grid-template-columns: minmax(0, 1fr); .read { display: none; } }
      .bar { padding-left: 12px; } .sub { padding-left: 16px; } .status { display: none; }
    }
  `],
})
export class NotesComponent implements OnDestroy {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private offline = inject(OfflineService);
  @ViewChild(EditorComponent) editor?: EditorComponent;
  @ViewChild('reader') reader?: { nativeElement: HTMLElement };
  rel = relativeTime;

  list = signal<NoteSummary[]>([]);
  tags = signal<TagCount[]>([]);
  results = signal<NoteSummary[]>([]);
  linked = signal<Task[]>([]);
  dialog = inject(TaskDialogService);
  note = signal<Note | null>(null);
  content = signal('');
  loading = signal(true);
  missing = signal(false);
  status = signal('');
  query = signal('');
  tag = signal('');
  collapsed = signal(new Set<string>());
  side = signal(localStorage.getItem('vf-notes-side') !== '0');
  listOpen = signal(false);
  mode = signal<Mode>((localStorage.getItem('vf-notes-mode') as Mode) || (innerWidth > 1300 ? 'split' : 'preview'));
  title = '';
  folder = '';

  private dirty = false;
  private timer?: ReturnType<typeof setTimeout>;
  private search$ = new Subject<string>();

  titleList = computed(() => this.list().map(n => n.title));
  titleSet = computed(() => new Set(this.list().map(n => n.title.toLowerCase())));
  folderNames = computed(() => [...new Set(this.list().map(n => n.folder).filter(Boolean))].sort());
  outline = computed(() => headings(this.content()));
  visible = computed(() => {
    const t = this.tag();
    return t ? this.list().filter(n => n.tags.some(x => x === t || x.startsWith(t + '/'))) : this.list();
  });
  folders = computed(() => {
    const map = new Map<string, NoteSummary[]>();
    for (const n of this.visible()) { if (!map.has(n.folder)) map.set(n.folder, []); map.get(n.folder)!.push(n); }
    const sort = (a: NoteSummary, b: NoteSummary) => Number(b.is_pinned) - Number(a.is_pinned) || a.title.localeCompare(b.title, 'es', { numeric: true });
    return [...map.entries()].sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)))
      .map(([name, notes]) => ({ name, notes: notes.sort(sort) }));
  });

  constructor() {
    this.loadList(true);
    this.api.tasksChanged.pipe(takeUntilDestroyed()).subscribe(() => { const n = this.note(); if (n) this.loadLinked(n.id); });
    addEventListener('online', this.onOnline);
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe(p => {
      const id = Number(p.get('id'));
      if (id) this.open(id);
    });
    this.search$.pipe(debounceTime(200), distinctUntilChanged(), switchMap(q => (q ? this.api.notes({ q }) : of([]))), takeUntilDestroyed())
      .subscribe(r => this.results.set(r));
  }

  ngOnDestroy() { this.flush(); this.offline.activeId = null; removeEventListener('online', this.onOnline); }
  /** Al volver la red, envía lo que quedó pendiente de la nota abierta. */
  private onOnline = () => { const n = this.note(); if (n && this.offline.get(n.id)) { this.dirty = true; this.flush(); } };
  @HostListener('window:beforeunload') onUnload() { this.flush(); }

  private loadList(initial = false) {
    this.api.notes().subscribe({
      next: l => {
        this.list.set(l);
        if (initial && !this.route.snapshot.paramMap.get('id')) {
          if (l.length) this.router.navigate(['/notes', l[0].id], { replaceUrl: true });
          else this.loading.set(false);
        }
      },
      error: e => { this.loading.set(false); this.toast.error(e, 'No se pudieron cargar las notas'); },
    });
    this.api.tags().subscribe(t => this.tags.set(t));
  }

  private open(id: number) {
    this.flush();
    this.loading.set(true);
    this.missing.set(false);
    this.api.note(id).subscribe({
      next: n => {
        this.apply(n);
        this.content.set(n.content);
        this.status.set('');
        this.loading.set(false);
        // Texto escrito sin conexión y aún no enviado: tiene prioridad sobre lo que devuelve el servidor
        const draft = this.offline.get(n.id);
        if (draft && draft.content !== n.content) {
          if (n.updated_at === draft.base || !navigator.onLine) { this.content.set(draft.content); this.dirty = true; this.flush(); }
          else { this.offline.activeId = null; this.offline.sync().then(() => { this.offline.activeId = n.id; this.loadList(); }); }  // cambió en otro sitio: copia aparte
        } else if (draft) this.offline.remove(n.id);
        if (this.route.snapshot.queryParamMap.get('edit')) {
          if (this.mode() === 'preview') this.mode.set('edit');
          setTimeout(() => this.editor?.focus(), 50);
        }
      },
      error: () => {
        this.loading.set(false);
        // Sin red y sin copia del servidor, pero con texto escrito en este dispositivo: se abre desde ahí
        const draft = this.offline.get(id);
        if (draft) {
          const s = this.list().find(x => x.id === id);
          this.apply({ id, title: draft.title, folder: s?.folder ?? '', tags: s?.tags ?? [], is_pinned: !!s?.is_pinned, is_daily: !!s?.is_daily,
            created_at: s?.created_at ?? draft.base, updated_at: draft.base, content: draft.content, backlinks: [], outgoing: [] });
          this.content.set(draft.content);
          this.status.set('Sin conexión · guardado en este dispositivo');
          return;
        }
        this.note.set(null);
        this.missing.set(true);
      },
    });
  }

  private loadLinked(id: number) {
    if (id > 0) this.api.tasks({ note_id: id, include_archived: true }).subscribe({ next: t => this.linked.set(t), error: () => this.linked.set([]) });
  }
  private apply(n: Note) { if (this.note()?.id !== n.id) { this.linked.set([]); this.loadLinked(n.id); } this.offline.activeId = n.id; this.note.set(n); this.title = n.title; this.folder = n.folder; }

  // ---- Edición y guardado automático ----
  onEdit(text: string) {
    this.content.set(text);
    this.dirty = true;
    this.status.set('Sin guardar…');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 900);
  }

  /** Guarda ya los cambios pendientes de la nota abierta. */
  flush() {
    clearTimeout(this.timer);
    const n = this.note();
    if (!n || !this.dirty) return;
    this.dirty = false;
    const sent = this.content();
    this.status.set('Guardando…');
    this.api.updateNote(n.id, { content: sent }).subscribe({
      next: saved => {
        this.offline.remove(saved.id);
        if (this.note()?.id !== saved.id) { this.loadList(); return; }  // ya se abrió otra nota
        this.apply({ ...saved, content: this.content() });
        if (!this.dirty) this.status.set('Guardado');
        this.loadList();
      },
      error: e => {
        if (isOffline(e)) {
          // Sin red: el texto se queda en este dispositivo y se envía al reconectar
          this.offline.save(n.id, n.title, sent, n.updated_at);
          if (this.note()?.id === n.id) this.status.set('Sin conexión · guardado en este dispositivo');
          return;
        }
        if (this.note()?.id === n.id) { this.dirty = true; this.status.set('Error al guardar'); }
        this.toast.error(e, 'No se pudo guardar la nota');
      },
    });
  }

  onToggle(ev: { line: number; checked: boolean }) { this.onEdit(toggleCheckboxLine(this.content(), ev.line, ev.checked)); }

  rename() {
    const n = this.note(), title = this.title.trim().replace(/\s+/g, ' ');
    if (!n || title === n.title) return;
    if (!title) { this.title = n.title; return; }
    this.api.updateNote(n.id, { title }).subscribe({
      next: saved => { this.apply({ ...saved, content: this.content() }); this.loadList(); },
      error: e => { this.title = n.title; this.toast.error(e, 'No se pudo renombrar'); },
    });
  }
  moveFolder() {
    const n = this.note(), folder = this.folder.trim();
    if (!n || folder === n.folder) return;
    this.api.updateNote(n.id, { folder }).subscribe({
      next: saved => { this.apply({ ...saved, content: this.content() }); this.loadList(); },
      error: e => { this.folder = n.folder; this.toast.error(e); },
    });
  }
  pin() {
    const n = this.note()!;
    this.api.updateNote(n.id, { is_pinned: !n.is_pinned }).subscribe({ next: s => { this.apply({ ...s, content: this.content() }); this.loadList(); }, error: e => this.toast.error(e) });
  }
  remove() {
    const n = this.note()!;
    if (!confirm(`¿Enviar la nota «${n.title}» a la papelera? Podrás restaurarla durante 30 días.`)) return;
    this.dirty = false;
    this.offline.remove(n.id);
    this.api.deleteNote(n.id).subscribe({
      next: () => {
        this.note.set(null);
        const next = this.list().find(x => x.id !== n.id);
        this.list.update(l => l.filter(x => x.id !== n.id));
        this.loading.set(false);
        this.router.navigate(next ? ['/notes', next.id] : ['/notes'], { replaceUrl: true });
        this.api.tags().subscribe(t => this.tags.set(t));
      },
      error: e => this.toast.error(e),
    });
  }

  // ---- Navegación ----
  create(title?: string) {
    const base = title ?? 'Sin título';
    let name = base, i = 1;
    while (this.titleSet().has(name.toLowerCase())) name = `${base} ${++i}`;
    this.api.createNote({ title: name, content: '', folder: title ? '' : this.note()?.folder ?? '' }).subscribe({
      next: n => { this.listOpen.set(false); this.loadList(); this.router.navigate(['/notes', n.id], { queryParams: { edit: 1 } }); },
      error: e => this.toast.error(e, 'No se pudo crear la nota'),
    });
  }
  daily() {
    this.api.dailyNote(today()).subscribe({ next: n => { this.listOpen.set(false); this.loadList(); this.router.navigate(['/notes', n.id]); }, error: e => this.toast.error(e) });
  }
  /** Abre la nota enlazada; si no existe, la crea (como en Obsidian). */
  openLink(title: string) {
    const found = this.list().find(n => n.title.toLowerCase() === title.toLowerCase());
    if (found) this.router.navigate(['/notes', found.id]);
    else { this.flush(); this.create(title); }
  }
  goTo(line: number, index: number) {
    if (this.mode() === 'edit') { this.editor?.scrollToLine(line); return; }
    this.reader?.nativeElement.querySelectorAll('h1,h2,h3,h4,h5,h6')[index]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  toggleSide() { this.side.set(!this.side()); localStorage.setItem('vf-notes-side', this.side() ? '1' : '0'); }
  onSearch(q: string) { this.query.set(q); this.search$.next(q.trim()); }
  setMode(m: Mode) { this.mode.set(m); localStorage.setItem('vf-notes-mode', m); }
  toggleFolder(name: string) {
    this.collapsed.update(s => { const n = new Set(s); n.has(name) ? n.delete(name) : n.add(name); return n; });
  }
}
