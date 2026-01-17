// frontend/src/app/services/theme.service.ts
import { Injectable, effect, signal } from '@angular/core';

export type Theme = 'light' | 'dark' | 'auto';

@Injectable({
  providedIn: 'root'
})
export class ThemeService {
  private readonly THEME_KEY = 'user-theme-preference';

  // Signal para el tema actual
  currentTheme = signal<Theme>(this.getInitialTheme());

  // Signal para el tema efectivo (resuelve 'auto' a 'light' o 'dark')
  effectiveTheme = signal<'light' | 'dark'>('light');

  constructor() {
    // Effect para aplicar el tema cuando cambie
    effect(() => {
      const theme = this.currentTheme();
      this.applyTheme(theme);
      this.saveThemePreference(theme);
    });

    // Escuchar cambios en las preferencias del sistema
    this.watchSystemTheme();
  }

  /**
   * Obtiene el tema inicial desde localStorage o preferencias del sistema
   */
  private getInitialTheme(): Theme {
    const saved = localStorage.getItem(this.THEME_KEY) as Theme;
    if (saved && ['light', 'dark', 'auto'].includes(saved)) {
      return saved;
    }
    return 'auto';
  }

  /**
   * Aplica el tema al documento
   */
  private applyTheme(theme: Theme): void {
    const root = document.documentElement;

    if (theme === 'auto') {
      const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      const effectiveTheme = systemPrefersDark ? 'dark' : 'light';
      root.setAttribute('data-theme', effectiveTheme);
      this.effectiveTheme.set(effectiveTheme);
    } else {
      root.setAttribute('data-theme', theme);
      this.effectiveTheme.set(theme);
    }
  }

  /**
   * Guarda la preferencia de tema en localStorage
   */
  private saveThemePreference(theme: Theme): void {
    localStorage.setItem(this.THEME_KEY, theme);
  }

  /**
   * Escucha cambios en las preferencias del sistema
   */
  private watchSystemTheme(): void {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    mediaQuery.addEventListener('change', (e) => {
      if (this.currentTheme() === 'auto') {
        this.applyTheme('auto');
      }
    });
  }

  /**
   * Cambia el tema
   */
  setTheme(theme: Theme): void {
    this.currentTheme.set(theme);
  }

  /**
   * Alterna entre light y dark (útil para toggle)
   */
  toggleTheme(): void {
    const current = this.effectiveTheme();
    this.setTheme(current === 'light' ? 'dark' : 'light');
  }

  /**
   * Obtiene el tema actual
   */
  getTheme(): Theme {
    return this.currentTheme();
  }

  /**
   * Verifica si está en modo oscuro
   */
  isDark(): boolean {
    return this.effectiveTheme() === 'dark';
  }
}
