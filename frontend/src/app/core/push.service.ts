import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { SwPush } from '@angular/service-worker';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

export type PushState = 'unsupported' | 'off' | 'on' | 'denied' | 'busy';
export const PUSH_ENDPOINT_KEY = 'vf-push-endpoint';

/**
 * Notificaciones Web Push: llegan aunque ViltrumFlow esté cerrado. Las muestra el service worker de
 * Angular, así que solo funcionan en la build de producción (no con `ng serve`).
 */
@Injectable({ providedIn: 'root' })
export class PushService {
  private sw = inject(SwPush);
  private http = inject(HttpClient);
  private api = `${environment.apiUrl}/api/v1/push`;

  readonly state = signal<PushState>('unsupported');

  get supported() { return this.sw.isEnabled && typeof window !== 'undefined' && 'PushManager' in window; }

  /** Comprueba el estado y vuelve a asociar la suscripción de este navegador a la cuenta actual. */
  init() {
    if (!this.supported) { this.state.set('unsupported'); return; }
    if (typeof Notification !== 'undefined' && Notification.permission === 'denied') { this.state.set('denied'); return; }
    this.sw.subscription.subscribe(sub => {
      if (this.state() === 'busy') return;
      this.state.set(sub ? 'on' : 'off');
      if (sub) this.register(sub).catch(() => {});
    });
  }

  async enable(): Promise<void> {
    this.state.set('busy');
    try {
      const { public_key } = await firstValueFrom(this.http.get<{ public_key: string }>(`${this.api}/key`));
      const sub = await this.sw.requestSubscription({ serverPublicKey: public_key });
      await this.register(sub);
      this.state.set('on');
    } catch (e) {
      this.state.set(typeof Notification !== 'undefined' && Notification.permission === 'denied' ? 'denied' : 'off');
      throw e;
    }
  }

  async disable(): Promise<void> {
    this.state.set('busy');
    const endpoint = localStorage.getItem(PUSH_ENDPOINT_KEY);
    try {
      if (endpoint) await firstValueFrom(this.http.post(`${this.api}/unsubscribe`, { endpoint }));
      await this.sw.unsubscribe().catch(() => {});
    } finally {
      localStorage.removeItem(PUSH_ENDPOINT_KEY);
      this.state.set('off');
    }
  }

  test() { return firstValueFrom(this.http.post<{ delivered: number }>(`${this.api}/test`, null)); }

  private async register(sub: PushSubscription) {
    const json = sub.toJSON();
    await firstValueFrom(this.http.post(`${this.api}/subscribe`, { endpoint: json.endpoint, keys: json.keys }));
    localStorage.setItem(PUSH_ENDPOINT_KEY, json.endpoint!);
  }
}
