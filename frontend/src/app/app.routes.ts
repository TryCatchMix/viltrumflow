import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/auth.guard';

// Cada pantalla se carga bajo demanda: el editor y el grafo no pesan en el arranque.
export const routes: Routes = [
  { path: 'login', canActivate: [guestGuard], loadComponent: () => import('./pages/auth.component').then(m => m.AuthComponent), data: { mode: 'login' } },
  { path: 'register', canActivate: [guestGuard], loadComponent: () => import('./pages/auth.component').then(m => m.AuthComponent), data: { mode: 'register' } },
  { path: 'forgot-password', canActivate: [guestGuard], loadComponent: () => import('./pages/auth.component').then(m => m.AuthComponent), data: { mode: 'forgot' } },
  // Sin guestGuard: el enlace del correo debe funcionar aunque haya una sesión abierta en este navegador
  { path: 'reset-password', loadComponent: () => import('./pages/auth.component').then(m => m.AuthComponent), data: { mode: 'reset' } },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./layout/shell.component').then(m => m.ShellComponent),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      { path: 'dashboard', loadComponent: () => import('./pages/dashboard.component').then(m => m.DashboardComponent) },
      { path: 'tasks', loadComponent: () => import('./pages/tasks.component').then(m => m.TasksComponent) },
      { path: 'kanban', loadComponent: () => import('./pages/kanban.component').then(m => m.KanbanComponent) },
      { path: 'projects', loadComponent: () => import('./pages/projects.component').then(m => m.ProjectsComponent) },
      { path: 'notes', loadComponent: () => import('./pages/notes.component').then(m => m.NotesComponent) },
      { path: 'notes/:id', loadComponent: () => import('./pages/notes.component').then(m => m.NotesComponent) },
      { path: 'graph', loadComponent: () => import('./pages/graph.component').then(m => m.GraphComponent) },
      { path: 'calendar', loadComponent: () => import('./pages/calendar.component').then(m => m.CalendarComponent) },
      { path: 'trash', loadComponent: () => import('./pages/trash.component').then(m => m.TrashComponent) },
      { path: 'settings', loadComponent: () => import('./pages/settings.component').then(m => m.SettingsComponent) },
    ],
  },
  { path: '**', redirectTo: '' },
];
