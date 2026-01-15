import { Component, Input } from '@angular/core';

import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-skeleton-loader',
  standalone: true,
  imports: [CommonModule],
  template: `
    <!-- Card Skeleton -->
    <div class="skeleton-card" *ngIf="type === 'card'">
      <div class="skeleton skeleton-header"></div>
      <div class="skeleton skeleton-text"></div>
      <div class="skeleton skeleton-text short"></div>
      <div class="skeleton-footer">
        <div class="skeleton skeleton-avatar"></div>
        <div class="skeleton skeleton-badge"></div>
      </div>
    </div>

    <!-- List Item Skeleton -->
    <div class="skeleton-list-item" *ngIf="type === 'list-item'">
      <div class="skeleton skeleton-avatar"></div>
      <div class="skeleton-content">
        <div class="skeleton skeleton-text"></div>
        <div class="skeleton skeleton-text short"></div>
      </div>
    </div>

    <!-- Table Row Skeleton -->
    <div class="skeleton-table-row" *ngIf="type === 'table-row'">
      <div class="skeleton skeleton-cell"></div>
      <div class="skeleton skeleton-cell"></div>
      <div class="skeleton skeleton-cell"></div>
      <div class="skeleton skeleton-cell short"></div>
    </div>

    <!-- Custom Skeleton -->
    <div
      class="skeleton"
      *ngIf="type === 'custom'"
      [style.width]="width"
      [style.height]="height"
      [class.circle]="circle"
    ></div>
  `,
  styles: [`
    .skeleton {
      background: linear-gradient(
        90deg,
        #f0f0f0 0%,
        #f8f8f8 50%,
        #f0f0f0 100%
      );
      background-size: 200% 100%;
      animation: loading 1.5s ease-in-out infinite;
      border-radius: 4px;
    }

    .skeleton.circle {
      border-radius: 50%;
    }

    @keyframes loading {
      0% {
        background-position: 200% 0;
      }
      100% {
        background-position: -200% 0;
      }
    }

    /* Card Skeleton */
    .skeleton-card {
      background: white;
      padding: 20px;
      border-radius: 12px;
      display: flex;
      flex-direction: column;
      gap: 15px;
    }

    .skeleton-header {
      height: 24px;
      width: 60%;
    }

    .skeleton-text {
      height: 16px;
      width: 100%;
    }

    .skeleton-text.short {
      width: 80%;
    }

    .skeleton-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 10px;
    }

    .skeleton-avatar {
      width: 32px;
      height: 32px;
      border-radius: 50%;
    }

    .skeleton-badge {
      width: 60px;
      height: 24px;
      border-radius: 12px;
    }

    /* List Item Skeleton */
    .skeleton-list-item {
      display: flex;
      gap: 15px;
      padding: 15px;
      background: white;
      border-radius: 8px;
    }

    .skeleton-content {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    /* Table Row Skeleton */
    .skeleton-table-row {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 15px;
      padding: 15px;
      background: white;
      border-radius: 8px;
    }

    .skeleton-cell {
      height: 20px;
    }

    .skeleton-cell.short {
      width: 60%;
    }
  `]
})
export class SkeletonLoaderComponent {
  @Input() type: 'card' | 'list-item' | 'table-row' | 'custom' = 'card';
  @Input() width: string = '100%';
  @Input() height: string = '20px';
  @Input() circle: boolean = false;
}
