import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { TaskService } from '../../services/task.service';
import { ProjectService } from '../../services/project.service';
import { User, Task, Project, Status, Priority } from '../../models';

interface ActivityItem {
  type: 'task_created' | 'task_completed' | 'task_updated' | 'project_created';
  icon: string;
  color: string;
  title: string;
  description: string;
  time: Date;
}

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
            <a [routerLink]="['/profile']" class="user-link">
              <img 
                [src]="currentUser?.avatar_url || 'https://ui-avatars.com/api/?name=' + (currentUser?.username || 'U') + '&size=40&background=667eea&color=fff'" 
                class="user-avatar"
                [alt]="currentUser?.username"
              />
              <span>{{ currentUser?.username }}</span>
            </a>
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
            <p>{{ getGreeting() }}</p>
          </div>

          <!-- Stats Cards -->
          <div class="stats-grid">
            <div class="stat-card">
              <div class="stat-icon todo">📝</div>
              <div class="stat-info">
                <h3>{{ stats.todo }}</h3>
                <p>Por Hacer</p>
              </div>
              <div class="stat-trend" *ngIf="stats.todo > 0">
                <span class="percentage">{{ getPercentage(stats.todo) }}%</span>
              </div>
            </div>

            <div class="stat-card">
              <div class="stat-icon in-progress">⚡</div>
              <div class="stat-info">
                <h3>{{ stats.inProgress }}</h3>
                <p>En Progreso</p>
              </div>
              <div class="stat-trend" *ngIf="stats.inProgress > 0">
                <span class="percentage">{{ getPercentage(stats.inProgress) }}%</span>
              </div>
            </div>

            <div class="stat-card">
              <div class="stat-icon completed">✅</div>
              <div class="stat-info">
                <h3>{{ stats.completed }}</h3>
                <p>Completadas</p>
              </div>
              <div class="stat-trend success" *ngIf="stats.completed > 0">
                <span class="percentage">{{ getPercentage(stats.completed) }}%</span>
              </div>
            </div>

            <div class="stat-card">
              <div class="stat-icon projects">📁</div>
              <div class="stat-info">
                <h3>{{ projects.length }}</h3>
                <p>Proyectos</p>
              </div>
              <div class="stat-trend" *ngIf="projects.length > 0">
                <span class="percentage">100%</span>
              </div>
            </div>
          </div>

          <!-- Main Grid -->
          <div class="dashboard-grid">
            <!-- Progress Chart -->
            <div class="card chart-card">
              <div class="card-header">
                <h3>📈 Progreso General</h3>
                <span class="completion-rate">{{ getCompletionRate() }}% completado</span>
              </div>
              <div class="chart-container">
                <div class="progress-chart">
                  <svg viewBox="0 0 200 200" class="circular-chart">
                    <defs>
                      <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" style="stop-color:#667eea;stop-opacity:1" />
                        <stop offset="100%" style="stop-color:#764ba2;stop-opacity:1" />
                      </linearGradient>
                    </defs>
                    <circle
                      class="circle-bg"
                      cx="100"
                      cy="100"
                      r="90"
                    ></circle>
                    <circle
                      class="circle-progress"
                      cx="100"
                      cy="100"
                      r="90"
                      [style.stroke-dashoffset]="getCircleOffset()"
                    ></circle>
                    <text x="100" y="100" class="percentage-text">
                      {{ getCompletionRate() }}%
                    </text>
                  </svg>
                </div>
                <div class="chart-legend">
                  <div class="legend-item">
                    <span class="legend-dot todo"></span>
                    <span>Por Hacer: {{ stats.todo }}</span>
                  </div>
                  <div class="legend-item">
                    <span class="legend-dot in-progress"></span>
                    <span>En Progreso: {{ stats.inProgress }}</span>
                  </div>
                  <div class="legend-item">
                    <span class="legend-dot completed"></span>
                    <span>Completadas: {{ stats.completed }}</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Calendar -->
            <div class="card calendar-card">
              <div class="card-header">
                <h3>📅 Calendario de Tareas</h3>
                <div class="calendar-controls">
                  <button (click)="previousMonth()">‹</button>
                  <span>{{ getMonthYear() }}</span>
                  <button (click)="nextMonth()">›</button>
                </div>
              </div>
              <div class="calendar">
                <div class="calendar-header">
                  <div class="day-name" *ngFor="let day of dayNames">{{ day }}</div>
                </div>
                <div class="calendar-body">
                  <div 
                    class="calendar-day" 
                    *ngFor="let day of calendarDays"
                    [class.other-month]="!day.isCurrentMonth"
                    [class.today]="day.isToday"
                    [class.has-tasks]="day.taskCount > 0"
                  >
                    <span class="day-number">{{ day.date.getDate() }}</span>
                    <span class="task-count" *ngIf="day.taskCount > 0">
                      {{ day.taskCount }}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Priority Distribution -->
            <div class="card priority-card">
              <div class="card-header">
                <h3>🎯 Distribución por Prioridad</h3>
              </div>
              <div class="priority-bars">
                <div class="priority-item" *ngFor="let item of priorityDistribution">
                  <div class="priority-label">
                    <span [class]="'priority-badge ' + item.priority">
                      {{ getPriorityLabel(item.priority) }}
                    </span>
                    <span class="priority-count">{{ item.count }}</span>
                  </div>
                  <div class="priority-bar">
                    <div 
                      class="priority-fill"
                      [class]="item.priority"
                      [style.width.%]="item.percentage"
                    ></div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Activity Feed -->
            <div class="card activity-card">
              <div class="card-header">
                <h3>🔔 Actividad Reciente</h3>
              </div>
              <div class="activity-feed">
                <div class="activity-item" *ngFor="let activity of recentActivity">
                  <div class="activity-icon" [style.background-color]="activity.color">
                    {{ activity.icon }}
                  </div>
                  <div class="activity-content">
                    <h4>{{ activity.title }}</h4>
                    <p>{{ activity.description }}</p>
                    <span class="activity-time">{{ getTimeAgo(activity.time) }}</span>
                  </div>
                </div>
                <div class="no-activity" *ngIf="recentActivity.length === 0">
                  <p>No hay actividad reciente</p>
                </div>
              </div>
            </div>

            <!-- Recent Tasks -->
            <div class="card tasks-card">
              <div class="card-header">
                <h3>📋 Tareas Recientes</h3>
                <a [routerLink]="['/tasks']" class="view-all">Ver todas →</a>
              </div>
              <div class="tasks-list" *ngIf="tasks.length > 0; else noTasks">
                <div class="task-item" *ngFor="let task of tasks.slice(0, 5)">
                  <div class="task-priority" [class]="task.priority"></div>
                  <div class="task-content">
                    <h4>{{ task.title }}</h4>
                    <div class="task-meta">
                      <span class="task-status" [class]="task.status">
                        {{ getStatusLabel(task.status) }}
                      </span>
                      <span class="task-date" *ngIf="task.due_date">
                        {{ getDaysUntilDue(task.due_date) }}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
              <ng-template #noTasks>
                <p class="no-data">No tienes tareas aún. <a [routerLink]="['/tasks']">Crear primera tarea</a></p>
              </ng-template>
            </div>
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

    .user-link {
      display: flex;
      align-items: center;
      gap: 10px;
      text-decoration: none;
      color: #333;
      padding: 8px 12px;
      border-radius: 8px;
      transition: background 0.3s;
    }

    .user-link:hover {
      background: #f5f5f5;
    }

    .user-avatar {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      object-fit: cover;
      border: 2px solid #667eea;
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
      position: relative;
      overflow: hidden;
    }

    .stat-icon {
      width: 50px;
      height: 50px;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 24px;
      flex-shrink: 0;
    }

    .stat-icon.todo { background: #fff3e0; }
    .stat-icon.in-progress { background: #e3f2fd; }
    .stat-icon.completed { background: #e8f5e9; }
    .stat-icon.projects { background: #f3e5f5; }

    .stat-info {
      flex: 1;
    }

    .stat-info h3 {
      margin: 0;
      font-size: 32px;
      color: #333;
      font-weight: 700;
    }

    .stat-info p {
      margin: 5px 0 0;
      color: #666;
      font-size: 14px;
    }

    .stat-trend {
      position: absolute;
      top: 10px;
      right: 10px;
    }

    .stat-trend .percentage {
      font-size: 12px;
      color: #999;
      font-weight: 600;
    }

    .stat-trend.success .percentage {
      color: #4caf50;
    }

    .dashboard-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
      gap: 20px;
    }

    .card {
      background: white;
      border-radius: 12px;
      padding: 20px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }

    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
      padding-bottom: 15px;
      border-bottom: 2px solid #f0f0f0;
    }

    .card-header h3 {
      margin: 0;
      font-size: 18px;
      color: #333;
    }

    .completion-rate {
      font-size: 14px;
      color: #667eea;
      font-weight: 600;
    }

    .view-all {
      color: #667eea;
      text-decoration: none;
      font-size: 14px;
      font-weight: 500;
    }

    .view-all:hover {
      text-decoration: underline;
    }

    /* Progress Chart */
    .chart-container {
      display: flex;
      align-items: center;
      gap: 30px;
    }

    .progress-chart {
      width: 200px;
      height: 200px;
    }

    .circular-chart {
      width: 100%;
      height: 100%;
    }

    .circle-bg {
      fill: none;
      stroke: #f0f0f0;
      stroke-width: 12;
    }

    .circle-progress {
      fill: none;
      stroke: url(#gradient);
      stroke-width: 12;
      stroke-linecap: round;
      stroke-dasharray: 565;
      transition: stroke-dashoffset 1s ease;
    }

    .percentage-text {
      fill: #333;
      font-size: 36px;
      font-weight: 700;
      text-anchor: middle;
      dominant-baseline: middle;
    }

    .chart-legend {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 15px;
    }

    .legend-item {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 14px;
      color: #666;
    }

    .legend-dot {
      width: 12px;
      height: 12px;
      border-radius: 50%;
    }

    .legend-dot.todo { background: #ff9800; }
    .legend-dot.in-progress { background: #2196f3; }
    .legend-dot.completed { background: #4caf50; }

    /* Calendar */
    .calendar-controls {
      display: flex;
      align-items: center;
      gap: 15px;
    }

    .calendar-controls button {
      background: none;
      border: none;
      font-size: 20px;
      cursor: pointer;
      color: #666;
      padding: 5px 10px;
    }

    .calendar-controls button:hover {
      color: #667eea;
    }

    .calendar-controls span {
      font-weight: 600;
      color: #333;
      min-width: 150px;
      text-align: center;
    }

    .calendar {
      display: flex;
      flex-direction: column;
    }

    .calendar-header {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      gap: 5px;
      margin-bottom: 10px;
    }

    .day-name {
      text-align: center;
      font-size: 12px;
      color: #999;
      font-weight: 600;
      padding: 10px 0;
    }

    .calendar-body {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      gap: 5px;
    }

    .calendar-day {
      aspect-ratio: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      border-radius: 8px;
      background: #f9f9f9;
      position: relative;
      cursor: pointer;
      transition: all 0.2s;
    }

    .calendar-day:hover {
      background: #f0f0f0;
    }

    .calendar-day.other-month {
      opacity: 0.3;
    }

    .calendar-day.today {
      background: #667eea;
      color: white;
      font-weight: 700;
    }

    .calendar-day.has-tasks {
      background: #e3f2fd;
      border: 2px solid #2196f3;
    }

    .day-number {
      font-size: 14px;
      font-weight: 500;
    }

    .task-count {
      position: absolute;
      bottom: 2px;
      right: 2px;
      background: #f44336;
      color: white;
      font-size: 10px;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 600;
    }

    /* Priority Distribution */
    .priority-bars {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .priority-item {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .priority-label {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .priority-badge {
      padding: 4px 12px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 500;
    }

    .priority-badge.low { background: #e8f5e9; color: #388e3c; }
    .priority-badge.medium { background: #fff3e0; color: #f57c00; }
    .priority-badge.high { background: #ffebee; color: #c62828; }
    .priority-badge.urgent { background: #f3e5f5; color: #6a1b9a; }

    .priority-count {
      font-weight: 600;
      color: #333;
    }

    .priority-bar {
      height: 8px;
      background: #f0f0f0;
      border-radius: 4px;
      overflow: hidden;
    }

    .priority-fill {
      height: 100%;
      transition: width 0.5s ease;
      border-radius: 4px;
    }

    .priority-fill.low { background: #4caf50; }
    .priority-fill.medium { background: #ff9800; }
    .priority-fill.high { background: #f44336; }
    .priority-fill.urgent { background: #9c27b0; }

    /* Activity Feed */
    .activity-feed {
      display: flex;
      flex-direction: column;
      gap: 15px;
      max-height: 400px;
      overflow-y: auto;
    }

    .activity-item {
      display: flex;
      gap: 15px;
      padding: 15px;
      background: #f9f9f9;
      border-radius: 8px;
      transition: background 0.2s;
    }

    .activity-item:hover {
      background: #f0f0f0;
    }

    .activity-icon {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
      flex-shrink: 0;
    }

    .activity-content {
      flex: 1;
    }

    .activity-content h4 {
      margin: 0 0 5px;
      font-size: 14px;
      color: #333;
    }

    .activity-content p {
      margin: 0 0 5px;
      font-size: 13px;
      color: #666;
    }

    .activity-time {
      font-size: 11px;
      color: #999;
    }

    .no-activity {
      text-align: center;
      padding: 40px 20px;
      color: #999;
    }

    /* Tasks List */
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
      font-size: 14px;
      color: #333;
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

    @media (max-width: 1200px) {
      .dashboard-grid {
        grid-template-columns: 1fr;
      }
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
  
  // Calendar
  currentDate: Date = new Date();
  calendarDays: any[] = [];
  dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  
  // Priority Distribution
  priorityDistribution: any[] = [];
  
  // Activity
  recentActivity: ActivityItem[] = [];

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
    this.taskService.getTasks({ limit: 100 }).subscribe({
      next: (tasks) => {
        this.tasks = tasks;
        this.calculateStats(tasks);
        this.calculatePriorityDistribution(tasks);
        this.generateCalendar();
        this.generateActivity(tasks);
      },
      error: (error) => console.error('Error loading tasks:', error)
    });
  }

  loadProjects(): void {
    this.projectService.getProjects().subscribe({
      next: (projects) => {
        this.projects = projects.filter(p => !p.is_archived);
      },
      error: (error) => console.error('Error loading projects:', error)
    });
  }

  calculateStats(tasks: Task[]): void {
    this.stats.todo = tasks.filter(t => t.status === Status.TODO).length;
    this.stats.inProgress = tasks.filter(t => t.status === Status.IN_PROGRESS).length;
    this.stats.completed = tasks.filter(t => t.status === Status.COMPLETED).length;
  }

  calculatePriorityDistribution(tasks: Task[]): void {
    const totalTasks = tasks.length || 1;
    const distribution = {
      low: tasks.filter(t => t.priority === Priority.LOW).length,
      medium: tasks.filter(t => t.priority === Priority.MEDIUM).length,
      high: tasks.filter(t => t.priority === Priority.HIGH).length,
      urgent: tasks.filter(t => t.priority === Priority.URGENT).length
    };

    this.priorityDistribution = [
      { priority: 'urgent', count: distribution.urgent, percentage: (distribution.urgent / totalTasks) * 100 },
      { priority: 'high', count: distribution.high, percentage: (distribution.high / totalTasks) * 100 },
      { priority: 'medium', count: distribution.medium, percentage: (distribution.medium / totalTasks) * 100 },
      { priority: 'low', count: distribution.low, percentage: (distribution.low / totalTasks) * 100 }
    ];
  }

  generateCalendar(): void {
    const year = this.currentDate.getFullYear();
    const month = this.currentDate.getMonth();
    
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const prevLastDay = new Date(year, month, 0);
    
    const firstDayWeek = firstDay.getDay();
    const lastDayDate = lastDay.getDate();
    const prevLastDayDate = prevLastDay.getDate();
    
    this.calendarDays = [];
    
    // Previous month days
    for (let i = firstDayWeek - 1; i >= 0; i--) {
      const date = new Date(year, month - 1, prevLastDayDate - i);
      this.calendarDays.push({
        date,
        isCurrentMonth: false,
        isToday: false,
        taskCount: this.getTaskCountForDate(date)
      });
    }
    
    // Current month days
    for (let i = 1; i <= lastDayDate; i++) {
      const date = new Date(year, month, i);
      const today = new Date();
      this.calendarDays.push({
        date,
        isCurrentMonth: true,
        isToday: date.toDateString() === today.toDateString(),
        taskCount: this.getTaskCountForDate(date)
      });
    }
    
    // Next month days
    const remainingDays = 42 - this.calendarDays.length;
    for (let i = 1; i <= remainingDays; i++) {
      const date = new Date(year, month + 1, i);
      this.calendarDays.push({
        date,
        isCurrentMonth: false,
        isToday: false,
        taskCount: this.getTaskCountForDate(date)
      });
    }
  }

  getTaskCountForDate(date: Date): number {
    return this.tasks.filter(task => {
      if (!task.due_date) return false;
      const dueDate = new Date(task.due_date);
      return dueDate.toDateString() === date.toDateString();
    }).length;
  }

  previousMonth(): void {
    this.currentDate = new Date(this.currentDate.getFullYear(), this.currentDate.getMonth() - 1);
    this.generateCalendar();
  }

  nextMonth(): void {
    this.currentDate = new Date(this.currentDate.getFullYear(), this.currentDate.getMonth() + 1);
    this.generateCalendar();
  }

  getMonthYear(): string {
    const months = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 
                    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    return `${months[this.currentDate.getMonth()]} ${this.currentDate.getFullYear()}`;
  }

  generateActivity(tasks: Task[]): void {
    this.recentActivity = [];
    
    // Sort tasks by updated_at
    const sortedTasks = [...tasks].sort((a, b) => 
      new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    );

    sortedTasks.slice(0, 5).forEach(task => {
      if (task.status === Status.COMPLETED) {
        this.recentActivity.push({
          type: 'task_completed',
          icon: '✅',
          color: '#4caf50',
          title: 'Tarea completada',
          description: task.title,
          time: new Date(task.updated_at)
        });
      } else {
        this.recentActivity.push({
          type: 'task_updated',
          icon: '✏️',
          color: '#2196f3',
          title: 'Tarea actualizada',
          description: task.title,
          time: new Date(task.updated_at)
        });
      }
    });
  }

  getGreeting(): string {
    const hour = new Date().getHours();
    if (hour < 12) return 'Buenos días';
    if (hour < 18) return 'Buenas tardes';
    return 'Buenas noches';
  }

  getCompletionRate(): number {
    const total = this.stats.todo + this.stats.inProgress + this.stats.completed;
    if (total === 0) return 0;
    return Math.round((this.stats.completed / total) * 100);
  }

  getPercentage(value: number): number {
    const total = this.stats.todo + this.stats.inProgress + this.stats.completed;
    if (total === 0) return 0;
    return Math.round((value / total) * 100);
  }

  getCircleOffset(): number {
    const percentage = this.getCompletionRate();
    const circumference = 2 * Math.PI * 90;
    return circumference - (percentage / 100) * circumference;
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

  getPriorityLabel(priority: string): string {
    const labels: Record<string, string> = {
      'low': 'Baja',
      'medium': 'Media',
      'high': 'Alta',
      'urgent': 'Urgente'
    };
    return labels[priority] || priority;
  }

  getDaysUntilDue(dueDate: string): string {
    const due = new Date(dueDate);
    const today = new Date();
    const diffTime = due.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays < 0) return `Vencida hace ${Math.abs(diffDays)} días`;
    if (diffDays === 0) return 'Vence hoy';
    if (diffDays === 1) return 'Vence mañana';
    return `Vence en ${diffDays} días`;
  }

  getTimeAgo(date: Date): string {
    const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);
    
    const intervals: { [key: string]: number } = {
      'año': 31536000,
      'mes': 2592000,
      'semana': 604800,
      'día': 86400,
      'hora': 3600,
      'minuto': 60,
      'segundo': 1
    };

    for (const [name, value] of Object.entries(intervals)) {
      const interval = Math.floor(seconds / value);
      if (interval >= 1) {
        return `Hace ${interval} ${name}${interval > 1 ? 's' : ''}`;
      }
    }
    
    return 'Justo ahora';
  }

  logout(): void {
    this.authService.logout();
  }
}