import { Page, expect, test } from '@playwright/test';
import { noteItem, openNote, register, taskRow, toast, typeAtEnd } from './helpers';

/** El service worker se registra cuando la app está estable; hay que esperar a que controle la página. */
async function waitForServiceWorker(page: Page) {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(async () => {
    if (await page.evaluate(() => !!navigator.serviceWorker.controller)) return true;
    await page.reload();
    return false;
  }, { timeout: 45_000, intervals: [2000] }).toBe(true);
}

test('sin conexión: la app abre, las notas se guardan en el dispositivo y se sincronizan', async ({ browser }) => {
  const { page, context, api } = await register(browser);
  await api('POST', '/tasks', { title: 'Tarea ya consultada' });

  // Con conexión: se visita lo que luego se usará sin red
  await page.goto('/notes');
  await waitForServiceWorker(page);
  await openNote(page, 'Ideas');
  await page.goto('/tasks');
  await expect(taskRow(page, 'Tarea ya consultada')).toBeVisible();

  await context.setOffline(true);
  await page.goto('/tasks');  // recarga completa sin red
  await expect(page.getByRole('status').filter({ hasText: 'Sin conexión' })).toBeVisible();
  await expect(taskRow(page, 'Tarea ya consultada')).toBeVisible();

  // Modificar una tarea existente necesita red, y se avisa
  await taskRow(page, 'Tarea ya consultada').locator('.check').check();
  await expect(toast(page)).toContainText('Sin conexión: este cambio no se ha guardado');

  // Las notas sí: el texto se queda en el dispositivo
  await page.getByRole('link', { name: 'Notas' }).click();
  await openNote(page, 'Ideas');
  await typeAtEnd(page, '\nEscrito sin conexión.');
  await expect(page.locator('.status')).toHaveText('Sin conexión · guardado en este dispositivo');

  // …y sobrevive a cerrar y volver a abrir la app sin red
  await page.goto('/notes');
  await noteItem(page, 'Ideas').click();
  await expect(page.locator('.cm-content')).toContainText('Escrito sin conexión.');

  await context.setOffline(false);
  await expect.poll(async () => (await api('GET', '/notes/by-title/Ideas')).content).toContain('Escrito sin conexión.');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('vf-note-drafts'))).toBe('{}');
});

test('sin conexión: si la nota cambió en otro dispositivo, lo local se guarda como copia', async ({ browser, request }) => {
  const { page, context, api } = await register(browser);
  await page.goto('/notes');
  await waitForServiceWorker(page);
  await openNote(page, 'Bienvenido');

  await context.setOffline(true);
  await typeAtEnd(page, '\nVersión local.');
  await expect(page.locator('.status')).toContainText('Sin conexión');
  await page.getByRole('link', { name: 'Tareas' }).click();  // sale de la nota

  // Mientras este dispositivo sigue sin red, la nota cambia en el servidor
  const token = await page.evaluate(() => localStorage.getItem('vf-access'));
  const headers = { Authorization: `Bearer ${token}` };
  const note = await (await request.get('http://localhost:8010/api/v1/notes/by-title/Bienvenido', { headers })).json();
  await request.put(`http://localhost:8010/api/v1/notes/${note.id}`, { headers, data: { content: 'Cambiada en otro dispositivo' } });

  await context.setOffline(false);
  await expect(toast(page).filter({ hasText: 'se ha guardado como copia' })).toBeVisible();
  const copy = (await api('GET', '/notes')).find((n: any) => n.title === 'Bienvenido (copia sin conexión)');
  expect((await api('GET', `/notes/${copy.id}`)).content).toContain('Versión local.');
  expect((await api('GET', '/notes/by-title/Bienvenido')).content).toBe('Cambiada en otro dispositivo');
});

test('sin conexión: crear tareas y notas nuevas, que se envían al reconectar', async ({ browser }) => {
  const { page, context, api } = await register(browser);
  await page.goto('/tasks');
  await waitForServiceWorker(page);
  await page.goto('/notes');
  await openNote(page, 'Ideas');  // deja en caché la lista de notas
  await page.goto('/tasks');
  await expect(page.getByText('Todavía no hay tareas')).toBeVisible();

  await context.setOffline(true);
  await page.getByLabel('Añadir tarea rápida').fill('Comprar billetes mañana !alta #viaje');
  await page.keyboard.press('Enter');
  const row = taskRow(page, 'Comprar billetes');
  await expect(row).toContainText('pendiente');
  await expect(row.locator('.prio')).toHaveText('Alta');

  // se puede corregir antes de enviarla, y sobrevive a recargar sin red
  await row.click();
  await expect(page.locator('.drawer .ro')).toContainText('Creada sin conexión');
  await page.locator('.drawer .title').fill('Comprar billetes de tren');
  await page.locator('.drawer').getByRole('button', { name: 'Guardar' }).click();
  await page.goto('/tasks');
  await expect(taskRow(page, 'Comprar billetes de tren')).toContainText('pendiente');

  // nota nueva escrita sin red
  await page.getByRole('link', { name: 'Notas' }).click();
  await page.getByTitle('Nueva nota', { exact: true }).click();
  await expect(page).toHaveURL(/notes\/-\d+/);
  await page.locator('.cm-content').click();
  await page.keyboard.type('Idea apuntada en el tren, ver [[Ideas]]');
  await expect(page.locator('.status')).toHaveText('Guardado');
  await expect(noteItem(page, 'Sin título')).toContainText('pendiente');
  await expect(page.getByRole('status').filter({ hasText: 'Sin conexión' })).toBeVisible();

  await context.setOffline(false);
  await expect(toast(page).filter({ hasText: 'Sincronizados 2 elementos' })).toBeVisible();
  await expect(page).toHaveURL(/notes\/\d+$/);  // la nota abierta pasa a su id definitivo
  await expect(page.locator('.cm-content')).toContainText('Idea apuntada en el tren');

  const note = await api('GET', '/notes/by-title/Sin título');
  expect(note.content).toBe('Idea apuntada en el tren, ver [[Ideas]]');
  expect(note.outgoing[0].id).not.toBeNull();
  const tasks = await api('GET', '/tasks');
  expect(tasks).toHaveLength(1);
  expect(tasks[0]).toMatchObject({ title: 'Comprar billetes de tren', priority: 'high', tags: ['viaje'] });
  expect(tasks[0].due_date).not.toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('vf-outbox'))).toBe('{"tasks":[],"notes":[]}');
});
