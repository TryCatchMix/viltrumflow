import { Component, OnDestroy, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { ItemListDetail, ItemListSummary, ListEntry } from '../core/models';
import { ToastService } from '../core/toast.service';
import { relativeTime } from '../core/util';
import { IconComponent } from '../shared/icon.component';
import { VoiceButtonComponent } from '../shared/voice-button.component';

const COLORS = ['#7c5cff', '#2a78d6', '#1baf7a', '#eda100', '#eb6834', '#e34948', '#e87ba4', '#6b7280'];
const PRESETS = [
  { emoji: '🛒', name: 'Compra', color: '#1baf7a', hint: 'Lo comprado sale de la lista y se recuerda para la próxima', items: [] as string[] },
  { emoji: '🧳', name: 'Maleta', color: '#2a78d6', hint: 'Se marca al guardar y se desmarca todo para el siguiente viaje',
    items: ['Cargador del móvil', 'DNI o pasaporte', 'Cepillo de dientes', 'Ropa interior', 'Medicinas', 'Gafas de sol', 'Auriculares'] },
  { emoji: '🏠', name: 'Antes de salir de casa', color: '#eda100', hint: 'Repasa y vuelve a empezar cada día',
    items: ['Llaves', 'Cartera', 'Móvil', 'Ventanas cerradas', 'Luces apagadas', 'Fuego y horno apagados'] },
];
const POLL_MS = 20_000;  // para ver lo que cambian otras personas en una lista compartida

/** Separa lo dictado en elementos: «leche, pan y huevos» → «leche, pan, huevos». */
export function spokenToItems(text: string): string {
  return text.replace(/[.。]+$/, '').replace(/\s+y\s+/gi, ', ');
}

@Component({
  selector: 'app-lists',
  standalone: true,
  imports: [FormsModule, RouterLink, IconComponent, VoiceButtonComponent],
  template: `
  <div class="page narrow">
    @if (!id()) {
      <div class="page-head">
        <div><h1>Listas</h1><p>Para lo que repites: la compra, la maleta, lo de antes de salir de casa.</p></div>
        <span class="spacer"></span>
        <button class="btn primary" (click)="creating.set(true)"><app-icon name="plus" /> Nueva lista</button>
      </div>

      @if (creating()) {
        <div class="card new">
          <h2>Nueva lista</h2>
          <div class="presets">
            @for (p of presets; track p.name) {
              <button class="preset" (click)="createPreset(p)" [disabled]="busy()"><span class="emoji">{{ p.emoji }}</span>
                <span><strong>{{ p.name }}</strong><small class="muted">{{ p.hint }}</small></span></button>
            }
          </div>
          <form class="row" (ngSubmit)="createBlank()">
            <input class="input emoji-in" name="emoji" [(ngModel)]="newEmoji" maxlength="4" aria-label="Emoji de la lista" placeholder="📝" />
            <input class="input grow" name="name" [(ngModel)]="newName" maxlength="100" placeholder="O ponle nombre a una lista vacía" aria-label="Nombre de la lista" />
            <button class="btn" [disabled]="!newName.trim() || busy()">Crear</button>
            <button type="button" class="btn ghost" (click)="creating.set(false)">Cancelar</button>
          </form>
        </div>
      }

      <div class="grid">
        @for (l of lists() ?? []; track l.id) {
          <a class="card lcard" [routerLink]="['/lists', l.id]" [style.--c]="l.color">
            <span class="emoji big">{{ l.emoji || '📝' }}</span>
            <span class="grow"><strong>{{ l.name }}</strong>
              <small class="muted">{{ l.total ? (l.pending ? l.pending + ' por hacer de ' + l.total : 'Todo hecho') : 'Vacía' }}
                @if (!l.is_owner) { · de {{ l.owner_name }} } @else if (l.member_count) { · compartida }</small></span>
            @if (l.pending) { <span class="count">{{ l.pending }}</span> }
          </a>
        } @empty {
          @if (lists() && !creating()) {
            <div class="card empty-state"><app-icon name="list" [size]="26" /><p>Aún no tienes listas. Empieza con la de la compra.</p>
              <button class="btn primary" (click)="createPreset(presets[0])">Crear «Compra»</button></div>
          }
        }
      </div>
    } @else {
      @if (cur(); as l) {
        <a class="back muted" routerLink="/lists"><app-icon name="left" [size]="14" /> Listas</a>
        <div class="page-head">
          <div class="row title"><span class="emoji big">{{ l.emoji || '📝' }}</span>
            <div><h1>{{ l.name }}</h1>
              <p>{{ l.pending ? l.pending + ' por hacer' : (l.total ? 'Todo hecho 🎉' : 'Añade lo primero') }}
                @if (l.members.length > 1) { · compartida con {{ others(l) }} }</p></div></div>
          <span class="spacer"></span>
          <button class="btn ghost icon" (click)="sharing.set(true)" [attr.aria-label]="'Compartir ' + l.name" title="Compartir"><app-icon name="users" /></button>
          @if (l.is_owner) { <button class="btn ghost icon" (click)="editing.set(true); editName = l.name; editEmoji = l.emoji" aria-label="Editar lista" title="Editar"><app-icon name="edit" /></button> }
        </div>

        <form class="card add row" (ngSubmit)="add()">
          <app-icon name="plus" />
          <input class="grow" name="add" [(ngModel)]="newItem" placeholder="Añadir (varios separados por comas: «leche, pan, huevos»)" maxlength="2000" aria-label="Añadir a la lista" #addInput />
          <app-voice-button [raw]="true" (heard)="newItem = spoken($event); addInput.focus()" />
          @if (newItem.trim()) { <button class="btn sm primary">Añadir</button> }
        </form>

        @if (l.suggestions.length) {
          <div class="sugg" role="group" aria-label="Lo de siempre">
            <span class="muted small">Lo de siempre:</span>
            @for (s of l.suggestions; track s.id) {
              <button class="chip" (click)="addText(s.text)" [title]="'Usado ' + s.times_used + ' veces'">+ {{ s.text }}</button>
            }
          </div>
        }

        <ul class="items card">
          @for (i of pending(); track i.id) {
            <li class="row"><label class="row grow"><input type="checkbox" class="check big" [checked]="false" (change)="toggle(i, true)" />
              <span>{{ i.text }}</span></label>
              <button class="btn ghost icon sm" (click)="forget(i)" [attr.aria-label]="'Borrar ' + i.text"><app-icon name="x" /></button></li>
          } @empty { @if (!done().length) { <li class="muted empty">La lista está vacía.</li> } @else { <li class="muted empty">Todo hecho.</li> } }
        </ul>

        @if (done().length) {
          <div class="row done-head"><h2>Hecho ({{ done().length }})</h2><span class="spacer"></span>
            <button class="btn sm" (click)="clearChecked()" title="Salen de la lista; aparecerán en «Lo de siempre»">Quitar lo marcado</button>
            <button class="btn sm" (click)="uncheckAll()" title="Todo vuelve a estar por hacer">Desmarcar todo</button></div>
          <ul class="items card done">
            @for (i of done(); track i.id) {
              <li class="row"><label class="row grow"><input type="checkbox" class="check big" [checked]="true" (change)="toggle(i, false)" />
                <span>{{ i.text }}</span></label></li>
            }
          </ul>
        }
        <p class="muted small foot">Actualizada {{ rel(l.updated_at) }}. Funciona sin conexión para consultarla; los cambios necesitan red.</p>

        @if (sharing()) {
          <div class="backdrop" (click)="sharing.set(false)">
            <div class="modal" role="dialog" [attr.aria-label]="'Compartir ' + l.name" (click)="$event.stopPropagation()">
              <h2>Compartir «{{ l.name }}»</h2>
              @if (l.is_owner) {
                <form class="row" (ngSubmit)="invite()">
                  <input class="input grow" name="who" [(ngModel)]="who" placeholder="Nombre de usuario o email" aria-label="Nombre de usuario o email" autocomplete="off" />
                  <button class="btn primary" [disabled]="who.trim().length < 3">Invitar</button>
                </form>
                <p class="muted small">Quien invites podrá ver la lista, añadir y marcar. Ideal para la compra en casa.</p>
              }
              <ul class="members">
                @for (m of l.members; track m.user_id) {
                  <li class="row"><strong>{{ m.name }}</strong><span class="muted">&#64;{{ m.username }}{{ m.owner ? ' · creó la lista' : '' }}</span><span class="spacer"></span>
                    @if (!m.owner && l.is_owner) { <button class="btn ghost icon sm" (click)="removeMember(m.user_id)" [attr.aria-label]="'Quitar a ' + m.name"><app-icon name="x" /></button> }</li>
                }
              </ul>
              <div class="actions">
                @if (!l.is_owner) { <button class="btn danger" (click)="leave()">Salir de la lista</button> }
                <span class="spacer"></span><button class="btn" (click)="sharing.set(false)">Cerrar</button>
              </div>
            </div>
          </div>
        }
        @if (editing()) {
          <div class="backdrop" (click)="editing.set(false)">
            <form class="modal" (click)="$event.stopPropagation()" (ngSubmit)="saveEdit()">
              <h2>Editar lista</h2>
              <div class="row"><input class="input emoji-in" name="e" [(ngModel)]="editEmoji" maxlength="4" aria-label="Emoji" />
                <input class="input grow" name="n" [(ngModel)]="editName" maxlength="100" aria-label="Nombre" required /></div>
              <div class="actions"><button type="button" class="btn danger" (click)="remove()">Eliminar</button><span class="spacer"></span>
                <button type="button" class="btn" (click)="editing.set(false)">Cancelar</button><button class="btn primary" [disabled]="!editName.trim()">Guardar</button></div>
            </form>
          </div>
        }
      } @else { <div class="skeleton" style="height:240px"></div> }
    }
  </div>`,
  styles: [`
    .narrow { max-width: 680px; }
    .new { padding: 18px; display: grid; gap: 12px; margin-bottom: 14px; h2 { margin: 0; font-size: 15px; } }
    .presets { display: grid; gap: 6px; }
    .preset { display: flex; gap: 12px; align-items: center; text-align: left; padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--radius-sm);
      background: var(--surface); color: var(--text); cursor: pointer; font: inherit; &:hover { border-color: var(--text-3); }
      span:last-child { display: grid; } small { font-size: 12px; } }
    .emoji { font-size: 20px; line-height: 1; } .emoji.big { font-size: 26px; }
    .emoji-in { width: 56px; text-align: center; flex: none; }
    .grow { flex: 1; min-width: 0; }
    .grid { display: grid; gap: 8px; }
    .lcard { display: flex; gap: 12px; align-items: center; padding: 14px 16px; color: inherit; text-decoration: none; border-left: 3px solid var(--c);
      &:hover { border-color: var(--text-3); border-left-color: var(--c); } .grow { display: grid; } small { font-size: 12.5px; } }
    .count { min-width: 26px; height: 26px; padding: 0 8px; border-radius: 13px; background: var(--accent-soft); color: var(--accent-text); display: grid; place-content: center; font-size: 13px; font-weight: 600; }
    .empty-state { padding: 28px; display: grid; justify-items: center; gap: 10px; text-align: center; app-icon { color: var(--accent); } }
    .back { display: inline-flex; align-items: center; gap: 4px; margin-bottom: 8px; text-decoration: none; font-size: 13px; }
    .title { gap: 12px; align-items: center; h1 { margin: 0; } p { margin: 2px 0 0; } }
    .add { padding: 6px 8px 6px 14px; gap: 8px; align-items: center; margin-bottom: 10px;
      input { border: none; background: none; outline: none; color: var(--text); font: inherit; padding: 8px 0; } }
    .sugg { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 10px;
      .chip { cursor: pointer; border: 1px dashed var(--border); background: var(--surface); font: inherit; font-size: 12.5px; &:hover { border-color: var(--accent); } } }
    .items { list-style: none; margin: 0 0 12px; padding: 4px 0;
      li { padding: 4px 12px; gap: 8px; align-items: center; min-height: 44px; border-bottom: 1px solid var(--border); &:last-child { border-bottom: none; } }
      label { gap: 12px; align-items: center; cursor: pointer; padding: 6px 0; span { overflow-wrap: anywhere; } }
      .empty { justify-content: center; font-size: 13px; } }
    .done li span { text-decoration: line-through; color: var(--text-muted); }
    .done-head { gap: 6px; align-items: center; margin: 6px 0; flex-wrap: wrap; h2 { margin: 0; font-size: 14px; color: var(--text-2); } }
    .small { font-size: 12.5px; } .foot { margin-top: 4px; }
    .members { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; li { gap: 8px; align-items: center; } }
    .actions { display: flex; gap: 8px; }
  `],
})
export class ListsComponent implements OnDestroy {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  private router = inject(Router);
  private auth = inject(AuthService);

  readonly id = input<string | undefined>();
  presets = PRESETS; rel = relativeTime; spoken = spokenToItems;
  lists = signal<ItemListSummary[] | null>(null);
  cur = signal<ItemListDetail | null>(null);
  creating = signal(false);
  sharing = signal(false);
  editing = signal(false);
  busy = signal(false);
  newName = ''; newEmoji = ''; newItem = ''; who = ''; editName = ''; editEmoji = '';
  private timer?: ReturnType<typeof setInterval>;

  pending = computed(() => (this.cur()?.items ?? []).filter(i => !i.checked));
  done = computed(() => (this.cur()?.items ?? []).filter(i => i.checked));

  constructor() {
    effect(() => {
      const id = this.id();
      clearInterval(this.timer);
      this.cur.set(null);
      if (id) {
        this.loadOne(+id);
        this.timer = setInterval(() => { if (document.visibilityState === 'visible' && !this.busy()) this.loadOne(+id, true); }, POLL_MS);
      } else this.loadAll();
    });
  }
  ngOnDestroy() { clearInterval(this.timer); }

  others(l: ItemListDetail) { return l.members.filter(m => !m.owner || !l.is_owner).map(m => m.name).filter(n => n).slice(0, 3).join(', '); }

  private loadAll() { this.api.lists().subscribe({ next: l => this.lists.set(l), error: e => { this.lists.set([]); this.toast.error(e); } }); }
  private loadOne(id: number, quiet = false) {
    this.api.list(id).subscribe({
      next: l => this.cur.set(l),
      error: e => { if (!quiet) { this.toast.error(e, 'No se encontró la lista'); this.router.navigate(['/lists']); } },
    });
  }
  private run(obs: ReturnType<ApiService['list']>) {
    this.busy.set(true);
    obs.subscribe({ next: l => { this.busy.set(false); this.cur.set(l); }, error: e => { this.busy.set(false); this.toast.error(e); } });
  }

  createPreset(p: typeof PRESETS[number]) {
    // Si ya existe una con ese nombre, se abre en vez de duplicarla
    const existing = this.lists()?.find(l => l.name.toLowerCase() === p.name.toLowerCase());
    if (existing) { this.router.navigate(['/lists', existing.id]); return; }
    this.create({ name: p.name, emoji: p.emoji, color: p.color, items: p.items });
  }
  createBlank() {
    if (!this.newName.trim()) return;
    this.create({ name: this.newName.trim(), emoji: this.newEmoji.trim(), color: COLORS[(this.lists()?.length ?? 0) % COLORS.length] });
  }
  private create(data: { name: string; emoji?: string; color?: string; items?: string[] }) {
    this.busy.set(true);
    this.api.createList(data).subscribe({
      next: l => { this.busy.set(false); this.creating.set(false); this.newName = this.newEmoji = ''; this.router.navigate(['/lists', l.id]); },
      error: e => { this.busy.set(false); this.toast.error(e); },
    });
  }

  add() { const t = this.newItem.trim(); if (t) { this.newItem = ''; this.addText(t); } }
  addText(text: string) { const l = this.cur(); if (l) this.run(this.api.addListItems(l.id, text)); }
  toggle(i: ListEntry, checked: boolean) {
    // Optimista: en el súper no hay que esperar a la red para ver el cambio
    this.cur.update(l => l && { ...l, pending: l.pending + (checked ? -1 : 1), items: l.items.map(x => (x.id === i.id ? { ...x, checked } : x)) });
    this.api.updateListItem(i.id, { checked }).subscribe({ next: l => this.cur.set(l), error: e => { this.toast.error(e); this.loadOne(this.cur()!.id); } });
  }
  forget(i: ListEntry) { this.run(this.api.forgetListItem(i.id)); }
  clearChecked() { const l = this.cur(); if (l) this.run(this.api.clearChecked(l.id)); }
  uncheckAll() { const l = this.cur(); if (l) this.run(this.api.uncheckAll(l.id)); }

  invite() {
    const l = this.cur();
    if (!l) return;
    this.api.addListMember(l.id, this.who.trim()).subscribe({
      next: d => { this.cur.set(d); this.who = ''; this.toast.success('Lista compartida'); },
      error: e => this.toast.error(e, 'No se pudo compartir'),
    });
  }
  removeMember(userId: number) {
    const l = this.cur()!;
    this.api.removeListMember(l.id, userId).subscribe({ next: () => this.loadOne(l.id), error: e => this.toast.error(e) });
  }
  leave() {
    const l = this.cur()!, me = this.auth.user()?.id;
    if (!me || !confirm(`¿Salir de «${l.name}»? Dejarás de verla.`)) return;
    this.api.removeListMember(l.id, me).subscribe({
      next: () => { this.sharing.set(false); this.router.navigate(['/lists']); }, error: e => this.toast.error(e),
    });
  }
  saveEdit() {
    const l = this.cur()!;
    this.api.updateList(l.id, { name: this.editName.trim(), emoji: this.editEmoji.trim() }).subscribe({
      next: d => { this.cur.set(d); this.editing.set(false); }, error: e => this.toast.error(e),
    });
  }
  remove() {
    const l = this.cur()!;
    if (!confirm(`¿Eliminar la lista «${l.name}»? También se olvidan sus sugerencias.`)) return;
    this.api.deleteList(l.id).subscribe({ next: () => { this.editing.set(false); this.router.navigate(['/lists']); }, error: e => this.toast.error(e) });
  }
}
