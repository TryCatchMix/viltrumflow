import { Injectable, NgZone, inject, signal } from '@angular/core';

const NUM: Record<string, number> = {
  una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12,
  trece: 13, catorce: 14, quince: 15, dieciseis: 16, dieciséis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19, veinte: 20,
  veintiuna: 21, veintiuno: 21, veintidos: 22, veintidós: 22, veintitres: 23, veintitrés: 23, media: 30,
};
const NUM_RE = Object.keys(NUM).join('|');
const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Pasa lo dictado al formato de la captura rápida. El reconocimiento de voz escribe como se habla
 * («a las diez y media», «prioridad alta», «etiqueta trabajo»), y la captura rápida entiende «a las 10:30», «!alta», «#trabajo».
 */
export function spokenToQuick(spoken: string): string {
  let s = ' ' + spoken.trim().replace(/[.。]+$/, '').replace(/\s+/g, ' ') + ' ';
  // «a las diez» → «a las 10»; «a la una» → «a las 1»
  s = s.replace(new RegExp(`\\ba (las?) (${NUM_RE})\\b`, 'gi'), (_m, _l, w) => `a las ${NUM[w.toLowerCase()]}`);
  // «a las 10 y media / y cuarto / menos cuarto / y 20»
  s = s.replace(/\ba las (\d{1,2}) y media\b/gi, 'a las $1:30')
    .replace(/\ba las (\d{1,2}) y cuarto\b/gi, 'a las $1:15')
    .replace(/\ba las (\d{1,2}) menos cuarto\b/gi, (_m, h) => `a las ${(Number(h) + 23) % 24}:45`)
    .replace(new RegExp(`\\ba las (\\d{1,2}) y (\\d{1,2}|${NUM_RE})\\b`, 'gi'),
      (_m, h, mm) => `a las ${h}:${pad(NUM[mm.toLowerCase()] ?? Number(mm))}`);
  // Prioridad
  s = s.replace(/\b(?:con )?prioridad (urgente|alta|media|baja)\b/gi, (_m, p) => `!${p.toLowerCase()}`)
    .replace(/\b(?:es )?urgente\b/gi, '!urgente')
    .replace(/\bimportante\b/gi, '!alta');
  // Etiquetas y proyecto
  s = s.replace(/\b(?:etiqueta|hashtag|almohadilla) ([\p{L}\d_-]+)/giu, (_m, t) => `#${t.toLowerCase()}`)
    .replace(/\ben el proyecto ([\p{L}\d_-]+)/giu, (_m, p) => `@${p}`);
  // Duración: «durante 15 minutos», «de una hora», «dura 2 horas»
  s = s.replace(new RegExp(`\\b(?:durante|dura|de) (\\d+|${NUM_RE}|un|una) (minutos?|horas?)\\b`, 'gi'), (_m, n, unit) => {
    const v = /^un[ao]?$/i.test(n) ? 1 : NUM[n.toLowerCase()] ?? Number(n);
    return unit.toLowerCase().startsWith('hora') ? `~${v}h` : `~${v}m`;
  });
  s = s.trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

type Recognition = {
  lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
};

/** Dictado con la Web Speech API del navegador (Chrome y Edge, también en Android; Safari desde iOS 14.5). */
@Injectable({ providedIn: 'root' })
export class VoiceService {
  private zone = inject(NgZone);
  private ctor = (window as unknown as Record<string, new () => Recognition>)['SpeechRecognition']
    ?? (window as unknown as Record<string, new () => Recognition>)['webkitSpeechRecognition'];
  readonly supported = !!this.ctor;
  readonly listening = signal(false);
  /** Texto provisional mientras se habla. */
  readonly interim = signal('');
  private current: Recognition | null = null;

  /** Escucha una frase y devuelve lo reconocido (cadena vacía si no se entendió nada). */
  listen(): Promise<string> {
    if (!this.ctor) return Promise.reject(new Error('Tu navegador no permite dictar por voz'));
    this.stop();
    return new Promise((resolve, reject) => {
      const rec = new this.ctor();
      rec.lang = 'es-ES';
      rec.interimResults = true;
      rec.continuous = false;
      rec.maxAlternatives = 1;
      let final = '';
      rec.onresult = e => this.zone.run(() => {
        let text = '';
        for (let i = 0; i < e.results.length; i++) {
          text += e.results[i][0].transcript;
          if (e.results[i].isFinal) final = text;
        }
        this.interim.set(text);
      });
      rec.onerror = e => this.zone.run(() => {
        this.reset();
        if (e.error === 'no-speech' || e.error === 'aborted') resolve('');
        else reject(new Error(e.error === 'not-allowed' || e.error === 'service-not-allowed'
          ? 'Permite el micrófono para dictar tareas' : 'No se pudo reconocer la voz'));
      });
      rec.onend = () => this.zone.run(() => { const text = (final || this.interim()).trim(); this.reset(); resolve(text); });
      this.current = rec;
      this.listening.set(true);
      this.interim.set('');
      rec.start();
    });
  }

  stop() { this.current?.stop(); }

  private reset() { this.current = null; this.listening.set(false); this.interim.set(''); }
}
