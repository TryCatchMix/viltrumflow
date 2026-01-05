import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Project, ProjectCreate, ProjectUpdate, Message } from '../models';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class ProjectService {
  private apiUrl = `${environment.apiUrl}/api/v1/projects`;

  constructor(private http: HttpClient) {}

  /**
   * Obtener proyectos
   */
  getProjects(skip: number = 0, limit: number = 100): Observable<Project[]> {
    const params = new HttpParams()
      .set('skip', skip.toString())
      .set('limit', limit.toString());

    return this.http.get<Project[]>(this.apiUrl, { params });
  }

  /**
   * Obtener proyecto por ID
   */
  getProject(id: number): Observable<Project> {
    return this.http.get<Project>(`${this.apiUrl}/${id}`);
  }

  /**
   * Crear proyecto
   */
  createProject(project: ProjectCreate): Observable<Project> {
    return this.http.post<Project>(this.apiUrl, project);
  }

  /**
   * Actualizar proyecto
   */
  updateProject(id: number, project: ProjectUpdate): Observable<Project> {
    return this.http.put<Project>(`${this.apiUrl}/${id}`, project);
  }

  /**
   * Eliminar proyecto
   */
  deleteProject(id: number): Observable<Message> {
    return this.http.delete<Message>(`${this.apiUrl}/${id}`);
  }

  /**
   * Archivar proyecto
   */
  archiveProject(id: number): Observable<Project> {
    return this.updateProject(id, { is_archived: true });
  }

  /**
   * Desarchivar proyecto
   */
  unarchiveProject(id: number): Observable<Project> {
    return this.updateProject(id, { is_archived: false });
  }
}
