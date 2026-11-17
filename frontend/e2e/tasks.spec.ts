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

test('captura rápida en lenguaje natural y casilla convertida en tarea', async ({ browser }) => {
  const { page, api } = await register(browser);
  await api('POST', '/projects', { name: 'Web corporativa' });
  await api('POST', '/notes', { title: 'Plan', content: '- [ ] Pedir presupuesto el viernes !alta\n- [ ] otra cosa' });

  await page.goto('/tasks');
  const quick = page.getByLabel('Añadir tarea rápida');
  await quick.fill('Llamar a Juan mañana a las 10 #trabajo !urgente @web cada semana');
  const preview = page.locator('.preview');
  await expect(preview).toContainText('Llamar a Juan');
  await expect(preview).toContainText('Mañana 10:00');
  await expect(preview).toContainText('Web corporativa');
  await quick.press('Enter');
  await expect(taskRow(page, 'Llamar a Juan')).toBeVisible();
  const created = (await api('GET', '/tasks')).find((t: any) => t.title === 'Llamar a Juan');
  expect(created).toMatchObject({ priority: 'urgent', tags: ['trabajo'], recurrence: 'weekly', all_day: false });
  expect(created.project_id).not.toBeNull();
  // las 10:00 en la zona horaria del navegador de la prueba
  expect(new Date(created.due_date).toLocaleTimeString('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' })).toBe('10:00');

  // una casilla de una nota pasa a ser tarea, con su fecha y prioridad interpretadas
  await page.getByRole('tab', { name: /Casillas de notas/ }).click();
  await page.locator('.task', { hasText: 'Pedir presupuesto' }).hover();
  await page.locator('.task', { hasText: 'Pedir presupuesto' }).getByRole('button', { name: 'Convertir en tarea' }).click();
  await expect(toast(page)).toContainText('Tarea creada: Pedir presupuesto');
  await expect(page.locator('.task', { hasText: 'Pedir presupuesto' })).toHaveCount(0);
  const converted = (await api('GET', '/tasks')).find((t: any) => t.title === 'Pedir presupuesto');
  expect(converted).toMatchObject({ priority: 'high', note_title: 'Plan' });
  expect(converted.due_date).not.toBeNull();
  expect((await api('GET', '/notes/by-title/Plan')).content).toContain('- Pedir presupuesto el viernes !alta *(convertida en tarea)*');

  // la nota muestra su tarea y la tarea enlaza a la nota
  await page.goto(`/notes/${converted.note_id}`);
  await page.locator('.side .out', { hasText: 'Pedir presupuesto' }).click();
  await expect(page.locator('.drawer .from')).toContainText('Viene de la nota «Plan»');
});
