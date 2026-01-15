import { BehaviorSubject } from 'rxjs';
import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class LoadingService {
  private loadingSubject = new BehaviorSubject<boolean>(false);
  public loading$ = this.loadingSubject.asObservable();

  private loadingCountSubject = new BehaviorSubject<number>(0);
  private loadingCount = 0;

  /**
   * Mostrar indicador de carga global
   */
  show(): void {
    this.loadingCount++;
    this.loadingCountSubject.next(this.loadingCount);
    this.loadingSubject.next(true);
  }

  /**
   * Ocultar indicador de carga global
   */
  hide(): void {
    this.loadingCount--;
    if (this.loadingCount < 0) {
      this.loadingCount = 0;
    }
    this.loadingCountSubject.next(this.loadingCount);

    if (this.loadingCount === 0) {
      this.loadingSubject.next(false);
    }
  }

  /**
   * Forzar ocultar todos los loaders
   */
  hideAll(): void {
    this.loadingCount = 0;
    this.loadingCountSubject.next(0);
    this.loadingSubject.next(false);
  }
}
