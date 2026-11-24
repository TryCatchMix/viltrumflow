import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

// Trazos de 24×24 (estilo outline). Varios subtrazos se separan con "|".
const ICONS: Record<string, string> = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  check: 'M9 11l3 3 8-8|M20 12v7a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h10',
  board: 'M4 4h5v16H4z|M10.5 4h5v10h-5z|M17 4h3v7h-3z',
  folder: 'M3 6a1 1 0 0 1 1-1h5l2 2.5h9a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z',
  note: 'M6 3h8l5 5v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z|M14 3v5h5|M9 13h6|M9 17h6',
  graph: 'M6 7a2 2 0 1 0 0-.01|M18 6a2 2 0 1 0 0-.01|M12 18a2.5 2.5 0 1 0 0-.01|M7.5 8.5l3.2 7|M16.6 7.7l-3.4 7.9|M8 6.6l8-.5',
  calendar: 'M4 6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z|M4 10h16|M8 3v4|M16 3v4',
  settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z|M19.4 13a7.6 7.6 0 0 0 0-2l2-1.5-2-3.4-2.3.9a7.6 7.6 0 0 0-1.7-1L15 3.5h-4l-.4 2.5a7.6 7.6 0 0 0-1.7 1l-2.3-.9-2 3.4 2 1.5a7.6 7.6 0 0 0 0 2l-2 1.5 2 3.4 2.3-.9a7.6 7.6 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7.6 7.6 0 0 0 1.7-1l2.3.9 2-3.4z',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z|M20 20l-4-4',
  plus: 'M12 5v14|M5 12h14',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z|M12 2v2|M12 20v2|M4.9 4.9l1.4 1.4|M17.7 17.7l1.4 1.4|M2 12h2|M20 12h2|M4.9 19.1l1.4-1.4|M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
  logout: 'M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4|M15 8l4 4-4 4|M19 12H9',
  trash: 'M4 7h16|M9 7V4h6v3|M6 7l1 13h10l1-13',
  x: 'M6 6l12 12|M18 6L6 18',
  pin: 'M9 4h6l-1 6 3 3H7l3-3z|M12 13v7',
  edit: 'M4 20h4L19 9l-4-4L4 16z|M13.5 6.5l4 4',
  eye: 'M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z|M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
  split: 'M4 5h16v14H4z|M12 5v14',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1|M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  left: 'M15 6l-6 6 6 6',
  right: 'M9 6l6 6-6 6',
  down: 'M6 9l6 6 6-6',
  menu: 'M4 7h16|M4 12h16|M4 17h16',
  sync: 'M20 11a8 8 0 0 0-14.5-4L4 9|M4 4v5h5|M4 13a8 8 0 0 0 14.5 4L20 15|M20 20v-5h-5',
  alert: 'M12 4l9 16H3z|M12 10v4|M12 17v.5',
  clock: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z|M12 8v4l3 2',
  tag: 'M4 4h7l9 9-7 7-9-9z|M8 8v.01',
  table: 'M4 5h16v14H4z|M4 10h16|M4 15h16|M10 5v14',
  repeat: 'M17 3l3 3-3 3|M4 11V9a3 3 0 0 1 3-3h13|M7 21l-3-3 3-3|M20 13v2a3 3 0 0 1-3 3H4',
  bell: 'M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z|M10 20a2 2 0 0 0 4 0',
  download: 'M12 4v11|M7 11l5 5 5-5|M5 20h14',
  upload: 'M12 16V5|M7 9l5-5 5 5|M5 20h14',
  users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z|M2.5 20a6.5 6.5 0 0 1 13 0|M16 4.5a3.5 3.5 0 0 1 0 6.5|M18 14.5a6.5 6.5 0 0 1 3.5 5.5',
  undo: 'M8 5L4 9l4 4|M4 9h10a5 5 0 0 1 0 10h-3',
  offline: 'M3 3l18 18|M5 12.5a10 10 0 0 1 3.5-2.3|M12 9a10 10 0 0 1 7 3.5|M8.5 16a5 5 0 0 1 3.5-1.5|M12 19.5v.01',
  image: 'M4 5h16v14H4z|M4 16l5-5 4 4 3-3 4 4|M15.5 9.5a1 1 0 1 0 0-.01',
  play: 'M8 5.5v13l10-6.5z',
  stop: 'M7 7h10v10H7z',
  history: 'M4 12a8 8 0 1 0 2.5-5.8L4 8.5|M4 4v4.5h4.5|M12 8v4l3 2',
  template: 'M5 4h14v5H5z|M5 12h6v8H5z|M14 12h5|M14 16h5|M14 20h5',
  flame: 'M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2 1-3.2 2-4 .2 1.6 1 2.4 2 2.6C10.5 9 11 6 12 3z',
  target: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z|M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z|M12 11.9v.2',
  shield: 'M12 3l7.5 3v6c0 4.5-3 7.6-7.5 9-4.5-1.4-7.5-4.5-7.5-9V6z',
  pause: 'M8 6v12|M16 6v12',
  skip: 'M6 6l8 6-8 6z|M17 6v12',
  lock: 'M7 11h10v8H7z|M9 11V8a3 3 0 0 1 6 0v3',
  coin: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z|M12 4a8 8 0 1 0 0 16|M9.5 9.2c.4-.9 1.4-1.4 2.5-1.4 1.5 0 2.5.8 2.5 1.9 0 2.4-5 1.4-5 4.1 0 1.2 1 2 2.5 2 1.2 0 2.1-.5 2.5-1.3|M12 6.5v1.3|M12 16.2v1.3',
  gift: 'M4 10h16v4H4z|M5.5 14h13v6h-13z|M12 10v10|M12 10c-1.5-3.5-5-4-5-1.8C7 10 12 10 12 10z|M12 10c1.5-3.5 5-4 5-1.8C17 10 12 10 12 10z',
  snow: 'M12 3v18|M4.2 7.5l15.6 9|M4.2 16.5l15.6-9|M9.5 4.5 12 7l2.5-2.5|M9.5 19.5 12 17l2.5 2.5',
  flag: 'M5 21V4|M5 4h11l-2 4 2 4H5',
  camera: 'M4 8a1 1 0 0 1 1-1h3l1.5-2h5L16 7h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z|M12 10a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  cards: 'M9 4h9a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z|M8 6.5 5.6 7.2a1 1 0 0 0-.7 1.2l2.9 10.8a1 1 0 0 0 1.2.7l2.5-.7',
  minus: 'M5 12h14',
  star: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z',
  smile: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z|M8.5 14.5c1.8 2 5.2 2 7 0|M9 9.5h.01|M15 9.5h.01',
  mountain: 'M2.5 20 9 8.5l3.5 6 2.5-4L21.5 20z|M7.4 11.4 9 12.8l1.6-1.4',
  share: 'M12 3v12|M8 7l4-4 4 4|M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7',
  panel: 'M4 5h16v14H4z|M15 5v14',
};

@Component({
  selector: 'app-icon',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<svg [attr.width]="size" [attr.height]="size" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    @for (d of paths; track $index) { <path [attr.d]="d" /> }
  </svg>`,
  styles: [':host { display: inline-flex; flex: none; }'],
})
export class IconComponent {
  @Input() size = 16;
  paths: string[] = [];
  @Input({ required: true }) set name(n: string) { this.paths = (ICONS[n] ?? '').split('|'); }
}
