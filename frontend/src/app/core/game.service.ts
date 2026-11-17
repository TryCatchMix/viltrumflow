import { Injectable, inject, signal } from '@angular/core';
import { merge } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import { ApiService } from './api.service';
import { GameProfile, Wallet } from './models';
import { ToastService } from './toast.service';

export interface LevelUp { level: number; rank: string; rankIndex: number; newRank: boolean; }

/** Experiencia, nivel y rango del usuario. Se refresca cuando algo puede haber puntuado. */
@Injectable({ providedIn: 'root' })
export class GameService {
  private api = inject(ApiService);
  private toast = inject(ToastService);

  readonly profile = signal<GameProfile | null>(null);
  /** Monedas y protectores de racha. */
  readonly wallet = signal<Wallet | null>(null);
  /** Subida de nivel pendiente de celebrar (la pinta el layout). */
  readonly levelUp = signal<LevelUp | null>(null);

  constructor() {
    merge(this.api.tasksChanged, this.api.xpChanged).pipe(debounceTime(400)).subscribe(() => this.refresh());
  }

  /** Porcentaje del nivel actual ya recorrido. */
  progress(p = this.profile()): number {
    if (!p) return 0;
    return Math.round((100 * (p.xp - p.level_start_xp)) / (p.next_level_xp - p.level_start_xp));
  }

  refresh() {
    this.api.wallet().subscribe({ next: w => this.wallet.set(w), error: () => {} });
    this.api.gameProfile().subscribe({
      next: p => {
        const prev = this.profile();
        this.profile.set(p);
        if (!prev) return;  // primera carga: nada que anunciar
        const gained = p.xp - prev.xp;
        if (gained > 0) this.toast.show(`+${gained} XP`, 'success', 2500);
        if (p.level > prev.level) this.levelUp.set({ level: p.level, rank: p.rank, rankIndex: p.rank_index, newRank: p.rank_index > prev.rank_index });
      },
      error: () => {},
    });
  }

  reset() { this.profile.set(null); this.wallet.set(null); this.levelUp.set(null); }
}
