import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TaskService } from '../../services/task.service';
import { Task, Status, Priority } from '../../models';

@Component({
  selector: 'app-tasks-list',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="tasks-page">
      <div class="page-header">
        <h1>Mis Tareas</h1>
        <button class="btn-primary" (click)="showCreateModal = true">
          + Nueva Tarea
        </button>
      </div>

      <!-- Filtros -->
      <div class="filters">
        <select [(ngModel)]="filterStatus" (change)="loadTasks()">
          <option [ngValue]="null">Todos los estados</option>
          <option value="todo">Por Hacer</option>
          <option value="in_progress">En Progreso</option>
          <option value="review">En Revisión</option>
          <option value="completed">Completadas</option>
        </select>

        <select [(ngModel)]="filterPriority" (change)="loadTasks()">
          <option [ngValue]="null">Todas las prioridades</option>
          <option value="low">Baja</option>
          <option value="medium">Media</option>
          <option value="high">Alta</option>
          <option value="urgent">Urgente</option>
        </select>
      </div>

      <!-- Lista de Tareas -->
      <div class="tasks-container" *ngIf="tasks.length > 0; else noTasks">
        <div class="task-card" *ngFor="let task of tasks">
          <div class="task-header">
            <div class="task-title-section">
              <div class="priority-indicator" [class]="task.priority"></div>
              <h3>{{ task.title }}</h3>
            </div>
            <div class="task-actions">
              <button class="btn-icon" (click)="editTask(task)" title="Editar">✏️</button>
              <button class="btn-icon" (click)="deleteTask(task.id)" title="Eliminar">🗑️</button>
            </div>
          </div>

          <p class="task-description">{{ task.description || 'Sin descripción' }}</p>

          <div class="task-meta">
            <span class="task-status" [class]="task.status">
              {{ getStatusLabel(task.status) }}
            </span>
            <span class="task-priority-label" [class]="task.priority">
              {{ getPriorityLabel(task.priority) }}
            </span>
            <span class="task-date" *ngIf="task.due_date">
              📅 {{ task.due_date | date:'dd/MM/yyyy' }}
            </span>
          </div>

          <div class="task-progress" *ngIf="task.progress > 0">
            <div class="progress-bar">
              <div class="progress-fill" [style.width.%]="task.progress"></div>
            </div>
            <span class="progress-text">{{ task.progress }}%</span>
          </div>

          <div class="task-footer">
            <select
              class="status-select"
              [value]="task.status"
              (change)="updateStatus(task.id, $event)"
            >
              <option value="todo">Por Hacer</option>
              <option value="in_progress">En Progreso</option>
              <option value="review">En Revisión</option>
              <option value="completed">Completada</option>
            </select>
          </div>
        </div>
      </div>

      <ng-template #noTasks>
        <div class="no-tasks">
          <p>📝 No hay tareas que mostrar</p>
          <button class="btn-primary" (click)="showCreateModal = true">
            Crear primera tarea
          </button>
        </div>
      </ng-template>

      <!-- Modal Crear/Editar Tarea -->
      <div class="modal" *ngIf="showCreateModal" (click)="closeModal($event)">
        <div class="modal-content" (click)="$event.stopPropagation()">
          <div class="modal-header">
            <h2>{{ editingTask ? 'Editar Tarea' : 'Nueva Tarea' }}</h2>
            <button class="btn-close" (click)="closeModal($event)">×</button>
          </div>

          <div class="modal-body">
            <div class="form-group">
              <label>Título *</label>
              <input
                type="text"
                [(ngModel)]="taskForm.title"
                placeholder="Nombre de la tarea"
              />
            </div>

            <div class="form-group">
              <label>Descripción</label>
              <textarea
                [(ngModel)]="taskForm.description"
                placeholder="Describe la tarea..."
                rows="4"
              ></textarea>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label>Estado</label>
                <select [(ngModel)]="taskForm.status">
                  <option value="todo">Por Hacer</option>
                  <option value="in_progress">En Progreso</option>
                  <option value="review">En Revisión</option>
                  <option value="completed">Completada</option>
                </select>
              </div>

              <div class="form-group">
                <label>Prioridad</label>
                <select [(ngModel)]="taskForm.priority">
                  <option value="low">Baja</option>
                  <option value="medium">Media</option>
                  <option value="high">Alta</option>
                  <option value="urgent">Urgente</option>
                </select>
              </div>
            </div>

            <div class="form-group">
              <label>Fecha de vencimiento</label>
              <input
                type="date"
                [(ngModel)]="taskForm.due_date"
              />
            </div>
          </div>

          <div class="modal-footer">
            <button class="btn-secondary" (click)="closeModal($event)">Cancelar</button>
            <button class="btn-primary" (click)="saveTask()">
              {{ editingTask ? 'Guardar' : 'Crear' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .tasks-page {
      padding: 30px;
    }

    .page-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 30px;
    }

    .page-header h1 {
      margin: 0;
      font-size: 28px;
      color: #333;
    }

    .filters {
      display: flex;
      gap: 15px;
      margin-bottom: 20px;
    }

    .filters select {
      padding: 10px 15px;
      border: 2px solid #e0e0e0;
      border-radius: 8px;
      font-size: 14px;
      background: white;
      cursor: pointer;
    }

    .tasks-container {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
      gap: 20px;
    }

    .task-card {
      background: white;
      padding: 20px;
      border-radius: 12px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      transition: transform 0.2s, box-shadow 0.2s;
    }

    .task-card:hover {
      transform: translateY(-5px);
      box-shadow: 0 4px 16px rgba(0,0,0,0.15);
    }

    .task-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 10px;
    }

    .task-title-section {
      display: flex;
      align-items: center;
      gap: 10px;
      flex: 1;
    }

    .priority-indicator {
      width: 4px;
      height: 40px;
      border-radius: 2px;
    }

    .priority-indicator.low { background: #4caf50; }
    .priority-indicator.medium { background: #ff9800; }
    .priority-indicator.high { background: #f44336; }
    .priority-indicator.urgent { background: #9c27b0; }

    .task-card h3 {
      margin: 0;
      font-size: 18px;
      color: #333;
    }

    .task-actions {
      display: flex;
      gap: 8px;
    }

    .btn-icon {
      background: none;
      border: none;
      font-size: 18px;
      cursor: pointer;
      padding: 5px;
      opacity: 0.7;
      transition: opacity 0.2s;
    }

    .btn-icon:hover {
      opacity: 1;
    }

    .task-description {
      color: #666;
      font-size: 14px;
      margin: 10px 0;
      line-height: 1.5;
    }

    .task-meta {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      margin: 15px 0;
    }

    .task-status {
      padding: 4px 12px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 500;
    }

    .task-status.todo { background: #fff3e0; color: #f57c00; }
    .task-status.in_progress { background: #e3f2fd; color: #1976d2; }
    .task-status.review { background: #f3e5f5; color: #7b1fa2; }
    .task-status.completed { background: #e8f5e9; color: #388e3c; }

    .task-priority-label {
      padding: 4px 12px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 500;
    }

    .task-priority-label.low { background: #e8f5e9; color: #388e3c; }
    .task-priority-label.medium { background: #fff3e0; color: #f57c00; }
    .task-priority-label.high { background: #ffebee; color: #c62828; }
    .task-priority-label.urgent { background: #f3e5f5; color: #6a1b9a; }

    .task-date {
      color: #666;
      font-size: 12px;
    }

    .task-progress {
      display: flex;
      align-items: center;
      gap: 10px;
      margin: 15px 0;
    }

    .progress-bar {
      flex: 1;
      height: 8px;
      background: #e0e0e0;
      border-radius: 4px;
      overflow: hidden;
    }

    .progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #667eea, #764ba2);
      transition: width 0.3s;
    }

    .progress-text {
      font-size: 12px;
      color: #666;
      font-weight: 500;
    }

    .task-footer {
      margin-top: 15px;
    }

    .status-select {
      width: 100%;
      padding: 8px 12px;
      border: 2px solid #e0e0e0;
      border-radius: 6px;
      font-size: 14px;
      cursor: pointer;
      background: white;
    }

    .no-tasks {
      text-align: center;
      padding: 60px 20px;
      color: #666;
    }

    .no-tasks p {
      font-size: 18px;
      margin-bottom: 20px;
    }

    .btn-primary {
      padding: 12px 24px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: transform 0.2s;
    }

    .btn-primary:hover {
      transform: translateY(-2px);
    }

    .btn-secondary {
      padding: 12px 24px;
      background: #e0e0e0;
      color: #333;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
    }

    /* Modal */
    .modal {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0,0,0,0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
    }

    .modal-content {
      background: white;
      border-radius: 12px;
      width: 90%;
      max-width: 600px;
      max-height: 90vh;
      overflow-y: auto;
    }

    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 20px;
      border-bottom: 1px solid #e0e0e0;
    }

    .modal-header h2 {
      margin: 0;
      font-size: 20px;
    }

    .btn-close {
      background: none;
      border: none;
      font-size: 32px;
      cursor: pointer;
      color: #666;
      line-height: 1;
    }

    .modal-body {
      padding: 20px;
    }

    .form-group {
      margin-bottom: 20px;
    }

    .form-group label {
      display: block;
      margin-bottom: 8px;
      font-weight: 500;
      color: #333;
    }

    .form-group input,
    .form-group textarea,
    .form-group select {
      width: 100%;
      padding: 10px;
      border: 2px solid #e0e0e0;
      border-radius: 6px;
      font-size: 14px;
      box-sizing: border-box;
    }

    .form-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 15px;
    }

    .modal-footer {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      padding: 20px;
      border-top: 1px solid #e0e0e0;
    }
  `]
})
export class TasksListComponent implements OnInit {
  tasks: Task[] = [];
  filterStatus: Status | null = null;
  filterPriority: Priority | null = null;
  showCreateModal = false;
  editingTask: Task | null = null;

  taskForm = {
    title: '',
    description: '',
    status: Status.TODO,
    priority: Priority.MEDIUM,
    due_date: ''
  };

  constructor(private taskService: TaskService) {}

  ngOnInit(): void {
    this.loadTasks();
  }

  loadTasks(): void {
    this.taskService.getTasks({
      status: this.filterStatus || undefined,
      priority: this.filterPriority || undefined,
      limit: 100
    }).subscribe({
      next: (tasks) => {
        this.tasks = tasks;
      },
      error: (error) => console.error('Error loading tasks:', error)
    });
  }

  editTask(task: Task): void {
    this.editingTask = task;
    this.taskForm = {
      title: task.title,
      description: task.description || '',
      status: task.status,
      priority: task.priority,
      due_date: task.due_date ? task.due_date.split('T')[0] : ''
    };
    this.showCreateModal = true;
  }

  saveTask(): void {
    if (!this.taskForm.title) {
      alert('El título es requerido');
      return;
    }

    const taskData = {
      ...this.taskForm,
      due_date: this.taskForm.due_date || undefined
    };

    if (this.editingTask) {
      this.taskService.updateTask(this.editingTask.id, taskData).subscribe({
        next: () => {
          this.loadTasks();
          this.closeModal();
        },
        error: (error) => console.error('Error updating task:', error)
      });
    } else {
      this.taskService.createTask(taskData).subscribe({
        next: () => {
          this.loadTasks();
          this.closeModal();
        },
        error: (error) => console.error('Error creating task:', error)
      });
    }
  }

  deleteTask(id: number): void {
    if (!confirm('¿Estás seguro de eliminar esta tarea?')) {
      return;
    }

    this.taskService.deleteTask(id).subscribe({
      next: () => {
        this.loadTasks();
      },
      error: (error) => console.error('Error deleting task:', error)
    });
  }

  updateStatus(taskId: number, event: any): void {
    const status = event.target.value as Status;
    this.taskService.updateTaskStatus(taskId, status).subscribe({
      next: () => {
        this.loadTasks();
      },
      error: (error) => console.error('Error updating status:', error)
    });
  }

  closeModal(event?: Event): void {
    this.showCreateModal = false;
    this.editingTask = null;
    this.taskForm = {
      title: '',
      description: '',
      status: Status.TODO,
      priority: Priority.MEDIUM,
      due_date: ''
    };
  }

  getStatusLabel(status: Status): string {
    const labels: Record<Status, string> = {
      [Status.TODO]: 'Por Hacer',
      [Status.IN_PROGRESS]: 'En Progreso',
      [Status.REVIEW]: 'En Revisión',
      [Status.COMPLETED]: 'Completada',
      [Status.ARCHIVED]: 'Archivada'
    };
    return labels[status];
  }

  getPriorityLabel(priority: Priority): string {
    const labels: Record<Priority, string> = {
      [Priority.LOW]: 'Baja',
      [Priority.MEDIUM]: 'Media',
      [Priority.HIGH]: 'Alta',
      [Priority.URGENT]: 'Urgente'
    };
    return labels[priority];
  }
}
