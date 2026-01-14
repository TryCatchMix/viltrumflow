import { Routes } from '@angular/router';
import { LoginComponent } from './components/login/login.component';
import { RegisterComponent } from './components/register/register.component';
import { DashboardComponent } from './components/dashboard/dashboard.component';
import { TasksListComponent } from './components/tasks-list/tasks-list.component';
import { ProjectsListComponent } from './components/projects-list/projects-list.component';
import { ProfileComponent } from './components/profile/profile.component';
import { KanbanBoardComponent } from './components/kanban-board/kanban-board.component';
import { authGuard } from './guards/auth.guard';

export const routes: Routes = [
  { path: '', redirectTo: '/dashboard', pathMatch: 'full' },
  { path: 'login', component: LoginComponent },
  { path: 'register', component: RegisterComponent },
  { 
    path: 'dashboard', 
    component: DashboardComponent,
    canActivate: [authGuard]
  },
  { 
    path: 'tasks', 
    component: TasksListComponent,
    canActivate: [authGuard]
  },
  { 
    path: 'kanban', 
    component: KanbanBoardComponent,
    canActivate: [authGuard]
  },
  { 
    path: 'projects', 
    component: ProjectsListComponent,
    canActivate: [authGuard]
  },
  { 
    path: 'profile', 
    component: ProfileComponent,
    canActivate: [authGuard]
  },
  { path: '**', redirectTo: '/dashboard' }
];