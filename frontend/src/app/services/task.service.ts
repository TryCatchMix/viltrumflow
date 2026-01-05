import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Task, TaskCreate, TaskUpdate, Status, Priority, Message } from '../models';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class TaskService {
  private apiUrl = `${environment.apiUrl}/api/v1/tasks`;

  constructor(private http: HttpClient) {}

  /**
   * Obtener tareas con filtros
   */
  getTasks(filters?: {
    skip?: number;
    limit?: number;
    project_id?: number;
    status?: Status;
    priority?: Priority;
  }): Observable<Task[]> {
    let params = new HttpParams();

    if (filters) {
      if (filters.skip !== undefined) params = params.set('skip', filters.skip.toString());
      if (filters.limit !== undefined) params = params.set('limit', filters.limit.toString());
      if (filters.project_id) params = params.set('project_id', filters.project_id.toString());
      if (filters.status) params = params.set('status', filters.status);
      if (filters.priority) params = params.set('priority', filters.priority);
    }

    return this.http.get<Task[]>(this.apiUrl, { params });
  }

  /**
   * Obtener todas las tareas (sin filtrar por usuario)
   */
  getAllTasks(filters?: {
    skip?: number;
    limit?: number;
    project_id?: number;
    status?: Status;
    priority?: Priority;
  }): Observable<Task[]> {
    let params = new HttpParams();

    if (filters) {
      if (filters.skip !== undefined) params = params.set('skip', filters.skip.toString());
      if (filters.limit !== undefined) params = params.set('limit', filters.limit.toString());
      if (filters.project_id) params = params.set('project_id', filters.project_id.toString());
      if (filters.status) params = params.set('status', filters.status);
      if (filters.priority) params = params.set('priority', filters.priority);
    }

    return this.http.get<Task[]>(`${this.apiUrl}/all`, { params });
  }

  /**
   * Obtener tarea por ID
   */
  getTask(id: number): Observable<Task> {
    return this.http.get<Task>(`${this.apiUrl}/${id}`);
  }

  /**
   * Crear tarea
   */
  createTask(task: TaskCreate): Observable<Task> {
    return this.http.post<Task>(this.apiUrl, task);
  }

  /**
   * Actualizar tarea
   */
  updateTask(id: number, task: TaskUpdate): Observable<Task> {
    return this.http.put<Task>(`${this.apiUrl}/${id}`, task);
  }

  /**
   * Eliminar tarea
   */
  deleteTask(id: number): Observable<Message> {
    return this.http.delete<Message>(`${this.apiUrl}/${id}`);
  }

  /**
   * Cambiar estado de tarea
   */
  updateTaskStatus(id: number, status: Status): Observable<Task> {
    return this.updateTask(id, { status });
  }

  /**
   * Cambiar prioridad de tarea
   */
  updateTaskPriority(id: number, priority: Priority): Observable<Task> {
    return this.updateTask(id, { priority });
  }

  /**
   * Actualizar progreso de tarea
   */
  updateTaskProgress(id: number, progress: number): Observable<Task> {
    return this.updateTask(id, { progress });
  }
}
