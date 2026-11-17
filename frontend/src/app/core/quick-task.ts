import { Project, TaskInput } from './models';
import { QuickTask, parseQuick } from './quick-parse';
import { toDue } from './util';

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');

/** Proyecto al que se refiere «@texto»: el primero (editable) cuyo nombre empieza así, sin tildes ni espacios. */
export function matchProject(text: string | null, projects: Project[]): Project | undefined {
  if (!text) return undefined;
  const t = norm(text);
  const usable = projects.filter(p => p.role !== 'viewer' && !p.is_archived);
  return usable.find(p => norm(p.name) === t) ?? usable.find(p => norm(p.name).startsWith(t));
}

/** Convierte el texto de la captura rápida en los campos de una tarea. */
export function quickToTask(text: string, projects: Project[]): { input: TaskInput; parsed: QuickTask; project?: Project } {
  const parsed = parseQuick(text);
  const project = matchProject(parsed.project, projects);
  // Si «@algo» no corresponde a ningún proyecto, se devuelve al título tal cual
  const title = parsed.project && !project ? `${parsed.title} @${parsed.project}` : parsed.title;
  const input: TaskInput = { title };
  if (parsed.day) Object.assign(input, toDue(parsed.day, parsed.time ?? ''));
  if (parsed.priority) input.priority = parsed.priority;
  if (parsed.tags.length) input.tags = parsed.tags;
  if (parsed.recurrence) input.recurrence = parsed.recurrence;
  if (project) input.project_id = project.id;
  return { input, parsed, project };
}
