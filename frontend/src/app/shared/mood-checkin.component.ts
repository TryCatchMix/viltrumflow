import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { ENERGY_LEVELS, MOOD_LEVELS, MoodEntry, MoodFactor } from '../core/models';
import { ToastService } from '../core/toast.service';
import { IconComponent } from './icon.component';

/** Registro de ánimo y energía del día en ~10 segundos: dos toques y «Guardar»; factores y nota, opcionales. */
@Component({
  selector: 'app-mood-checkin',
  standalone: true,
  imports: [FormsModule, RouterLink, IconComponent],
  template: `
  @if (ready()) {
    @if (saved() && !editing()) {
      <div class="card done row">
        <span class="face" aria-hidden="true">{{ moods[saved()!.mood - 1].emoji }}</span>
        <div class="grow"><strong>Hoy: {{ moods[saved()!.mood - 1].label.toLowerCase() }} · energía {{ energies[saved()!.energy - 1].label.toLowerCase() }}</strong>
          @if (saved()!.factors.length || saved()!.note) {
            <p class="muted small">{{ factorText(saved()!.factors) }}{{ saved()!.factors.length && saved()!.note ? ' · ' : '' }}{{ saved()!.note }}</p>
          }</div>
        <button class="btn sm" (click)="edit()">Cambiar</button>
        @if (showLink()) { <a class="btn sm ghost" routerLink="/journal">Ver diario</a> }
      </div>
    } @else {
      <div class="card box">
        <div class="row head"><h2>¿Cómo estás hoy?</h2><span class="muted small">Diez segundos. Te ayuda a ver qué días rindes más.</span></div>
        <div class="scale" role="radiogroup" aria-label="Ánimo">
          <span class="lbl">Ánimo</span>
          @for (m of moods; track m.v) {
            <button type="button" role="radio" class="opt" [class.on]="mood() === m.v" [attr.aria-checked]="mood() === m.v" (click)="pick('mood', m.v)">
              <span class="emoji" aria-hidden="true">{{ m.emoji }}</span><span class="t">{{ m.label }}</span></button>
          }
        </div>
        <div class="scale" role="radiogroup" aria-label="Energía">
          <span class="lbl">Energía</span>
          @for (e of energies; track e.v) {
            <button type="button" role="radio" class="opt" [class.on]="energy() === e.v" [attr.aria-checked]="energy() === e.v" (click)="pick('energy', e.v)">
              <span class="bat" aria-hidden="true">@for (i of [1, 2, 3, 4, 5]; track i) { <i [class.f]="i <= e.v"></i> }</span><span class="t">{{ e.label }}</span></button>
          }
        </div>
        <div class="chips" role="group" aria-label="¿Algo que influya?">
          @for (f of factors(); track f.key) {
            <button type="button" class="chip" [class.on]="chosen().has(f.key)" [attr.aria-pressed]="chosen().has(f.key)" (click)="toggle(f.key)">{{ f.label }}</button>
          }
        </div>
        @if (noteOpen()) {
          <textarea class="input" rows="2" [(ngModel)]="note" maxlength="2000" placeholder="¿Algo que quieras recordar de hoy?" aria-label="Nota del día"></textarea>
        }
        <div class="row">
          @if (!noteOpen()) { <button type="button" class="btn sm ghost" (click)="noteOpen.set(true)"><app-icon name="edit" [size]="13" /> Añadir nota</button> }
          <span class="spacer"></span>
          @if (editing()) { <button type="button" class="btn sm" (click)="editing.set(false)">Cancelar</button> }
          <button type="button" class="btn sm primary" (click)="save()" [disabled]="!mood() || !energy() || busy()">Guardar</button>
        </div>
      </div>
    }
  }`,
  styles: [`
    :host { display: block; }
    .box { padding: 16px 18px; display: grid; gap: 12px; }
    .head { gap: 10px; flex-wrap: wrap; align-items: baseline; h2 { margin: 0; font-size: 15px; } }
    .small { font-size: 12.5px; } p { margin: 2px 0 0; }
    .scale { display: grid; grid-template-columns: 64px repeat(5, minmax(0, 1fr)); gap: 6px; align-items: stretch; }
    .lbl { font-size: 12.5px; color: var(--text-2); align-self: center; }
    .opt { display: grid; justify-items: center; gap: 3px; padding: 7px 2px; border-radius: var(--radius-sm); border: 1px solid var(--border);
      background: var(--surface); color: var(--text-2); cursor: pointer; font: inherit; min-width: 0;
      &:hover { border-color: var(--text-3); } &.on { border-color: var(--accent); background: var(--accent-soft); color: var(--text); }
      .t { font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; } }
    .emoji { font-size: 20px; line-height: 1; }
    .bat { display: flex; gap: 2px; align-items: flex-end; height: 20px; i { width: 4px; border-radius: 1px; background: var(--surface-3); }
      i:nth-child(1) { height: 8px; } i:nth-child(2) { height: 11px; } i:nth-child(3) { height: 14px; } i:nth-child(4) { height: 17px; } i:nth-child(5) { height: 20px; }
      i.f { background: var(--text-2); } }
    .opt.on .bat i.f { background: var(--accent); }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .chip { cursor: pointer; border: 1px solid var(--border); background: var(--surface); font: inherit; font-size: 12px;
      &.on { background: var(--accent-soft); border-color: var(--accent); color: var(--text); } }
    textarea { resize: vertical; }
    .done { padding: 12px 16px; gap: 12px; align-items: center; }
    .face { font-size: 26px; line-height: 1; } .grow { flex: 1; min-width: 0; }
    @media (max-width: 520px) { .scale { grid-template-columns: repeat(5, minmax(0, 1fr)); } .lbl { grid-column: 1 / -1; } .opt .t { font-size: 10.5px; } }
  `],
})
export class MoodCheckinComponent implements OnInit {
  private api = inject(ApiService);
  private toast = inject(ToastService);

