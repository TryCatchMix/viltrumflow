import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

export const ATTACHMENT_PATH = /^\/api\/v1\/attachments\/[0-9a-f]{32}$/;
const TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

/**
 * Imágenes de las notas. Son privadas, así que no se pueden cargar con un <img src> normal
 * (no enviaría la sesión): se descargan con la cabecera de autorización y se muestran como blob.
 */
@Injectable({ providedIn: 'root' })
export class AttachmentService {
  private http = inject(HttpClient);
  private cache = new Map<string, Promise<string>>();

  /** URL local (blob:) de una imagen adjunta; se descarga una sola vez por sesión. */
  objectUrl(path: string): Promise<string> {
    let url = this.cache.get(path);
    if (!url) {
      url = firstValueFrom(this.http.get(environment.apiUrl + path, { responseType: 'blob' })).then(b => URL.createObjectURL(b));
      url.catch(() => this.cache.delete(path));  // si falla (p. ej. sin red), se reintenta la próxima vez
      this.cache.set(path, url);
    }
    return url;
  }

  isImage(file: File) { return TYPES.includes(file.type); }

  /** Sube la imagen y devuelve el Markdown que la inserta. */
  async upload(file: File, noteId?: number): Promise<string> {
    const form = new FormData();
    form.append('file', file, file.name || 'imagen.png');
    const params: Record<string, string> = noteId && noteId > 0 ? { note_id: String(noteId) } : {};
    const res = await firstValueFrom(this.http.post<{ url: string; filename: string }>(`${environment.apiUrl}/api/v1/attachments`, form, { params }));
    const alt = res.filename.replace(/\.[a-z0-9]+$/i, '').replace(/[\[\]]/g, '');
    return `![${alt}](${res.url})`;
  }
}
