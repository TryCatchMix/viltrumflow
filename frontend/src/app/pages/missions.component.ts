import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { GameService } from '../core/game.service';
import { CoinEntry, Mission, Missions, RewardItem } from '../core/models';
import { ToastService } from '../core/toast.service';
import { formatDay, relativeTime } from '../core/util';
import { IconComponent } from '../shared/icon.component';

const REASON: Record<CoinEntry['reason'], string> = { mission: 'Misión', chest: 'Cofre semanal', reward: 'Recompensa', freeze: 'Protector de racha' };
const IDEAS = [
  { emoji: '🌴', title: 'Una tarde libre', cost: 150 },
  { emoji: '📚', title: 'Comprarme un libro', cost: 120 },
  { emoji: '🍕', title: 'Cena especial', cost: 100 },
  { emoji: '🎮', title: 'Una hora de videojuegos', cost: 40 },
];

@Component({
  selector: 'app-missions',
  standalone: true,
  imports: [FormsModule, IconComponent],
  template: `
  <div class="page">
    <div class="page-head">
      <div><h1>Misiones y recompensas</h1><p>Cumple las misiones de la semana, gana monedas y cámbialas por premios que tú eliges.</p></div>
      <span class="spacer"></span>
      @if (game.wallet(); as w) {
        <div class="purse card row" [title]="'Ganas 1 moneda por cada ' + w.xp_per_coin + ' XP; la siguiente en ' + w.next_coin_in + ' XP'">
          <app-icon name="coin" [size]="22" /><div><strong>{{ w.coins }}</strong><small class="muted">monedas</small></div>
        </div>
      }
    </div>

    <section class="block">
      <header class="row"><h2>Misiones de la semana</h2><span class="muted">{{ weekLabel() }}</span><span class="spacer"></span>
        @if (data(); as d) { <span class="chip" [class.got]="d.chest_claimed" title="Completa y reclama las tres para llevarte un protector de racha">
          <app-icon name="gift" [size]="12" /> {{ d.chest_claimed ? 'Cofre conseguido' : 'Cofre: ' + claimedCount() + '/3' }}</span> }
      </header>
      <div class="missions">
        @for (m of data()?.missions ?? []; track m.key) {
          <article class="card mission" [class.done]="m.claimed" [class.ready]="m.claimable">
            <div class="row top"><app-icon [name]="m.claimed ? 'check' : 'flag'" [size]="18" /><h3>{{ m.title }}</h3></div>
            <p class="muted small">{{ m.hint }}</p>
            <div class="bar" role="progressbar" [attr.aria-valuenow]="m.progress" aria-valuemin="0" [attr.aria-valuemax]="m.target" [attr.aria-label]="m.title">
              <span [style.width.%]="(100 * m.progress) / m.target"></span></div>
            <div class="row foot">
              <span class="count">{{ m.progress }} / {{ m.target }}</span><span class="spacer"></span>
              <span class="chip xp">+{{ m.reward_xp }} XP</span><span class="chip coin"><app-icon name="coin" [size]="11" />{{ m.reward_coins }}</span>
            </div>
            @if (m.claimable) { <button class="btn primary" (click)="claim(m)" [disabled]="busy()">Reclamar recompensa</button> }
            @else if (m.claimed) { <span class="muted small">Recompensa reclamada</span> }
          </article>
        } @empty { @for (i of [1, 2, 3]; track i) { <div class="skeleton" style="height:170px"></div> } }
      </div>
    </section>

    <div class="two">
      <section class="card box">
        <h2><app-icon name="snow" /> Protector de racha</h2>
        @if (game.wallet(); as w) {
          <div class="row freezes" [attr.aria-label]="w.freezes + ' de ' + w.max_freezes + ' protectores'">
            @for (i of slots(); track i) { <span class="slot" [class.on]="i < w.freezes"><app-icon name="snow" [size]="20" /></span> }
            <span class="muted">{{ w.freezes }} de {{ w.max_freezes }}</span>
          </div>
          <p class="muted small">Si un día no cumples una rutina diaria que llevaba racha, se gasta solo un protector y la racha se salva
            (ese día no suma, pero tampoco la rompe). Si luego marcas ese día, te lo devuelve.</p>
          @for (f of w.recent_freezes; track f.day + f.habit) { <p class="saved"><app-icon name="snow" [size]="13" /> Salvó «{{ f.habit }}» el {{ fmt(f.day).toLowerCase() }}</p> }
          <div><button class="btn" (click)="buyFreeze()" [disabled]="busy() || w.freezes >= w.max_freezes || w.coins < w.freeze_price">
            Comprar por {{ w.freeze_price }} <app-icon name="coin" [size]="13" /></button>
            @if (w.freezes >= w.max_freezes) { <span class="muted small"> Tienes el máximo.</span> }</div>
        }
      </section>

      <section class="card box">
        <h2>Cómo se ganan monedas</h2>
        <ul class="rules">
          <li><app-icon name="shield" /> <span>1 moneda por cada <strong>10 XP</strong> que ganes con tareas, rutinas, concentración o revisiones.</span></li>
          <li><app-icon name="flag" /> <span>Cada misión da monedas extra además de su experiencia.</span></li>
          <li><app-icon name="gift" /> <span>Completar las tres misiones de la semana regala un protector de racha.</span></li>
        </ul>
        <p class="muted small">Si reabres una tarea o desmarcas una rutina, su experiencia (y las monedas que daba) se retira.</p>
      </section>
    </div>

    <section class="block">
      <header class="row"><h2>Tus recompensas</h2><span class="spacer"></span>
        <button class="btn primary" (click)="edit()"><app-icon name="plus" /> Nueva recompensa</button></header>
      <div class="rewards">
        @for (r of rewards(); track r.id) {
          <article class="card reward" [class.used]="!r.available">
            <div class="emoji" aria-hidden="true">{{ r.emoji || '🎁' }}</div>
            <h3>{{ r.title }}</h3>
            <span class="muted small">{{ r.repeatable ? (r.times_redeemed ? 'Canjeada ' + r.times_redeemed + ' ' + (r.times_redeemed === 1 ? 'vez' : 'veces') : 'Se puede repetir') : (r.available ? 'Una sola vez' : 'Ya canjeada') }}</span>
            <div class="row foot">
              <span class="price"><app-icon name="coin" [size]="15" /> {{ r.cost }}</span><span class="spacer"></span>
              <button class="btn ghost icon sm" title="Editar recompensa" (click)="edit(r)"><app-icon name="edit" /></button>
              <button class="btn primary sm" (click)="redeem(r)" [disabled]="busy() || !r.available || (game.wallet()?.coins ?? 0) < r.cost"
                      [title]="!r.available ? 'Ya canjeada' : (game.wallet()?.coins ?? 0) < r.cost ? 'Te faltan ' + (r.cost - (game.wallet()?.coins ?? 0)) + ' monedas' : 'Canjear'">Canjear</button>
            </div>
          </article>
        } @empty {
          <div class="card empty-r">
            <h3>Ponte tus propios premios</h3>
            <p class="muted">Algo que te apetezca y que te ganes con tu esfuerzo. Por ejemplo:</p>
            <div class="row ideas">@for (i of ideas; track i.title) { <button class="btn sm" (click)="addIdea(i)">{{ i.emoji }} {{ i.title }} · {{ i.cost }}</button> }</div>
          </div>
        }
      </div>
    </section>

    <section class="card box">
      <h2>Movimientos de monedas</h2>
      @for (e of history(); track e.id) {
        <div class="ev row">
          <app-icon [name]="e.amount >= 0 ? (e.reason === 'chest' ? 'gift' : 'flag') : (e.reason === 'freeze' ? 'snow' : 'gift')" />
          <span class="truncate">{{ e.detail || reason[e.reason] }}</span><span class="muted small">{{ reason[e.reason] }} · {{ rel(e.created_at) }}</span>
          <span class="spacer"></span>
          @if (e.reason === 'reward') { <button class="btn ghost sm" (click)="undo(e)" title="Devuelve las monedas">Deshacer</button> }
          @if (e.amount !== 0) { <span class="amt" [class.neg]="e.amount < 0">{{ e.amount > 0 ? '+' : '' }}{{ e.amount }}</span> }
        </div>
      } @empty { <p class="muted">Aún no hay movimientos aparte de las monedas que te da la experiencia.</p> }
    </section>
  </div>

  @if (editing(); as e) {
    <div class="backdrop" (click)="editing.set(null)">
      <form class="modal" (click)="$event.stopPropagation()" (ngSubmit)="save()">
        <h2>{{ e.id ? 'Editar recompensa' : 'Nueva recompensa' }}</h2>
        <div class="row">
          <label class="field emo">Icono <input class="input" name="emoji" [(ngModel)]="e.emoji" maxlength="8" placeholder="🎁" /></label>
          <label class="field grow">Recompensa <input class="input" name="title" [(ngModel)]="e.title" required maxlength="120" placeholder="Una tarde libre" /></label>
        </div>
        <label class="field">Precio en monedas <input class="input" type="number" name="cost" min="1" max="100000" [(ngModel)]="e.cost" required />
          <span class="muted hint">Como referencia, un día productivo suele dar entre 10 y 20 monedas.</span></label>
        <label class="row"><input type="checkbox" name="repeatable" [(ngModel)]="e.repeatable" /> Se puede canjear más de una vez</label>
        <div class="actions">
          @if (e.id) {
            <button type="button" class="btn danger" (click)="remove(e)">Eliminar</button>
            <button type="button" class="btn" (click)="archive(e)">Archivar</button>
          }
          <span class="spacer"></span>
          <button type="button" class="btn" (click)="editing.set(null)">Cancelar</button>
          <button class="btn primary" [disabled]="!e.title.trim() || !(e.cost >= 1)">Guardar</button>
        </div>
      </form>
    </div>
  }`,
  styles: [`
    .purse { padding: 8px 14px; gap: 10px; color: var(--warning); div { display: grid; line-height: 1.1; } strong { font-size: 22px; color: var(--text); font-variant-numeric: tabular-nums; } small { font-size: 11px; } }
    .block { margin-bottom: 16px; header { margin-bottom: 10px; gap: 10px; } }
    .missions { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
    .mission { padding: 16px; display: grid; gap: 10px; align-content: start;
      &.ready { border-color: var(--accent); } &.done { opacity: .7; .top app-icon { color: var(--good); } }
      .top { align-items: flex-start; gap: 8px; app-icon { color: var(--accent-text); margin-top: 1px; } } h3 { font-size: 14.5px; } }
    .bar { height: 8px; background: var(--surface-3); border-radius: 4px; overflow: hidden; span { display: block; height: 100%; background: var(--accent); border-radius: 4px; transition: width .4s; } }
    .count { font-variant-numeric: tabular-nums; font-size: 13px; }
    .xp { background: var(--accent-soft); color: var(--accent-text); } .coin { color: var(--text); } .coin app-icon, .price app-icon { color: var(--warning); }
    .got { background: color-mix(in srgb, var(--good) 18%, transparent); color: var(--text); }
    .small { font-size: 12.5px; } .foot { gap: 6px; }
    .two { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
    .box { padding: 16px 18px; display: grid; gap: 10px; align-content: start; min-width: 0; h2 { display: flex; gap: 8px; align-items: center; } }
    .freezes { gap: 8px; } .slot { width: 40px; height: 40px; border-radius: 10px; border: 2px dashed var(--border); display: grid; place-content: center; color: var(--text-3);
      &.on { border: 2px solid var(--series-1); background: color-mix(in srgb, var(--series-1) 16%, transparent); color: var(--series-1); } }
    .saved { font-size: 13px; display: flex; gap: 6px; align-items: center; color: var(--series-1); }
    .rules { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; font-size: 13px; li { display: flex; gap: 10px; color: var(--text-2); app-icon { color: var(--accent-text); margin-top: 2px; } strong { color: var(--text); } } }
    .rewards { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 12px; }
    .reward { padding: 16px; display: grid; gap: 6px; align-content: start; &.used { opacity: .55; } h3 { font-size: 14.5px; } .emoji { font-size: 30px; line-height: 1; }
      .price { display: inline-flex; gap: 5px; align-items: center; font-weight: 600; font-variant-numeric: tabular-nums; } }
    .empty-r { padding: 20px; grid-column: 1 / -1; display: grid; gap: 8px; } .ideas { flex-wrap: wrap; }
    .ev { padding: 7px 0; border-bottom: 1px solid var(--border); font-size: 13.5px; &:last-child { border-bottom: none; } .small { white-space: nowrap; } }
    .amt { font-variant-numeric: tabular-nums; font-weight: 600; color: var(--good); min-width: 44px; text-align: right; &.neg { color: var(--text-2); } }
    .emo { width: 80px; flex: none; } .grow { flex: 1; } .hint { font-weight: 400; } .actions { display: flex; }
    @media (max-width: 820px) { .two { grid-template-columns: minmax(0, 1fr); } }
  `],
})
export class MissionsComponent implements OnInit {
  game = inject(GameService);
  private api = inject(ApiService);
  private toast = inject(ToastService);
  reason = REASON; ideas = IDEAS; rel = relativeTime; fmt = formatDay;

