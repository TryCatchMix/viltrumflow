import { Component, OnDestroy, OnInit, ViewChild, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { AuthService } from '../core/auth.service';
import { SwUpdate } from '@angular/service-worker';
import { NotificationService } from '../core/notification.service';
import { OfflineService } from '../core/offline.service';
import { PushService } from '../core/push.service';
import { ThemeService } from '../core/theme.service';
import { ToastService } from '../core/toast.service';
import { GameService } from '../core/game.service';
import { PHASE_LABEL, PomodoroService } from '../core/pomodoro.service';
import { IconComponent } from '../shared/icon.component';
import { RankInsigniaComponent } from '../shared/rank-insignia.component';
import { TaskDialogComponent } from '../shared/task-dialog.component';
import { TaskDialogService } from '../shared/task-dialog.service';
import { CommandPaletteComponent } from './command-palette.component';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, IconComponent, CommandPaletteComponent, TaskDialogComponent, RankInsigniaComponent],
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
      @if (pomodoro.active()) {
        <a class="pomo row" routerLink="/focus" [class.break]="pomodoro.phase() !== 'focus'" [title]="phaseLabel[pomodoro.phase()] + (pomodoro.running() ? '' : ' (en pausa)')">
          <app-icon [name]="pomodoro.running() ? 'target' : 'pause'" /><span class="t">{{ pomodoro.clock() }}</span>
          <span class="truncate muted">{{ pomodoro.phase() === 'focus' ? (pomodoro.taskTitle() || 'Concentración') : phaseLabel[pomodoro.phase()] }}</span>
        </a>
      }
      @if (game.profile(); as g) {
        <a class="level" routerLink="/progress" [title]="g.xp + ' XP · faltan ' + (g.next_level_xp - g.xp) + ' para el nivel ' + (g.level + 1)">
          <app-rank-insignia [rank]="g.rank_index" [size]="26" [label]="g.rank" />
          <div><div class="row"><strong class="truncate">{{ g.rank }}</strong><span class="spacer"></span>
              @if (game.wallet(); as w) { <span class="coins" [title]="w.coins + ' monedas' + (w.freezes ? ' · ' + w.freezes + ' protector(es) de racha' : '')"><app-icon name="coin" [size]="12" />{{ w.coins }}</span> }
              <span class="muted">Nv. {{ g.level }}</span></div>
            <div class="xpbar"><span [style.width.%]="game.progress()"></span></div></div>
        </a>
      }
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
      @if (!offline.online()) {
        <div class="offline" role="status"><app-icon name="offline" [size]="14" />
          Sin conexión. Puedes consultar lo que ya habías abierto, escribir notas y crear tareas; se sincronizarán al volver.</div>
      } @else if (offline.pending()) {
        <div class="offline sync" role="status"><app-icon name="sync" [size]="14" /> {{ offline.pending() }} cambio(s) pendientes de sincronizar
          <button class="btn sm" (click)="offline.sync()">Sincronizar</button></div>
      }
      @if (updateReady()) {
        <div class="offline sync" role="status">Hay una versión nueva de ViltrumFlow. <button class="btn sm" (click)="reload()">Actualizar</button></div>
      }
      <button class="btn ghost icon burger" (click)="navOpen.set(true)" aria-label="Abrir menú"><app-icon name="menu" [size]="18" /></button>
      <router-outlet />
    </main>
  </div>

  @if (game.levelUp(); as up) {
    <div class="backdrop" (click)="game.levelUp.set(null)">
      <div class="modal levelup" role="alertdialog" aria-label="Has subido de nivel" (click)="$event.stopPropagation()">
        <app-rank-insignia [rank]="up.rankIndex" [size]="110" [label]="up.rank" />
        <span class="muted">{{ up.newRank ? 'Nuevo rango' : 'Has subido de nivel' }}</span>
        <h2>{{ up.newRank ? up.rank : 'Nivel ' + up.level }}</h2>
        <p class="muted">{{ up.newRank ? 'Alcanzas el nivel ' + up.level + ' y asciendes en el Imperio.' : 'Sigues siendo ' + up.rank + '. Cada nivel te acerca al siguiente rango.' }}</p>
        <div class="row"><a class="btn" routerLink="/progress" (click)="game.levelUp.set(null)">Ver mi progreso</a><button class="btn primary" (click)="game.levelUp.set(null)">Continuar</button></div>
      </div>
    </div>
  }
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
    .level { display: flex; align-items: center; gap: 9px; padding: 7px 8px; border-radius: var(--radius-sm); border: 1px solid var(--border); color: var(--text); font-size: 12.5px;
      &:hover { text-decoration: none; border-color: var(--text-3); } > div { flex: 1; min-width: 0; display: grid; gap: 4px; } strong { font-weight: 500; } }
    .coins { display: inline-flex; gap: 3px; align-items: center; margin-right: 6px; font-variant-numeric: tabular-nums; color: var(--text-2); app-icon { color: var(--warning); } }
    .xpbar { height: 4px; border-radius: 2px; background: var(--surface-3); overflow: hidden; span { display: block; height: 100%; background: var(--accent); transition: width .4s; } }
    .pomo { padding: 6px 9px; border-radius: var(--radius-sm); background: var(--accent-soft); color: var(--accent-text); font-size: 13px; &:hover { text-decoration: none; }
      &.break { background: color-mix(in srgb, var(--series-3) 18%, transparent); color: var(--text); } .t { font-variant-numeric: tabular-nums; font-weight: 600; } .muted { font-size: 12px; } }
    .levelup { justify-items: center; text-align: center; max-width: 360px; padding: 28px; h2 { font-size: 26px; } .row { margin-top: 6px; } animation: pop .25s ease-out; }
    @keyframes pop { from { transform: scale(.9); opacity: 0; } }
    .user { border-top: 1px solid var(--border); padding-top: 10px; gap: 2px; }
    .me { flex: 1; color: var(--text); font-weight: 500; padding: 2px 4px; border-radius: var(--radius-sm); &:hover { background: var(--surface-2); text-decoration: none; } }
    .avatar { width: 24px; height: 24px; border-radius: 50%; background: var(--surface-3); display: grid; place-content: center; font-size: 12px; font-weight: 600; flex: none; }
    main { flex: 1; min-width: 0; overflow-y: auto; position: relative; display: flex; flex-direction: column; }
    .offline { display: flex; align-items: center; gap: 8px; padding: 7px 16px; font-size: 13px; background: color-mix(in srgb, var(--warning) 16%, var(--surface)); border-bottom: 1px solid var(--border); flex: none;
      &.sync { background: var(--accent-soft); } }
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
  private sw = inject(SwUpdate);
  offline = inject(OfflineService);
  game = inject(GameService);
  pomodoro = inject(PomodoroService);
  private push = inject(PushService);
  phaseLabel = PHASE_LABEL;
  updateReady = signal(false);
  reload() { location.reload(); }
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
    { path: '/today', icon: 'sun', label: 'Hoy' },
    { path: '/tasks', icon: 'check', label: 'Tareas' },
    { path: '/kanban', icon: 'board', label: 'Tablero' },
    { path: '/calendar', icon: 'calendar', label: 'Calendario' },
    { path: '/projects', icon: 'folder', label: 'Proyectos' },
    { path: '/goals', icon: 'mountain', label: 'Objetivos' },
    { path: '/focus', icon: 'target', label: 'Enfoque' },
    { path: '/review', icon: 'history', label: 'Revisión semanal' },
    { path: '/missions', icon: 'flag', label: 'Misiones' },
    { path: '/progress', icon: 'shield', label: 'Progreso', gap: true },
    { path: '/notes', icon: 'note', label: 'Notas' },
    { path: '/graph', icon: 'graph', label: 'Grafo', gap: true },
    { path: '/trash', icon: 'trash', label: 'Papelera' },
  ];
  initial = () => (this.auth.user()?.full_name || this.auth.user()?.username || '?').charAt(0).toUpperCase();

  // El layout solo se destruye al cerrar sesión: el siguiente usuario no debe heredar nivel ni reloj
  ngOnDestroy() { this.notifications.stop(); this.game.reset(); this.pomodoro.clear(); }

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
    this.game.refresh();
    this.pomodoro.init();
    this.push.init();
    this.offline.sync();
    if (this.sw.isEnabled) this.sw.versionUpdates.subscribe(e => { if (e.type === 'VERSION_READY') this.updateReady.set(true); });
    this.router.events.pipe(filter(e => e instanceof NavigationEnd)).subscribe(() => this.navOpen.set(false));
  }
}
