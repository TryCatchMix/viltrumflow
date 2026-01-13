import { Component, OnInit } from '@angular/core';
import { Priority, Project, Status, Task } from '../../models';
import { Subject, debounceTime } from 'rxjs';

import { ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NotificationService } from '../../services/notification.service';
import { ProjectService } from '../../services/project.service';
import { TaskService } from '../../services/task.service';

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

      <!-- Barra de Búsqueda -->
      <div class="search-bar">
        <div class="search-input-wrapper">
          <span class="search-icon">🔍</span>
          <input
            type="text"
            class="search-input"
            [(ngModel)]="searchTerm"
            (ngModelChange)="onSearchChange($event)"
            placeholder="Buscar tareas por título o descripción..."
          />
          <button
            class="clear-search"
            *ngIf="searchTerm"
            (click)="searchTerm = ''; onSearchChange('')"
          >
            ×
          </button>
        </div>
        <button
          class="btn-filters"
          (click)="showFilters = !showFilters"
          [class.active]="showFilters"
        >
          🎯 Filtros
          <span class="filter-badge" *ngIf="hasActiveFilters">{{ (filterStatus ? 1 : 0) + (filterPriority ? 1 : 0) + (filterProject ? 1 : 0) }}</span>
        </button>
      </div>

      <!-- Panel de Filtros Avanzados -->
      <div class="filters-panel" *ngIf="showFilters">
        <div class="filters-row">
          <div class="filter-group">
            <label>Estado</label>
            <select [(ngModel)]="filterStatus" (change)="loadTasks()">
              <option [ngValue]="null">Todos</option>
              <option value="todo">Por Hacer</option>
              <option value="in_progress">En Progreso</option>
              <option value="review">En Revisión</option>
              <option value="completed">Completadas</option>
            </select>
          </div>

          <div class="filter-group">
            <label>Prioridad</label>
            <select [(ngModel)]="filterPriority" (change)="loadTasks()">
              <option [ngValue]="null">Todas</option>
              <option value="low">Baja</option>
              <option value="medium">Media</option>
              <option value="high">Alta</option>
              <option value="urgent">Urgente</option>
            </select>
          </div>

          <div class="filter-group">
            <label>Proyecto</label>
            <select [(ngModel)]="filterProject" (change)="loadTasks()">
              <option [ngValue]="null">Todos los proyectos</option>
              <option *ngFor="let project of projects" [ngValue]="project.id">
                {{ project.icon }} {{ project.name }}
              </option>
            </select>
          </div>

          <div class="filter-group">
            <label>Ordenar por</label>
            <select [(ngModel)]="sortBy" (change)="performSearch()">
              <option value="created">Fecha de creación</option>
              <option value="due_date">Fecha de vencimiento</option>
              <option value="priority">Prioridad</option>
              <option value="title">Título</option>
            </select>
          </div>

          <div class="filter-group">
            <label>Orden</label>
            <select [(ngModel)]="sortOrder" (change)="performSearch()">
              <option value="asc">Ascendente</option>
              <option value="desc">Descendente</option>
            </select>
          </div>
        </div>

        <div class="filters-actions">
          <button class="btn-clear-filters" (click)="clearFilters()" *ngIf="hasActiveFilters">
            ✗ Limpiar filtros
          </button>
          <span class="results-count">
            {{ filteredTasks.length }} de {{ tasks.length }} tareas
          </span>
        </div>
      </div>

      <!-- Lista de Tareas -->
      <div class="tasks-container" *ngIf="filteredTasks.length > 0; else noTasks">
        <div class="task-card" *ngFor="let task of filteredTasks">
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

            <div class="form-group">
              <label>Proyecto</label>
              <select [(ngModel)]="taskForm.project_id">
                <option [ngValue]="null">Sin proyecto</option>
                <option *ngFor="let project of projects" [ngValue]="project.id">
                  {{ project.icon }} {{ project.name }}
                </option>
              </select>
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

    .search-bar {
      display: flex;
      gap: 15px;
      margin-bottom: 20px;
    }

    .search-input-wrapper {
      flex: 1;
      position: relative;
      display: flex;
      align-items: center;
    }

    .search-icon {
      position: absolute;
      left: 15px;
      font-size: 18px;
      color: #999;
    }

    .search-input {
      width: 100%;
      padding: 12px 45px 12px 45px;
      border: 2px solid #e0e0e0;
      border-radius: 8px;
      font-size: 14px;
      transition: border-color 0.3s;
      box-sizing: border-box;
    }

    .search-input:focus {
      outline: none;
      border-color: #667eea;
    }

    .clear-search {
      position: absolute;
      right: 10px;
      background: none;
      border: none;
      font-size: 24px;
      color: #999;
      cursor: pointer;
      padding: 5px;
      line-height: 1;
    }

    .clear-search:hover {
      color: #666;
    }

    .btn-filters {
      padding: 12px 20px;
      background: white;
      border: 2px solid #e0e0e0;
      border-radius: 8px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 500;
      color: #666;
      transition: all 0.3s;
      display: flex;
      align-items: center;
      gap: 8px;
      position: relative;
    }

    .btn-filters:hover,
    .btn-filters.active {
      border-color: #667eea;
      color: #667eea;
    }

    .filter-badge {
      background: #f44336;
      color: white;
      font-size: 11px;
      padding: 2px 6px;
      border-radius: 10px;
      font-weight: 600;
    }

    .filters-panel {
      background: white;
      padding: 20px;
      border-radius: 12px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      margin-bottom: 20px;
      animation: slideDown 0.3s ease;
    }

    @keyframes slideDown {
      from {
        opacity: 0;
        transform: translateY(-10px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .filters-row {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 15px;
      margin-bottom: 15px;
    }

    .filter-group {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .filter-group label {
      font-size: 12px;
      font-weight: 600;
      color: #666;
      text-transform: uppercase;
    }

    .filter-group select {
      padding: 10px;
      border: 2px solid #e0e0e0;
      border-radius: 6px;
      font-size: 14px;
      cursor: pointer;
      background: white;
      transition: border-color 0.3s;
    }

    .filter-group select:focus {
      outline: none;
      border-color: #667eea;
    }

    .filters-actions {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-top: 15px;
      border-top: 1px solid #e0e0e0;
    }

    .btn-clear-filters {
      padding: 8px 16px;
      background: #f44336;
      color: white;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
      transition: background 0.3s;
    }

    .btn-clear-filters:hover {
      background: #d32f2f;
    }

    .results-count {
      font-size: 13px;
      color: #999;
      font-weight: 500;
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

  selectedProjectId: number | null = null;

  constructor(
    private taskService: TaskService,
    private route: ActivatedRoute,
    private notificationService: NotificationService
  ) {}

  ngOnInit(): void {
    // Obtener project_id de query params si existe
    this.route.queryParams.subscribe(params => {
      if (params['project']) {
        this.selectedProjectId = +params['project'];
      }
      this.loadTasks();
    });
  }

  loadTasks(): void {
    this.taskService.getTasks({
      status: this.filterStatus || undefined,
      priority: this.filterPriority || undefined,
      project_id: this.filterProject || this.selectedProjectId || undefined,
      limit: 100
    }).subscribe({
      next: (tasks) => {
        this.tasks = tasks;
        this.filteredTasks = tasks;
        this.performSearch();
      },
      error: (error) => console.error('Error loading tasks:', error)
    });
  }

  onSearchChange(term: string): void {
    this.searchTerm = term;
    this.searchSubject.next(term);
  }

  performSearch(): void {
    let results = [...this.tasks];

    // Búsqueda por término
    if (this.searchTerm.trim()) {
      const term = this.searchTerm.toLowerCase();
      results = results.filter(task =>
        task.title.toLowerCase().includes(term) ||
        (task.description && task.description.toLowerCase().includes(term))
      );
    }

    // Ordenamiento
    results = this.sortTasks(results);

    this.filteredTasks = results;
  }

  sortTasks(tasks: Task[]): Task[] {
    return tasks.sort((a, b) => {
      let comparison = 0;

      switch (this.sortBy) {
        case 'title':
          comparison = a.title.localeCompare(b.title);
          break;
        case 'due_date':
          const dateA = a.due_date ? new Date(a.due_date).getTime() : 0;
          const dateB = b.due_date ? new Date(b.due_date).getTime() : 0;
          comparison = dateA - dateB;
          break;
        case 'priority':
          const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
          comparison = priorityOrder[a.priority] - priorityOrder[b.priority];
          break;
        case 'created':
        default:
          comparison = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
          break;
      }

      return this.sortOrder === 'asc' ? comparison : -comparison;
    });
  }

  toggleSort(field: 'created' | 'due_date' | 'priority' | 'title'): void {
    if (this.sortBy === field) {
      this.sortOrder = this.sortOrder === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortBy = field;
      this.sortOrder = 'desc';
    }
    this.performSearch();
  }

  clearFilters(): void {
    this.filterStatus = null;
    this.filterPriority = null;
    this.filterProject = null;
    this.searchTerm = '';
    this.loadTasks();
  }

  get hasActiveFilters(): boolean {
    return !!(this.filterStatus || this.filterPriority || this.filterProject || this.searchTerm);
  }

  editTask(task: Task): void {
    this.editingTask = task;
    this.taskForm = {
      title: task.title,
      description: task.description || '',
      status: task.status,
      priority: task.priority,
      due_date: task.due_date ? task.due_date.split('T')[0] : '',
      project_id: task.project_id || null
    };
    this.showCreateModal = true;
  }

  saveTask(): void {
    if (!this.taskForm.title) {
      this.notificationService.warning('El título de la tarea es requerido', 'Campo obligatorio');
      return;
    }

    const taskData = {
      ...this.taskForm,
      due_date: this.taskForm.due_date || undefined
    };

    if (this.editingTask) {
      this.taskService.updateTask(this.editingTask.id, taskData).subscribe({
        next: () => {
          this.notificationService.success('La tarea ha sido actualizada correctamente', 'Tarea actualizada');
          this.loadTasks();
          this.closeModal();
        },
        error: (error) => {
          console.error('Error updating task:', error);
          this.notificationService.error('No se pudo actualizar la tarea', 'Error');
        }
      });
    } else {
      this.taskService.createTask(taskData).subscribe({
        next: () => {
          this.notificationService.success('La tarea ha sido creada correctamente', 'Tarea creada');
          this.loadTasks();
          this.closeModal();
        },
        error: (error) => {
          console.error('Error creating task:', error);
          this.notificationService.error('No se pudo crear la tarea', 'Error');
        }
      });
    }
  }

  deleteTask(id: number): void {
    if (!confirm('¿Estás seguro de eliminar esta tarea?')) {
      return;
    }

    this.taskService.deleteTask(id).subscribe({
      next: () => {
        this.notificationService.success('La tarea ha sido eliminada', 'Tarea eliminada');
        this.loadTasks();
      },
      error: (error) => {
        console.error('Error deleting task:', error);
        this.notificationService.error('No se pudo eliminar la tarea', 'Error');
      }
    });
  }

  updateStatus(taskId: number, event: any): void {
    const status = event.target.value as Status;
    this.taskService.updateTaskStatus(taskId, status).subscribe({
      next: () => {
        this.notificationService.info('El estado de la tarea ha sido actualizado', 'Estado actualizado');
        this.loadTasks();
      },
      error: (error) => {
        console.error('Error updating status:', error);
        this.notificationService.error('No se pudo actualizar el estado', 'Error');
      }
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
      due_date: '',
      project_id: null
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
