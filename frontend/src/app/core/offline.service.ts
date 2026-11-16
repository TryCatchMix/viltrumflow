import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiService } from './api.service';
import { ToastService } from './toast.service';
import { isOffline } from './util';

export interface Draft { title: string; content: string; base: string; }
const KEY = 'vf-note-drafts';

/**
 * Notas escritas sin conexión: se guardan en este dispositivo y se envían al volver la red.
 * Si entretanto la nota cambió en el servidor, no se pisa: el texto local se guarda como copia aparte.
 */
@Injectable({ providedIn: 'root' })
export class OfflineService {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  private syncing = false;
  /** Nota abierta en el editor: sus cambios los envía el propio editor, no la sincronización en segundo plano. */
  activeId: number | null = null;

  readonly online = signal(navigator.onLine);
  readonly pending = signal(Object.keys(this.read()).length);

  constructor() {
    addEventListener('online', () => { this.online.set(true); this.sync(); });
    addEventListener('offline', () => this.online.set(false));
  }

  private read(): Record<string, Draft> {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
  }
  private write(d: Record<string, Draft>) {
    try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { this.toast.error('No queda espacio en este dispositivo para guardar la nota sin conexión'); }
    this.pending.set(Object.keys(d).length);
  }

  get(id: number): Draft | undefined { return this.read()[id]; }
  /** `base` es el `updated_at` de la versión sobre la que se escribió; se conserva el del primer borrador. */
  save(id: number, title: string, content: string, base: string) {
    const d = this.read();
    d[id] = { title, content, base: d[id]?.base ?? base };
    this.write(d);
  }
  remove(id: number) {
    const d = this.read();
    if (d[id]) { delete d[id]; this.write(d); }
  }
  clear() { localStorage.removeItem(KEY); this.pending.set(0); }

  /** Envía los borradores pendientes. */
  async sync(): Promise<void> {
    if (this.syncing || !navigator.onLine) return;
    this.syncing = true;
    let done = 0, copies = 0;
    try {
      for (const [key, draft] of Object.entries(this.read())) {
        const id = Number(key);
        if (id === this.activeId) continue;
        try {
          const server = await firstValueFrom(this.api.note(id)).catch(e => (e.status === 404 ? null : Promise.reject(e)));
          if (server && (server.updated_at === draft.base || server.content === draft.content)) {
            if (server.content !== draft.content) await firstValueFrom(this.api.updateNote(id, { content: draft.content }));
            done++;
          } else {
            // Cambió en otro dispositivo (o se eliminó): no se pisa, se guarda como copia
            await this.saveCopy(draft);
            copies++;
          }
          this.remove(id);
        } catch (e) {
          if (isOffline(e)) break;  // sigue sin red: se reintenta más tarde
        }
      }
    } finally { this.syncing = false; }
    if (copies) this.toast.show(`${copies === 1 ? 'Una nota había cambiado' : copies + ' notas habían cambiado'} en otro sitio: tu versión sin conexión se ha guardado como copia`, 'info', 9000);
    else if (done) this.toast.success(done === 1 ? 'Nota sincronizada' : `${done} notas sincronizadas`);
  }

  private async saveCopy(draft: Draft) {
    for (let i = 1; i < 20; i++) {
      const title = `${draft.title} (copia sin conexión${i > 1 ? ' ' + i : ''})`;
      try { await firstValueFrom(this.api.createNote({ title, content: draft.content })); return; }
      catch (e: any) { if (e.status !== 409) throw e; }
    }
  }
}
