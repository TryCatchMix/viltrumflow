import { ChangeDetectionStrategy, Component, ElementRef, EventEmitter, HostListener, Input, OnChanges, Output, inject } from '@angular/core';
import { AttachmentService } from '../core/attachment.service';
import { renderMarkdown } from './markdown';

/** Vista de lectura: pinta el Markdown ya saneado y delega los clics en enlaces, etiquetas y casillas. */
@Component({
  selector: 'app-markdown',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
  host: { class: 'md' },
  styles: [':host { display: block; }'],
})
export class MarkdownViewComponent implements OnChanges {
  private el = inject(ElementRef<HTMLElement>);
  private attachments = inject(AttachmentService);
  @Input() content = '';
  /** Títulos existentes en minúsculas. */
  @Input() titles: Set<string> = new Set();
  @Output() openLink = new EventEmitter<string>();
  @Output() openTag = new EventEmitter<string>();
  @Output() toggle = new EventEmitter<{ line: number; checked: boolean }>();

  ngOnChanges() {
    // Seguro: renderMarkdown devuelve HTML pasado por DOMPurify
    this.el.nativeElement.innerHTML = renderMarkdown(this.content, t => this.titles.has(t.toLowerCase()));
    (this.el.nativeElement as HTMLElement).querySelectorAll<HTMLImageElement>('img[data-attachment]').forEach(img => {
      this.attachments.objectUrl(img.dataset['attachment']!).then(url => (img.src = url), () => img.classList.add('broken'));
    });
  }

  @HostListener('click', ['$event'])
  @HostListener('keydown.enter', ['$event'])
  onClick(e: Event) {
    const target = e.target as HTMLElement;
    const link = target.closest<HTMLElement>('a.wikilink');
    if (link) { e.preventDefault(); this.openLink.emit(link.dataset['title']!); return; }
    const tag = target.closest<HTMLElement>('a.hashtag');
    if (tag) { e.preventDefault(); this.openTag.emit(tag.dataset['tag']!); return; }
    if (e.type === 'click' && target instanceof HTMLInputElement && target.dataset['line']) {
      this.toggle.emit({ line: Number(target.dataset['line']), checked: target.checked });
    }
  }
}
