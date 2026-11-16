import { expect, test } from '@playwright/test';
import { register, taskRow, toast } from './helpers';

test('tareas: alta rápida, edición, subtareas y comentarios', async ({ browser }) => {
  const { page, api } = await register(browser);
  await page.goto('/tasks');
  await page.getByLabel('Añadir tarea rápida').fill('Preparar informe');
  await page.keyboard.press('Enter');
  await taskRow(page, 'Preparar informe').click();

  const drawer = page.locator('.drawer');
  await drawer.locator('select[name=priority]').selectOption('urgent');
  await drawer.locator('input[name=tags]').fill('trabajo, Q4');
  await drawer.locator('input[name=sub]').fill('Reunir datos');
  await drawer.locator('input[name=sub]').press('Enter');
  await expect(drawer.locator('.sub')).toHaveCount(1);
  await drawer.locator('input[name=comment]').fill('Pedir cifras a ventas');
  await drawer.locator('input[name=comment]').press('Enter');
  await expect(drawer.locator('.comment')).toContainText('Pedir cifras a ventas');
  await drawer.getByRole('button', { name: 'Guardar' }).click();

  const row = taskRow(page, 'Preparar informe');
  await expect(row.locator('.prio')).toHaveText('Urgente');
  await expect(row.locator('.chip.tag')).toHaveText(['#trabajo', '#q4']);
  await expect(row.locator('.chip', { hasText: '0/1' })).toBeVisible();

  // completar la saca de «Abiertas»
  await row.locator('.check').check();
  await expect(row).toHaveCount(0);
  const [task] = await api('GET', '/tasks');
  expect(task.status).toBe('completed');
});

test('tarea recurrente con recordatorio: al completarla se crea la siguiente', async ({ browser }) => {
  const { page, api } = await register(browser);
  await page.goto('/tasks');
  await page.getByRole('button', { name: 'Nueva tarea' }).first().click();
  const drawer = page.locator('.drawer');
  await drawer.locator('.title').fill('Revisión semanal');
  await drawer.locator('input[name=day]').fill('2030-05-06');
  await drawer.locator('select[name=recurrence]').selectOption('weekly');
  await drawer.locator('select[name=reminder]').selectOption({ label: 'El día anterior a las 9:00' });
  await drawer.getByRole('button', { name: 'Crear tarea' }).click();

  await taskRow(page, 'Revisión semanal').locator('.check').check();
  await expect(toast(page)).toContainText('siguiente repetición');
  await expect.poll(async () =>
    (await api('GET', '/tasks')).map((t: any) => `${t.status} ${t.due_date.slice(0, 10)} ${t.reminder_minutes}`).sort(),
  ).toEqual(['completed 2030-05-06 1440', 'todo 2030-05-13 1440']);
});

test('tablero: arrastrar una tarjeta cambia su estado', async ({ browser }) => {
  const { page, api } = await register(browser);
  await api('POST', '/tasks', { title: 'Diseñar portada' });
  await page.goto('/kanban');

  const columns = page.locator('.col');
  const card = columns.nth(0).locator('.kcard', { hasText: 'Diseñar portada' });
  await card.dragTo(columns.nth(1).locator('.cards'));
  await expect(columns.nth(1).locator('.kcard', { hasText: 'Diseñar portada' })).toBeVisible();
  await expect.poll(async () => (await api('GET', '/tasks'))[0].status).toBe('in_progress');
});

test('panel de inicio y calendario muestran las tareas', async ({ browser }) => {
  const { page, api } = await register(browser);
  const today = new Date().toLocaleDateString('sv');  // AAAA-MM-DD en hora local
  await api('POST', '/tasks', { title: 'Entrega de hoy', due_date: `${today}T00:00:00Z` });
  await api('POST', '/tasks', { title: 'Atrasada', due_date: '2020-01-01T00:00:00Z' });

  await page.goto('/dashboard');
  await expect(page.locator('.tile', { hasText: 'Atrasadas' }).locator('strong')).toHaveText('1');
  await expect(page.locator('.tile', { hasText: 'Para hoy' }).locator('strong')).toHaveText('1');
  await expect(page.locator('app-line-chart svg').first()).toBeVisible();
  await page.getByRole('button', { name: 'Ver tabla' }).click();
  await expect(page.locator('.tbl tbody tr').first()).toContainText(today);

  await page.goto('/calendar');
  await expect(page.locator('.cell.today .ev')).toHaveText('Entrega de hoy');
  await expect(page.getByText('La integración no está configurada')).toBeVisible();
});