  data = signal<Missions | null>(null);
  rewards = signal<RewardItem[]>([]);
  history = signal<CoinEntry[]>([]);
  busy = signal(false);
  editing = signal<{ id?: number; title: string; cost: number; emoji: string; repeatable: boolean } | null>(null);

  claimedCount = computed(() => this.data()?.missions.filter(m => m.claimed).length ?? 0);
  slots = computed(() => Array.from({ length: this.game.wallet()?.max_freezes ?? 2 }, (_, i) => i));
  weekLabel = computed(() => {
    const d = this.data();
    return d ? `hasta el ${formatDay(d.week_end).toLowerCase()}` : '';
  });

  ngOnInit() { this.game.refresh(); this.load(); }

  private load() {
    this.api.missions().subscribe({ next: d => this.data.set(d), error: e => this.toast.error(e, 'No se pudieron cargar las misiones') });
    this.api.rewards().subscribe({ next: r => this.rewards.set(r), error: () => {} });
    this.api.coinHistory().subscribe({ next: h => this.history.set(h), error: () => {} });
  }

  claim(m: Mission) {
    this.busy.set(true);
    this.api.claimMission(m.key).subscribe({
      next: r => {
        this.busy.set(false);
        this.game.wallet.set(r.wallet);
        this.toast.success(`Misión cumplida: +${r.xp_gained} XP y ${r.coins_gained} monedas`);
        if (r.chest) this.toast.show('¡Cofre semanal! Te llevas un protector de racha', 'success', 8000);
        this.load();
      },
      error: e => { this.busy.set(false); this.toast.error(e); this.load(); },
    });
  }

