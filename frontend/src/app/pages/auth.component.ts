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

  constructor() {
    // El token no debe quedarse en la barra de direcciones ni en el historial
    if (this.token) this.router.navigate([], { queryParams: {}, replaceUrl: true });
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
