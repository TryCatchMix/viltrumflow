import { expect, test } from '@playwright/test';
import { register, toast } from './helpers';

const madrid = (offset = 0) => {
  const d = new Date(Date.now() + offset * 86_400_000);
  return d.toLocaleDateString('sv', { timeZone: 'Europe/Madrid' });
};

test('ritual del día: elegir prioridades por la mañana y cerrar el día por la noche', async ({ browser }) => {
  const { page, api } = await register(browser, 'plan');
  await api('PUT', '/auth/me', { timezone: 'Europe/Madrid' });
  await api('POST', '/tasks', { title: 'Enviar presupuesto', due_date: `${madrid()}T00:00:00Z` });
  await api('POST', '/tasks', { title: 'Factura atrasada', due_date: `${madrid(-2)}T00:00:00Z` });
  await api('POST', '/tasks', { title: 'Leer documentación', priority: 'high' });

  // En «Hoy» invita a planificar
  await page.goto('/today');
  await page.getByRole('link', { name: /Empieza el día/ }).click();
  await expect(page).toHaveURL(/\/plan/);
  await page.getByRole('tab', { name: 'Inicio' }).click();
  await expect(page.getByRole('heading', { name: 'Empieza el día' })).toBeVisible();

  await page.getByRole('button', { name: 'Elegir Enviar presupuesto como prioridad' }).click();
  await page.getByRole('button', { name: 'Elegir Factura atrasada como prioridad' }).click();
  await page.locator('summary', { hasText: 'Otras tareas abiertas' }).click();
  await page.getByRole('button', { name: 'Elegir Leer documentación como prioridad' }).click();
  await expect(page.locator('.slot.full')).toHaveCount(3);
  await expect(page.locator('.slot.full').nth(1)).toContainText('Atrasada');
  // Como mucho tres
  await page.getByLabel('Nueva prioridad').fill('Otra más');
  await expect(page.getByRole('button', { name: 'Añadir', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Quitar Leer documentación de las prioridades' }).click();
  await page.getByRole('button', { name: 'Añadir', exact: true }).click();
  await expect(page.locator('.slot.full').nth(2)).toContainText('Otra más');
  await page.getByLabel('Intención del día').fill('Terminar con calma');
  await page.getByRole('button', { name: 'Empezar el día' }).click();
  await expect(toast(page)).toContainText('¡A por el día!');
  await expect(page).toHaveURL(/\/today/);

  // «Hoy» muestra las prioridades y se pueden marcar
  const card = page.locator('.prios');
  await expect(card).toContainText('«Terminar con calma»');
  await expect(card.locator('.prio-item')).toHaveText([/Enviar presupuesto/, /Factura atrasada/, /Otra más/]);
  await card.locator('.prio-item', { hasText: 'Enviar presupuesto' }).locator('input').check();
  await expect.poll(async () => (await api<any[]>('GET', '/tasks')).find(t => t.title === 'Enviar presupuesto').status).toBe('completed');

  // Cierre: lo hecho, lo pendiente a mañana (menos lo que se marca como hecho) y la reflexión
  await page.goto('/plan?mode=close');
  await expect(page.getByRole('heading', { name: 'Cierra el día' })).toBeVisible();
  await expect(page.locator('.stat', { hasText: 'prioridades' })).toContainText('1/3');
  const pending = page.locator('.pick li', { has: page.getByRole('checkbox') });
  await expect(pending).toHaveCount(2);
  await page.locator('.pick li', { hasText: 'Otra más' }).getByRole('button', { name: 'Hecha' }).click();
  await expect(pending).toHaveCount(1);
  await page.getByLabel('Reflexión del día').fill('Buen avance');
  await page.getByRole('button', { name: 'Cerrar el día y pasar 1 a mañana' }).click();
  await expect(toast(page).filter({ hasText: 'Día cerrado' })).toContainText('1 tarea pasa a mañana');
  const late = (await api<any[]>('GET', '/tasks')).find(t => t.title === 'Factura atrasada');
  expect(late.due_date.slice(0, 10)).toBe(madrid(1));

  // Y propone dejar listo mañana
  await expect(page.getByRole('heading', { name: 'Prepara mañana' })).toBeVisible();
  await page.getByRole('button', { name: 'Elegir Factura atrasada como prioridad' }).click();
  await page.getByRole('button', { name: 'Dejar listo mañana' }).click();
  await expect(toast(page).filter({ hasText: 'Mañana ya está listo' })).toBeVisible();
  const tomorrow = await api<any>('GET', `/day-plan?day=${madrid(1)}`);
  expect(tomorrow.priorities.map((t: any) => t.title)).toEqual(['Factura atrasada']);
  const todayPlan = await api<any>('GET', '/day-plan');
  expect(todayPlan.reflection).toBe('Buen avance');
  expect(todayPlan.closed_at).toBeTruthy();
});

test('resumen de la mañana: activarlo en Ajustes y ver cómo sería hoy', async ({ browser }) => {
  const { page, api } = await register(browser, 'morn');
  await api('PUT', '/auth/me', { timezone: 'Europe/Madrid' });
  await api('POST', '/tasks', { title: 'Llamar al banco', due_date: `${madrid()}T00:00:00Z`, priority: 'high' });
  await page.goto('/settings#morning');
  await expect(page.getByLabel('Hora del resumen de la mañana')).toBeDisabled();
  await page.getByLabel('Activar el resumen de la mañana').check();
  await page.getByLabel('Hora del resumen de la mañana').selectOption({ label: '07:00' });
  await expect.poll(async () => (await api<any>('GET', '/auth/me')).morning_summary_hour).toBe(7);
  await page.getByRole('button', { name: 'Ver cómo sería hoy' }).click();
  await expect(page.locator('#morning .preview')).toHaveText('☀️ Hoy: 1 tarea (1 importante). Elige tus 3 prioridades.');
});