  buyFreeze() {
    this.busy.set(true);
    this.api.buyFreeze().subscribe({
      next: w => { this.busy.set(false); this.game.wallet.set(w); this.toast.success('Protector de racha comprado'); this.load(); },
      error: e => { this.busy.set(false); this.toast.error(e); },
    });
  }

  redeem(r: RewardItem) {
    if (!confirm(`¿Canjear «${r.title}» por ${r.cost} monedas?`)) return;
    this.busy.set(true);
    this.api.redeemReward(r.id).subscribe({
      next: res => { this.busy.set(false); this.game.wallet.set(res.wallet); this.toast.success(`¡Disfrútalo! ${r.emoji} ${r.title}`.replace('  ', ' ')); this.load(); },
      error: e => { this.busy.set(false); this.toast.error(e); },
    });
  }
  undo(e: CoinEntry) {
    this.api.undoRedemption(e.id).subscribe({ next: () => { this.toast.show('Canje deshecho: monedas devueltas'); this.game.refresh(); this.load(); }, error: err => this.toast.error(err) });
  }

  edit(r?: RewardItem) {
    this.editing.set(r ? { id: r.id, title: r.title, cost: r.cost, emoji: r.emoji, repeatable: r.repeatable } : { title: '', cost: 50, emoji: '', repeatable: true });
    setTimeout(() => document.querySelector<HTMLInputElement>('.modal input[name=title]')?.focus());
  }
  addIdea(i: { emoji: string; title: string; cost: number }) {
    this.api.createReward({ ...i, repeatable: true }).subscribe({ next: () => this.load(), error: e => this.toast.error(e) });
  }
  save() {
    const e = this.editing()!;
    const data = { title: e.title.trim(), cost: Math.round(Number(e.cost)), emoji: e.emoji.trim(), repeatable: e.repeatable };
    (e.id ? this.api.updateReward(e.id, data) : this.api.createReward(data)).subscribe({
      next: () => { this.editing.set(null); this.load(); }, error: err => this.toast.error(err, 'No se pudo guardar'),
    });
  }
  archive(e: { id?: number }) {
    this.api.updateReward(e.id!, { is_archived: true }).subscribe({ next: () => { this.editing.set(null); this.load(); }, error: err => this.toast.error(err) });
  }
  remove(e: { id?: number; title: string }) {
    if (!confirm(`¿Eliminar «${e.title}»? Los canjes ya hechos siguen en el historial.`)) return;
    this.api.deleteReward(e.id!).subscribe({ next: () => { this.editing.set(null); this.load(); }, error: err => this.toast.error(err) });
  }
}
