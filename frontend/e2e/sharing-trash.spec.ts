import { expect, test } from '@playwright/test';
import { noteItem, openNote, register, taskRow, toast } from './helpers';

test('compartir un proyecto: permisos de lectura y edición, asignación y aviso', async ({ browser }) => {
  const ana = await register(browser, 'ana');
  const bea = await register(browser, 'bea');

  // Ana crea el proyecto y lo comparte con Bea en solo lectura
  await ana.page.goto('/projects');
  await ana.page.getByRole('button', { name: 'Nuevo proyecto' }).first().click();
  await ana.page.locator('.modal input[name=name]').fill('Lanzamiento');
  await ana.page.getByRole('button', { name: 'Guardar' }).click();
  await ana.page.getByTitle('Compartir proyecto').click();

  const who = ana.page.getByLabel('Nombre de usuario o email');
  await who.fill('nadie-con-este-nombre');
  await ana.page.getByRole('button', { name: 'Invitar' }).click();
  await expect(toast(ana.page).last()).toContainText('No hay ningún usuario');
  await who.fill(bea.username);
  await ana.page.locator('.invite select').selectOption('viewer');
  await ana.page.getByRole('button', { name: 'Invitar' }).click();
  await expect(ana.page.locator('.members li')).toHaveCount(2);
  await ana.page.getByRole('button', { name: 'Cerrar', exact: true }).click();

  // Ana crea una tarea asignada a Bea
  await ana.page.goto('/tasks');
  await ana.page.getByRole('button', { name: 'Nueva tarea' }).first().click();
  const drawer = ana.page.locator('.drawer');
  await drawer.locator('.title').fill('Preparar la demo');
  await drawer.locator('select[name=project]').selectOption({ label: 'Lanzamiento' });
  await drawer.locator('select[name=assignee]').selectOption({ label: bea.name });
  await drawer.getByRole('button', { name: 'Crear tarea' }).click();
  await expect(taskRow(ana.page, 'Preparar la demo')).toContainText(bea.name);

  // Bea recibe el aviso y la ve, pero no puede modificarla
  await bea.page.goto('/tasks');
  await expect(toast(bea.page)).toContainText('Te han asignado una tarea en «Lanzamiento»');
  const row = taskRow(bea.page, 'Preparar la demo');
  await expect(row.locator('.check')).toBeDisabled();
  await row.click();
  await expect(bea.page.locator('.drawer .ro')).toContainText('solo lectura');
  await expect(bea.page.locator('.drawer').getByRole('button', { name: 'Guardar' })).toBeDisabled();
  await bea.page.locator('.drawer input[name=comment]').fill('¿Para cuándo?');  // comentar sí puede
  await bea.page.locator('.drawer input[name=comment]').press('Enter');
  await expect(bea.page.locator('.drawer .comment')).toContainText('¿Para cuándo?');
  await bea.page.keyboard.press('Escape');

  // Las tareas privadas de Ana no se ven
  await ana.api('POST', '/tasks', { title: 'Privada de Ana' });
  await bea.page.reload();
  await expect(taskRow(bea.page, 'Preparar la demo')).toBeVisible();
  await expect(taskRow(bea.page, 'Privada de Ana')).toHaveCount(0);

  // Ana la pasa a editora: ahora sí puede completarla
  await ana.page.goto('/projects');
  await ana.page.getByTitle('Compartir proyecto').click();
  // Esperar a que el servidor guarde el cambio de permiso antes de que Bea recargue
  const saved = ana.page.waitForResponse(r => r.request().method() === 'PUT' && /\/members\/\d+$/.test(r.url()) && r.ok());
  await ana.page.locator('.members select').selectOption('editor');
  await saved;
  await expect(toast(ana.page)).toHaveCount(0);
  await bea.page.reload();
  await taskRow(bea.page, 'Preparar la demo').locator('.check').check();
  await expect.poll(async () => (await ana.api('GET', '/tasks?include_archived=true'))
    .find((t: any) => t.title === 'Preparar la demo').status).toBe('completed');

  // Bea sale del proyecto y deja de verlo
  await bea.page.goto('/projects');
  await expect(bea.page.locator('.proj')).toContainText('Puede editar');
  await bea.page.getByTitle('Ver quién tiene acceso').click();
  await bea.page.getByRole('button', { name: 'Salir del proyecto' }).click();
  await expect(bea.page.locator('.proj')).toHaveCount(0);
});

test('papelera: restaurar y eliminar definitivamente', async ({ browser }) => {
  const { page, api } = await register(browser);
  await api('POST', '/tasks', { title: 'Tarea para borrar' });

  await page.goto('/tasks');
  await taskRow(page, 'Tarea para borrar').click();
  await page.getByTitle('Eliminar tarea').click();
  await expect(taskRow(page, 'Tarea para borrar')).toHaveCount(0);

  await page.goto('/notes');
  await openNote(page, 'Ideas');
  await page.getByTitle('Eliminar nota').click();
  await expect(noteItem(page, 'Ideas')).toHaveCount(0);

  await page.goto('/trash');
  const items = page.locator('.item');
  await expect(items).toHaveCount(2);

  await items.filter({ hasText: 'Ideas' }).getByRole('button', { name: 'Restaurar' }).click();
  await expect(toast(page)).toContainText('Nota restaurada como «Ideas»');
  await items.filter({ hasText: 'Tarea para borrar' }).getByTitle(/Eliminar definitivamente/).click();
  await expect(page.getByText('La papelera está vacía')).toBeVisible();

  expect((await api('GET', '/notes')).map((n: any) => n.title)).toContain('Ideas');
  expect(await api('GET', '/tasks?include_archived=true')).toEqual([]);
});

test('importar y exportar notas', async ({ browser }) => {
  const { page, api } = await register(browser);
  await page.goto('/settings');

  await page.locator('input[type=file]').setInputFiles([
    { name: 'Mapa.md', mimeType: 'text/markdown', buffer: Buffer.from('---\ntags: [importada]\n---\nVer [[Libro]]') },
    { name: 'Libro.md', mimeType: 'text/markdown', buffer: Buffer.from('Vuelve a [[Mapa]]') },
  ]);
  await expect(page.getByRole('status').filter({ hasText: 'creadas' })).toContainText('2 creadas · 0 actualizadas · 0 omitidas');
  const mapa = await api('GET', '/notes/by-title/Mapa');
  expect(mapa.tags).toEqual(['importada']);
  expect(mapa.outgoing[0].id).not.toBeNull();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /Exportar todas las notas/ }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^viltrumflow-notas-\d{4}-\d{2}-\d{2}\.zip$/);
});
