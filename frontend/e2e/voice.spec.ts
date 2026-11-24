import { expect, test } from '@playwright/test';
import { parseQuick } from '../src/app/core/quick-parse';
import { spokenToQuick } from '../src/app/core/voice';
import { register } from './helpers';

const NOW = new Date(2025, 10, 12, 10, 0);  // miércoles 12 de noviembre de 2025, 10:00
const heard = (s: string) => parseQuick(spokenToQuick(s), NOW);

test('dictado: lo que se dice se entiende como en la captura rápida', () => {
  expect(heard('llamar al dentista mañana a las diez')).toMatchObject({ title: 'Llamar al dentista', day: '2025-11-13', time: '10:00' });
  expect(heard('Reunión con Ana el viernes a las cinco y media de la tarde.')).toMatchObject({ title: 'Reunión con Ana', day: '2025-11-14', time: '17:30' });
  expect(heard('pagar el alquiler a las 9 y cuarto')).toMatchObject({ title: 'Pagar el alquiler', time: '09:15' });
  expect(heard('salir a las 10 menos cuarto')).toMatchObject({ title: 'Salir', time: '09:45' });
  expect(heard('enviar informe hoy prioridad alta etiqueta trabajo')).toMatchObject({ title: 'Enviar informe', day: '2025-11-12', priority: 'high', tags: ['trabajo'] });
  expect(heard('renovar el DNI es urgente')).toMatchObject({ title: 'Renovar el DNI', priority: 'urgent' });
  expect(heard('estudiar inglés durante 45 minutos')).toMatchObject({ title: 'Estudiar inglés', estimate: 45 });
  expect(heard('preparar la presentación de una hora')).toMatchObject({ title: 'Preparar la presentación', estimate: 60 });
  expect(heard('regar las plantas cada semana')).toMatchObject({ title: 'Regar las plantas', recurrence: 'weekly' });
  expect(spokenToQuick('comprar pan')).toBe('Comprar pan');
});

/** Sustituye el reconocimiento de voz del navegador por uno que «oye» la frase indicada. */
const fakeSpeech = (phrase: string) => `
  window.webkitSpeechRecognition = class {
    start() {
      setTimeout(() => {
        const r = [{ transcript: ${JSON.stringify(phrase)} }]; r.isFinal = true;
        this.onresult && this.onresult({ results: [r] });
        this.onend && this.onend();
      }, 200);
    }
    stop() {} abort() {}
  };
  window.SpeechRecognition = window.webkitSpeechRecognition;`;

test('micrófono en Tareas y en Hoy: crea la tarea con fecha y hora', async ({ browser }) => {
  const { context, page, api } = await register(browser, 'voz');
  await context.addInitScript(fakeSpeech('llamar al dentista mañana a las diez y media prioridad alta'));
  await page.goto('/tasks');
  await page.getByRole('button', { name: 'Dictar tarea por voz' }).click();
  await expect(page.getByLabel('Añadir tarea rápida')).toHaveValue('Llamar al dentista mañana a las 10:30 !alta');
  await expect(page.locator('.preview')).toContainText('Llamar al dentista');
  await page.getByRole('button', { name: 'Añadir', exact: true }).click();
  await expect(page.getByLabel('Añadir tarea rápida')).toHaveValue('');
  await expect.poll(async () => (await api<any[]>('GET', '/tasks')).map(t => t.title)).toContain('Llamar al dentista');
  const t = (await api<any[]>('GET', '/tasks')).find(x => x.title === 'Llamar al dentista');
  expect(t.priority).toBe('high');
  expect(t.all_day).toBe(false);
  // La hora se comprueba en la zona del navegador (Europe/Madrid), no en la del proceso de pruebas
  const local = (iso: string, plusDays = 0) => page.evaluate(([iso, n]) => {
    const d = new Date(iso as string), ref = new Date(); ref.setDate(ref.getDate() + (n as number));
    return [d.getDate() === ref.getDate(), d.getHours(), d.getMinutes()];
  }, [iso, plusDays] as const);
  expect(await local(t.due_date, 1)).toEqual([true, 10, 30]);

  // En «Hoy», sin día en lo dicho, la tarea es para hoy (con su hora)
  await context.addInitScript(fakeSpeech('sacar al perro a las siete de la tarde'));
  await page.goto('/today');
  await page.getByRole('button', { name: 'Dictar tarea por voz' }).click();
  await expect(page.getByLabel('Añadir tarea para hoy')).toHaveValue('Sacar al perro a las 7 de la tarde');
  await page.getByRole('button', { name: 'Añadir', exact: true }).click();
  await expect(page.locator('.item', { hasText: 'Sacar al perro' })).toBeVisible();
  const dog = (await api<any[]>('GET', '/tasks')).find(x => x.title === 'Sacar al perro');
  expect(await local(dog.due_date)).toEqual([true, 19, 0]);
});

test('sin reconocimiento de voz en el navegador no aparece el micrófono', async ({ browser }) => {
  const { context, page } = await register(browser, 'nomic');
  await context.addInitScript('delete window.webkitSpeechRecognition; delete window.SpeechRecognition;');
  await page.goto('/tasks');
  await expect(page.getByLabel('Añadir tarea rápida')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Dictar tarea por voz' })).toHaveCount(0);
});
