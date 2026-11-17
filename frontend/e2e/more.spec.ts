import { expect, test } from '@playwright/test';
import { noteItem, openNote, register, taskRow, toast, typeAtEnd } from './helpers';

test('plantillas: crear las de ejemplo y una nota a partir de una', async ({ browser }) => {
  const { page, api } = await register(browser);
  await page.goto('/notes');
  await page.getByTitle('Nueva nota desde plantilla').click();
  await page.getByRole('button', { name: 'Crear plantillas de ejemplo' }).click();
  await page.locator('.tpl .out', { hasText: 'Reunión' }).click();

  const today = new Date().toLocaleDateString('sv', { timeZone: 'Europe/Madrid' });
  await expect(page.locator('input.title')).toHaveValue(`Reunión ${today}`);
  const note = await api('GET', `/notes/by-title/${encodeURIComponent('Reunión ' + today)}`);
  expect(note.content).toContain(`# Reunión ${today}`);
  expect(note.content).toMatch(new RegExp(`\\*\\*Fecha:\\*\\* ${today} \\d{2}:\\d{2}`));
  expect(note.folder).toBe('');  // la nota nueva no se queda en la carpeta de plantillas
});

test('historial de versiones: ver una versión anterior y restaurarla', async ({ browser }) => {
  const { page, api } = await register(browser);
  await page.goto('/notes');
  await openNote(page, 'Ideas');
  const original = (await api('GET', '/notes/by-title/Ideas')).content;
  await typeAtEnd(page, '\nUn cambio del que me arrepiento.');
  await expect(page.locator('.status')).toHaveText('Guardado');

  await page.getByTitle('Historial de versiones').click();
  const modal = page.getByRole('dialog', { name: 'Historial de versiones' });
  await expect(modal.locator('ul li')).toHaveCount(1);
  await expect(modal.locator('.hview')).toContainText('Apunta aquí lo que se te ocurra');
  await expect(modal.locator('.hview')).not.toContainText('me arrepiento');
  await modal.getByRole('button', { name: 'Restaurar esta versión' }).click();
  await expect(toast(page)).toContainText('Versión restaurada');
  await expect(page.locator('.cm-content')).not.toContainText('me arrepiento');
  expect((await api('GET', '/notes/by-title/Ideas')).content).toBe(original);
  // lo que había antes de restaurar tampoco se pierde
  await page.getByTitle('Historial de versiones').click();
  await expect(modal.locator('ul li')).toHaveCount(2);
});

test('incrustar notas, enlaces a secciones, menciones sin enlazar y grafo local', async ({ browser }) => {
  const { page, api } = await register(browser);
  const filler = Array.from({ length: 40 }, (_, i) => `Línea ${i}`).join('\n\n');
  await api('POST', '/notes', { title: 'Manual', content: `# Manual\n\n${filler}\n\n## Instalación\n\nPaso único: ejecutar el instalador.\n\n## Otra\n\nfin` });
  await api('POST', '/notes', { title: 'Acta', content: 'Revisamos el manual entero.' });
  await api('POST', '/notes', { title: 'Guía', content: 'Resumen:\n\n![[Manual#Instalación]]\n\nVer [[Manual#Instalación]] y ![[No existe]]' });

  await page.goto('/notes');
  await openNote(page, 'Guía');
  await page.getByTitle('Lectura').click();
  // la sección incrustada muestra solo su contenido
  const box = page.locator('.read .embed-box');
  await expect(box).toContainText('Paso único: ejecutar el instalador.');
  await expect(box).not.toContainText('Línea 3');
  await expect(box).not.toContainText('fin');
  await expect(page.locator('.read .embed.missing')).toHaveText('No existe');

  // el enlace a la sección abre la nota y baja hasta el encabezado
  await page.locator('.read p a.wikilink', { hasText: 'Manual › Instalación' }).click();
  await expect(page.locator('input.title')).toHaveValue('Manual');
  await expect(page.locator('.read h2', { hasText: 'Instalación' })).toBeInViewport();

  // «Acta» nombra a Manual sin enlazarla
  const mention = page.locator('.side .mention');
  await expect(mention).toContainText('Revisamos el manual entero.');
  await expect(page.locator('.side svg.local .node')).toHaveCount(1);  // por ahora solo Guía
  await mention.getByRole('button', { name: 'Enlazar' }).click();
  await expect(mention).toHaveCount(0);
  await expect(page.locator('.side .back', { hasText: 'Acta' })).toBeVisible();
  expect((await api('GET', '/notes/by-title/Acta')).content).toBe('Revisamos el [[Manual|manual]] entero.');
  await expect(page.locator('.side svg.local .node')).toHaveCount(2);
  await page.locator('.side svg.local .node', { hasText: 'Acta' }).locator('circle.hit').click();
  await expect(page.locator('input.title')).toHaveValue('Acta');
});

