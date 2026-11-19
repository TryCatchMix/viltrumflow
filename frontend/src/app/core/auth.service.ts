import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, finalize, map, shareReplay, switchMap, tap } from 'rxjs';
import { environment } from '../../environments/environment';
import { Token, User } from './models';

const ACCESS = 'vf-access', REFRESH = 'vf-refresh';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private router = inject(Router);
  private api = `${environment.apiUrl}/api/v1/auth`;
  private refreshing$: Observable<Token> | null = null;

  readonly user = signal<User | null>(null);

  get accessToken() { return localStorage.getItem(ACCESS); }
  isAuthenticated() { return !!this.accessToken; }

  register(data: { email: string; username: string; password: string; full_name?: string }) {
    return this.http.post<User>(`${this.api}/register`, data);
  }

  login(username: string, password: string) {
    // El endpoint sigue OAuth2 «password»: application/x-www-form-urlencoded
    const body = new HttpParams().set('username', username).set('password', password);
    return this.http.post<Token>(`${this.api}/login`, body).pipe(tap(t => this.store(t)));
  }

  /** Una sola renovación en vuelo aunque fallen varias peticiones a la vez. */
  refresh(): Observable<Token> {
    if (!this.refreshing$) {
      this.refreshing$ = this.http.post<Token>(`${this.api}/refresh`, { refresh_token: localStorage.getItem(REFRESH) }).pipe(
        tap(t => this.store(t)),
        finalize(() => (this.refreshing$ = null)),
        shareReplay(1),
      );
    }
    return this.refreshing$;
  }

  /** Métodos de acceso activos en el servidor (p. ej. si mostrar «Continuar con Google»). */
  providers() { return this.http.get<{ google: boolean }>(`${this.api}/providers`); }

  /** Entrar o registrarse con Google: navegación completa, el servidor redirige a Google y vuelve a /login. */
  signInWithGoogle() { window.location.assign(`${this.api}/google/start`); }

  /** Canjea el código de un solo uso que deja el servidor en /login#google_code=… */
  exchangeGoogleCode(code: string) {
    return this.http.post<Token>(`${this.api}/google/exchange`, { code }).pipe(tap(t => this.store(t)));
  }

  /** Vincula Google a la cuenta abierta. El vale viaja en un formulario (POST), no en la URL. */
  linkGoogle() {
    return this.http.post<{ ticket: string }>(`${this.api}/google/link-ticket`, {}).pipe(tap(({ ticket }) => {
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = `${this.api}/google/start`;
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = 'ticket';
      input.value = ticket;
      form.appendChild(input);
      document.body.appendChild(form);
      form.submit();
    }));
  }
  unlinkGoogle() { return this.http.delete<User>(`${this.api}/google/link`).pipe(tap(u => this.user.set(u))); }

  loadUser() { return this.http.get<User>(`${this.api}/me`).pipe(tap(u => this.user.set(u))); }
  updateProfile(data: Partial<User>) { return this.http.put<User>(`${this.api}/me`, data).pipe(tap(u => this.user.set(u))); }
  changePassword(current_password: string | null, new_password: string) {
    // El servidor cierra las demás sesiones y devuelve tokens nuevos para esta
    return this.http.post<Token>(`${this.api}/change-password`, { current_password, new_password }).pipe(
      tap(t => this.store(t)),
      switchMap(t => this.loadUser().pipe(map(() => t))),
    );
  }
  forgotPassword(email: string) { return this.http.post<{ message: string }>(`${this.api}/forgot-password`, { email }); }
  resetPassword(token: string, new_password: string) {
    return this.http.post<{ message: string }>(`${this.api}/reset-password`, { token, new_password });
  }

  logout(redirect = true) {
    // Antes de olvidar la sesión: este navegador deja de recibir los avisos de esta cuenta
    const token = this.accessToken, endpoint = localStorage.getItem('vf-push-endpoint');
    if (token) {
      const send = (path: string, method: string, body?: unknown) => fetch(`${environment.apiUrl}/api/v1${path}`, {
        method, keepalive: true, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      }).catch(() => {});
      if (endpoint) send('/push/unsubscribe', 'POST', { endpoint });
      send('/pomodoro/timer', 'DELETE');
    }
    if (endpoint) {
      navigator.serviceWorker?.getRegistration().then(r => r?.pushManager.getSubscription()).then(s => s?.unsubscribe()).catch(() => {});
      localStorage.removeItem('vf-push-endpoint');
    }
    localStorage.removeItem(ACCESS);
    localStorage.removeItem(REFRESH);
    this.user.set(null);
    // En un dispositivo compartido no deben quedar datos del usuario anterior
    localStorage.removeItem('vf-note-drafts');
    localStorage.removeItem('vf-outbox');
    localStorage.removeItem('vf-pomodoro');
    if ('caches' in window) caches.keys().then(keys => keys.filter(k => k.includes(':data:')).forEach(k => caches.delete(k))).catch(() => {});
    if (redirect) this.router.navigate(['/login']);
  }

  private store(t: Token) {
    localStorage.setItem(ACCESS, t.access_token);
    localStorage.setItem(REFRESH, t.refresh_token);
  }
}
