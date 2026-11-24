import { Component, ElementRef, Input, OnDestroy, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Observable } from 'rxjs';
import { ApiService } from '../core/api.service';
import { AttachmentService } from '../core/attachment.service';
import { ScanMode, TcgCard, TcgCardFields, TcgCollection, TcgEvent, TcgScanResult, TcgTotals } from '../core/models';
import { ToastService } from '../core/toast.service';
import { relativeTime } from '../core/util';
import { IconComponent } from '../shared/icon.component';

/** Foto de una carta: privada (se descarga con la sesión) o recién tomada (blob:). */
@Component({
  selector: 'app-card-img',
  standalone: true,
  imports: [IconComponent],
  template: `@if (url()) { <img [src]="url()" [alt]="alt" /> } @else { <span class="ph" aria-hidden="true"><app-icon name="cards" [size]="20" /></span> }`,
  styles: [`
    :host { display: block; aspect-ratio: 63 / 88; border-radius: 6px; overflow: hidden; background: var(--surface-2); flex: none; }
    img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .ph { width: 100%; height: 100%; display: grid; place-items: center; color: var(--text-3); }
  `],
})
export class CardImgComponent {
  private att = inject(AttachmentService);
  url = signal<string | null>(null);
  private current: string | null = null;
  @Input() alt = '';
  @Input() set src(v: string | null | undefined) {
    this.current = v ?? null;
    this.url.set(null);
    if (!v) return;
    if (v.startsWith('blob:')) { this.url.set(v); return; }
    this.att.objectUrl(v).then(u => { if (this.current === v) this.url.set(u); }).catch(() => {});
  }
}

type Tab = 'scan' | 'list';
type Filter = 'all' | 'owned' | 'dupes' | 'wanted';
type Sort = 'number' | 'name' | 'quantity';
type CameraState = 'off' | 'starting' | 'on' | 'denied' | 'unsupported';
interface Editor {
  kind: 'new' | 'edit' | 'apply';
  mode: ScanMode;
  card?: TcgCard;
  fields: TcgCardFields;
  quantity: number;
  wanted: boolean;
  photo?: Blob | null;
}

const MODES: { mode: ScanMode; icon: string; label: string; hint: string }[] = [
  { mode: 'add', icon: 'plus', label: 'Añadir', hint: 'Suma la carta a tu colección' },
  { mode: 'remove', icon: 'minus', label: 'Quitar', hint: 'Resta una copia (cambio, venta…)' },
  { mode: 'check', icon: 'eye', label: 'Consultar', hint: 'Dice cuántas tienes, sin cambiar nada' },
  { mode: 'wish', icon: 'star', label: 'Deseos', hint: 'La apunta en tu lista de deseos' },
];
const APPLY_LABEL: Record<ScanMode, string> = {
  add: 'Añadir a la colección', remove: 'Quitar de la colección', check: 'Consultar', wish: 'Añadir a deseos',
};
const EMPTY_FIELDS: TcgCardFields = { name: '', number: '', set_name: '', rarity: '', card_type: '' };
const MAX_SIDE = 1200;  // la foto que se envía: suficiente para leer el texto pequeño, ligera de subir

const copies = (n: number) => n === 1 ? '1 copia' : `${n} copias`;
const cards = (n: number) => n === 1 ? '1 carta' : `${n.toLocaleString('es-ES')} cartas`;

