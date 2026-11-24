export type Status = 'todo' | 'in_progress' | 'review' | 'completed' | 'archived';
export type Priority = 'low' | 'medium' | 'high' | 'urgent';

export const STATUS_LABEL: Record<Status, string> = {
  todo: 'Por hacer', in_progress: 'En curso', review: 'En revisión', completed: 'Completada', archived: 'Archivada',
};
export const PRIORITY_LABEL: Record<Priority, string> = { low: 'Baja', medium: 'Media', high: 'Alta', urgent: 'Urgente' };
export type Recurrence = 'none' | 'daily' | 'weekdays' | 'weekly' | 'biweekly' | 'monthly' | 'yearly';
export const RECURRENCE_LABEL: Record<Recurrence, string> = {
  none: 'No se repite', daily: 'Cada día', weekdays: 'Días laborables (lun–vie)', weekly: 'Cada semana',
  biweekly: 'Cada 2 semanas', monthly: 'Cada mes', yearly: 'Cada año',
};
/** Minutos antes del vencimiento. En tareas de día completo el vencimiento se toma a las 9:00. */
export const REMINDER_OPTIONS: { value: number; timed: string; allDay: string }[] = [
  { value: 0, timed: 'A la hora de la tarea', allDay: 'Ese día a las 9:00' },
  { value: 10, timed: '10 minutos antes', allDay: 'Ese día a las 8:50' },
  { value: 30, timed: '30 minutos antes', allDay: 'Ese día a las 8:30' },
  { value: 60, timed: '1 hora antes', allDay: 'Ese día a las 8:00' },
  { value: 1440, timed: '1 día antes', allDay: 'El día anterior a las 9:00' },
];
export const BOARD_STATUSES: Status[] = ['todo', 'in_progress', 'review', 'completed'];
export const PRIORITIES: Priority[] = ['urgent', 'high', 'medium', 'low'];

export interface User {
  id: number; email: string; username: string; full_name?: string | null; avatar_url?: string | null;
  bio?: string | null; theme: 'light' | 'dark' | 'auto'; language: string; timezone: string;
  email_reminders: boolean; daily_digest: boolean; digest_hour: number; mood_reminder: boolean; mood_reminder_hour: number; created_at: string; last_login?: string | null;
  has_password: boolean; google_linked: boolean;
}
export interface Token { access_token: string; refresh_token: string; token_type: string; }

export interface Project {
  id: number; name: string; description?: string | null; color: string; is_archived: boolean;
  created_at: string; updated_at: string; total_tasks: number; completed_tasks: number;
  role: Role; owner_name: string; member_count: number;
}
export type Role = 'owner' | 'editor' | 'viewer';
export const ROLE_LABEL: Record<Role, string> = { owner: 'Propietario', editor: 'Puede editar', viewer: 'Solo lectura' };
export interface Member { user_id: number; username: string; name: string; role: Role; }
export interface TrashItem { kind: 'note' | 'task'; id: number; title: string; detail?: string | null; deleted_at: string; purge_at: string; }

export interface Subtask { id: number; title: string; status: Status; }
export interface Task {
  id: number; title: string; description?: string | null; status: Status; priority: Priority;
  due_date?: string | null; all_day: boolean; completed_at?: string | null; estimated_minutes?: number | null;
  tags: string[]; position: number; project_id?: number | null; parent_task_id?: number | null;
  note_id?: number | null; google_event_id?: string | null; recurrence: Recurrence; reminder_minutes?: number | null;
  difficulty: number; time_spent_seconds: number; timer_started_at?: string | null;
  user_id: number; note_title?: string | null; owner_name: string; assignee_id?: number | null; assignee_name?: string | null; can_edit: boolean;
  created_at: string; updated_at: string; subtasks: Subtask[];
  /** Creada sin conexión y aún no enviada al servidor (id negativo provisional). */
  pending?: boolean;
}
export type TaskInput = Partial<Pick<Task, 'title' | 'description' | 'status' | 'priority' | 'due_date' | 'all_day'
  | 'estimated_minutes' | 'tags' | 'project_id' | 'parent_task_id' | 'note_id' | 'recurrence' | 'reminder_minutes' | 'assignee_id' | 'time_spent_seconds' | 'difficulty'>>;
export interface Comment { id: number; content: string; task_id: number; author_id: number; author_name: string; created_at: string; }

export interface NoteSummary {
  id: number; title: string; folder: string; tags: string[]; is_pinned: boolean; is_daily: boolean;
  created_at: string; updated_at: string; snippet?: string | null;
  pending?: boolean;
}
export interface NoteRef { id: number | null; title: string; context?: string | null; }
export interface Note extends NoteSummary { content: string; backlinks: NoteRef[]; outgoing: NoteRef[]; }
export interface NoteVersion { id: number; title: string; created_at: string; size: number; preview: string; content?: string; }
export interface Mention { note_id: number; title: string; context: string; }
export interface GraphNode { id: string; label: string; kind: 'note' | 'ghost' | 'tag'; note_id?: number | null; degree: number; folder: string; }
export interface GraphEdge { source: string; target: string; kind: 'link' | 'tag'; }
export interface Graph { nodes: GraphNode[]; edges: GraphEdge[]; }
export interface TagCount { tag: string; count: number; }
export interface ChecklistItem { note_id: number; note_title: string; line: number; text: string; checked: boolean; }
export interface SearchResult { kind: 'note' | 'task' | 'project'; id: number; title: string; snippet?: string | null; }

