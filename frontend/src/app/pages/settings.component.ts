import { Component, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { Theme, ThemeService } from '../core/theme.service';
import { ToastService } from '../core/toast.service';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
  <div class="page narrow">
    <div class="page-head"><h1>Ajustes</h1></div>

    <form class="card sec" (ngSubmit)="saveProfile()">
      <h2>Perfil</h2>
      <label class="field">Nombre <input class="input" name="full_name" [(ngModel)]="p.full_name" maxlength="100" /></label>
      <label class="field">Email <input class="input" type="email" name="email" [(ngModel)]="p.email" required /></label>
      <label class="field">Usuario <input class="input" [value]="auth.user()?.username ?? ''" disabled /></label>
      <label class="field">Biografía <textarea class="input" name="bio" [(ngModel)]="p.bio" rows="3" maxlength="2000"></textarea></label>
      <div class="row"><span class="spacer"></span><button class="btn primary" [disabled]="busy()">Guardar perfil</button></div>
    </form>

    <section class="card sec">
      <h2>Apariencia</h2>
      <div class="row" role="radiogroup" aria-label="Tema">
        @for (t of themes; track t.id) {
          <button class="btn" role="radio" [attr.aria-checked]="theme.theme() === t.id" [class.active]="theme.theme() === t.id" (click)="setTheme(t.id)">{{ t.label }}</button>
        }
      </div>
    </section>

    <section class="card sec">
      <h2>Google Calendar</h2>
      <p class="muted">Conecta tu cuenta y sincroniza las tareas con fecha desde la vista de calendario.</p>
      <div><a class="btn" routerLink="/calendar">Abrir calendario</a></div>
    </section>

    <form class="card sec" (ngSubmit)="changePassword()">
      <h2>Contraseña</h2>
      <label class="field">Contraseña actual <input class="input" type="password" name="cur" [(ngModel)]="pw.current" required autocomplete="current-password" /></label>
      <label class="field">Nueva contraseña <input class="input" type="password" name="new" [(ngModel)]="pw.next" required minlength="8" autocomplete="new-password" />
        <span class="muted" style="font-weight:400">Mínimo 8 caracteres, con mayúscula, minúscula y número.</span></label>
      <div class="row"><span class="spacer"></span><button class="btn" [disabled]="busy() || !pw.current || pw.next.length < 8">Cambiar contraseña</button></div>
    </form>

    <section class="card sec">
      <h2>Sesión</h2>
      <div><button class="btn danger" (click)="auth.logout()">Cerrar sesión</button></div>
    </section>
  </div>`,
  styles: [`.narrow { max-width: 640px; } .sec { padding: 20px; display: grid; gap: 14px; margin-bottom: 14px; }`],
})
export class SettingsComponent {
  auth = inject(AuthService);
  theme = inject(ThemeService);
  private toast = inject(ToastService);
  themes: { id: Theme; label: string }[] = [{ id: 'auto', label: 'Automático' }, { id: 'light', label: 'Claro' }, { id: 'dark', label: 'Oscuro' }];
  p = { full_name: '', email: '', bio: '' };
  pw = { current: '', next: '' };
  busy = signal(false);

  constructor() {
    effect(() => {
      const u = this.auth.user();
      if (u) this.p = { full_name: u.full_name ?? '', email: u.email, bio: u.bio ?? '' };
    });
  }

  saveProfile() {
    this.busy.set(true);
    this.auth.updateProfile({ full_name: this.p.full_name.trim() || null, email: this.p.email.trim(), bio: this.p.bio.trim() || null }).subscribe({
      next: () => { this.busy.set(false); this.toast.success('Perfil guardado'); },
      error: e => { this.busy.set(false); this.toast.error(e); },
    });
  }
  setTheme(t: Theme) {
    this.theme.set(t);
    this.auth.updateProfile({ theme: t }).subscribe({ error: () => {} });
  }
  changePassword() {
    this.busy.set(true);
    this.auth.changePassword(this.pw.current, this.pw.next).subscribe({
      next: () => { this.busy.set(false); this.pw = { current: '', next: '' }; this.toast.success('Contraseña actualizada'); },
      error: e => { this.busy.set(false); this.toast.error(e); },
    });
  }
}