  /** Muestra el enlace al diario (en «Hoy»; no dentro del propio diario). */
  readonly showLink = input(true);
  readonly changed = output<MoodEntry>();

  moods = MOOD_LEVELS; energies = ENERGY_LEVELS;
  ready = signal(false);
  busy = signal(false);
  editing = signal(false);
  saved = signal<MoodEntry | null>(null);
  factors = signal<MoodFactor[]>([]);
  mood = signal(0);
  energy = signal(0);
  chosen = signal(new Set<string>());
  noteOpen = signal(false);
  note = '';
  private day = '';

  ngOnInit() {
    this.api.moodLog(7).subscribe({
      next: r => { this.day = r.today; this.factors.set(r.factors); this.saved.set(r.entry_today); this.ready.set(true); },
      error: () => {},  // sin conexión o error: simplemente no se muestra
    });
  }

  factorText(keys: string[]) { return keys.map(k => this.factors().find(f => f.key === k)?.label ?? k).join(', '); }

  edit() {
    const s = this.saved()!;
    this.mood.set(s.mood); this.energy.set(s.energy); this.chosen.set(new Set(s.factors));
    this.note = s.note ?? ''; this.noteOpen.set(!!s.note); this.editing.set(true);
  }

  pick(kind: 'mood' | 'energy', v: number) { (kind === 'mood' ? this.mood : this.energy).set(v); }

  toggle(key: string) {
    const s = new Set(this.chosen());
    if (s.has(key)) s.delete(key); else s.add(key);
    this.chosen.set(s);
  }

  save() {
    if (!this.mood() || !this.energy()) return;
    this.busy.set(true);
    this.api.saveMood(this.day, { mood: this.mood(), energy: this.energy(), factors: [...this.chosen()], note: this.note.trim() || null }).subscribe({
      next: e => { this.busy.set(false); this.saved.set(e); this.editing.set(false); this.changed.emit(e); },
      error: err => { this.busy.set(false); this.toast.error(err, 'No se pudo guardar el registro'); },
    });
  }
}
