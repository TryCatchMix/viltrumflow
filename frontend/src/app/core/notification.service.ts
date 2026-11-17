import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { ToastService } from './toast.service';
import { TaskDialogService } from '../shared/task-dialog.service';
import { Reminder } from './models';

const TIME = new Intl.DateTimeFormat('es', { hour: '2-digit', minute: '2-digit' });

/** Recordatorios en el navegador: consulta cada minuto los que toca avisar mientras la app está abierta. */
@Injectable({ providedIn: 'root' })
export class NotificationService {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private toast = inject(ToastService);
  private dialog = inject(TaskDialogService);
  private router = inject(Router);
  private timer?: ReturnType<typeof setInterval>;

  readonly supported = typeof Notification !== 'undefined';
  readonly permission = signal<NotificationPermission>(this.supported ? Notification.permission : 'denied');

  start() {
    this.stop();
    this.poll();
    this.timer = setInterval(() => this.poll(), 60_000);
  }
  stop() { clearInterval(this.timer); }

  async requestPermission() {
    if (!this.supported) return;
    this.permission.set(await Notification.requestPermission());
    if (this.permission() === 'granted') new Notification('ViltrumFlow', { body: 'Los recordatorios aparecerán así.' });
  }

  private poll() {
    if (!this.auth.isAuthenticated()) return;
    this.api.pollReminders().subscribe({ next: list => list.forEach(r => this.notify(r)), error: () => {} });
  }

  private habit(r: Reminder) {
    this.toast.show(`Rutina pendiente: ${r.title}`, 'info', 12_000);
    if (this.supported && Notification.permission === 'granted') {
      const n = new Notification('Rutina pendiente', { body: r.title, tag: `vf-habit-${r.task_id}` });
      n.onclick = () => { window.focus(); this.router.navigate(['/today']); n.close(); };
    }
  }

  private assigned(r: Reminder) {
    const where = r.by ? ` en «${r.by}»` : '';
    this.toast.show(`Te han asignado una tarea${where}: ${r.title}`, 'info', 12_000);
    this.api.tasksChanged.next();
    if (this.supported && Notification.permission === 'granted') {
      const n = new Notification('Nueva tarea asignada', { body: `${r.title}${where}`, tag: `vf-assigned-${r.task_id}` });
      n.onclick = () => { window.focus(); this.api.task(r.task_id).subscribe({ next: t => this.dialog.edit(t), error: () => {} }); n.close(); };
    }
  }

  private notify(r: Reminder) {
    if (r.kind === 'assigned') return this.assigned(r);
    if (r.kind === 'habit') return this.habit(r);
    const when = r.all_day || !r.due_date ? 'vence hoy o mañana' : `a las ${TIME.format(new Date(r.due_date))}`;
    const open = () => this.api.task(r.task_id).subscribe({ next: t => this.dialog.edit(t), error: () => {} });
    // Siempre queda el aviso dentro de la app; la notificación del sistema es un extra si hay permiso
    this.toast.show(`Recordatorio: ${r.title} (${when})`, 'info', 12_000);
    if (this.supported && Notification.permission === 'granted') {
      const n = new Notification(`Recordatorio: ${r.title}`, { body: r.all_day ? 'Tarea de día completo' : `Vence ${when}`, tag: `vf-task-${r.task_id}` });
      n.onclick = () => { window.focus(); open(); n.close(); };
    }
  }
}
