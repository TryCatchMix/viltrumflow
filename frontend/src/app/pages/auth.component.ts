import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { switchMap } from 'rxjs';
import { AuthService } from '../core/auth.service';
import { errorMessage } from '../core/util';

type Mode = 'login' | 'register' | 'forgot' | 'reset';
const TITLES: Record<Mode, string> = {
  login: 'Inicia sesión', register: 'Crea tu cuenta', forgot: 'Recupera tu contraseña', reset: 'Elige una contraseña nueva',
};
const GOOGLE_ERRORS: Record<string, string> = {
  exists: 'Ya hay una cuenta con ese email. Entra con tu contraseña (o recupérala) y vincula Google desde Ajustes.',
  denied: 'Has cancelado el acceso con Google.',
  unverified: 'Tu cuenta de Google no tiene el email verificado.',
  expired: 'El acceso con Google ha caducado. Vuelve a intentarlo.',
  unavailable: 'El acceso con Google no está disponible en este servidor.',
  error: 'No se pudo entrar con Google. Vuelve a intentarlo.',
};
const ACTIONS: Record<Mode, string> = { login: 'Entrar', register: 'Crear cuenta', forgot: 'Enviar enlace', reset: 'Guardar contraseña' };

@Component({
  selector: 'app-auth',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
  <div class="wrap">
    <form class="card box" (ngSubmit)="submit()" #form="ngForm">
      <div class="brand"><span class="logo">V</span> ViltrumFlow</div>
      <h1>{{ title }}</h1>
      <p class="muted">
        @switch (mode) {
          @case ('forgot') { Escribe el email de tu cuenta y te enviaremos un enlace para elegir una contraseña nueva. }
          @case ('reset') { El enlace caduca a los 30 minutos y solo sirve una vez. }
          @default { Tareas, notas enlazadas y calendario en un solo sitio. }
        }
      </p>

      @if (error()) { <div class="msg error" role="alert">{{ error() }}</div> }
      @if (done()) { <div class="msg ok" role="status">{{ done() }}</div> }

      @if (!done()) {
        @if (mode === 'register') {
          <label class="field">Nombre <input class="input" name="full_name" [(ngModel)]="f.full_name" autocomplete="name" maxlength="100" /></label>
        }
        @if (mode === 'register' || mode === 'forgot') {
          <label class="field">Email <input class="input" type="email" name="email" [(ngModel)]="f.email" required autocomplete="email" /></label>
        }
        @if (mode === 'login' || mode === 'register') {
          <label class="field">{{ mode === 'register' ? 'Nombre de usuario' : 'Usuario o email' }}
            <input class="input" name="username" [(ngModel)]="f.username" required minlength="3" autocomplete="username" />
          </label>
        }
        @if (mode !== 'forgot') {
          <label class="field">{{ mode === 'reset' ? 'Contraseña nueva' : 'Contraseña' }}
            <input class="input" type="password" name="password" [(ngModel)]="f.password" required [minlength]="mode === 'login' ? 1 : 8"
              [autocomplete]="mode === 'login' ? 'current-password' : 'new-password'" />
            @if (mode !== 'login') { <span class="muted hint">Mínimo 8 caracteres, con mayúscula, minúscula y número.</span> }
          </label>
        }
        @if (mode === 'login') { <a class="forgot" routerLink="/forgot-password">¿Has olvidado tu contraseña?</a> }

        <button class="btn primary big" [disabled]="loading() || form.invalid || (mode === 'reset' && !token)">
          {{ loading() ? 'Un momento…' : action }}
        </button>
        @if (google() && (mode === 'login' || mode === 'register')) {
          <div class="or muted"><span>o</span></div>
          <button type="button" class="btn big google" (click)="withGoogle()" [disabled]="loading()">
            <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true">
              <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.2C12.5 13.6 17.8 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.2 5.6c4.2-3.9 7.1-9.6 7.1-17z"/>
              <path fill="#FBBC05" d="M10.5 28.6A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.6l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l7.9-6.1z"/>
              <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.2-5.6c-2.2 1.5-5 2.4-8.7 2.4-6.2 0-11.5-4.2-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/>
            </svg>
            Continuar con Google
          </button>
        }
      }
      <p class="muted alt">
        @switch (mode) {
          @case ('login') { ¿No tienes cuenta? <a routerLink="/register">Regístrate</a> }
          @case ('register') { ¿Ya tienes cuenta? <a routerLink="/login">Inicia sesión</a> }
          @default { <a routerLink="/login">Volver a iniciar sesión</a> }
        }
      </p>
    </form>
  </div>`,
  styles: [`
    .wrap { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
    .box { width: 100%; max-width: 380px; padding: 28px; display: grid; gap: 14px; }
    .brand { display: flex; align-items: center; gap: 9px; font-weight: 650; margin-bottom: 6px; }
    .logo { width: 26px; height: 26px; border-radius: 6px; background: var(--accent); color: var(--on-accent); display: grid; place-content: center; font-weight: 700; }
    .big { height: 38px; margin-top: 4px; }
    .msg { border-radius: var(--radius-sm); padding: 8px 10px; font-size: 13px; border: 1px solid;
      &.error { background: color-mix(in srgb, var(--critical) 14%, transparent); border-color: var(--critical); }
      &.ok { background: color-mix(in srgb, var(--good) 14%, transparent); border-color: var(--good); } }
    .or { display: flex; align-items: center; gap: 10px; font-size: 12px; margin: -2px 0;
      &::before, &::after { content: ''; flex: 1; border-top: 1px solid var(--border); } }
    .google { display: flex; align-items: center; justify-content: center; gap: 10px; }
    .hint { font-weight: 400; } .alt { text-align: center; font-size: 13px; } .forgot { font-size: 13px; justify-self: end; margin-top: -6px; }
  `],
})
export class AuthComponent {
  private auth = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  mode: Mode = this.route.snapshot.data['mode'];
  title = TITLES[this.mode];
  action = ACTIONS[this.mode];
  token = this.route.snapshot.queryParamMap.get('token') ?? '';
  f = { full_name: '', email: '', username: '', password: '' };
  loading = signal(false);
  error = signal(this.mode === 'reset' && !this.token ? 'A este enlace le falta el código. Ábrelo desde el correo o solicita uno nuevo.' : '');
  done = signal('');

  google = signal(false);

  constructor() {
    // El token no debe quedarse en la barra de direcciones ni en el historial
    if (this.token) this.router.navigate([], { queryParams: {}, replaceUrl: true });
    if (this.mode === 'login' || this.mode === 'register') {
      this.auth.providers().subscribe({ next: p => this.google.set(p.google), error: () => {} });
      this.handleGoogleReturn();
    }
  }

  withGoogle() {
    this.loading.set(true);
    this.auth.signInWithGoogle();
  }

  /** Vuelta del inicio de sesión con Google: código de un solo uso en el fragmento o motivo del fallo en ?google= */
  private handleGoogleReturn() {
    const code = new URLSearchParams(this.route.snapshot.fragment ?? '').get('google_code');
    const result = this.route.snapshot.queryParamMap.get('google');
    if (!code && !result) return;
    this.router.navigate([], { queryParams: {}, fragment: undefined, replaceUrl: true });
    if (result) { this.error.set(GOOGLE_ERRORS[result] ?? GOOGLE_ERRORS['error']); return; }
    this.loading.set(true);
    this.auth.exchangeGoogleCode(code!).subscribe({
      next: () => this.router.navigateByUrl('/'),
      error: e => { this.loading.set(false); this.error.set(errorMessage(e, GOOGLE_ERRORS['error'])); },
    });
  }

  submit() {
    this.loading.set(true);
    this.error.set('');
    const fail = (e: unknown) => { this.loading.set(false); this.error.set(errorMessage(e, 'No se pudo completar la operación')); };

    if (this.mode === 'forgot') {
      this.auth.forgotPassword(this.f.email.trim()).subscribe({ next: r => { this.loading.set(false); this.done.set(r.message); }, error: fail });
      return;
    }
    if (this.mode === 'reset') {
      this.auth.resetPassword(this.token, this.f.password).subscribe({
        next: r => { this.loading.set(false); this.auth.logout(false); this.done.set(r.message); },
        error: fail,
      });
      return;
    }
    const login$ = this.mode === 'register'
      ? this.auth.register({ email: this.f.email.trim(), username: this.f.username.trim(), password: this.f.password, full_name: this.f.full_name.trim() || undefined })
          .pipe(switchMap(() => this.auth.login(this.f.username.trim(), this.f.password)))
      : this.auth.login(this.f.username.trim(), this.f.password);
    login$.subscribe({
      next: () => {
        // Solo rutas internas: evita redirecciones abiertas mediante returnUrl
        const ret = this.route.snapshot.queryParamMap.get('returnUrl') ?? '';
        this.router.navigateByUrl(ret.startsWith('/') && !ret.startsWith('//') ? ret : '/');
      },
      error: fail,
    });
  }
}
