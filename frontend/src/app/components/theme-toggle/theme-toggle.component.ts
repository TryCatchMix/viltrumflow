// frontend/src/app/components/theme-toggle/theme-toggle.component.ts
import { Component, inject } from '@angular/core';
import { Theme, ThemeService } from '../../services/theme.service';

import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-theme-toggle',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="theme-toggle">
      <!-- Toggle simple (solo light/dark) -->
      <button
        class="toggle-button"
        (click)="toggleSimple()"
        [attr.aria-label]="'Cambiar a modo ' + (isDark() ? 'claro' : 'oscuro')"
        title="Cambiar tema">
        <svg *ngIf="!isDark()" class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <svg *ngIf="isDark()" class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <circle cx="12" cy="12" r="5" stroke-width="2"/>
          <line x1="12" y1="1" x2="12" y2="3" stroke-width="2" stroke-linecap="round"/>
          <line x1="12" y1="21" x2="12" y2="23" stroke-width="2" stroke-linecap="round"/>
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" stroke-width="2" stroke-linecap="round"/>
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" stroke-width="2" stroke-linecap="round"/>
          <line x1="1" y1="12" x2="3" y2="12" stroke-width="2" stroke-linecap="round"/>
          <line x1="21" y1="12" x2="23" y2="12" stroke-width="2" stroke-linecap="round"/>
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" stroke-width="2" stroke-linecap="round"/>
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </button>

      <!-- Selector completo (incluye auto) -->
      <div class="theme-selector" *ngIf="showFullSelector">
        <button
          *ngFor="let option of themeOptions"
          class="theme-option"
          [class.active]="currentTheme() === option.value"
          (click)="setTheme(option.value)">
          <span class="option-icon">{{ option.icon }}</span>
          <span class="option-label">{{ option.label }}</span>
        </button>
      </div>
    </div>
  `,
  styles: [`
    .theme-toggle {
      display: flex;
      align-items: center;
      gap: 1rem;
    }

    .toggle-button {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 2.5rem;
      height: 2.5rem;
      padding: 0;
      background: var(--background-secondary);
      border: 1px solid var(--border-color);
      border-radius: 0.5rem;
      cursor: pointer;
      transition: all 0.3s ease;
    }

    .toggle-button:hover {
      background: var(--background-tertiary);
      transform: scale(1.05);
    }

    .toggle-button:active {
      transform: scale(0.95);
    }

    .icon {
      width: 1.25rem;
      height: 1.25rem;
      color: var(--text-primary);
    }

    .theme-selector {
      display: flex;
      gap: 0.5rem;
      padding: 0.25rem;
      background: var(--background-secondary);
      border: 1px solid var(--border-color);
      border-radius: 0.5rem;
    }

    .theme-option {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 1rem;
      background: transparent;
      border: none;
      border-radius: 0.375rem;
      cursor: pointer;
      font-size: 0.875rem;
      color: var(--text-secondary);
      transition: all 0.2s ease;
    }

    .theme-option:hover {
      background: var(--background-tertiary);
      color: var(--text-primary);
    }

    .theme-option.active {
      background: var(--primary-color);
      color: white;
    }

    .option-icon {
      font-size: 1.125rem;
    }

    .option-label {
      font-weight: 500;
    }

    @media (max-width: 768px) {
      .theme-selector {
        position: absolute;
        top: 100%;
        right: 0;
        margin-top: 0.5rem;
        flex-direction: column;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
      }

      .theme-option {
        width: 100%;
        justify-content: flex-start;
      }
    }
  `]
})
export class ThemeToggleComponent {
  private themeService = inject(ThemeService);

  // Propiedad para mostrar selector completo o solo toggle
  showFullSelector = false;

  themeOptions = [
    { value: 'light' as Theme, icon: '☀️', label: 'Claro' },
    { value: 'dark' as Theme, icon: '🌙', label: 'Oscuro' },
    { value: 'auto' as Theme, icon: '🔄', label: 'Auto' }
  ];

  currentTheme = this.themeService.currentTheme;

  toggleSimple(): void {
    this.themeService.toggleTheme();
  }

  setTheme(theme: Theme): void {
    this.themeService.setTheme(theme);
  }

  isDark(): boolean {
    return this.themeService.isDark();
  }
}
