import { AfterViewInit, Component, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { ImportResult } from '../core/models';
import { NotificationService } from '../core/notification.service';
import { IconComponent } from '../shared/icon.component';
import { AuthService } from '../core/auth.service';
import { Theme, ThemeService } from '../core/theme.service';
import { ToastService } from '../core/toast.service';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [FormsModule, RouterLink, IconComponent],
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
      <h2>Recordatorios y avisos</h2>
      <div class="opt">
        <div><strong>Notificaciones del navegador</strong>
          <p class="muted">Avisan de los recordatorios de tus tareas mientras ViltrumFlow está abierto en una pestaña.</p></div>
        @if (!notif.supported) { <span class="chip">No disponible en este navegador</span> }
        @else if (notif.permission() === 'granted') { <span class="chip"><span class="ok"></span> Activadas</span> }
        @else if (notif.permission() === 'denied') { <span class="chip" title="Cámbialo en los permisos del sitio de tu navegador">Bloqueadas en el navegador</span> }
        @else { <button class="btn" (click)="notif.requestPermission()"><app-icon name="bell" /> Activar</button> }
      </div>
      @if (!emailReady()) {
        <div class="box"><p class="muted">El envío de correos no está configurado en el servidor (variables <code>SMTP_*</code>, ver README). Los avisos por email no se enviarán hasta entonces.</p></div>
      }
      <label class="opt"><div><strong>Recordatorios por email</strong><p class="muted">Un correo cuando llega el recordatorio de una tarea, aunque no tengas la app abierta.</p></div>
        <input type="checkbox" [checked]="auth.user()?.email_reminders" (change)="setPref({ email_reminders: $any($event.target).checked })" /></label>
      <label class="opt"><div><strong>Resumen diario por email</strong><p class="muted">Cada mañana, las tareas de hoy y las atrasadas. No se envía si no hay nada pendiente.</p></div>
        <input type="checkbox" [checked]="auth.user()?.daily_digest" (change)="setPref({ daily_digest: $any($event.target).checked })" /></label>
      <label class="opt"><div><strong>Hora del resumen</strong><p class="muted">Hora local ({{ auth.user()?.timezone }}).</p></div>
        <select class="input hour" [ngModel]="auth.user()?.digest_hour" (ngModelChange)="setPref({ digest_hour: $event })" [ngModelOptions]="{ standalone: true }">
          @for (h of hours; track h) { <option [ngValue]="h">{{ h < 10 ? '0' + h : h }}:00</option> }
        </select></label>
    </section>

    <section class="card sec" id="vault">
      <h2>Tus notas: exportar e importar</h2>
      <p class="muted">Las notas se exportan como archivos <code>.md</code> en sus carpetas, un formato que Obsidian abre directamente como vault. También sirve como copia de seguridad.</p>
      <div><button class="btn" (click)="exportNotes()" [disabled]="busy()"><app-icon name="download" /> Exportar todas las notas (.zip)</button></div>
      <hr />
      <p class="muted">Importa un <code>.zip</code> (por ejemplo, la carpeta de tu vault de Obsidian comprimida) o archivos <code>.md</code> sueltos. El nombre del archivo será el título de la nota.</p>
      <label class="row"><input type="checkbox" [(ngModel)]="overwrite" [ngModelOptions]="{ standalone: true }" /> Sobrescribir las notas que ya existan con el mismo título</label>
      <div>
        <input #file type="file" accept=".zip,.md" multiple hidden (change)="importNotes(file)" />
        <button class="btn" (click)="file.click()" [disabled]="busy()"><app-icon name="upload" /> {{ busy() ? 'Importando…' : 'Elegir archivos…' }}</button>
      </div>
      @if (result(); as r) {
        <div class="box" role="status">
          <strong>{{ r.created }} creadas · {{ r.updated }} actualizadas · {{ r.skipped }} omitidas (ya existían)</strong>
          @if (r.errors.length) {
            <p class="muted">No se pudieron importar:</p>
            <ul>@for (e of r.errors; track e) { <li>{{ e }}</li> }</ul>
          }
          @if (r.created || r.updated) { <a routerLink="/notes">Ver notas</a> }
        </div>
      }
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
  styles: [`
    .narrow { max-width: 640px; } .sec { padding: 20px; display: grid; gap: 14px; margin-bottom: 14px; }
    .opt { display: flex; align-items: center; gap: 16px; justify-content: space-between; p { font-size: 13px; } strong { font-weight: 500; } }
    .hour { width: 100px; }
    .ok { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--good); }
    .box { background: var(--surface-2); border-radius: var(--radius-sm); padding: 10px 12px; font-size: 13px; display: grid; gap: 6px; ul { margin: 0; padding-left: 18px; overflow-wrap: anywhere; } }
    hr { border: none; border-top: 1px solid var(--border); margin: 2px 0; width: 100%; }
    code { font: 12px var(--mono); background: var(--surface-2); padding: 1px 5px; border-radius: 4px; }
  `],
})
export class SettingsComponent implements AfterViewInit {
  notif = inject(NotificationService);
  private api = inject(ApiService);
  private route = inject(ActivatedRoute);
  hours = Array.from({ length: 24 }, (_, i) => i);
  emailReady = signal(true);
  result = signal<ImportResult | null>(null);
  overwrite = false;
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

  ngAfterViewInit() {
    this.api.notificationStatus().subscribe(s => this.emailReady.set(s.email_configured));
    const id = this.route.snapshot.fragment;
    if (id) setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }));
  }

  setPref(data: { email_reminders?: boolean; daily_digest?: boolean; digest_hour?: number }) {
    this.auth.updateProfile(data).subscribe({ error: e => this.toast.error(e) });
  }

  exportNotes() {
    this.busy.set(true);
    this.api.exportNotes().subscribe({
      next: blob => {
        this.busy.set(false);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `viltrumflow-notas-${new Date().toISOString().slice(0, 10)}.zip`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      },
      error: e => { this.busy.set(false); this.toast.error(e, 'No se pudieron exportar las notas'); },
    });
  }

  importNotes(input: HTMLInputElement) {
    const files = Array.from(input.files ?? []);
    input.value = '';  // permite volver a elegir el mismo archivo
    if (!files.length) return;
    this.busy.set(true);
    this.result.set(null);
    this.api.importNotes(files, this.overwrite).subscribe({
      next: r => { this.busy.set(false); this.result.set(r); },
      error: e => { this.busy.set(false); this.toast.error(e, 'No se pudo importar'); },
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
      next: () => { this.busy.set(false); this.pw = { current: '', next: '' }; this.toast.success('Contraseña actualizada. Se han cerrado tus otras sesiones'); },
      error: e => { this.busy.set(false); this.toast.error(e); },
    });
  }
}
