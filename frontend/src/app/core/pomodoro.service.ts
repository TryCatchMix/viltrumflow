import { Injectable, computed, inject, signal } from '@angular/core';
import { ApiService } from './api.service';
import { PomodoroSettings } from './models';
import { ToastService } from './toast.service';

export type Phase = 'focus' | 'short' | 'long';
export const PHASE_LABEL: Record<Phase, string> = { focus: 'Concentración', short: 'Descanso corto', long: 'Descanso largo' };
export const DEFAULT_SETTINGS: PomodoroSettings = {
  focus_minutes: 25, short_break_minutes: 5, long_break_minutes: 15, cycles: 4, auto_start: false, sound: true, notify: true,
};

interface Saved { phase: Phase; endsAt: number | null; remaining: number; done: number; taskId: number | null; taskTitle: string; }
const KEY = 'vf-pomodoro';

/**
 * Reloj Pomodoro. Vive fuera de las páginas para seguir corriendo al navegar, y guarda la hora de fin
 * (no un contador) para que cerrar la pestaña o suspender el equipo no lo descuadre.
 */
@Injectable({ providedIn: 'root' })
export class PomodoroService {
  private api = inject(ApiService);
  private toast = inject(ToastService);

  readonly settings = signal<PomodoroSettings>(DEFAULT_SETTINGS);
  readonly phase = signal<Phase>('focus');
  readonly running = signal(false);
  /** Segundos que quedan de la fase actual. */
  readonly remaining = signal(DEFAULT_SETTINGS.focus_minutes * 60);
  /** Bloques de concentración terminados en la serie actual. */
  readonly done = signal(0);
  readonly taskId = signal<number | null>(null);
  readonly taskTitle = signal('');
  /** Se incrementa al registrar un bloque, para que las estadísticas se recarguen. */
  readonly logged = signal(0);

  readonly total = computed(() => this.duration(this.phase()));
  readonly clock = computed(() => {
    const s = Math.max(0, Math.ceil(this.remaining()));
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  });
  /** ¿Hay algo en marcha o a medias que mostrar fuera de la página del reloj? */
  readonly active = computed(() => this.running() || this.remaining() < this.total());

  private endsAt: number | null = null;
  private timer?: ReturnType<typeof setInterval>;
  private loaded = false;

  /** Carga ajustes y recupera el reloj si estaba en marcha. Se llama al entrar en la app. */
  init() {
    if (this.loaded) return;
    this.loaded = true;
    this.restore();
    this.api.pomodoroSettings().subscribe({
      next: s => { this.settings.set(s); if (!this.active()) this.remaining.set(this.total()); },
      error: () => {},
    });
    this.timer = setInterval(() => this.tick(), 500);
  }

  duration(phase: Phase): number {
    const s = this.settings();
    return (phase === 'focus' ? s.focus_minutes : phase === 'short' ? s.short_break_minutes : s.long_break_minutes) * 60;
  }

  saveSettings(s: PomodoroSettings) {
    this.settings.set(s);
    if (!this.active()) this.remaining.set(this.total());
    return this.api.savePomodoroSettings(s);
  }

  setTask(id: number | null, title = '') { this.taskId.set(id); this.taskTitle.set(title); this.persist(); }

  start() {
    if (this.running()) return;
    if (this.remaining() <= 0) this.remaining.set(this.total());
    this.endsAt = Date.now() + this.remaining() * 1000;
    this.running.set(true);
    this.persist();
    this.syncServer();
    if (this.settings().notify && typeof Notification !== 'undefined' && Notification.permission === 'default') Notification.requestPermission();
  }
  pause() {
    if (!this.running()) return;
    this.remaining.set(Math.max(0, (this.endsAt! - Date.now()) / 1000));
    this.endsAt = null;
    this.running.set(false);
    this.persist();
    this.syncServer();
  }
  /** Vuelve al principio de la fase actual sin registrar nada. */
  reset() {
    const wasRunning = this.running();
    this.endsAt = null;
    this.running.set(false);
    this.remaining.set(this.total());
    this.persist();
    if (wasRunning) this.syncServer();
  }
  /** Da por terminada la fase ahora. Un bloque de concentración cuenta por el tiempo real trabajado. */
  skip() {
    const worked = this.total() - (this.running() ? Math.max(0, (this.endsAt! - Date.now()) / 1000) : this.remaining());
    this.finish(Math.floor(worked), false);
  }
  /** Empieza una serie nueva desde el primer bloque. */
  restart() { this.done.set(0); this.phase.set('focus'); this.reset(); }

