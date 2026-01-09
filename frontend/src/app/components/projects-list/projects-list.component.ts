import { Component, OnInit } from '@angular/core';
import { Project, ProjectCreate } from '../../models';
import { Router, RouterModule } from '@angular/router';

import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ProjectService } from '../../services/project.service';

@Component({
  selector: 'app-projects-list',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  template: `
    <div class="projects-page">
      <div class="page-header">
        <h1>Mis Proyectos</h1>
        <button class="btn-primary" (click)="openCreateModal()">
          + Nuevo Proyecto
        </button>
      </div>

      <!-- Filtro -->
      <div class="filters">
        <button
          class="filter-btn"
          [class.active]="!showArchived"
          (click)="showArchived = false; filterProjects()"
        >
          Activos ({{ activeCount }})
        </button>
        <button
          class="filter-btn"
          [class.active]="showArchived"
          (click)="showArchived = true; filterProjects()"
        >
          Archivados ({{ archivedCount }})
        </button>
      </div>

      <!-- Grid de Proyectos -->
      <div class="projects-grid" *ngIf="filteredProjects.length > 0; else noProjects">
        <div class="project-card" *ngFor="let project of filteredProjects">
          <div class="project-header" [style.border-left-color]="project.color">
            <div class="project-title-section">
              <span class="project-icon" *ngIf="project.icon">{{ project.icon }}</span>
              <h3>{{ project.name }}</h3>
            </div>
            <div class="project-actions">
              <button
                class="btn-icon"
                (click)="viewProject(project.id)"
                title="Ver tareas"
              >
                👁️
              </button>
              <button
                class="btn-icon"
                (click)="editProject(project)"
                title="Editar"
              >
                ✏️
              </button>
              <button
                class="btn-icon"
                (click)="toggleArchive(project)"
                [title]="project.is_archived ? 'Desarchivar' : 'Archivar'"
              >
                {{ project.is_archived ? '📂' : '📁' }}
              </button>
              <button
                class="btn-icon danger"
                (click)="deleteProject(project.id)"
                title="Eliminar"
              >
                🗑️
              </button>
            </div>
          </div>

          <p class="project-description">{{ project.description || 'Sin descripción' }}</p>

          <div class="project-meta">
            <span class="project-slug">{{ project.slug }}</span>
            <span class="project-date">
              Creado: {{ project.created_at | date:'dd/MM/yyyy' }}
            </span>
          </div>

          <div class="project-dates" *ngIf="project.start_date || project.end_date">
            <span *ngIf="project.start_date">
              📅 Inicio: {{ project.start_date | date:'dd/MM/yyyy' }}
            </span>
            <span *ngIf="project.end_date">
              🏁 Fin: {{ project.end_date | date:'dd/MM/yyyy' }}
            </span>
          </div>

          <div class="project-status">
            <span
              class="status-badge"
              [class.active]="project.is_active"
              [class.archived]="project.is_archived"
            >
              {{ project.is_archived ? 'Archivado' : project.is_active ? 'Activo' : 'Inactivo' }}
            </span>
          </div>
        </div>
      </div>

      <ng-template #noProjects>
        <div class="no-projects">
          <p>📁 {{ showArchived ? 'No hay proyectos archivados' : 'No tienes proyectos activos' }}</p>
          <button class="btn-primary" (click)="openCreateModal()" *ngIf="!showArchived">
            Crear primer proyecto
          </button>
        </div>
      </ng-template>

      <!-- Modal Crear/Editar Proyecto -->
      <div class="modal" *ngIf="showModal" (click)="closeModal($event)">
        <div class="modal-content" (click)="$event.stopPropagation()">
          <div class="modal-header">
            <h2>{{ editingProject ? 'Editar Proyecto' : 'Nuevo Proyecto' }}</h2>
            <button class="btn-close" (click)="closeModal($event)">×</button>
          </div>

          <div class="modal-body">
            <div class="form-group">
              <label>Nombre del Proyecto *</label>
              <input
                type="text"
                [(ngModel)]="projectForm.name"
                placeholder="Ej: Rediseño Web"
                maxlength="100"
              />
            </div>

            <div class="form-group">
              <label>Descripción</label>
              <textarea
                [(ngModel)]="projectForm.description"
                placeholder="Describe el proyecto..."
                rows="4"
              ></textarea>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label>Color</label>
                <div class="color-picker">
                  <input
                    type="color"
                    [(ngModel)]="projectForm.color"
                    class="color-input"
                  />
                  <span class="color-preview" [style.background-color]="projectForm.color">
                    {{ projectForm.color }}
                  </span>
                </div>
              </div>

              <div class="form-group">
                <label>Icono (Emoji)</label>
                <input
                  type="text"
                  [(ngModel)]="projectForm.icon"
                  placeholder="📊"
                  maxlength="2"
                />
                <small>Ej: 📊 🚀 💼 🎨 📱</small>
              </div>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label>Fecha de Inicio</label>
                <input
                  type="date"
                  [(ngModel)]="projectForm.start_date"
                />
              </div>

              <div class="form-group">
                <label>Fecha de Fin</label>
                <input
                  type="date"
                  [(ngModel)]="projectForm.end_date"
                />
              </div>
            </div>
          </div>

          <div class="modal-footer">
            <button class="btn-secondary" (click)="closeModal($event)">Cancelar</button>
            <button class="btn-primary" (click)="saveProject()">
              {{ editingProject ? 'Guardar Cambios' : 'Crear Proyecto' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .projects-page {
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
      gap: 10px;
      margin-bottom: 30px;
    }

    .filter-btn {
      padding: 10px 20px;
      background: white;
      border: 2px solid #e0e0e0;
      border-radius: 8px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 500;
      color: #666;
      transition: all 0.3s;
    }

    .filter-btn:hover {
      border-color: #667eea;
      color: #667eea;
    }

    .filter-btn.active {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border-color: transparent;
    }

    .projects-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
      gap: 25px;
    }

    .project-card {
      background: white;
      padding: 25px;
      border-radius: 12px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      transition: transform 0.2s, box-shadow 0.2s;
      border-left: 4px solid #667eea;
    }

    .project-card:hover {
      transform: translateY(-5px);
      box-shadow: 0 4px 16px rgba(0,0,0,0.15);
    }

    .project-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 15px;
    }

    .project-title-section {
      display: flex;
      align-items: center;
      gap: 10px;
      flex: 1;
    }

    .project-icon {
      font-size: 24px;
    }

    .project-card h3 {
      margin: 0;
      font-size: 20px;
      color: #333;
      word-break: break-word;
    }

    .project-actions {
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
      transition: opacity 0.2s, transform 0.2s;
    }

    .btn-icon:hover {
      opacity: 1;
      transform: scale(1.1);
    }

    .btn-icon.danger:hover {
      transform: scale(1.2);
    }

    .project-description {
      color: #666;
      font-size: 14px;
      margin: 10px 0;
      line-height: 1.5;
      min-height: 40px;
    }

    .project-meta {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin: 15px 0;
      font-size: 12px;
      color: #999;
    }

    .project-slug {
      background: #f5f5f5;
      padding: 4px 8px;
      border-radius: 4px;
      font-family: monospace;
    }

    .project-dates {
      display: flex;
      flex-direction: column;
      gap: 5px;
      font-size: 12px;
      color: #666;
      margin: 10px 0;
    }

    .project-status {
      display: flex;
      justify-content: flex-end;
      margin-top: 15px;
    }

    .status-badge {
      padding: 6px 12px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 500;
    }

    .status-badge.active {
      background: #e8f5e9;
      color: #388e3c;
    }

    .status-badge.archived {
      background: #f5f5f5;
      color: #666;
    }

    .no-projects {
      text-align: center;
      padding: 60px 20px;
      color: #666;
    }

    .no-projects p {
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

    .form-group input:focus,
    .form-group textarea:focus {
      outline: none;
      border-color: #667eea;
    }

    .form-group small {
      display: block;
      margin-top: 5px;
      color: #999;
      font-size: 12px;
    }

    .form-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 15px;
    }

    .color-picker {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .color-input {
      width: 60px;
      height: 40px;
      border: none;
      border-radius: 6px;
      cursor: pointer;
    }

    .color-preview {
      flex: 1;
      padding: 10px;
      border-radius: 6px;
      text-align: center;
      color: white;
      font-weight: 500;
      font-size: 12px;
      text-shadow: 0 1px 2px rgba(0,0,0,0.3);
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
export class ProjectsListComponent implements OnInit {
  projects: Project[] = [];
  filteredProjects: Project[] = [];
  showArchived = false;
  showModal = false;
  editingProject: Project | null = null;

  projectForm = {
    name: '',
    description: '',
    color: '#3B82F6',
    icon: '📊',
    start_date: '',
    end_date: ''
  };

  constructor(
    private projectService: ProjectService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.loadProjects();
  }

  loadProjects(): void {
    this.projectService.getProjects().subscribe({
      next: (projects) => {
        this.projects = projects;
        this.filterProjects();
      },
      error: (error) => console.error('Error loading projects:', error)
    });
  }

  filterProjects(): void {
    this.filteredProjects = this.projects.filter(p =>
      this.showArchived ? p.is_archived : !p.is_archived
    );
  }

  get activeCount(): number {
    return this.projects.filter(p => !p.is_archived).length;
  }

  get archivedCount(): number {
    return this.projects.filter(p => p.is_archived).length;
  }

  openCreateModal(): void {
    this.editingProject = null;
    this.projectForm = {
      name: '',
      description: '',
      color: '#3B82F6',
      icon: '📊',
      start_date: '',
      end_date: ''
    };
    this.showModal = true;
  }

  editProject(project: Project): void {
    this.editingProject = project;
    this.projectForm = {
      name: project.name,
      description: project.description || '',
      color: project.color,
      icon: project.icon || '📊',
      start_date: project.start_date ? project.start_date.split('T')[0] : '',
      end_date: project.end_date ? project.end_date.split('T')[0] : ''
    };
    this.showModal = true;
  }

  saveProject(): void {
    if (!this.projectForm.name.trim()) {
      alert('El nombre del proyecto es requerido');
      return;
    }

    const projectData = {
      ...this.projectForm,
      start_date: this.projectForm.start_date || undefined,
      end_date: this.projectForm.end_date || undefined
    };

    if (this.editingProject) {
      this.projectService.updateProject(this.editingProject.id, projectData).subscribe({
        next: () => {
          this.loadProjects();
          this.closeModal();
        },
        error: (error) => console.error('Error updating project:', error)
      });
    } else {
      this.projectService.createProject(projectData).subscribe({
        next: () => {
          this.loadProjects();
          this.closeModal();
        },
        error: (error) => console.error('Error creating project:', error)
      });
    }
  }

  deleteProject(id: number): void {
    if (!confirm('¿Estás seguro de eliminar este proyecto? Se eliminarán todas sus tareas.')) {
      return;
    }

    this.projectService.deleteProject(id).subscribe({
      next: () => {
        this.loadProjects();
      },
      error: (error) => console.error('Error deleting project:', error)
    });
  }

  toggleArchive(project: Project): void {
    const action = project.is_archived ? 'desarchivar' : 'archivar';
    if (!confirm(`¿Estás seguro de ${action} este proyecto?`)) {
      return;
    }

    const updateData = { is_archived: !project.is_archived };
    this.projectService.updateProject(project.id, updateData).subscribe({
      next: () => {
        this.loadProjects();
      },
      error: (error) => console.error('Error toggling archive:', error)
    });
  }

  viewProject(projectId: number): void {
    this.router.navigate(['/tasks'], {
      queryParams: { project: projectId }
    });
  }

  closeModal(event?: Event): void {
    this.showModal = false;
    this.editingProject = null;
  }
}
