import { Component, OnDestroy, OnInit, ViewChild, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { AuthService } from '../core/auth.service';
import { NotificationService } from '../core/notification.service';
import { ThemeService } from '../core/theme.service';
import { ToastService } from '../core/toast.service';
import { IconComponent } from '../shared/icon.component';
import { TaskDialogComponent } from '../shared/task-dialog.component';
import { TaskDialogService } from '../shared/task-dialog.service';
import { CommandPaletteComponent } from './command-palette.component';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, IconComponent, CommandPaletteComponent, TaskDialogComponent],
  template: `
  <div class="shell" [class.nav-open]="navOpen()">
    <nav class="sidebar" aria-label="Navegación principal">
      <a class="brand" routerLink="/dashboard"><span class="logo">V</span> ViltrumFlow</a>
      <button class="search" (click)="palette.show()">
        <app-icon name="search" [size]="14" /> <span>Buscar…</span> <kbd>{{ mod }}K</kbd>
      </button>
      <div class="links">
        @for (l of links; track l.path) {
          <a [routerLink]="l.path" routerLinkActive="active"><app-icon [name]="l.icon" /> {{ l.label }}</a>
          @if (l.gap) { <hr /> }
        }
      </div>
      <span class="spacer"></span>
      <button class="btn primary new" (click)="dialog.create()"><app-icon name="plus" /> Nueva tarea</button>
      <div class="user row">
        <a class="row me truncate" routerLink="/settings" title="Ajustes">
          <span class="avatar">{{ initial() }}</span>
          <span class="truncate">{{ auth.user()?.full_name || auth.user()?.username }}</span>
        </a>
        <button class="btn ghost icon sm" (click)="theme.toggle()" [title]="theme.effective() === 'dark' ? 'Tema claro' : 'Tema oscuro'">
          <app-icon [name]="theme.effective() === 'dark' ? 'sun' : 'moon'" />
        </button>
        <button class="btn ghost icon sm" (click)="auth.logout()" title="Cerrar sesión"><app-icon name="logout" /></button>
      </div>
    </nav>
    <div class="scrim" (click)="navOpen.set(false)"></div>
    <main>
      <button class="btn ghost icon burger" (click)="navOpen.set(true)" aria-label="Abrir menú"><app-icon name="menu" [size]="18" /></button>
      <router-outlet />
    </main>
  </div>

  <app-command-palette #palette />
  <app-task-dialog />
  <div class="toasts" aria-live="polite">
    @for (t of toast.toasts(); track t.id) {
      <div class="toast" [class]="t.kind" (click)="toast.dismiss(t.id)">{{ t.text }}</div>
    }
  </div>`,
  styles: [`
    .shell { display: flex; height: 100vh; }
    .sidebar { width: var(--sidebar-w); flex: none; background: var(--surface); border-right: 1px solid var(--border); display: flex; flex-direction: column; padding: 14px 10px 10px; gap: 10px; }
    .brand { display: flex; align-items: center; gap: 9px; font-weight: 650; font-size: 15px; color: var(--text); padding: 0 6px; &:hover { text-decoration: none; } }
    .logo { width: 24px; height: 24px; border-radius: 6px; background: var(--accent); color: var(--on-accent); display: grid; place-content: center; font-size: 14px; font-weight: 700; }
    .search { display: flex; align-items: center; gap: 8px; height: 32px; padding: 0 9px; border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--bg); color: var(--text-3);
      span { flex: 1; text-align: left; } &:hover { border-color: var(--text-3); } }
    kbd { font: 11px var(--mono); border: 1px solid var(--border); border-radius: 4px; padding: 0 4px; }
    .links { display: grid; gap: 1px;
      a { display: flex; align-items: center; gap: 10px; height: 32px; padding: 0 9px; border-radius: var(--radius-sm); color: var(--text-2); font-weight: 500;
        &:hover { background: var(--surface-2); color: var(--text); text-decoration: none; }
        &.active { background: var(--accent-soft); color: var(--accent-text); } }
      hr { border: none; border-top: 1px solid var(--border); margin: 6px 4px; width: auto; } }
    .new { width: 100%; }
    .user { border-top: 1px solid var(--border); padding-top: 10px; gap: 2px; }
    .me { flex: 1; color: var(--text); font-weight: 500; padding: 2px 4px; border-radius: var(--radius-sm); &:hover { background: var(--surface-2); text-decoration: none; } }
    .avatar { width: 24px; height: 24px; border-radius: 50%; background: var(--surface-3); display: grid; place-content: center; font-size: 12px; font-weight: 600; flex: none; }
    main { flex: 1; min-width: 0; overflow-y: auto; position: relative; display: flex; flex-direction: column; }
    .burger, .scrim { display: none; }
    .toasts { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); z-index: 100; display: grid; gap: 8px; width: max-content; max-width: calc(100vw - 32px); }
    .toast { background: var(--surface-3); border: 1px solid var(--border); border-left: 3px solid var(--accent); padding: 9px 14px; border-radius: var(--radius-sm); box-shadow: var(--shadow); cursor: pointer;
      &.error { border-left-color: var(--critical); } &.success { border-left-color: var(--good); } }
    @media (max-width: 820px) {
      .sidebar { position: fixed; inset: 0 auto 0 0; z-index: 40; transform: translateX(-100%); transition: transform .18s; }
      .nav-open .sidebar { transform: none; box-shadow: var(--shadow); }
      .nav-open .scrim { display: block; position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 39; }
      .burger { display: inline-flex; position: absolute; top: 10px; left: 10px; z-index: 5; }
      main { padding-top: 40px; }
    }
  `],
})
export class ShellComponent implements OnInit, OnDestroy {
  private notifications = inject(NotificationService);
  auth = inject(AuthService);
  theme = inject(ThemeService);
  toast = inject(ToastService);
  dialog = inject(TaskDialogService);
  private router = inject(Router);
  @ViewChild('palette') palette!: CommandPaletteComponent;

  navOpen = signal(false);
  mod = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl ';
  links = [
    { path: '/dashboard', icon: 'home', label: 'Inicio' },
    { path: '/tasks', icon: 'check', label: 'Tareas' },
    { path: '/kanban', icon: 'board', label: 'Tablero' },
    { path: '/calendar', icon: 'calendar', label: 'Calendario' },
    { path: '/projects', icon: 'folder', label: 'Proyectos', gap: true },
    { path: '/notes', icon: 'note', label: 'Notas' },
    { path: '/graph', icon: 'graph', label: 'Grafo' },
  ];
  initial = () => (this.auth.user()?.full_name || this.auth.user()?.username || '?').charAt(0).toUpperCase();

  ngOnDestroy() { this.notifications.stop(); }

  ngOnInit() {
    // Un 401 aquí ya lo gestiona el interceptor (renueva o cierra sesión)
    this.auth.loadUser().subscribe({
      next: u => {
        // La zona horaria del navegador decide a qué hora local llegan recordatorios y resumen diario
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (tz && tz !== u.timezone) this.auth.updateProfile({ timezone: tz }).subscribe({ error: () => {} });
      },
      error: () => {},
    });
    this.notifications.start();
    this.router.events.pipe(filter(e => e instanceof NavigationEnd)).subscribe(() => this.navOpen.set(false));
  }
}