@Component({
  selector: 'app-collection',
  standalone: true,
  imports: [FormsModule, IconComponent, CardImgComponent],
  template: `
  <div class="page">
    <div class="page-head">
      <div><h1>Colección Cyberpunk TCG</h1><p>Enseña una carta a la cámara y elige qué hacer con ella.</p></div>
    </div>

    <div class="tiles" aria-label="Resumen de la colección">
      <div class="card tile"><span>Cartas en total</span><strong data-testid="total-copies">{{ totals().copies }}</strong></div>
      <div class="card tile"><span>Distintas</span><strong>{{ totals().unique }}</strong></div>
      <div class="card tile"><span>Repetidas</span><strong>{{ totals().duplicates }}</strong></div>
      <div class="card tile"><span>Lista de deseos</span><strong>{{ totals().wanted }}</strong></div>
    </div>

    <div class="tabs" role="tablist">
      <button role="tab" [class.active]="tab() === 'scan'" [attr.aria-selected]="tab() === 'scan'" (click)="setTab('scan')"><app-icon name="camera" [size]="15" /> Escanear</button>
      <button role="tab" [class.active]="tab() === 'list'" [attr.aria-selected]="tab() === 'list'" (click)="setTab('list')"><app-icon name="cards" [size]="15" /> Mi colección ({{ data()?.cards?.length ?? 0 }})</button>
    </div>

    @if (tab() === 'scan') {
      <div class="scan-grid">
        <section class="scanner">
          <div class="modes" role="radiogroup" aria-label="Qué hacer con la carta">
            @for (m of modes; track m.mode) {
              <button role="radio" class="mode" [class.on]="mode() === m.mode" [attr.aria-checked]="mode() === m.mode" [title]="m.hint" (click)="mode.set(m.mode)">
                <app-icon [name]="m.icon" [size]="18" /><span>{{ m.label }}</span>
              </button>
            }
          </div>
          <p class="mode-hint muted">{{ modeHint() }}
            @if (mode() === 'add' || mode() === 'remove') {
              <span class="qty-pick" role="group" aria-label="Copias por escaneo">
                <button class="btn icon sm" (click)="setQty(qty() - 1)" [disabled]="qty() <= 1" aria-label="Menos copias"><app-icon name="minus" [size]="14" /></button>
                <span aria-live="polite">×{{ qty() }}</span>
                <button class="btn icon sm" (click)="setQty(qty() + 1)" aria-label="Más copias"><app-icon name="plus" [size]="14" /></button>
              </span>
            }
          </p>

          @if (data() && !data()!.recognition) {
            <div class="card notice">
              <app-icon name="alert" [size]="18" />
              <p>El reconocimiento de cartas no está configurado en el servidor (falta <code>ANTHROPIC_API_KEY</code>).
                Mientras tanto puedes añadir las cartas a mano.</p>
            </div>
          } @else {
            <div class="viewport" [class.live]="cam() === 'on'">
              <video #video playsinline muted autoplay [hidden]="cam() !== 'on'" (click)="shoot()"></video>
              @if (cam() === 'on') {
                <div #frame class="frame" aria-hidden="true">@if (!result()) { <span>Encuadra la carta</span> }</div>
              } @else {
                <div class="cam-msg">
                  @switch (cam()) {
                    @case ('starting') { <p>Abriendo la cámara…</p> }
                    @case ('denied') { <app-icon name="camera" [size]="28" /><p>No hay permiso para usar la cámara. Actívalo en el navegador o sube una foto.</p>
                      <button class="btn" (click)="startCamera()">Reintentar</button> }
                    @case ('unsupported') { <app-icon name="camera" [size]="28" /><p>No se encuentra una cámara. Puedes subir o hacer una foto de la carta.</p> }
                    @default { <app-icon name="camera" [size]="28" /><button class="btn primary" (click)="startCamera()">Activar cámara</button> }
                  }
                </div>
              }
              @if (result(); as r) { @if (!busy()) { <div class="flash" [class]="'flash ' + r.status" data-testid="scan-flash">{{ flashText(r) }}</div> } }
              @if (busy()) { <div class="reading" role="status"><span class="spin"></span> Leyendo la carta…</div> }
              @if (cam() === 'on') {
                <button class="shutter" (click)="shoot()" [disabled]="busy()" aria-label="Escanear carta"><span></span></button>
              }
            </div>
            <div class="row alt">
              <label class="btn" [class.disabled]="busy()">
                <app-icon name="image" [size]="15" /> Subir o hacer foto
                <input type="file" accept="image/*" capture="environment" hidden (change)="fromFile($event)" [disabled]="busy()" data-testid="photo-input" />
              </label>
              <span class="spacer"></span>
              <button class="btn ghost" (click)="openManual()"><app-icon name="edit" [size]="15" /> A mano</button>
            </div>
          }
          @if (data() && !data()!.recognition) {
            <button class="btn primary" (click)="openManual()"><app-icon name="plus" [size]="15" /> Añadir carta a mano</button>
          }
        </section>

        <section class="side">
          @if (result(); as r) {
            <div class="card result" [class]="'card result ' + r.status" aria-live="polite" data-testid="scan-result">
              <app-card-img class="pic" [src]="r.card?.image_url || photoUrl()" [alt]="r.card?.name || 'Foto escaneada'" />
              <div class="info">
                @switch (r.status) {
                  @case ('done') {
                    <p class="msg"><app-icon [name]="modeIcon(r.mode)" [size]="15" /> {{ r.message }}@if (r.delta > 1 || r.delta < -1) { ({{ r.delta > 0 ? '+' : '' }}{{ r.delta }}) }</p>
                    <h2>{{ r.card!.name }}</h2>
                    <p class="meta">{{ meta(r.card!) }}</p>
                    <p class="have">{{ haveText(r.card!) }}</p>
                    @if (r.card!.wanted && !r.card!.quantity) { <span class="chip tag"><app-icon name="star" [size]="12" /> En tu lista de deseos</span> }
                  }
                  @case ('missing') {
                    <p class="msg"><app-icon name="alert" [size]="15" /> {{ r.message }}</p>
                    <h2>{{ r.reading?.name }}</h2>
                    <p class="meta">{{ meta(r.reading!) }}</p>
                  }
                  @case ('choose') {
                    <p class="msg"><app-icon name="search" [size]="15" /> He leído «{{ r.reading?.name }}»@if (r.reading?.number) { ({{ r.reading?.number }}) }. ¿Cuál de estas es?</p>
                  }
                  @default {
                    <p class="msg"><app-icon name="alert" [size]="15" /> {{ r.message }}</p>
                  }
                }
                <p class="total">Total de tu colección: <strong>{{ cardsText(r.totals.copies) }}</strong> · {{ r.totals.unique }} distintas</p>
              </div>

              @if (r.status === 'choose') {
                <ul class="cands">
                  @for (c of r.candidates; track c.id) {
                    <li><button class="cand" (click)="pick(r, c)" [disabled]="busy()">
                      <app-card-img [src]="c.image_url" [alt]="c.name" />
                      <span class="truncate"><strong>{{ c.name }}</strong><small>{{ meta(c) }} · tienes {{ c.quantity }}</small></span>
                    </button></li>
                  }
                </ul>
              }

              <div class="actions">
                @switch (r.status) {
                  @case ('done') {
                    @if (r.event_id) { <button class="btn" (click)="undo(r)" [disabled]="busy()"><app-icon name="undo" [size]="15" /> Deshacer</button> }
                    @if (r.mode === 'check') {
                      <button class="btn" (click)="quick('add', r.card!)" [disabled]="busy()"><app-icon name="plus" [size]="15" /> Añadir 1</button>
                      @if (r.card!.quantity) { <button class="btn" (click)="quick('remove', r.card!)" [disabled]="busy()"><app-icon name="minus" [size]="15" /> Quitar 1</button> }
                    }
                    <span class="spacer"></span>
                    <button class="btn ghost" (click)="correct(r)" [disabled]="busy()">No es esta carta</button>
                  }
                  @case ('missing') {
                    <button class="btn primary" (click)="applyReading(r, 'add')" [disabled]="busy()"><app-icon name="plus" [size]="15" /> Añadir a la colección</button>
                    <button class="btn" (click)="applyReading(r, 'wish')" [disabled]="busy()"><app-icon name="star" [size]="15" /> A deseos</button>
                    <span class="spacer"></span>
                    <button class="btn ghost" (click)="correct(r)" [disabled]="busy()">Corregir</button>
                  }
                  @default {
                    <span class="spacer"></span>
                    <button class="btn" (click)="correct(r)" [disabled]="busy()"><app-icon name="edit" [size]="15" /> {{ r.status === 'choose' ? 'Otra: escribirla' : 'Escribirla a mano' }}</button>
                  }
                }
              </div>
            </div>
          } @else {
            <div class="card result idle">
              <app-icon name="cards" [size]="26" />
              <p>Elige una función, pon la carta dentro del recuadro y pulsa el botón. Verás aquí cuál es, cuántas tienes y el total de tu colección.</p>
            </div>
          }

          @if (events().length) {
            <div class="card recent">
              <h2>Últimos cambios</h2>
              <ul>
                @for (e of events(); track e.id) {
                  <li>
                    <span class="delta" [class.neg]="e.delta < 0">{{ eventLabel(e) }}</span>
                    <span class="truncate">{{ e.card.name }} <small class="muted">{{ e.card.number }}</small></span>
                    <small class="muted when">{{ when(e.created_at) }}</small>
                    <button class="btn ghost icon sm" (click)="undoEvent(e)" [attr.aria-label]="'Deshacer ' + e.card.name" title="Deshacer"><app-icon name="undo" [size]="14" /></button>
                  </li>
                }
              </ul>
            </div>
          }
        </section>
      </div>
    } @else {
      <div class="toolbar">
        <input class="input search" type="search" placeholder="Buscar por nombre o número" aria-label="Buscar carta" [ngModel]="q()" (ngModelChange)="q.set($event)" />
        <div class="filters" role="group" aria-label="Filtrar">
          @for (f of filters; track f.key) {
            <button class="btn sm" [class.active]="filter() === f.key" [attr.aria-pressed]="filter() === f.key" (click)="filter.set(f.key)">{{ f.label }}</button>
          }
        </div>
        <select class="input sort" aria-label="Ordenar" [ngModel]="sort()" (ngModelChange)="sort.set($event)">
          <option value="number">Por número</option><option value="name">Por nombre</option><option value="quantity">Por copias</option>
        </select>
        <button class="btn primary" (click)="openNew()"><app-icon name="plus" [size]="15" /> Añadir</button>
      </div>

      @if (!data()) {
        <div class="skeleton" style="height: 240px"></div>
      } @else if (!data()!.cards.length) {
        <div class="empty"><h3>Tu colección está vacía</h3><p>Escanea tu primera carta o añádela a mano.</p>
          <button class="btn primary" (click)="setTab('scan')"><app-icon name="camera" [size]="15" /> Escanear</button></div>
      } @else if (!visible().length) {
        <div class="empty"><p>Ninguna carta coincide con la búsqueda.</p></div>
      } @else {
        <ul class="list">
          @for (c of visible(); track c.id) {
            <li class="card item" [class.zero]="!c.quantity">
              <button class="open" (click)="openEdit(c)" [attr.aria-label]="'Editar ' + c.name">
                <app-card-img [src]="c.image_url" [alt]="c.name" />
                <span class="body">
                  <strong class="truncate">{{ c.name }}</strong>
                  <small class="truncate">{{ meta(c) }}</small>
                  @if (c.wanted && !c.quantity) { <span class="chip tag"><app-icon name="star" [size]="11" /> Deseada</span> }
                </span>
              </button>
              <div class="qty" role="group" [attr.aria-label]="'Copias de ' + c.name">
                <button class="btn icon sm" (click)="adjust(c, -1)" [disabled]="!c.quantity" [attr.aria-label]="'Quitar una copia de ' + c.name"><app-icon name="minus" [size]="14" /></button>
                <span class="n">{{ c.quantity }}</span>
                <button class="btn icon sm" (click)="adjust(c, 1)" [attr.aria-label]="'Añadir una copia de ' + c.name"><app-icon name="plus" [size]="14" /></button>
              </div>
            </li>
          }
        </ul>
      }
    }
  </div>

  @if (editor(); as ed) {
    <div class="backdrop" (click)="editor.set(null)">
      <form class="modal" (click)="$event.stopPropagation()" (ngSubmit)="saveEditor()" role="dialog" aria-modal="true" aria-labelledby="ed-title">
        <h2 id="ed-title">{{ ed.kind === 'edit' ? 'Editar carta' : ed.kind === 'new' ? 'Añadir carta' : '¿Qué carta es?' }}</h2>
        <label class="field">Nombre<input class="input" name="name" [(ngModel)]="ed.fields.name" required maxlength="120" autocomplete="off" list="tcg-names" /></label>
        <datalist id="tcg-names">@for (c of data()?.cards ?? []; track c.id) { <option [value]="c.name"></option> }</datalist>
        <div class="two">
          <label class="field">Número<input class="input" name="number" [(ngModel)]="ed.fields.number" maxlength="20" placeholder="p. ej. 014 o β001" autocomplete="off" /></label>
          <label class="field">Rareza<input class="input" name="rarity" [(ngModel)]="ed.fields.rarity" maxlength="40" autocomplete="off" /></label>
          <label class="field">Tipo<input class="input" name="card_type" [(ngModel)]="ed.fields.card_type" maxlength="40" autocomplete="off" /></label>
          <label class="field">Set<input class="input" name="set_name" [(ngModel)]="ed.fields.set_name" maxlength="80" autocomplete="off" /></label>
        </div>
        @if (ed.kind !== 'apply') {
          <div class="two">
            <label class="field">Copias<input class="input" type="number" name="quantity" min="0" max="999" [(ngModel)]="ed.quantity" /></label>
            <label class="row wish"><input type="checkbox" name="wanted" [(ngModel)]="ed.wanted" /> En la lista de deseos</label>
          </div>
        }
        @if (ed.kind === 'edit') {
          <div class="row">
            <label class="btn sm"><app-icon name="image" [size]="14" /> {{ ed.card?.image_url ? 'Cambiar foto' : 'Añadir foto' }}
              <input type="file" accept="image/*" capture="environment" hidden (change)="changePhoto(ed, $event)" /></label>
            <span class="spacer"></span>
            <button type="button" class="btn sm danger" (click)="remove(ed)"><app-icon name="trash" [size]="14" /> Eliminar</button>
          </div>
        }
        <div class="actions">
          <button type="button" class="btn" (click)="editor.set(null)">Cancelar</button>
          <button type="submit" class="btn primary" [disabled]="busy() || !ed.fields.name.trim()">{{ ed.kind === 'apply' ? applyLabel[ed.mode] : 'Guardar' }}</button>
        </div>
      </form>
    </div>
  }
  `,
  styles: [`
    .tiles { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-bottom: 16px; }
    .tile { padding: 10px 14px; display: grid; gap: 2px;
      span { font-size: 12px; color: var(--text-2); } strong { font-size: 24px; font-weight: 600; line-height: 1.2; font-variant-numeric: tabular-nums; } }
    .tabs button { display: inline-flex; align-items: center; gap: 6px; }

    .scan-grid { display: grid; grid-template-columns: minmax(0, 460px) minmax(0, 1fr); gap: 16px; align-items: start; }
    .scanner, .side { display: grid; gap: 10px; min-width: 0; }
    .modes { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
    .mode { display: grid; justify-items: center; gap: 2px; padding: 8px 4px; border-radius: var(--radius); border: 1px solid var(--border);
      background: var(--surface); color: var(--text-2); font-size: 12.5px; font-weight: 500;
      &:hover { background: var(--surface-2); } &.on { background: var(--accent); border-color: var(--accent); color: var(--on-accent); } }
    .mode-hint { font-size: 12.5px; display: flex; align-items: center; gap: 8px; min-height: 26px; }
    .qty-pick { margin-left: auto; display: inline-flex; align-items: center; gap: 6px; color: var(--text); font-variant-numeric: tabular-nums; }

    .viewport { position: relative; width: 100%; aspect-ratio: 3 / 4; max-height: 64vh; border-radius: var(--radius); overflow: hidden;
      background: var(--surface-2); border: 1px solid var(--border); display: grid; place-items: center;
      &.live { background: #000; border-color: #000; } }
    video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; cursor: pointer; }
    .frame { position: absolute; top: 44%; left: 50%; height: 70%; aspect-ratio: 63 / 88; transform: translate(-50%, -50%); max-width: 86%;
      border: 2px solid rgba(255, 255, 255, .9); border-radius: 14px; box-shadow: 0 0 0 100vmax rgba(0, 0, 0, .38); pointer-events: none;
      span { position: absolute; top: -26px; left: 0; right: 0; text-align: center; color: #fff; font-size: 12.5px; text-shadow: 0 1px 2px #000; } }
    .cam-msg { display: grid; justify-items: center; gap: 10px; padding: 24px; text-align: center; color: var(--text-2); max-width: 300px; }
    .shutter { position: absolute; bottom: 14px; left: 50%; transform: translateX(-50%); width: 68px; height: 68px; border-radius: 50%;
      border: 4px solid #fff; background: rgba(255, 255, 255, .25); display: grid; place-items: center; padding: 0;
      span { width: 50px; height: 50px; border-radius: 50%; background: #fff; transition: transform .1s; }
      &:active span { transform: scale(.88); } &:disabled { opacity: .5; } }
    .flash { position: absolute; top: 10px; left: 10px; right: 10px; padding: 8px 12px; border-radius: var(--radius); text-align: center;
      background: rgba(10, 120, 40, .92); color: #fff; font-weight: 600; font-size: 14px; line-height: 1.35; box-shadow: 0 4px 16px rgba(0, 0, 0, .35);
      &.missing, &.unreadable { background: rgba(160, 100, 0, .94); } &.choose { background: rgba(70, 50, 170, .94); } }
    .reading { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: 10px;
      background: rgba(0, 0, 0, .55); color: #fff; font-weight: 500; }
    .spin { width: 18px; height: 18px; border-radius: 50%; border: 2px solid rgba(255, 255, 255, .35); border-top-color: #fff; animation: spin .8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .alt { flex-wrap: wrap; }
    label.btn.disabled { opacity: .5; pointer-events: none; }
    .notice { display: flex; gap: 10px; padding: 12px 14px; align-items: flex-start; app-icon { color: var(--warning); margin-top: 2px; } code { font-size: 12px; } }

    .result { padding: 14px; display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: 8px 14px; align-items: start; }
    .result.idle { grid-template-columns: auto 1fr; align-items: center; color: var(--text-2); app-icon { color: var(--accent); } }
    .result.done { border-color: color-mix(in srgb, var(--good) 55%, var(--border)); }
    .result.missing, .result.unreadable { border-color: color-mix(in srgb, var(--warning) 55%, var(--border)); }
    .pic { width: 96px; }
    .info { display: grid; gap: 4px; min-width: 0; h2 { font-size: 18px; overflow-wrap: anywhere; } }
    .msg { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 500; color: var(--text-2); }
    .done .msg { color: var(--good); }
    .meta { color: var(--text-3); font-size: 12.5px; }
    .have { font-size: 15px; font-weight: 600; }
    .total { font-size: 13px; color: var(--text-2); margin-top: 4px; strong { color: var(--text); } }
    .cands, .actions { grid-column: 1 / -1; }
    .cands { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
    .cand { width: 100%; display: flex; align-items: center; gap: 10px; text-align: left; padding: 6px; border-radius: var(--radius-sm);
      border: 1px solid var(--border); background: var(--surface-2); app-card-img { width: 36px; }
      span { display: grid; } small { color: var(--text-3); } &:hover { border-color: var(--accent); } }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .recent { padding: 12px 14px; h2 { font-size: 14px; margin-bottom: 6px; }
      ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
      li { display: flex; align-items: center; gap: 8px; font-size: 13px; min-height: 30px; }
      .delta { width: 36px; flex: none; font-weight: 600; color: var(--good); font-variant-numeric: tabular-nums; &.neg { color: var(--critical); } }
      .when { margin-left: auto; white-space: nowrap; } }

    .toolbar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 12px;
      .search { flex: 1 1 200px; width: auto; } .sort { width: auto; } }
    .filters { display: flex; gap: 4px; flex-wrap: wrap; }
    .list { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 8px; }
    .item { display: flex; align-items: center; gap: 8px; padding: 8px 10px 8px 8px; &.zero { opacity: .6; } }
    .open { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; background: none; border: 0; padding: 0; text-align: left;
      app-card-img { width: 44px; } }
    .body { display: grid; gap: 1px; min-width: 0; justify-items: start; small { color: var(--text-3); font-size: 12px; max-width: 100%; } }
    .qty { display: flex; align-items: center; gap: 4px; .n { min-width: 26px; text-align: center; font-weight: 600; font-size: 15px; font-variant-numeric: tabular-nums; } }

    .two { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .wish { align-self: end; height: 32px; font-size: 13px; }

    @media (max-width: 820px) {
      .page { padding: 12px 12px 40px; }
      .page-head { margin-bottom: 12px; padding-left: 36px; }
      .tiles { gap: 6px; margin-bottom: 8px; }
      .tile { padding: 6px 8px; span { font-size: 11px; line-height: 1.25; } strong { font-size: 18px; } }
      .page-head p { display: none; }
      .tabs { margin-bottom: 10px; }
      .scan-grid { grid-template-columns: minmax(0, 1fr); }
      .viewport { aspect-ratio: 4 / 5; max-height: 46vh; }
      .mode { grid-auto-flow: column; justify-content: center; align-items: center; gap: 5px; padding: 8px 2px; font-size: 12px; }
      .mode-hint { font-size: 12px; }
      .list { grid-template-columns: minmax(0, 1fr); }
      .qty .btn.icon.sm { width: 34px; height: 34px; }
    }
  `],
})
export class CollectionComponent implements OnInit, OnDestroy {
  private api = inject(ApiService);
  private toast = inject(ToastService);

