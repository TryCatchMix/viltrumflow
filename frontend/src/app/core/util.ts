import { HttpErrorResponse } from '@angular/common/http';
import { Task } from './models';

const pad = (n: number) => String(n).padStart(2, '0');

/** YYYY-MM-DD en hora local. */
export function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export const today = () => ymd(new Date());

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return ymd(new Date(y, m - 1, d + n));
}

/**
 * Día de calendario de una tarea. Las de día completo se guardan a medianoche UTC,
 * así que su fecha se lee tal cual; las que tienen hora se convierten a hora local.
 */
export function taskDay(t: Pick<Task, 'due_date' | 'all_day'>): string | null {
  if (!t.due_date) return null;
  return t.all_day ? t.due_date.slice(0, 10) : ymd(new Date(t.due_date));
}
export function taskTime(t: Pick<Task, 'due_date' | 'all_day'>): string {
  if (!t.due_date || t.all_day) return '';
  const d = new Date(t.due_date);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
/** Construye el due_date a enviar a la API. */
export function toDue(day: string, time: string): { due_date: string | null; all_day: boolean } {
  if (!day) return { due_date: null, all_day: true };
  if (!time) return { due_date: `${day}T00:00:00Z`, all_day: true };
  return { due_date: new Date(`${day}T${time}:00`).toISOString(), all_day: false };
}

const DAY_FMT = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' });
const DAY_FMT_Y = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', year: 'numeric' });

export function parseDay(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function formatDay(day: string): string {
  const t = today();
  if (day === t) return 'Hoy';
  if (day === addDays(t, 1)) return 'Mañana';
  if (day === addDays(t, -1)) return 'Ayer';
  const d = parseDay(day);
  return (d.getFullYear() === new Date().getFullYear() ? DAY_FMT : DAY_FMT_Y).format(d);
}
export function isOverdue(t: Task): boolean {
  if (!t.due_date || t.status === 'completed' || t.status === 'archived') return false;
  return t.all_day ? taskDay(t)! < today() : new Date(t.due_date).getTime() < Date.now();
}
export function relativeTime(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'ahora';
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  if (s < 86400 * 30) return `hace ${Math.floor(s / 86400)} d`;
  return DAY_FMT_Y.format(new Date(iso));
}

/** Mensaje legible a partir de un error de la API (FastAPI devuelve `detail` como texto o lista). */
export function errorMessage(err: unknown, fallback = 'Algo ha salido mal'): string {
  if (err instanceof HttpErrorResponse) {
    if (err.status === 0) return 'No se puede conectar con el servidor';
    const d = err.error?.detail;
    if (typeof d === 'string') return d;
    if (Array.isArray(d) && d.length) return String(d[0].msg ?? fallback).replace(/^Value error, /, '');
  }
  return fallback;
}
