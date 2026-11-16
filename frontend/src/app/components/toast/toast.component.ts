import { Component, OnDestroy, OnInit } from '@angular/core';
import { Notification, NotificationService } from '../../services/notification.service';

import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';

interface Toast extends Notification {
  id: number;
}

@Component({
  selector: 'app-toast',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="toast-container" aria-live="polite">
      <div
        *ngFor="let toast of toasts; trackBy: trackById"
        class="toast"
        [ngClass]="'toast-' + toast.type"
        role="status"
      >
        <span class="toast-icon">{{ icons[toast.type] }}</span>
        <div class="toast-body">
          <strong class="toast-title" *ngIf="toast.title">{{ toast.title }}</strong>
          <p class="toast-message">{{ toast.message }}</p>
        </div>
        <button class="toast-close" (click)="dismiss(toast.id)" aria-label="Cerrar">✕</button>
      </div>
    </div>
  `,
  styles: [`
    .toast-container {
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 10002;
      display: flex;
      flex-direction: column;
      gap: 10px;
      max-width: calc(100vw - 40px);
      width: 360px;
    }

    .toast {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 14px 16px;
      background: var(--background-secondary, white);
      color: var(--text-primary, #333);
      border: 1px solid var(--border-color, #e0e0e0);
      border-left: 4px solid;
      border-radius: 8px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
      animation: slide-in 0.2s ease-out;
    }

    .toast-success { border-left-color: #2e7d32; }
    .toast-error { border-left-color: #c62828; }
    .toast-warning { border-left-color: #ed6c02; }
    .toast-info { border-left-color: #0288d1; }

    .toast-icon {
      font-size: 18px;
      line-height: 1.2;
    }

    .toast-body {
      flex: 1;
      min-width: 0;
    }

    .toast-title {
      display: block;
      margin-bottom: 2px;
      font-size: 14px;
    }

    .toast-message {
      margin: 0;
      font-size: 13px;
      word-wrap: break-word;
    }

    .toast-close {
      background: none;
      border: none;
      cursor: pointer;
      color: inherit;
      opacity: 0.6;
      font-size: 14px;
      padding: 0;
    }

    .toast-close:hover {
      opacity: 1;
    }

    @keyframes slide-in {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
  `]
})
export class ToastComponent implements OnInit, OnDestroy {
  toasts: Toast[] = [];

  readonly icons: Record<Notification['type'], string> = {
    success: '✅',
    error: '❌',
    warning: '⚠️',
    info: 'ℹ️'
  };

  private readonly duration = 4000;
  private nextId = 0;
  private subscription?: Subscription;

  constructor(private notificationService: NotificationService) {}

  ngOnInit(): void {
    this.subscription = this.notificationService.notifications$.subscribe(notification => {
      const toast: Toast = { ...notification, id: this.nextId++ };
      this.toasts.push(toast);
      setTimeout(() => this.dismiss(toast.id), this.duration);
    });
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
  }

  dismiss(id: number): void {
    this.toasts = this.toasts.filter(toast => toast.id !== id);
  }

  trackById(_: number, toast: Toast): number {
    return toast.id;
  }
}
