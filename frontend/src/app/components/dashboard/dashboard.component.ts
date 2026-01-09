import { Component, OnInit } from '@angular/core';
import { Project, Status, Task, User } from '../../models';

import { AuthService } from '../../services/auth.service';
import { CommonModule } from '@angular/common';
import { ProjectService } from '../../services/project.service';
import { RouterModule } from '@angular/router';
import { TaskService } from '../../services/task.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="dashboard">
      <!-- Header -->
      <header class="header">
        <div class="header-content">
          <h1>ViltrumFlow</h1>
          <div class="user-menu">
            <span>{{ currentUser?.username }}</span>
            <button (click)="logout()" class="btn-logout">Cerrar Sesión</button>
          </div>
        </div>
      </header>

      <!-- Main Content -->
      <div class="main-content">
        <!-- Sidebar -->
        <aside class="sidebar">
          <nav>
            <a [routerLink]="['/dashboard']" routerLinkActive="active" [routerLinkActiveOptions]="{exact: true}">
              <span>📊</span> Dashboard
            </a>
            <a [routerLink]="['/tasks']" routerLinkActive="active">
              <span>✓</span> Mis Tareas
            </a>
            <a [routerLink]="['/projects']" routerLinkActive="active">
              <span>📁</span> Proyectos
            </a>
          </nav>
        </aside>

        <!-- Content Area -->
        <main class="content">
          <div class="welcome">
            <h2>Bienvenido, {{ currentUser?.full_name || currentUser?.username }}! 👋</h2>
            <p>Aquí está un resumen de tus tareas</p>
          </div>

          <!-- Stats Cards -->
          <div class="stats-grid">
            <div class="stat-card">
              <div class="stat-icon todo">📝</div>
              <div class="stat-info">
                <h3>{{ stats.todo }}</h3>
                <p>Por Hacer</p>
              </div>
            </div>

            <div class="stat-card">
              <div class="stat-icon in-progress">⚡</div>
              <div class="stat-info">
                <h3>{{ stats.inProgress }}</h3>
                <p>En Progreso</p>
              </div>
            </div>

            <div class="stat-card">
              <div class="stat-icon completed">✅</div>
              <div class="stat-info">
                <h3>{{ stats.completed }}</h3>
                <p>Completadas</p>
              </div>
            </div>

            <div class="stat-card">
              <div class="stat-icon projects">📁</div>
              <div class="stat-info">
                <h3>{{ projects.length }}</h3>
                <p>Proyectos</p>
              </div>
            </div>
          </div>

          <!-- Recent Tasks -->
          <div class="recent-tasks">
            <h3>Tareas Recientes</h3>
            <div class="tasks-list" *ngIf="tasks.length > 0; else noTasks">
              <div class="task-item" *ngFor="let task of tasks">
                <div class="task-priority" [class]="task.priority"></div>
                <div class="task-content">
                  <h4>{{ task.title }}</h4>
                  <p>{{ task.description || 'Sin descripción' }}</p>
                  <div class="task-meta">
                    <span class="task-status" [class]="task.status">
                      {{ getStatusLabel(task.status) }}
                    </span>
                    <span class="task-date" *ngIf="task.due_date">
                      Vence: {{ task.due_date | date:'dd/MM/yyyy' }}
                    </span>
                  </div>
                </div>
              </div>
            </div>
            <ng-template #noTasks>
              <p class="no-data">No tienes tareas aún. <a [routerLink]="['/tasks']">Crear primera tarea</a></p>
            </ng-template>
          </div>
        </main>
      </div>
    </div>
  `,
  styles: [`
    .dashboard {
      min-height: 100vh;
      background: #f5f5f5;
    }

    .header {
      background: white;
      border-bottom: 1px solid #e0e0e0;
      padding: 0 20px;
    }

    .header-content {
      max-width: 1400px;
      margin: 0 auto;
      display: flex;
      justify-content: space-between;
      align-items: center;
      height: 60px;
    }

    .header h1 {
      margin: 0;
      font-size: 24px;
      color: #667eea;
      font-weight: 700;
    }

    .user-menu {
      display: flex;
      align-items: center;
      gap: 15px;
    }

    .btn-logout {
      padding: 8px 16px;
      background: #f44336;
      color: white;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 500;
    }

    .btn-logout:hover {
      background: #d32f2f;
    }

    .main-content {
      display: flex;
      max-width: 1400px;
      margin: 0 auto;
      min-height: calc(100vh - 60px);
    }

    .sidebar {
      width: 250px;
      background: white;
      border-right: 1px solid #e0e0e0;
      padding: 20px 0;
    }

    .sidebar nav {
      display: flex;
      flex-direction: column;
    }

    .sidebar a {
      padding: 12px 20px;
      color: #666;
      text-decoration: none;
      display: flex;
      align-items: center;
      gap: 10px;
      transition: all 0.3s;
    }

    .sidebar a:hover {
      background: #f5f5f5;
      color: #667eea;
    }

    .sidebar a.active {
      background: #667eea;
      color: white;
    }

    .content {
      flex: 1;
      padding: 30px;
    }

    .welcome {
      margin-bottom: 30px;
    }

    .welcome h2 {
      margin: 0 0 5px;
      font-size: 28px;
      color: #333;
    }

    .welcome p {
      margin: 0;
      color: #666;
    }

    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }

    .stat-card {
      background: white;
      padding: 20px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      gap: 15px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }

    .stat-icon {
      width: 50px;
      height: 50px;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 24px;
    }

    .stat-icon.todo { background: #fff3e0; }
    .stat-icon.in-progress { background: #e3f2fd; }
    .stat-icon.completed { background: #e8f5e9; }
    .stat-icon.projects { background: #f3e5f5; }

    .stat-info h3 {
      margin: 0;
      font-size: 28px;
      color: #333;
    }

    .stat-info p {
      margin: 5px 0 0;
      color: #666;
      font-size: 14px;
    }

    .recent-tasks {
      background: white;
      padding: 20px;
      border-radius: 12px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }

    .recent-tasks h3 {
      margin: 0 0 20px;
      font-size: 20px;
      color: #333;
    }

    .tasks-list {
      display: flex;
      flex-direction: column;
      gap: 15px;
    }

    .task-item {
      display: flex;
      gap: 15px;
      padding: 15px;
      background: #f9f9f9;
      border-radius: 8px;
      transition: transform 0.2s;
    }

    .task-item:hover {
      transform: translateX(5px);
      background: #f5f5f5;
    }

    .task-priority {
      width: 4px;
      border-radius: 2px;
    }

    .task-priority.low { background: #4caf50; }
    .task-priority.medium { background: #ff9800; }
    .task-priority.high { background: #f44336; }
    .task-priority.urgent { background: #9c27b0; }

    .task-content {
      flex: 1;
    }

    .task-content h4 {
      margin: 0 0 5px;
      font-size: 16px;
      color: #333;
    }

    .task-content p {
      margin: 0 0 10px;
      color: #666;
      font-size: 14px;
    }

    .task-meta {
      display: flex;
      gap: 10px;
      font-size: 12px;
    }

    .task-status {
      padding: 4px 8px;
      border-radius: 4px;
      font-weight: 500;
    }

    .task-status.todo { background: #fff3e0; color: #f57c00; }
    .task-status.in_progress { background: #e3f2fd; color: #1976d2; }
    .task-status.completed { background: #e8f5e9; color: #388e3c; }

    .task-date {
      color: #666;
    }

    .no-data {
      text-align: center;
      color: #666;
      padding: 40px;
    }

    .no-data a {
      color: #667eea;
      text-decoration: none;
      font-weight: 600;
    }
  `]
})
export class DashboardComponent implements OnInit {
  currentUser: User | null = null;
  tasks: Task[] = [];
  projects: Project[] = [];
  stats = {
    todo: 0,
    inProgress: 0,
    completed: 0
  };

  constructor(
    private authService: AuthService,
    private taskService: TaskService,
    private projectService: ProjectService
  ) {}

  ngOnInit(): void {
    this.loadCurrentUser();
    this.loadTasks();
    this.loadProjects();
  }

  loadCurrentUser(): void {
    this.authService.currentUser$.subscribe(user => {
      this.currentUser = user;
    });
  }

  loadTasks(): void {
    this.taskService.getTasks({ limit: 10 }).subscribe({
      next: (tasks) => {
        this.tasks = tasks;
        this.calculateStats(tasks);
      },
      error: (error) => console.error('Error loading tasks:', error)
    });
  }

  loadProjects(): void {
    this.projectService.getProjects().subscribe({
      next: (projects) => {
        this.projects = projects;
      },
      error: (error) => console.error('Error loading projects:', error)
    });
  }

  calculateStats(tasks: Task[]): void {
    this.stats.todo = tasks.filter(t => t.status === Status.TODO).length;
    this.stats.inProgress = tasks.filter(t => t.status === Status.IN_PROGRESS).length;
    this.stats.completed = tasks.filter(t => t.status === Status.COMPLETED).length;
  }

  getStatusLabel(status: Status): string {
    const labels: Record<Status, string> = {
      [Status.TODO]: 'Por Hacer',
      [Status.IN_PROGRESS]: 'En Progreso',
      [Status.REVIEW]: 'En Revisión',
      [Status.COMPLETED]: 'Completada',
      [Status.ARCHIVED]: 'Archivada'
    };
    return labels[status] || status;
  }

  logout(): void {
    this.authService.logout();
  }
}
