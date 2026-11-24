import { expect, test } from '@playwright/test';
import { register } from './helpers';

test('diario de ánimo: registrar en «Hoy», cambiarlo y ver las conclusiones', async ({ browser }) => {
  const { page, api } = await register(browser, 'mood');

  // Registro rápido en «Hoy»
  await page.goto('/today');
  const card = page.locator('app-mood-checkin');
  await expect(card.getByText('¿Cómo estás hoy?')).toBeVisible();
  await expect(card.getByRole('button', { name: 'Guardar' })).toBeDisabled();
  await card.getByRole('radio', { name: /Bien/ }).click();
  await card.getByRole('radio', { name: /Alta/ }).click();
  await card.getByRole('button', { name: 'Ejercicio' }).click();
  await card.getByRole('button', { name: 'Añadir nota' }).click();
  await card.getByLabel('Nota del día').fill('Buen día de trabajo');
  await card.getByRole('button', { name: 'Guardar' }).click();
  await expect(card).toContainText('Hoy: bien · energía alta');
  await expect(card).toContainText('Ejercicio · Buen día de trabajo');

  // Cambiarlo
  await card.getByRole('button', { name: 'Cambiar' }).click();
  await expect(card.getByRole('radio', { name: /Bien/ })).toHaveAttribute('aria-checked', 'true');
  await card.getByRole('radio', { name: /Genial/ }).click();
  await card.getByRole('button', { name: 'Guardar' }).click();
  await expect(card).toContainText('Hoy: genial · energía alta');
  const log = await api<any>('GET', '/mood');
  expect(log.entries).toHaveLength(1);
  expect(log.entry_today).toMatchObject({ mood: 5, energy: 4, factors: ['exercise'], note: 'Buen día de trabajo' });

  // Unos días anteriores (se pueden rellenar hasta un mes atrás) para que haya conclusiones
  for (let i = 1; i <= 8; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const high = i % 2 === 0;
    await api('PUT', `/mood/${d.toLocaleDateString('sv')}`, { mood: high ? 4 : 2, energy: high ? 4 : 2, factors: high ? ['slept_well'] : ['slept_bad'] });
  }

  await page.getByRole('link', { name: 'Diario', exact: true }).click();
  await expect(page).toHaveURL(/\/journal/);
  await expect(page.locator('.tile', { hasText: 'Días registrados' }).locator('strong')).toHaveText('9');
  await expect(page.locator('.tile', { hasText: 'Racha de registro' }).locator('strong')).toHaveText('9');
  await expect(page.locator('.tile', { hasText: 'Ánimo medio' }).locator('strong')).toHaveText('3,2');
  await expect(page.getByText('Lo que dicen tus datos')).toBeVisible();
  await expect(page.locator('.findings')).toContainText('«Dormí mal» es lo que más cambia tu ánimo: 2 esos días frente a 4,2 el resto');
  await expect(page.locator('app-line-chart')).toBeVisible();
  await expect(page.locator('.cell.c5')).toHaveCount(1);
  await expect(page.locator('.cell.c2')).toHaveCount(4);
  await expect(page.locator('.notes')).toContainText('Buen día de trabajo');
  await expect(page.locator('table').first()).toContainText('Alta (4-5)');

  // En el propio diario no se repite el enlace «Ver diario»
  await expect(page.locator('app-mood-checkin').getByRole('link', { name: 'Ver diario' })).toHaveCount(0);
  await page.getByRole('button', { name: '90 días' }).click();
  await expect(page.locator('.tile', { hasText: 'Días registrados' })).toContainText('de los últimos 90');
});
