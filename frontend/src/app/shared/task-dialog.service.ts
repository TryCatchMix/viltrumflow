import { Injectable, signal } from '@angular/core';
import { Task, TaskInput } from '../core/models';

export type DialogState = { mode: 'create'; defaults: TaskInput & { day?: string } } | { mode: 'edit'; task: Task } | null;

/** Abre el panel de tarea desde cualquier pantalla (lo pinta el layout). */
@Injectable({ providedIn: 'root' })
export class TaskDialogService {
  readonly state = signal<DialogState>(null);
  create(defaults: TaskInput & { day?: string } = {}) { this.state.set({ mode: 'create', defaults }); }
  edit(task: Task) { this.state.set({ mode: 'edit', task }); }
  close() { this.state.set(null); }
}
