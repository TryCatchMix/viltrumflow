import { Component, OnInit, inject, signal } from '@angular/core';
import { ApiService } from '../core/api.service';
import { TrashItem } from '../core/models';
import { ToastService } from '../core/toast.service';
import { relativeTime } from '../core/util';
import { IconComponent } from '../shared/icon.component';

@Component({
  selector: 'app-trash',
  standalone: true,
  imports: [IconComponent],
  template: `
  <div class="page narrow">
    <div class="page-head">
      <div><h1>Papelera</h1><p>Las notas y tareas eliminadas se conservan 30 días y después se borran definitivamente.</p></div>
      <span class="spacer"></span>
      @if (items().length) { <button class="btn danger" (click)="empty()"><app-icon name="trash" /> Vaciar papelera</button> }
    </div>

    @if (!loaded()) {
      @for (i of [1,2,3]; track i) { <div class="skeleton" style="height:52px;margin-bottom:6px"></div> }
    } @else if (items().length) {
      <div class="card list">
        @for (it of items(); track it.kind + it.id) {
          <div class="item row">
            <app-icon [name]="it.kind === 'note' ? 'note' : 'check'" />
            <div class="info">
              <span class="truncate title">{{ it.title }}</span>
              <small class="muted">{{ it.kind === 'note' ? 'Nota' : 'Tarea' }}@if (it.detail) { · {{ it.detail }} } · eliminada {{ rel(it.deleted_at) }} · {{ left(it) }}</small>
            </div>
            <button class="btn sm" (click)="restore(it)"><app-icon name="undo" [size]="13" /> Restaurar</button>
            <button class="btn ghost icon sm danger" [title]="'Eliminar definitivamente ' + it.title" (click)="remove(it)"><app-icon name="x" /></button>
          </div>
        }
      </div>
    } @else {
      <div class="empty card"><h3>La papelera está vacía</h3><p>Lo que elimines aparecerá aquí por si necesitas recuperarlo.</p></div>
    }
  </div>`,
  styles: [`
    .narrow { max-width: 760px; }
    .list { overflow: hidden; }
    .item { padding: 9px 14px; border-bottom: 1px solid var(--border); gap: 12px; &:last-child { border-bottom: none; } }
    .info { flex: 1; min-width: 0; display: grid; } .title { font-weight: 500; } small { font-size: 12px; }
  `],
})
export class TrashComponent implements OnInit {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  items = signal<TrashItem[]>([]);
  loaded = signal(false);
  rel = relativeTime;

  ngOnInit() { this.load(); }
  load() {
    this.api.trash().subscribe({
      next: i => { this.items.set(i); this.loaded.set(true); },
      error: e => { this.loaded.set(true); this.toast.error(e, 'No se pudo cargar la papelera'); },
    });
  }

  left(it: TrashItem): string {
    const days = Math.max(0, Math.ceil((new Date(it.purge_at).getTime() - Date.now()) / 86_400_000));
    return days <= 1 ? 'se borra en menos de un día' : `se borra en ${days} días`;
  }

  restore(it: TrashItem) {
    this.api.restore(it.kind, it.id).subscribe({ next: r => { this.toast.success(r.message); this.load(); }, error: e => this.toast.error(e) });
  }
  remove(it: TrashItem) {
    if (!confirm(`¿Eliminar definitivamente «${it.title}»? No se podrá recuperar.`)) return;
    this.api.deleteForever(it.kind, it.id).subscribe({ next: () => this.load(), error: e => this.toast.error(e) });
  }
  empty() {
    if (!confirm(`¿Eliminar definitivamente los ${this.items().length} elementos de la papelera? No se podrán recuperar.`)) return;
    this.api.emptyTrash().subscribe({ next: () => { this.toast.show('Papelera vaciada'); this.load(); }, error: e => this.toast.error(e) });
  }
}
