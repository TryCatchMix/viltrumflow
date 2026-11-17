import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { Subject } from 'rxjs';
import { ApiService } from './api.service';
import { Outbox } from './outbox';
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
  private outbox = inject(Outbox);
  /** Una nota creada sin conexión ya existe en el servidor: { temp: id provisional, real: id definitivo }. */
  readonly noteSynced = new Subject<{ temp: number; real: number }>();
  /** Nota abierta en el editor: sus cambios los envía el propio editor, no la sincronización en segundo plano. */
  activeId: number | null = null;

  readonly online = signal(navigator.onLine);
  private drafts = signal(Object.keys(this.read()).length);
  /** Elementos que esperan a la red: borradores de notas + tareas y notas creadas sin conexión. */
  readonly pending = computed(() => this.drafts() + this.outbox.count());

  constructor() {
    addEventListener('online', () => { this.online.set(true); this.sync(); });
    addEventListener('offline', () => this.online.set(false));
  }

  private read(): Record<string, Draft> {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
  }
  private write(d: Record<string, Draft>) {
    try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { this.toast.error('No queda espacio en este dispositivo para guardar la nota sin conexión'); }
    this.drafts.set(Object.keys(d).length);
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
  clear() { localStorage.removeItem(KEY); this.drafts.set(0); this.outbox.clear(); }

  /** Envía los borradores pendientes. */
  async sync(): Promise<void> {
    if (!navigator.onLine) return;
    if (this.syncing) { this.again = true; return this.running ?? undefined; }  // se repetirá al terminar la pasada en curso
    this.syncing = true;
    this.running = this.pass();
    await this.running;
  }

  private again = false;
  private running: Promise<void> | null = null;

  private async pass(): Promise<void> {
    let done = 0, copies = 0;
    try {
      done += await this.sendOutbox();
      for (const [key, draft] of Object.entries(this.read())) {
        const id = Number(key);
        if (id === this.activeId) continue;
        try {
          // El servidor rechaza (409) el envío si la nota ya no es la versión sobre la que se escribió
          const sent = await firstValueFrom(this.api.updateNote(id, { content: draft.content, base_updated_at: draft.base }))
            .then(() => true, e => ([404, 409].includes(e.status) ? false : Promise.reject(e)));
          if (sent) done++;
          else {
            const server = await firstValueFrom(this.api.noteFresh(id)).catch(e => (e.status === 404 ? null : Promise.reject(e)));
            if (server?.content === draft.content) done++;  // mismo texto: no hay nada que conservar aparte
            else { await this.saveCopy(draft); copies++; }  // cambió en otro dispositivo (o se eliminó): se guarda como copia
          }
          this.remove(id);
        } catch (e) {
          if (isOffline(e)) break;  // sigue sin red: se reintenta más tarde
        }
      }
    } finally { this.syncing = false; this.running = null; }
    if (copies) this.toast.show(`${copies === 1 ? 'Una nota había cambiado' : copies + ' notas habían cambiado'} en otro sitio: tu versión sin conexión se ha guardado como copia`, 'info', 9000);
    else if (done) this.toast.success(done === 1 ? 'Sincronizado 1 cambio hecho sin conexión' : `Sincronizados ${done} cambios hechos sin conexión`);
    if (this.again) { this.again = false; await this.sync(); }
  }

  /** Envía lo creado sin conexión. Devuelve cuántos elementos llegaron al servidor. */
  private async sendOutbox(): Promise<number> {
    let sent = 0;
    for (const n of [...this.outbox.notes()].reverse()) {  // en el orden en que se crearon
      try {
        let created = null;
        for (let i = 1; i < 20 && !created; i++) {
          const title = i === 1 ? n.title : `${n.title} (sin conexión${i > 2 ? ' ' + (i - 1) : ''})`;
          created = await firstValueFrom(this.api.createNote({ title, content: n.content, folder: n.folder }))
            .catch(e => (e.status === 409 ? null : Promise.reject(e)));  // el título ya existe en el servidor
        }
        this.outbox.removeNote(n.id);
        if (created) { this.noteSynced.next({ temp: n.id, real: created.id }); sent++; }
      } catch (e) {
        if (isOffline(e)) return sent;
        this.outbox.removeNote(n.id);
        this.toast.error(e, `No se pudo guardar la nota «${n.title}»`);
      }
    }
    for (const t of [...this.outbox.tasks()].reverse()) {
      try {
        await firstValueFrom(this.api.postTask(t.data)).catch(e => {
          // El proyecto o el responsable pudieron dejar de ser válidos mientras tanto: se guarda sin ellos
          if (e instanceof HttpErrorResponse && [400, 403].includes(e.status)) return firstValueFrom(this.api.postTask({ ...t.data, project_id: null, assignee_id: null }));
          throw e;
        });
        this.outbox.removeTask(t.id);
        sent++;
      } catch (e) {
        if (isOffline(e)) return sent;
        this.outbox.removeTask(t.id);
        this.toast.error(e, `No se pudo guardar la tarea «${t.data.title}»`);
      }
    }
    if (sent) { this.api.tasksChanged.next(); this.api.notesChanged.next(); }
    return sent;
  }

  private async saveCopy(draft: Draft) {
    for (let i = 1; i < 20; i++) {
      const title = `${draft.title} (copia sin conexión${i > 1 ? ' ' + i : ''})`;
      try { await firstValueFrom(this.api.createNote({ title, content: draft.content })); return; }
      catch (e: any) { if (e.status !== 409) throw e; }
    }
  }
}
