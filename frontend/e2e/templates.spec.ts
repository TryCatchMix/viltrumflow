import { expect, test } from '@playwright/test';
import { register, toast } from './helpers';

test('plantillas de proyecto: crear desde un ejemplo, guardar uno propio y editarlo', async ({ browser }) => {
  const { page, api } = await register(browser, 'tpl');
  await api('POST', '/goals', { title: 'Cambiar de casa' });

  await page.goto('/projects');
  await page.getByRole('button', { name: 'Desde plantilla' }).click();
  const dialog = page.getByRole('dialog', { name: 'Plantillas de proyecto' });
  await dialog.getByRole('button', { name: /Mudanza/ }).click();
  await dialog.getByLabel('Nombre del proyecto').fill('Mudanza a Valencia');
  await dialog.getByLabel('Día de inicio').fill('2027-03-15');
  await expect(dialog.locator('.preview li', { hasText: 'Día de la mudanza' })).toContainText('15 mar');
  await expect(dialog.locator('.preview li', { hasText: 'Pedir presupuestos' })).toContainText('13 feb');
  await dialog.getByLabel('Objetivo (opcional)').selectOption({ label: 'Cambiar de casa' });
  await dialog.getByRole('button', { name: 'Crear proyecto' }).click();
  await expect(toast(page)).toContainText('Proyecto «Mudanza a Valencia» creado con 9 tareas');
  await expect(page).toHaveURL(/\/tasks\?project=\d+/);
  await expect(page.getByText('Día de la mudanza')).toBeVisible();
  const goals = await api<any[]>('GET', '/goals');
  expect(goals[0].progress.tasks_total).toBe(9);

  // Guardar un proyecto propio como plantilla y editarla
  const p = await api<any>('POST', '/projects', { name: 'Oposición', color: '#2a78d6' });
  await api('POST', '/tasks', { title: 'Temario', project_id: p.id, due_date: '2027-01-01T00:00:00Z' });
  await api('POST', '/tasks', { title: 'Simulacro', project_id: p.id, due_date: '2027-01-15T00:00:00Z' });
  await page.goto('/projects');
  await page.getByRole('button', { name: 'Guardar Oposición como plantilla' }).click();
  await expect(toast(page).filter({ hasText: 'guardado como plantilla' })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Editar plantilla' })).toBeVisible();
  await expect(dialog.getByLabel('Día de la tarea 2')).toHaveValue('14');
  await dialog.getByRole('button', { name: 'Añadir tarea' }).click();
  await dialog.getByLabel('Tarea 3', { exact: true }).fill('Examen');
  await dialog.getByLabel('Día de la tarea 3').fill('30');
  await dialog.getByLabel('Subtareas de la tarea 3').fill('DNI; Bolígrafos');
  await dialog.getByRole('button', { name: 'Guardar plantilla' }).click();
  await expect(dialog.getByRole('heading', { name: 'Plantillas de proyecto' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Oposición.*3 tareas/ })).toBeVisible();
  const tpls = await api<any>('GET', '/project-templates');
  expect(tpls.mine[0].tasks[2]).toMatchObject({ title: 'Examen', offset_days: 30, subtasks: ['DNI', 'Bolígrafos'] });

  // Un ejemplo se puede copiar para adaptarlo
  await dialog.getByRole('button', { name: /Viaje/ }).click();
  await dialog.getByRole('button', { name: 'Hacer una copia editable' }).click();
  await expect(dialog.getByLabel('Nombre', { exact: true })).toHaveValue('Viaje');
  await dialog.getByRole('button', { name: 'Cancelar' }).click();
  await expect(dialog.locator('button.pick', { hasText: 'Viaje' })).toHaveCount(2);  // el ejemplo y tu copia
  await expect(dialog.getByRole('button', { name: 'Editar Viaje' })).toBeVisible();
});

test('diario: aviso por la tarde en Ajustes y ánimo en la revisión semanal', async ({ browser }) => {
  const { page, api } = await register(browser, 'mrem');
  await page.goto('/journal');
  await page.getByRole('link', { name: 'Activa un aviso por la tarde' }).click();
  await expect(page).toHaveURL(/\/settings#mood/);
  await expect(page.getByLabel('Hora del aviso del diario')).toBeDisabled();
  await page.getByLabel('Activar el aviso del diario').check();
  await page.getByLabel('Hora del aviso del diario').selectOption({ label: '20:00' });
  await expect.poll(async () => (await api<any>('GET', '/auth/me')).mood_reminder_hour).toBe(20);
  expect((await api<any>('GET', '/auth/me')).mood_reminder).toBe(true);
  await page.goto('/journal');
  await expect(page.locator('.remind')).toContainText('Aviso por la tarde a las 20:00');

  const today = new Date().toLocaleDateString('sv');
  await api('PUT', `/mood/${today}`, { mood: 4, energy: 3 });
  await page.goto('/review');
  await expect(page.locator('.page-head p')).toContainText('Del ');
  const tile = page.locator('.tile', { hasText: 'Ánimo medio' });
  if (await tile.locator('strong').innerText() === '—') await page.getByRole('button', { name: 'Semana siguiente' }).click();
  await expect(tile.locator('strong')).toHaveText('4');
  await expect(tile).toContainText('1 día · energía 3');
});
