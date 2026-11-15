import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { switchMap } from 'rxjs';
import { AuthService } from '../core/auth.service';
import { errorMessage } from '../core/util';

@Component({
  selector: 'app-auth',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
  <div class="wrap">
    <form class="card box" (ngSubmit)="submit()" #form="ngForm">
      <div class="brand"><span class="logo">V</span> ViltrumFlow</div>
      <h1>{{ register ? 'Crea tu cuenta' : 'Inicia sesión' }}</h1>
      <p class="muted">Tareas, notas enlazadas y calendario en un solo sitio.</p>

      @if (error()) { <div class="error" role="alert">{{ error() }}</div> }

      @if (register) {
        <label class="field">Nombre <input class="input" name="full_name" [(ngModel)]="f.full_name" autocomplete="name" maxlength="100" /></label>
        <label class="field">Email <input class="input" type="email" name="email" [(ngModel)]="f.email" required autocomplete="email" /></label>
      }
      <label class="field">{{ register ? 'Nombre de usuario' : 'Usuario o email' }}
        <input class="input" name="username" [(ngModel)]="f.username" required minlength="3" autocomplete="username" />
      </label>
      <label class="field">Contraseña
        <input class="input" type="password" name="password" [(ngModel)]="f.password" required [minlength]="register ? 8 : 1"
          [autocomplete]="register ? 'new-password' : 'current-password'" />
        @if (register) { <span class="muted hint">Mínimo 8 caracteres, con mayúscula, minúscula y número.</span> }
      </label>

      <button class="btn primary big" [disabled]="loading() || form.invalid">
        {{ loading() ? 'Un momento…' : register ? 'Crear cuenta' : 'Entrar' }}
      </button>
      <p class="muted alt">
        @if (register) { ¿Ya tienes cuenta? <a routerLink="/login">Inicia sesión</a> }
        @else { ¿No tienes cuenta? <a routerLink="/register">Regístrate</a> }
      </p>
    </form>
  </div>`,
  styles: [`
    .wrap { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
    .box { width: 100%; max-width: 380px; padding: 28px; display: grid; gap: 14px; }
    .brand { display: flex; align-items: center; gap: 9px; font-weight: 650; margin-bottom: 6px; }
    .logo { width: 26px; height: 26px; border-radius: 6px; background: var(--accent); color: var(--on-accent); display: grid; place-content: center; font-weight: 700; }
    .big { height: 38px; margin-top: 4px; }
    .error { background: color-mix(in srgb, var(--critical) 14%, transparent); border: 1px solid var(--critical); border-radius: var(--radius-sm); padding: 8px 10px; font-size: 13px; }
    .hint { font-weight: 400; } .alt { text-align: center; font-size: 13px; }
  `],
})
export class AuthComponent {
  private auth = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  register = this.route.snapshot.data['mode'] === 'register';
  f = { full_name: '', email: '', username: '', password: '' };
  loading = signal(false);
  error = signal('');

  submit() {
    this.loading.set(true);
    this.error.set('');
    const login$ = this.register
      ? this.auth.register({ email: this.f.email.trim(), username: this.f.username.trim(), password: this.f.password, full_name: this.f.full_name.trim() || undefined })
          .pipe(switchMap(() => this.auth.login(this.f.username.trim(), this.f.password)))
      : this.auth.login(this.f.username.trim(), this.f.password);
    login$.subscribe({
      next: () => {
        // Solo rutas internas: evita redirecciones abiertas mediante returnUrl
        const ret = this.route.snapshot.queryParamMap.get('returnUrl') ?? '';
        this.router.navigateByUrl(ret.startsWith('/') && !ret.startsWith('//') ? ret : '/');
      },
      error: e => { this.loading.set(false); this.error.set(errorMessage(e, 'No se pudo iniciar sesión')); },
    });
  }
}
