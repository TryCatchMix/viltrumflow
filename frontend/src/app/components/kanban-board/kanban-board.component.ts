import { Component, OnInit } from '@angular/core';
import { Priority, Project, Status, Task } from '../../models';

import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NotificationService } from '../../services/notification.service';
import { ProjectService } from '../../services/project.service';
import { TaskService } from '../../services/task.service';

interface KanbanColumn {
  id: Status;
  title: string;
  tasks: Task[];
  color: string;
}

@Component({
  selector: 'app-kanban-board',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="kanban-page">
      <div class="kanban-header">
        <h1>📋 Tablero Kanban</h1>
        <div class="header-actions">
          <select class="project-filter" [(ngModel)]="selectedProjectId" (change)="loadTasks()">
            <option [ngValue]="null">Todos los proyectos</option>
            <option *ngFor="let project of projects" [ngValue]="project.id">
              {{ project.icon }} {{ project.name }}
            </option>
          </select>
        </div>
      </div>

      <div class="kanban-board">
        <div
          class="kanban-column"
          *ngFor="let column of columns"
          [style.border-top-color]="column.color"
          (drop)="onDrop($event, column.id)"
          (dragover)="onDragOver($event)"
        >
          <div class="column-header">
            <h3>{{ column.title }}</h3>
            <span class="task-count">{{ column.tasks.length }}</span>
          </div>

          <div class="column-content">
            <div
              class="kanban-card"
              *ngFor="let task of column.tasks"
              draggable="true"
              (dragstart)="onDragStart($event, task)"
              (dragend)="onDragEnd($event)"
            >
              <div class="card-header">
                <div class="card-priority" [class]="task.priority"></div>
                <h4>{{ task.title }}</h4>
              </div>

              <p class="card-description" *ngIf="task.description">
                {{ task.description.substring(0, 100) }}{{ task.description.length > 100 ? '...' : '' }}
              </p>

              <div class="card-meta">
                <span class="priority-badge" [class]="task.priority">
                  {{ getPriorityLabel(task.priority) }}
                </span>
                <span class="due-date" *ngIf="task.due_date" [class.overdue]="isOverdue(task.due_date)">
                  📅 {{ formatDueDate(task.due_date) }}
                </span>
              </div>

              <div class="card-progress" *ngIf="task.progress > 0">
                <div class="progress-bar">
                  <div class="progress-fill" [style.width.%]="task.progress"></div>
                </div>
                <span class="progress-text">{{ task.progress }}%</span>
              </div>

              <div class="card-footer" *ngIf="task.assignees && task.assignees.length > 0">
                <div class="assignees">
                  <img
                    *ngFor="let assignee of task.assignees.slice(0, 3)"
                    [src]="assignee.avatar_url || 'https://ui-avatars.com/api/?name=' + assignee.username + '&size=32'"
                    [alt]="assignee.username"
                    [title]="assignee.username"
                    class="assignee-avatar"
                  />
                  <span class="more-assignees" *ngIf="task.assignees.length > 3">
                    +{{ task.assignees.length - 3 }}
                  </span>
                </div>
              </div>
            </div>

            <div class="empty-column" *ngIf="column.tasks.length === 0">
              <p>Sin tareas</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Stats Bar -->
      <div class="stats-bar">
        <div class="stat-item">
          <span class="stat-label">Total de tareas</span>
          <span class="stat-value">{{ getTotalTasks() }}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Completadas</span>
          <span class="stat-value">{{ getCompletedCount() }}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">En progreso</span>
          <span class="stat-value">{{ getInProgressCount() }}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Progreso</span>
          <span class="stat-value">{{ getCompletionRate() }}%</span>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .kanban-page {
      padding: 30px;
      background: #f5f5f5;
      min-height: 100vh;
    }

    .kanban-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 30px;
    }

    .kanban-header h1 {
      margin: 0;
      font-size: 28px;
      color: #333;
    }

    .project-filter {
      padding: 10px 15px;
      border: 2px solid #e0e0e0;
      border-radius: 8px;
      font-size: 14px;
      background: white;
      cursor: pointer;
      min-width: 200px;
    }

    .kanban-board {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }

    .kanban-column {
      background: white;
      border-radius: 12px;
      border-top: 4px solid;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      display: flex;
      flex-direction: column;
      min-height: 500px;
      max-height: calc(100vh - 250px);
    }

    .column-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 20px;
      border-bottom: 2px solid #f0f0f0;
    }

    .column-header h3 {
      margin: 0;
      font-size: 16px;
      color: #333;
      font-weight: 600;
    }

    .task-count {
      background: #f0f0f0;
      padding: 4px 12px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 600;
      color: #666;
    }

    .column-content {
      flex: 1;
      padding: 15px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 15px;
    }

    .kanban-card {
      background: #f9f9f9;
      border-radius: 8px;
      padding: 15px;
      cursor: grab;
      transition: all 0.3s;
      border: 2px solid transparent;
    }

    .kanban-card:hover {
      background: #f5f5f5;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      transform: translateY(-2px);
    }

    .kanban-card:active {
      cursor: grabbing;
    }

    .kanban-card.dragging {
      opacity: 0.5;
      transform: rotate(2deg);
    }

    .card-header {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      margin-bottom: 10px;
    }

    .card-priority {
      width: 4px;
      height: 100%;
      min-height: 40px;
      border-radius: 2px;
    }

    .card-priority.low { background: #4caf50; }
    .card-priority.medium { background: #ff9800; }
    .card-priority.high { background: #f44336; }
    .card-priority.urgent { background: #9c27b0; }

    .card-header h4 {
      margin: 0;
      font-size: 14px;
      color: #333;
      line-height: 1.4;
      flex: 1;
    }

    .card-description {
      font-size: 13px;
      color: #666;
      line-height: 1.4;
      margin: 0 0 10px;
    }

    .card-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 10px;
    }

    .priority-badge {
      padding: 4px 10px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 600;
    }

    .priority-badge.low { background: #e8f5e9; color: #388e3c; }
    .priority-badge.medium { background: #fff3e0; color: #f57c00; }
    .priority-badge.high { background: #ffebee; color: #c62828; }
    .priority-badge.urgent { background: #f3e5f5; color: #6a1b9a; }

    .due-date {
      font-size: 11px;
      color: #666;
      padding: 4px 8px;
      background: #f0f0f0;
      border-radius: 8px;
    }

    .due-date.overdue {
      background: #ffebee;
      color: #c62828;
      font-weight: 600;
    }

    .card-progress {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 10px;
    }

    .progress-bar {
      flex: 1;
      height: 6px;
      background: #e0e0e0;
      border-radius: 3px;
      overflow: hidden;
    }

    .progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #667eea, #764ba2);
      transition: width 0.3s;
    }

    .progress-text {
      font-size: 11px;
      color: #666;
      font-weight: 600;
    }

    .card-footer {
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px solid #e0e0e0;
    }

    .assignees {
      display: flex;
      align-items: center;
      gap: 5px;
    }

    .assignee-avatar {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      border: 2px solid white;
      object-fit: cover;
    }

    .more-assignees {
      font-size: 11px;
      color: #666;
      font-weight: 600;
      padding: 2px 6px;
      background: #f0f0f0;
      border-radius: 10px;
    }

    .empty-column {
      text-align: center;
      padding: 40px 20px;
      color: #999;
      font-size: 14px;
    }

    .stats-bar {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 20px;
      background: white;
      padding: 20px;
      border-radius: 12px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }

    .stat-item {
      display: flex;
      flex-direction: column;
      gap: 5px;
    }

    .stat-label {
      font-size: 12px;
      color: #999;
      text-transform: uppercase;
      font-weight: 600;
    }

    .stat-value {
      font-size: 24px;
      color: #333;
      font-weight: 700;
    }

    @media (max-width: 1200px) {
      .kanban-board {
        grid-template-columns: repeat(2, 1fr);
      }
    }

    @media (max-width: 768px) {
      .kanban-board {
        grid-template-columns: 1fr;
      }

      .kanban-column {
        max-height: none;
      }
    }
  `]
})
export class KanbanBoardComponent implements OnInit {
  columns: KanbanColumn[] = [
    { id: Status.TODO, title: 'Por Hacer', tasks: [], color: '#ff9800' },
    { id: Status.IN_PROGRESS, title: 'En Progreso', tasks: [], color: '#2196f3' },
    { id: Status.REVIEW, title: 'En Revisión', tasks: [], color: '#9c27b0' },
    { id: Status.COMPLETED, title: 'Completadas', tasks: [], color: '#4caf50' }
  ];

  projects: Project[] = [];
  selectedProjectId: number | null = null;
  draggedTask: Task | null = null;

  constructor(
    private taskService: TaskService,
    private projectService: ProjectService,
    private notificationService: NotificationService
  ) {}

  ngOnInit(): void {
    this.loadProjects();
    this.loadTasks();
  }

  loadProjects(): void {
    this.projectService.getProjects().subscribe({
      next: (projects) => {
        this.projects = projects.filter(p => !p.is_archived);
      },
      error: (error) => console.error('Error loading projects:', error)
    });
  }

  loadTasks(): void {
    this.taskService.getTasks({
      project_id: this.selectedProjectId || undefined,
      limit: 200
    }).subscribe({
      next: (tasks) => {
        this.organizeTasks(tasks);
      },
      error: (error) => {
        console.error('Error loading tasks:', error);
        this.notificationService.error('No se pudieron cargar las tareas', 'Error');
      }
    });
  }

  organizeTasks(tasks: Task[]): void {
    // Limpiar columnas
    this.columns.forEach(col => col.tasks = []);

    // Organizar tareas por estado
    tasks.forEach(task => {
      const column = this.columns.find(col => col.id === task.status);
      if (column) {
        column.tasks.push(task);
      }
    });
  }

  onDragStart(event: DragEvent, task: Task): void {
    this.draggedTask = task;
    if (event.target) {
      (event.target as HTMLElement).classList.add('dragging');
    }
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/html', '');
    }
  }

  onDragEnd(event: DragEvent): void {
    if (event.target) {
      (event.target as HTMLElement).classList.remove('dragging');
    }
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  }

  onDrop(event: DragEvent, newStatus: Status): void {
    event.preventDefault();

    if (!this.draggedTask) return;

    const oldStatus = this.draggedTask.status;

    if (oldStatus === newStatus) {
      this.draggedTask = null;
      return;
    }

    // Actualizar en el servidor
    this.taskService.updateTaskStatus(this.draggedTask.id, newStatus).subscribe({
      next: (updatedTask) => {
        // Actualizar localmente
        const oldColumn = this.columns.find(col => col.id === oldStatus);
        const newColumn = this.columns.find(col => col.id === newStatus);

        if (oldColumn && newColumn && this.draggedTask) {
          oldColumn.tasks = oldColumn.tasks.filter(t => t.id !== this.draggedTask!.id);
          updatedTask.status = newStatus;
          newColumn.tasks.push(updatedTask);
        }

        this.notificationService.success(
          `Tarea movida a "${this.getStatusLabel(newStatus)}"`,
          'Estado actualizado'
        );

        this.draggedTask = null;
      },
      error: (error) => {
        console.error('Error updating task:', error);
        this.notificationService.error('No se pudo actualizar el estado', 'Error');
        this.draggedTask = null;
      }
    });
  }

  getStatusLabel(status: Status): string {
    const labels: Record<Status, string> = {
      [Status.TODO]: 'Por Hacer',
      [Status.IN_PROGRESS]: 'En Progreso',
      [Status.REVIEW]: 'En Revisión',
      [Status.COMPLETED]: 'Completadas',
      [Status.ARCHIVED]: 'Archivadas'
    };
    return labels[status] || status;
  }

  getPriorityLabel(priority: Priority): string {
    const labels: Record<Priority, string> = {
      [Priority.LOW]: 'Baja',
      [Priority.MEDIUM]: 'Media',
      [Priority.HIGH]: 'Alta',
      [Priority.URGENT]: 'Urgente'
    };
    return labels[priority] || priority;
  }

  formatDueDate(dueDate: string): string {
    const date = new Date(dueDate);
    const today = new Date();
    const diffTime = date.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays < 0) return `Vencida`;
    if (diffDays === 0) return 'Hoy';
    if (diffDays === 1) return 'Mañana';
    if (diffDays <= 7) return `En ${diffDays} días`;

    return date.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
  }

  isOverdue(dueDate: string): boolean {
    return new Date(dueDate) < new Date();
  }

  getTotalTasks(): number {
    return this.columns.reduce((sum, col) => sum + col.tasks.length, 0);
  }

  getCompletedCount(): number {
    const completedColumn = this.columns.find(col => col.id === Status.COMPLETED);
    return completedColumn ? completedColumn.tasks.length : 0;
  }

  getInProgressCount(): number {
    const inProgressColumn = this.columns.find(col => col.id === Status.IN_PROGRESS);
    return inProgressColumn ? inProgressColumn.tasks.length : 0;
  }

  getCompletionRate(): number {
    const total = this.getTotalTasks();
    if (total === 0) return 0;
    return Math.round((this.getCompletedCount() / total) * 100);
  }
}