export interface DayPoint { date: string; created: number; completed: number; open: number; }
export interface Overview {
  total: number; by_status: Record<Status, number>; by_priority: Record<Priority, number>;
  overdue: number; due_today: number; due_week: number; completed_week: number; completion_rate: number;
  notes: number; links: number; timeline: DayPoint[];
  projects: { id: number; name: string; color: string; total: number; completed: number }[];
  top_tags: { tag: string; count: number }[];
  time_tracking: { id: number; title: string; estimated_hours: number; spent_hours: number }[];
  spent_hours_week: number;
}

export interface Reminder { kind: 'reminder' | 'assigned' | 'habit' | 'mood'; task_id: number; title: string; due_date?: string | null; all_day: boolean; by?: string | null; }
export interface ImportResult { created: number; updated: number; skipped: number; errors: string[]; }

export interface CalendarStatus { configured: boolean; connected: boolean; email?: string | null; auto_sync: boolean; calendar_id: string; }
export interface CalendarInfo { id: string; name: string; primary: boolean; }
export interface CalendarEvent { id: string; title: string; start: string; end: string; all_day: boolean; html_link?: string | null; task_id?: number | null; }

// ---------- Rutinas, Pomodoro y progreso ----------
export const DIFFICULTY_LABEL: Record<number, string> = { 1: 'Fácil', 2: 'Normal', 3: 'Difícil', 4: 'Épica' };
export const WEEKDAY_SHORT = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
export const WEEKDAY_NAME = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

export interface Habit {
  id: number; title: string; days: string; target_time?: string | null; difficulty: number; color: string;
  is_archived: boolean; start_day: string; target_count: number; unit: string; weekly_target?: number | null; remind: boolean;
}
export type HabitInput = Partial<Pick<Habit, 'title' | 'days' | 'target_time' | 'difficulty' | 'color' | 'is_archived' | 'target_count' | 'unit' | 'weekly_target' | 'remind'>>;
export interface HabitDayItem extends Habit { checked: boolean; count: number; checked_at?: string | null; streak: number; week_done: number; xp: number; }
export type HabitState = 'done' | 'missed' | 'off' | 'pending' | 'partial' | 'free' | 'frozen';
export interface HabitStat {
  id: number; title: string; color: string; target_time?: string | null; days: string; scheduled: number; done: number;
  period: 'day' | 'week'; weekly_target?: number | null; target_count: number; unit: string; frozen: number;
  rate: number | null; streak: number; best_streak: number; avg_minute: number | null; on_time_rate: number | null; states: HabitState[];
}
export interface HabitStats {
  days: string[]; habits: HabitStat[]; daily: { date: string; scheduled: number; done: number }[]; hours: number[];
  weekday: (number | null)[]; scheduled: number; done: number; rate: number | null; perfect_days: number;
}

export interface PomodoroSettings {
  focus_minutes: number; short_break_minutes: number; long_break_minutes: number; cycles: number;
  auto_start: boolean; sound: boolean; notify: boolean;
}
export interface PomodoroStats {
  daily: { date: string; minutes: number; sessions: number }[]; today_sessions: number; today_minutes: number;
  total_minutes: number; by_task: { title: string; minutes: number }[];
}

export interface ReviewTask { id: number; title: string; difficulty: number; priority: Priority; due_day: string | null; project: string | null; can_edit: boolean; }
/** Meta de la semana (revisión semanal); no confundir con los objetivos a largo plazo. */
export interface WeekGoal { text: string; done: boolean; }
export interface WeeklyReview {
  week_start: string; week_end: string; is_current: boolean;
  completed: ReviewTask[]; carried_over: ReviewTask[]; no_date: ReviewTask[]; upcoming_next_week: number;
  xp: Record<XpKind, number>; xp_total: number; focus_minutes: number; notes_created: number;
  mood: { days: number; avg_mood: number | null; avg_energy: number | null; prev_avg_mood: number | null; best_day: string | null };
  habits: { rate: number | null; done: number; scheduled: number; perfect_days: number;
    items: { id: number; title: string; color: string; rate: number | null; done: number; scheduled: number; period: 'day' | 'week'; streak: number }[] };
  previous_goals: WeekGoal[]; goals: WeekGoal[]; reflection: string; completed_at: string | null; xp_reward: number;
}
export interface ReviewToday { goals_week: string; goals: WeekGoal[]; pending_review: string | null; }

