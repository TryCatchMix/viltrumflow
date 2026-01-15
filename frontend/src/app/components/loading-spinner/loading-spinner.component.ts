import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-loading-spinner',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="spinner-container" [class]="'size-' + size">
      <div class="spinner" [class]="type">
        <div class="spinner-inner" *ngIf="type === 'circle'"></div>
        <div class="spinner-dot" *ngIf="type === 'dots'">
          <div class="dot"></div>
          <div class="dot"></div>
          <div class="dot"></div>
        </div>
        <div class="spinner-bars" *ngIf="type === 'bars'">
          <div class="bar"></div>
          <div class="bar"></div>
          <div class="bar"></div>
          <div class="bar"></div>
          <div class="bar"></div>
        </div>
      </div>
      <p class="spinner-text" *ngIf="text">{{ text }}</p>
    </div>
  `,
  styles: [`
    .spinner-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 15px;
    }

    .spinner-container.size-small {
      --spinner-size: 24px;
    }

    .spinner-container.size-medium {
      --spinner-size: 40px;
    }

    .spinner-container.size-large {
      --spinner-size: 60px;
    }

    /* Circle Spinner */
    .spinner.circle {
      width: var(--spinner-size);
      height: var(--spinner-size);
      position: relative;
    }

    .spinner-inner {
      width: 100%;
      height: 100%;
      border: 3px solid #f3f3f3;
      border-top: 3px solid #667eea;
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }

    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }

    /* Dots Spinner */
    .spinner.dots {
      display: flex;
      gap: 8px;
      align-items: center;
    }

    .dot {
      width: calc(var(--spinner-size) / 3);
      height: calc(var(--spinner-size) / 3);
      background: #667eea;
      border-radius: 50%;
      animation: bounce 1.4s infinite ease-in-out both;
    }

    .dot:nth-child(1) {
      animation-delay: -0.32s;
    }

    .dot:nth-child(2) {
      animation-delay: -0.16s;
    }

    @keyframes bounce {
      0%, 80%, 100% {
        transform: scale(0);
        opacity: 0.5;
      }
      40% {
        transform: scale(1);
        opacity: 1;
      }
    }

    /* Bars Spinner */
    .spinner.bars {
      display: flex;
      gap: 4px;
      align-items: center;
      height: var(--spinner-size);
    }

    .bar {
      width: calc(var(--spinner-size) / 8);
      height: 100%;
      background: #667eea;
      border-radius: 2px;
      animation: stretch 1.2s infinite ease-in-out;
    }

    .bar:nth-child(1) {
      animation-delay: -1.2s;
    }

    .bar:nth-child(2) {
      animation-delay: -1.1s;
    }

    .bar:nth-child(3) {
      animation-delay: -1.0s;
    }

    .bar:nth-child(4) {
      animation-delay: -0.9s;
    }

    .bar:nth-child(5) {
      animation-delay: -0.8s;
    }

    @keyframes stretch {
      0%, 40%, 100% {
        transform: scaleY(0.4);
      }
      20% {
        transform: scaleY(1);
      }
    }

    .spinner-text {
      margin: 0;
      font-size: 14px;
      color: #666;
      font-weight: 500;
    }
  `]
})
export class LoadingSpinnerComponent {
  @Input() type: 'circle' | 'dots' | 'bars' = 'circle';
  @Input() size: 'small' | 'medium' | 'large' = 'medium';
  @Input() text: string = '';
}