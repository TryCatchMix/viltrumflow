import { Priority, Recurrence } from './models';

/**
 * Captura rápida en lenguaje natural: «Llamar a Juan mañana a las 10 #trabajo !alta @web cada semana».
 * Extrae fecha, hora, prioridad, etiquetas, proyecto y repetición; lo que queda es el título.
 */
export interface QuickTask {
  title: string;
  day: string | null;      // AAAA-MM-DD
  time: string | null;     // HH:MM
  priority: Priority | null;
  tags: string[];
  project: string | null;  // texto tras @, sin resolver
  recurrence: Recurrence | null;
  estimate: number | null;  // minutos («~45m», «~1h30»)
}

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const NUMBERS: Record<string, number> = { un: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 };
const PRIORITIES: Record<string, Priority> = { urgente: 'urgent', alta: 'high', media: 'medium', baja: 'low', p1: 'urgent', p2: 'high', p3: 'medium', p4: 'low' };
const DAY_RE = 'lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo';

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const plain = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
/** Palabra completa aunque lleve tildes o ñ (el \b de JavaScript solo entiende ASCII). */
const word = (pattern: string) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${pattern})(?![\\p{L}\\p{N}])`, 'iu');

export function parseQuick(input: string, now: Date = new Date()): QuickTask {
  let s = ` ${input} `;
  const out: QuickTask = { title: '', day: null, time: null, priority: null, tags: [], project: null, recurrence: null, estimate: null };
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const plus = (days: number) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + days);
  const nextWeekday = (name: string) => {
    const diff = (WEEKDAYS.indexOf(plain(name)) - today.getDay() + 7) % 7 || 7;  // «el lunes» dicho en lunes es el siguiente
    return plus(diff);
  };
  /** Aplica el patrón; si coincide, lo retira del texto y devuelve la coincidencia. */
  const take = (re: RegExp): RegExpExecArray | null => {
    const m = re.exec(s);
    if (m) s = `${s.slice(0, m.index)} ${s.slice(m.index + m[0].length)}`;
    return m;
  };

  // Etiquetas, proyecto y prioridad
  for (let m; (m = take(/(?<=\s)#([\p{L}_][\p{L}\p{N}_/-]*)/u));) {
    const tag = m[1].toLowerCase();
    if (!out.tags.includes(tag)) out.tags.push(tag);
  }
  const project = take(/(?<=\s)@([\p{L}\p{N}_-]+)/u);
  if (project) out.project = project[1];
  const prio = take(/(?<=\s)!(urgente|alta|media|baja|p[1-4])(?=\s)/i) ?? take(/(?<=\s)(p[1-4])(?=\s)/i);
  if (prio) out.priority = PRIORITIES[prio[1].toLowerCase()];
  else if (take(/(?<=\s)!!(?=\s)/)) out.priority = 'urgent';
  else if (take(/(?<=\s)!(?=\s)/)) out.priority = 'high';

  // Duración estimada: «~45m», «~45 min», «~2h», «~1h30», «~1,5h»
  const est = take(/(?<=\s)~\s?(?:(\d+(?:[.,]\d+)?)\s?h(?:oras?)?(?:\s?(\d{1,2})(?:\s?m(?:in)?)?)?|(\d+)\s?m(?:in(?:utos?)?)?)(?=\s)/i);
  if (est) {
    const minutes = est[3] ? Number(est[3]) : Math.round(Number(est[1].replace(',', '.')) * 60) + Number(est[2] || 0);
    if (minutes > 0) out.estimate = minutes;
  }

  // Repetición
  let recurDay: Date | null = null;
  const everyDay = take(word(`cada (${DAY_RE})|todos los (${DAY_RE})`));
  if (everyDay) { out.recurrence = 'weekly'; recurDay = nextWeekday(everyDay[1] ?? everyDay[2]); }
  else if (take(word('d[ií]as laborables|de lunes a viernes|entre semana'))) out.recurrence = 'weekdays';
  else if (take(word('cada d[ií]a|todos los d[ií]as|a diario|diariamente'))) out.recurrence = 'daily';
  else if (take(word('cada (2|dos) semanas|quincenalmente'))) out.recurrence = 'biweekly';
  else if (take(word('cada semana|semanalmente|todas las semanas'))) out.recurrence = 'weekly';
  else if (take(word('cada mes|mensualmente|todos los meses'))) out.recurrence = 'monthly';
  else if (take(word('cada a[ñn]o|anualmente|todos los a[ñn]os'))) out.recurrence = 'yearly';

  // Hora
  const period = take(word('(?:por|de) la (ma[ñn]ana|tarde|noche)'));
  const clock = take(word('a las? (\\d{1,2})(?:[:.](\\d{2}))?\\s?(am|pm|h)?'))
    ?? take(word('(\\d{1,2})[:.](\\d{2})\\s?(am|pm|h)?'))
    ?? take(word('(\\d{1,2})()\\s?(am|pm|h)'));
  if (clock) {
    let h = Number(clock[1]);
    const min = Number(clock[2] || 0), suffix = (clock[3] ?? '').toLowerCase();
    const pm = suffix === 'pm' || (!!period && plain(period[1]) !== 'manana');
    if (pm && h < 12) h += 12;
    if (suffix === 'am' && h === 12) h = 0;
    if (h < 24 && min < 60) out.time = `${pad(h)}:${pad(min)}`;
  }

  // Fecha
  let date: Date | null = null, m: RegExpExecArray | null;
  if (take(word('pasado ma[ñn]ana'))) date = plus(2);
  else if (take(word('hoy'))) date = plus(0);
  else if (take(word('ma[ñn]ana'))) date = plus(1);
  else if (take(word('(?:la )?semana que viene|(?:la )?pr[oó]xima semana|(?:la )?semana pr[oó]xima'))) date = plus(((8 - today.getDay()) % 7) || 7);
  else if ((m = take(word('(?:en|dentro de) (\\d+|un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez) (d[ií]as?|semanas?|mes|meses)')))) {
    const n = NUMBERS[m[1].toLowerCase()] ?? Number(m[1]), unit = plain(m[2]);
    date = unit.startsWith('mes') ? new Date(today.getFullYear(), today.getMonth() + n, today.getDate()) : plus(n * (unit.startsWith('semana') ? 7 : 1));
  } else if ((m = take(word(`(?:el |este |pr[oó]ximo |el pr[oó]ximo )?(${DAY_RE})`)))) date = nextWeekday(m[1]);
  else if ((m = take(word(`(?:el )?(\\d{1,2}) de (${MONTHS.join('|')})(?: (?:de |del )?(\\d{4}))?`)))) {
    date = explicit(Number(m[1]), MONTHS.indexOf(m[2].toLowerCase()), m[3] ? Number(m[3]) : null, today);
  } else if ((m = take(word('(?:el )?(\\d{1,2})[/-](\\d{1,2})(?:[/-](\\d{2,4}))?')))) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : null;
    date = explicit(Number(m[1]), Number(m[2]) - 1, y, today);
  } else if ((m = take(word('el (?:d[ií]a )?(\\d{1,2})')))) {
    const d = Number(m[1]);
    date = new Date(today.getFullYear(), today.getMonth() + (d < today.getDate() ? 1 : 0), d);
    if (date.getDate() !== d) date = null;  // p. ej. «el 31» en un mes de 30 días
  }
  date ??= recurDay;
  if (!date && out.time) date = plus(0);
  if (date) out.day = ymd(date);

  out.title = s.replace(/\s+/g, ' ').replace(/^[\s,;:.-]+|[\s,;:-]+$/g, '').trim() || input.trim();
  return out;
}

function explicit(day: number, month: number, year: number | null, today: Date): Date | null {
  if (month < 0 || month > 11 || day < 1) return null;
  let d = new Date(year ?? today.getFullYear(), month, day);
  if (d.getDate() !== day) return null;  // 31 de febrero
  if (year === null && d < today) d = new Date(today.getFullYear() + 1, month, day);  // ya pasó: el año que viene
  return d;
}

/** ¿Se ha reconocido algo además del título? */
export function hasMetadata(q: QuickTask): boolean {
  return !!(q.day || q.time || q.priority || q.tags.length || q.project || q.recurrence || q.estimate);
}