  readonly modes = MODES;
  readonly applyLabel = APPLY_LABEL;
  readonly filters: { key: Filter; label: string }[] = [
    { key: 'all', label: 'Todas' }, { key: 'owned', label: 'Las tengo' }, { key: 'dupes', label: 'Repetidas' }, { key: 'wanted', label: 'Deseos' },
  ];

  video = viewChild<ElementRef<HTMLVideoElement>>('video');
  frame = viewChild<ElementRef<HTMLElement>>('frame');

  data = signal<TcgCollection | null>(null);
  tab = signal<Tab>('scan');
  mode = signal<ScanMode>('add');
  qty = signal(1);
  cam = signal<CameraState>('off');
  busy = signal(false);
  result = signal<TcgScanResult | null>(null);
  photoUrl = signal<string | null>(null);
  events = signal<TcgEvent[]>([]);
  editor = signal<Editor | null>(null);
  q = signal('');
  filter = signal<Filter>('all');
  sort = signal<Sort>('number');

  totals = computed<TcgTotals>(() => this.data()?.totals ?? { copies: 0, unique: 0, duplicates: 0, wanted: 0 });
  modeHint = computed(() => MODES.find(m => m.mode === this.mode())!.hint);
  visible = computed(() => {
    const q = this.q().trim().toLowerCase();
    const f = this.filter();
    const list = (this.data()?.cards ?? []).filter(c =>
      (!q || c.name.toLowerCase().includes(q) || c.number.toLowerCase().includes(q)) &&
      (f === 'all' || (f === 'owned' && c.quantity > 0) || (f === 'dupes' && c.quantity > 1) || (f === 'wanted' && c.wanted && !c.quantity)));
    const by = this.sort();
    return [...list].sort((a, b) =>
      by === 'quantity' ? b.quantity - a.quantity || a.name.localeCompare(b.name, 'es') :
      by === 'name' ? a.name.localeCompare(b.name, 'es') || a.number.localeCompare(b.number, 'es', { numeric: true }) :
      (a.number || '~').localeCompare(b.number || '~', 'es', { numeric: true }) || a.name.localeCompare(b.name, 'es'));
  });

