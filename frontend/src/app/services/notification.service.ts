import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

export type NotificationType = 'success' | 'error' | 'warning' | 'info';

export interface Notification {
  type: NotificationType;
  message: string;
  title?: string;
}

@Injectable({
  providedIn: 'root'
})
export class NotificationService {
  private notificationSubject = new Subject<Notification>();
  public notifications$ = this.notificationSubject.asObservable();

  success(message: string, title?: string): void {
    this.notify('success', message, title);
  }

  error(message: string, title?: string): void {
    this.notify('error', message, title);
  }

  warning(message: string, title?: string): void {
    this.notify('warning', message, title);
  }

  info(message: string, title?: string): void {
    this.notify('info', message, title);
  }

  private notify(type: NotificationType, message: string, title?: string): void {
    this.notificationSubject.next({ type, message, title });
  }
}