test('calendario: vista semanal y arrastrar una tarea a otro día', async ({ browser }) => {
  const { page, api } = await register(browser);
  const day = (offset: number) => {
    const d = new Date(); d.setDate(d.getDate() + offset);
    return d.toLocaleDateString('sv', { timeZone: 'Europe/Madrid' });
  };
  // se parte del lunes de esta semana para no salir de la vista
  const monday = -((new Date(day(0) + 'T12:00:00').getDay() + 6) % 7);
  await api('POST', '/tasks', { title: 'Mover de día', due_date: `${day(monday)}T00:00:00Z` });
  await api('POST', '/tasks', { title: 'Con hora', all_day: false, due_date: new Date(`${day(monday + 1)}T09:30:00+01:00`).toISOString() });

  await page.goto('/calendar');
  await page.getByRole('button', { name: 'Semana' }).click();
  const cells = page.locator('.grid.week .cell');
  await expect(cells).toHaveCount(7);
  await expect(cells.nth(0).locator('.ev')).toHaveText('Mover de día');

  await cells.nth(0).locator('.ev').dragTo(cells.nth(3));
  await expect(cells.nth(3).locator('.ev')).toHaveText('Mover de día');
  await cells.nth(1).locator('.ev').dragTo(cells.nth(4));
  await expect(cells.nth(4).locator('.ev')).toContainText('Con hora');
  await expect.poll(async () => {
    const tasks = await api('GET', '/tasks');
    const moved = tasks.find((t: any) => t.title === 'Mover de día'), timed = tasks.find((t: any) => t.title === 'Con hora');
    return [moved.due_date.slice(0, 10), new Date(timed.due_date).toLocaleString('sv', { timeZone: 'Europe/Madrid' }).slice(0, 16)];
  }).toEqual([day(monday + 3), `${day(monday + 4)} 09:30`]);  // la que tenía hora la conserva

  await page.getByRole('button', { name: 'Semana siguiente' }).click();
  await expect(cells.locator('.ev')).toHaveCount(0);
  await page.getByRole('button', { name: 'Mes', exact: true }).click();
  await expect(page.locator('.grid .cell')).toHaveCount(42);
});

test('registro de tiempo: cronómetro, corrección manual y gráfico', async ({ browser }) => {
  const { page, api } = await register(browser);
  await api('POST', '/tasks', { title: 'Redactar informe', estimated_minutes: 120 });
  await page.goto('/tasks');
  await taskRow(page, 'Redactar informe').click();

  const section = page.locator('.drawer .timer');
  await expect(section.locator('.clock')).toHaveText('0 s');
  await section.getByRole('button', { name: 'Empezar' }).click();
  await expect(section.locator('.clock')).toHaveText(/^[1-9] s$/);  // corre
  await expect(taskRow(page, 'Redactar informe')).toContainText('en curso');
  await section.getByRole('button', { name: 'Parar' }).click();
  await expect(section.getByRole('button', { name: 'Empezar' })).toBeVisible();

  await section.getByLabel('Minutos dedicados').fill('150');
  await section.getByLabel('Minutos dedicados').press('Tab');
  await expect(section.locator('.clock')).toHaveText('2 h 30 min');
  await expect.poll(async () => (await api('GET', '/tasks'))[0].time_spent_seconds).toBe(9000);

  await page.goto('/dashboard');
  const panel = page.locator('.panel', { hasText: 'dedicado frente a estimado' });
  await expect(panel.locator('.bar')).toContainText('Redactar informe');
  await expect(panel.locator('.bar .value')).toHaveText('2.5/2');
});
