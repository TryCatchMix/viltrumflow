import { Injectable, signal } from '@angular/core';

export type Theme = 'light' | 'dark' | 'auto';
const KEY = 'vf-theme';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly theme = signal<Theme>((localStorage.getItem(KEY) as Theme) || 'auto');
  readonly effective = signal<'light' | 'dark'>('dark');
  private media = matchMedia('(prefers-color-scheme: light)');

  constructor() {
    this.apply();
    this.media.addEventListener('change', () => this.apply());
  }

  set(theme: Theme) {
    this.theme.set(theme);
    localStorage.setItem(KEY, theme);
    this.apply();
  }

  toggle() { this.set(this.effective() === 'dark' ? 'light' : 'dark'); }

  private apply() {
    const t = this.theme() === 'auto' ? (this.media.matches ? 'light' : 'dark') : (this.theme() as 'light' | 'dark');
    this.effective.set(t);
    document.documentElement.setAttribute('data-theme', t);
  }
}