  private tick() {
    if (!this.running() || this.endsAt === null) return;
    const left = (this.endsAt - Date.now()) / 1000;
    if (left <= 0) this.finish(this.total(), true);
    else this.remaining.set(left);
  }

  private finish(workedSeconds: number, natural: boolean) {
    const phase = this.phase(), s = this.settings();
    if (phase === 'focus') {
      if (workedSeconds >= 60) this.log(workedSeconds);
      const done = this.done() + 1;
      this.done.set(done);
      this.phase.set(done % s.cycles === 0 ? 'long' : 'short');
    } else {
      if (phase === 'long') this.done.set(0);
      this.phase.set('focus');
    }
    this.endsAt = null;
    this.running.set(false);
    this.remaining.set(this.total());
    if (natural) this.announce(phase);
    if (natural && s.auto_start) this.start();
    else { this.persist(); this.syncServer(); }
  }

  /** El servidor avisa por push del final de la fase en curso aunque la app se cierre. */
  private syncServer() {
    const req = this.running() && this.endsAt
      ? this.api.setPomodoroTimer(new Date(this.endsAt).toISOString(), this.phase())
      : this.api.clearPomodoroTimer();
    req.subscribe({ error: () => {} });
  }

  private log(seconds: number) {
    this.api.logPomodoro(seconds, this.taskId()).subscribe({
      next: () => this.logged.update(n => n + 1),
      error: e => this.toast.error(e, 'No se pudo registrar el bloque de concentración'),
    });
  }

  private announce(finished: Phase) {
    const s = this.settings();
    const text = finished === 'focus' ? 'Bloque terminado. Toca descansar.' : 'Fin del descanso. A por otro bloque.';
    this.toast.show(text, 'info', 8000);
    if (s.sound) this.beep();
    if (s.notify && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try { new Notification('ViltrumFlow · Pomodoro', { body: text, tag: 'vf-pomodoro' }); } catch { /* sin permiso en este contexto */ }
    }
  }

  /** Tres tonos cortos generados en el momento (no hace falta ningún archivo de sonido). */
  private beep() {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      [0, 0.25, 0.5].forEach((at, i) => {
        const osc = ctx.createOscillator(), gain = ctx.createGain();
        osc.frequency.value = i === 2 ? 880 : 660;
        gain.gain.setValueAtTime(0.0001, ctx.currentTime + at);
        gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.2);
        osc.connect(gain).connect(ctx.destination);
        osc.start(ctx.currentTime + at);
        osc.stop(ctx.currentTime + at + 0.22);
      });
      setTimeout(() => ctx.close(), 1200);
    } catch { /* el navegador no permite audio sin interacción previa */ }
  }

  private persist() {
    const data: Saved = { phase: this.phase(), endsAt: this.endsAt, remaining: this.remaining(), done: this.done(), taskId: this.taskId(), taskTitle: this.taskTitle() };
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* sin almacenamiento */ }
  }
  private restore() {
    try {
      const d: Saved | null = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (!d) return;
      this.phase.set(d.phase); this.done.set(d.done); this.taskId.set(d.taskId); this.taskTitle.set(d.taskTitle ?? '');
      this.remaining.set(d.remaining);
      if (d.endsAt) { this.endsAt = d.endsAt; this.running.set(true); this.tick(); }  // si ya venció, `tick` lo cierra y registra
    } catch { /* estado ilegible: se empieza de cero */ }
  }

  /** Al cerrar sesión. */
  clear() {
    this.endsAt = null; this.running.set(false); this.phase.set('focus'); this.done.set(0); this.setTask(null);
    this.settings.set(DEFAULT_SETTINGS); this.remaining.set(this.total()); this.loaded = false;
    clearInterval(this.timer);
    localStorage.removeItem(KEY);
  }
}