export interface Rank { name: string; min_level: number; min_xp: number; }
export interface GameProfile {
  xp: number; level: number; level_start_xp: number; next_level_xp: number; rank_index: number; rank: string;
  next_rank: string | null; next_rank_level: number | null; ranks: Rank[];
}
export type XpKind = 'task' | 'habit' | 'focus' | 'review' | 'mission' | 'goal';
export const XP_KIND_LABEL: Record<XpKind, string> = { task: 'Tareas', habit: 'Rutinas', focus: 'Concentración', review: 'Revisión semanal', mission: 'Misiones', goal: 'Objetivos' };
export interface GameHistory {
  daily: { date: string; task: number; habit: number; focus: number; review: number; mission: number; goal: number; total: number }[];
  by_kind: Record<XpKind, number>; today_xp: number; week_xp: number;
  recent: { kind: XpKind; amount: number; detail: string; created_at: string }[];
  achievements: { id: string; name: string; description: string; progress: number; goal: number; unlocked: boolean }[];
}

// ---------- Misiones, monedas y recompensas ----------
export interface Wallet {
  coins: number; next_coin_in: number; xp_per_coin: number; freezes: number; max_freezes: number; freeze_price: number;
  recent_freezes: { habit: string; day: string }[];
}
export interface Mission {
  key: string; title: string; hint: string; target: number; progress: number; reward_xp: number; reward_coins: number;
  claimed: boolean; claimable: boolean;
}
export interface Missions { week_start: string; week_end: string; missions: Mission[]; chest_claimed: boolean; }
export interface RewardItem { id: number; title: string; cost: number; emoji: string; repeatable: boolean; is_archived: boolean; times_redeemed: number; available: boolean; }
export interface CoinEntry { id: number; amount: number; reason: 'mission' | 'chest' | 'reward' | 'freeze'; detail: string; created_at: string; }

// ---------- Objetivos a largo plazo ----------
export type GoalStatus = 'active' | 'done' | 'archived';
export interface GoalProgress {
  percent: number | null; tasks_done: number; tasks_total: number; milestones_done: number; milestones_total: number;
  habit_rate: number | null; habits_count: number; projects_count: number;
  /** % de tiempo transcurrido hasta la fecha límite (solo activos con fecha). */
  expected: number | null; days_left: number | null; on_track: boolean;
}
export interface Goal {
  id: number; title: string; description?: string | null; color: string; deadline?: string | null;
  status: GoalStatus; completed_at?: string | null; created_at: string; progress: GoalProgress;
}
export interface GoalDetail extends Goal {
  projects: { id: number; name: string; color: string; done: number; total: number }[];
  tasks: { id: number; title: string; status: Status; priority: Priority; due_date?: string | null; all_day: boolean; project_id?: number | null; linked: boolean }[];
  habits: { id: number; title: string; color: string; rate: number | null; archived: boolean }[];
  milestones: { id: number; title: string; done: boolean; done_at?: string | null }[];
  /** Experiencia que daría cumplirlo ahora (null si ya está cumplido). */
  xp: number | null;
  xp_gained?: number;
}
export type GoalLinkKind = 'project' | 'task' | 'habit';

// ---------- Diario de ánimo y energía ----------
export interface MoodEntry { day: string; mood: number; energy: number; factors: string[]; note?: string | null; }
export interface MoodFactor { key: string; label: string; }
export interface MoodLog { today: string; entry_today: MoodEntry | null; entries: MoodEntry[]; factors: MoodFactor[]; }
export interface MoodBand { days: number; tasks: number | null; habits: number | null; focus: number | null; }
export interface MoodInsights {
  days: number; logged: number; streak: number; avg_mood: number | null; avg_energy: number | null;
  by_mood: { low: MoodBand; mid: MoodBand; high: MoodBand }; by_energy: { low: MoodBand; mid: MoodBand; high: MoodBand };
  correlations: { mood_tasks: number | null; energy_tasks: number | null; energy_focus: number | null; mood_habits: number | null };
  weekdays: { weekday: number; days: number; mood: number | null; energy: number | null }[];
  hours: { tasks: number[]; focus: number[] };
  factors: { key: string; label: string; days: number; mood_with: number; mood_without: number; energy_with: number; energy_without: number }[];
}
export const MOOD_LEVELS = [
  { v: 1, emoji: '😞', label: 'Muy mal' }, { v: 2, emoji: '🙁', label: 'Mal' }, { v: 3, emoji: '😐', label: 'Normal' },
  { v: 4, emoji: '🙂', label: 'Bien' }, { v: 5, emoji: '😄', label: 'Genial' },
];
export const ENERGY_LEVELS = [
  { v: 1, label: 'Muy baja' }, { v: 2, label: 'Baja' }, { v: 3, label: 'Normal' }, { v: 4, label: 'Alta' }, { v: 5, label: 'A tope' },
];

// ---------- Plantillas de proyecto ----------
export interface TemplateTask {
  title: string; description?: string | null; offset_days: number | null; priority: Priority; difficulty: number;
  estimated_minutes?: number | null; subtasks: string[];
}
export interface ProjectTemplate {
  id: number | null; key: string | null; name: string; description?: string | null; color: string;
  tasks: TemplateTask[]; task_count: number; span_days: number | null;
}
