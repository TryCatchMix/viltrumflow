import { Component, inject, input, output } from '@angular/core';
import { ToastService } from '../core/toast.service';
import { VoiceService, spokenToQuick } from '../core/voice';
import { IconComponent } from './icon.component';

/** Botón de micrófono: dicta una tarea y emite el texto ya en formato de captura rápida. Oculto si el navegador no dicta. */
@Component({
  selector: 'app-voice-button',
  standalone: true,
  imports: [IconComponent],
  template: `
  @if (voice.supported) {
    <button type="button" class="btn ghost icon sm mic" [class.on]="voice.listening()" (click)="toggle()"
      [attr.aria-label]="voice.listening() ? 'Dejar de escuchar' : raw() ? 'Dictar por voz' : 'Dictar tarea por voz'" [attr.aria-pressed]="voice.listening()"
      [title]="voice.listening() ? 'Escuchando… pulsa para terminar' : raw() ? 'Dictar por voz: «leche, pan y huevos»' : 'Dictar por voz: «Llamar al dentista mañana a las 10»'">
      <app-icon name="mic" />
    </button>
  }`,
  styles: [`
    .mic.on { color: var(--on-accent); background: var(--critical); animation: pulse 1.2s ease-in-out infinite; }
    @keyframes pulse { 50% { box-shadow: 0 0 0 6px color-mix(in srgb, var(--critical) 25%, transparent); } }
    @media (prefers-reduced-motion: reduce) { .mic.on { animation: none; } }
  `],
})
export class VoiceButtonComponent {
  voice = inject(VoiceService);
  private toast = inject(ToastService);
  /** Emite lo dicho tal cual (sin pasarlo al formato de tareas), p. ej. para listas. */
  readonly raw = input(false);
  readonly heard = output<string>();

  toggle() {
    if (this.voice.listening()) { this.voice.stop(); return; }
    this.voice.listen().then(
      text => { if (text) this.heard.emit(this.raw() ? text : spokenToQuick(text)); else this.toast.show('No te he oído. Prueba otra vez.', 'info'); },
      e => this.toast.error(e instanceof Error ? e.message : e),
    );
  }
}
