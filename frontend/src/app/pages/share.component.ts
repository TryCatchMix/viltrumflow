import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Observable, catchError, throwError } from 'rxjs';
import { ApiService } from '../core/api.service';
import { Note } from '../core/models';
import { ToastService } from '../core/toast.service';
import { errorMessage, isOffline, toDue } from '../core/util';
import { IconComponent } from '../shared/icon.component';

type Kind = 'note' | 'task';
const URL_RE = /https?:\/\/[^\s<>"]+/i;

/**
 * Lo que otra app comparte con ViltrumFlow (menú «Compartir» del móvil con la app instalada).
 * El manifiesto declara /share como destino: llega aquí con ?title=&text=&url=.
 */
export function parseShared(title: string, text: string, url: string): { title: string; body: string; url: string } {
  title = title.trim(); text = text.trim(); url = url.trim();
  // Muchas apps (Chrome en Android incluido) mandan el enlace dentro del texto y no en «url»
  if (!url) {
    const m = text.match(URL_RE);
    if (m) url = m[0].replace(/[.,;:!?)]+$/, '');
  }
  let body = url ? text.replace(url, '').trim() : text;
  if (!title) {
    const first = body.split('\n')[0].trim();
    if (first && first.length <= 120) { title = first; body = body.slice(first.length).trim(); }
    else if (url) { try { title = new URL(url).hostname.replace(/^www\./, ''); } catch { title = url; } }
    else title = body.slice(0, 80) || 'Compartido';
  }
  return { title: title.slice(0, 200), body, url };
}

@Component({
  selector: 'app-share',
  standalone: true,
  imports: [FormsModule, IconComponent],
  template: `
  <div class="page narrow">
    <div class="page-head"><div><h1><app-icon name="share" [size]="20" /> Guardar lo compartido</h1>
      <p>Elige si lo quieres como nota o como tarea.</p></div></div>

    @if (!hasContent) {
      <div class="card box">
        <p><strong>No ha llegado nada.</strong></p>
        <p class="muted">Con ViltrumFlow instalada en el móvil, pulsa «Compartir» en cualquier app (un enlace, un texto…) y elige ViltrumFlow.</p>
      </div>
    } @else {
      <form class="card box" (ngSubmit)="save()">
        <div class="seg" role="radiogroup" aria-label="Guardar como">
          <button type="button" role="radio" [attr.aria-checked]="kind() === 'note'" [class.on]="kind() === 'note'" (click)="kind.set('note')">
            <app-icon name="note" [size]="15" /> Nota</button>
          <button type="button" role="radio" [attr.aria-checked]="kind() === 'task'" [class.on]="kind() === 'task'" (click)="kind.set('task')">
            <app-icon name="check" [size]="15" /> Tarea</button>
        </div>
        <label class="field">Título <input class="input" name="title" [(ngModel)]="title" required maxlength="200" /></label>
        @if (url) { <p class="link muted"><app-icon name="link" [size]="13" /> <a [href]="url" target="_blank" rel="noopener noreferrer">{{ url }}</a></p> }
        <label class="field">{{ kind() === 'note' ? 'Contenido' : 'Descripción' }}
          <textarea class="input" name="body" [(ngModel)]="body" rows="5"></textarea></label>
        @if (kind() === 'task') {
          <label class="field">Fecha (opcional) <input class="input" type="date" name="day" [(ngModel)]="day" /></label>
        }
        <div class="row"><span class="spacer"></span>
          <button type="button" class="btn" (click)="cancel()">Descartar</button>
          <button class="btn primary" [disabled]="!title.trim() || busy()">{{ kind() === 'note' ? 'Guardar nota' : 'Crear tarea' }}</button>
        </div>
      </form>
    }
  </div>`,
  styles: [`
    .narrow { max-width: 560px; } h1 { display: flex; align-items: center; gap: 8px; }
    .box { padding: 18px; display: grid; gap: 12px; p { margin: 0; } }
    .seg { display: inline-flex; border: 1px solid var(--border); border-radius: var(--radius-sm); overflow: hidden; justify-self: start;
      button { display: flex; align-items: center; gap: 6px; padding: 7px 14px; background: none; border: none; cursor: pointer; color: var(--text-muted); font: inherit;
        &.on { background: var(--accent-soft); color: var(--accent-text); font-weight: 550; } } }
    .link { display: flex; gap: 6px; align-items: center; font-size: 13px; a { overflow-wrap: anywhere; } }
    textarea { resize: vertical; }
  `],
})
export class ShareComponent {
  private api = inject(ApiService);
  private router = inject(Router);
  private toast = inject(ToastService);

  kind = signal<Kind>('note');
  busy = signal(false);
  title = ''; body = ''; url = ''; day = '';
  hasContent: boolean;

  constructor() {
    const q = inject(ActivatedRoute).snapshot.queryParamMap;
    const shared = parseShared(q.get('title') ?? '', q.get('text') ?? '', q.get('url') ?? '');
    this.hasContent = !!(q.get('title') || q.get('text') || q.get('url'));
    this.title = shared.title; this.body = shared.body; this.url = shared.url;
    // Un enlace suele ser algo que leer más tarde; un texto suelto, una idea que apuntar
    this.kind.set(shared.url && !shared.body ? 'task' : 'note');
    // Que no quede en el historial: recargar no debe duplicarlo
    this.router.navigate([], { queryParams: {}, replaceUrl: true });
  }

  cancel() { this.router.navigateByUrl('/'); }

  save() {
    const title = this.title.trim();
    if (!title) return;
    this.busy.set(true);
    const fail = (e: unknown) => {
      this.busy.set(false);
      this.toast.error(isOffline(e) && this.kind() === 'note'
        ? 'Sin conexión: guárdalo como tarea y se enviará al recuperar la red'
        : errorMessage(e, 'No se pudo guardar'));
    };
    if (this.kind() === 'task') {
      const description = [this.body.trim(), this.url].filter(Boolean).join('\n\n') || undefined;
      this.api.createTask({ title, description, ...(this.day ? toDue(this.day, '') : {}) }).subscribe({
        next: () => { this.toast.success('Tarea creada'); this.router.navigateByUrl('/tasks'); },
        error: fail,
      });
      return;
    }
    const content = [`# ${title}`, this.url ? `<${this.url}>` : '', this.body.trim(), '#compartido'].filter(Boolean).join('\n\n') + '\n';
    this.createNote(title, content, 1).subscribe({
      next: n => { this.toast.success('Nota guardada'); this.router.navigate(['/notes', n.id]); },
      error: fail,
    });
  }

  /** Si ya hay una nota con ese título, prueba «Título (2)», «Título (3)»… */
  private createNote(title: string, content: string, n: number): Observable<Note> {
    const name = n === 1 ? title : `${title.slice(0, 190)} (${n})`;
    return this.api.createNote({ title: name, content }).pipe(
      catchError(e => (e?.status === 409 && n < 20 ? this.createNote(title, content, n + 1) : throwError(() => e))),
    );
  }
}