  private stream: MediaStream | null = null;
  private photo: Blob | null = null;
  private destroyed = false;
  private onVisibility = () => {
    if (document.hidden) this.stopCamera();
    else if (this.tab() === 'scan' && this.data()?.recognition && this.cam() === 'off') this.startCamera();
  };

  ngOnInit() {
    this.load(true);
    this.loadEvents();
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  ngOnDestroy() {
    this.destroyed = true;
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.stopCamera();
    this.setPhoto(null);
  }

  load(first = false) {
    this.api.tcg().subscribe({
      next: d => {
        this.data.set(d);
        if (first && d.recognition && this.tab() === 'scan') this.startCamera();
      },
      error: e => this.toast.error(e, 'No se pudo cargar la colección'),
    });
  }
  loadEvents() { this.api.tcgEvents().subscribe({ next: e => this.events.set(e), error: () => {} }); }

  setTab(t: Tab) {
    this.tab.set(t);
    if (t === 'scan' && this.data()?.recognition) setTimeout(() => this.startCamera());
    else this.stopCamera();
  }
  setQty(n: number) { this.qty.set(Math.max(1, Math.min(20, n))); }

  // --- Cámara ---------------------------------------------------------------------------------

  async startCamera() {
    if (this.stream || this.cam() === 'starting') return;
    if (!navigator.mediaDevices?.getUserMedia) { this.cam.set('unsupported'); return; }
    this.cam.set('starting');
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } },
      });
      if (this.destroyed || this.tab() !== 'scan' || document.hidden) { s.getTracks().forEach(t => t.stop()); this.cam.set('off'); return; }
      this.stream = s;
      this.cam.set('on');
      const v = this.video()?.nativeElement;
      if (v) { v.srcObject = s; await v.play().catch(() => {}); }
    } catch (e) {
      const name = (e as DOMException)?.name;
      this.cam.set(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unsupported');
    }
  }

  stopCamera() {
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
    const v = this.video()?.nativeElement;
    if (v) v.srcObject = null;
    if (this.cam() === 'on' || this.cam() === 'starting') this.cam.set('off');
  }

  /** Recorta del vídeo lo que hay dentro del recuadro (con un poco de margen) y lo pasa a JPEG. */
  private grab(): Promise<Blob | null> {
    const v = this.video()?.nativeElement, f = this.frame()?.nativeElement;
    if (!v || !f || !v.videoWidth) return Promise.resolve(null);
    const vr = v.getBoundingClientRect(), fr = f.getBoundingClientRect();
    const scale = Math.max(vr.width / v.videoWidth, vr.height / v.videoHeight);  // object-fit: cover
    const offX = (vr.width - v.videoWidth * scale) / 2, offY = (vr.height - v.videoHeight * scale) / 2;
    let sw = fr.width / scale * 1.12, sh = fr.height / scale * 1.12;
    let sx = (fr.left - vr.left - offX) / scale - fr.width / scale * 0.06;
    let sy = (fr.top - vr.top - offY) / scale - fr.height / scale * 0.06;
    sx = Math.max(0, sx); sy = Math.max(0, sy);
    sw = Math.min(sw, v.videoWidth - sx); sh = Math.min(sh, v.videoHeight - sy);
    const k = Math.min(1, MAX_SIDE / Math.max(sw, sh));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(sw * k); canvas.height = Math.round(sh * k);
    canvas.getContext('2d')!.drawImage(v, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    return new Promise(res => canvas.toBlob(b => res(b), 'image/jpeg', 0.88));
  }

  /** Reduce una foto del carrete (que puede pesar varios MB) antes de enviarla. */
  private async shrink(file: File): Promise<Blob> {
    try {
      const bmp = await createImageBitmap(file);
      const k = Math.min(1, (MAX_SIDE * 1.3) / Math.max(bmp.width, bmp.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bmp.width * k); canvas.height = Math.round(bmp.height * k);
      canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      bmp.close();
      return await new Promise<Blob>((res, rej) => canvas.toBlob(b => b ? res(b) : rej(), 'image/jpeg', 0.88));
    } catch {
      return file;
    }
  }

  async shoot() {
    if (this.busy()) return;
    const blob = await this.grab();
    if (!blob) { this.toast.error('La cámara aún no está lista'); return; }
    this.send(blob);
  }

  async fromFile(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.send(await this.shrink(file));
  }

  private setPhoto(b: Blob | null) {
    const old = this.photoUrl();
    if (old) URL.revokeObjectURL(old);
    this.photo = b;
    this.photoUrl.set(b ? URL.createObjectURL(b) : null);
  }

  private send(photo: Blob) {
    this.setPhoto(photo);
    this.run(this.api.tcgScan(this.mode(), photo, this.mode() === 'add' || this.mode() === 'remove' ? this.qty() : 1));
  }

  /** Lanza una petición que devuelve un resultado de escaneo y lo muestra. */
  private run(req: Observable<TcgScanResult>) {
    this.busy.set(true);
    req.subscribe({
      next: r => {
        this.busy.set(false);
        this.result.set(r);
        this.absorb(r.card, r.totals);
        if (r.event_id) this.loadEvents();
        navigator.vibrate?.(r.status === 'done' ? 40 : [30, 60, 30]);
      },
      error: e => { this.busy.set(false); this.toast.error(e, 'No se pudo leer la carta'); },
    });
  }

  /** Refleja en la lista una carta cambiada y los nuevos totales. */
  private absorb(card: TcgCard | null, totals: TcgTotals, removedId?: number) {
    this.data.update(d => {
      if (!d) return d;
      let list = d.cards.filter(c => c.id !== removedId);
      if (card) list = list.some(c => c.id === card.id) ? list.map(c => c.id === card.id ? card : c) : [...list, card];
      return { ...d, cards: list, totals };
    });
  }

  // --- Acciones sobre el resultado ------------------------------------------------------------

  pick(r: TcgScanResult, c: TcgCard) { this.run(this.api.tcgApply(r.mode, { cardId: c.id }, this.photo, this.qtyFor(r.mode))); }
  applyReading(r: TcgScanResult, mode: ScanMode) { this.run(this.api.tcgApply(mode, { fields: this.fieldsOf(r.reading) }, this.photo)); }
  quick(mode: ScanMode, c: TcgCard) { this.run(this.api.tcgApply(mode, { cardId: c.id })); }

  undo(r: TcgScanResult) {
    if (!r.event_id) return;
    this.api.tcgUndo(r.event_id).subscribe({
      next: u => {
        this.absorb(u.card, u.totals, u.removed ? r.card?.id : undefined);
        this.result.set(null);
        this.loadEvents();
        this.toast.show('Deshecho');
      },
      error: e => this.toast.error(e),
    });
  }

  undoEvent(e: TcgEvent) {
    this.api.tcgUndo(e.id).subscribe({
      next: u => {
        this.absorb(u.card, u.totals, u.removed ? e.card.id : undefined);
        if (this.result()?.event_id === e.id) this.result.set(null);
        this.loadEvents();
        this.toast.show(`Deshecho: ${e.card.name}`);
      },
      error: err => this.toast.error(err),
    });
  }

  /** «No es esta carta»: deshace lo hecho (si algo se hizo) y deja escribir cuál es. */
  correct(r: TcgScanResult) {
    const open = () => this.editor.set({
      kind: 'apply', mode: r.mode, fields: this.fieldsOf(r.card ?? r.reading), quantity: 0, wanted: false, photo: this.photo,
    });
    if (r.status === 'done' && r.event_id) {
      this.api.tcgUndo(r.event_id).subscribe({
        next: u => { this.absorb(u.card, u.totals, u.removed ? r.card?.id : undefined); this.loadEvents(); open(); },
        error: e => this.toast.error(e),
      });
    } else open();
  }

  openManual() {
    this.editor.set({ kind: 'apply', mode: this.mode() === 'check' ? 'check' : this.mode(), fields: { ...EMPTY_FIELDS }, quantity: 0, wanted: false, photo: null });
  }
  openNew() { this.editor.set({ kind: 'new', mode: 'add', fields: { ...EMPTY_FIELDS }, quantity: 1, wanted: false }); }
  openEdit(c: TcgCard) { this.editor.set({ kind: 'edit', mode: 'add', card: c, fields: this.fieldsOf(c), quantity: c.quantity, wanted: c.wanted }); }

  saveEditor() {
    const ed = this.editor();
    if (!ed || !ed.fields.name.trim()) return;
    if (ed.kind === 'apply') {
      this.editor.set(null);
      this.run(this.api.tcgApply(ed.mode, { fields: ed.fields }, ed.photo, this.qtyFor(ed.mode)));
      return;
    }
    const body = { ...ed.fields, quantity: Math.max(0, Math.min(999, Math.round(Number(ed.quantity) || 0))), wanted: !!ed.wanted };
    const req = ed.kind === 'edit' ? this.api.tcgUpdate(ed.card!.id, body) : this.api.tcgCreate(body);
    this.busy.set(true);
    req.subscribe({
      next: r => { this.busy.set(false); this.absorb(r.card, r.totals); this.editor.set(null); this.toast.success(ed.kind === 'edit' ? 'Carta guardada' : 'Carta añadida'); },
      error: e => { this.busy.set(false); this.toast.error(e); },
    });
  }

  async changePhoto(ed: Editor, ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !ed.card) return;
    this.api.tcgImage(ed.card.id, await this.shrink(file)).subscribe({
      next: r => { this.absorb(r.card, r.totals); this.editor.set({ ...ed, card: r.card }); this.toast.success('Foto actualizada'); },
      error: e => this.toast.error(e),
    });
  }

  remove(ed: Editor) {
    const c = ed.card;
    if (!c || !confirm(`¿Eliminar «${c.name}» de tu colección? Se pierden sus copias y su foto.`)) return;
    this.api.tcgDelete(c.id).subscribe({
      next: () => { this.editor.set(null); this.load(); this.loadEvents(); this.toast.show('Carta eliminada'); },
      error: e => this.toast.error(e),
    });
  }

  adjust(c: TcgCard, delta: number) {
    this.api.tcgAdjust(c.id, delta).subscribe({
      next: r => { this.absorb(r.card, r.totals); this.loadEvents(); },
      error: e => this.toast.error(e),
    });
  }

  // --- Textos ---------------------------------------------------------------------------------

  private qtyFor(mode: ScanMode) { return mode === 'add' || mode === 'remove' ? this.qty() : 1; }
  private fieldsOf(src: Partial<TcgCardFields> | null | undefined): TcgCardFields {
    return { name: src?.name ?? '', number: src?.number ?? '', set_name: src?.set_name ?? '', rarity: src?.rarity ?? '', card_type: src?.card_type ?? '' };
  }
  modeIcon(m: ScanMode) { return MODES.find(x => x.mode === m)?.icon ?? 'cards'; }
  meta(c: Partial<TcgCardFields>) { return [c.number || 'sin número', c.rarity, c.card_type].filter(Boolean).join(' · '); }
  haveText(c: TcgCard) { return c.quantity ? `Tienes ${copies(c.quantity)}` : 'No te queda ninguna copia'; }
  cardsText(n: number) { return cards(n); }
  eventLabel(e: TcgEvent) {
    if (e.mode === 'wish' && !e.delta) return '★';
    return (e.delta > 0 ? '+' : '') + e.delta;
  }
  /** Resumen de una línea sobre la cámara: lo que se ha hecho y cuántas hay. */
  flashText(r: TcgScanResult): string {
    const total = `total ${cards(r.totals.copies)}`;
    const c = r.card;
    switch (r.status) {
      case 'done':
        if (r.mode === 'wish') return `★ ${c!.name} · en tu lista de deseos`;
        if (r.mode === 'remove') return `− ${c!.name} · ${c!.quantity ? `te quedan ${c!.quantity}` : 'no te queda ninguna'} · ${total}`;
        return `${r.mode === 'add' ? '✓ ' : ''}${c!.name} · ${c!.quantity ? `tienes ${c!.quantity}` : 'no tienes ninguna'} · ${total}`;
      case 'missing': return `No tienes «${r.reading?.name}» · ${total}`;
      case 'choose': return '¿Cuál es? Elígela abajo';
      default: return 'No se ha podido leer: prueba otra vez';
    }
  }
  when(iso: string) { return relativeTime(iso); }
}
