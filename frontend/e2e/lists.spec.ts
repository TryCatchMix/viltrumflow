import { expect, test } from '@playwright/test';
import { register, toast } from './helpers';

test('lista de la compra: añadir varios, marcar, quitar lo comprado y «lo de siempre»', async ({ browser }) => {
  const { page, api } = await register(browser, 'lst');
  await page.getByRole('link', { name: 'Listas', exact: true }).click();
  await page.getByRole('button', { name: 'Crear «Compra»' }).click();
  await expect(page).toHaveURL(/\/lists\/\d+/);
  await expect(page.getByRole('heading', { name: 'Compra' })).toBeVisible();

  await page.getByLabel('Añadir a la lista').fill('leche, pan, huevos');
  await page.getByRole('button', { name: 'Añadir', exact: true }).click();
  const pending = page.locator('ul.items:not(.done) li label');
  await expect(pending).toHaveText(['huevos', 'pan', 'leche']);
  await expect(page.locator('.title p')).toContainText('3 por hacer');

  await pending.filter({ hasText: 'pan' }).getByRole('checkbox').check();
  await pending.filter({ hasText: 'leche' }).getByRole('checkbox').check();
  await expect(page.locator('ul.items.done li')).toHaveCount(2);
  await page.getByRole('button', { name: 'Quitar lo marcado' }).click();
  await expect(page.locator('ul.items.done li')).toHaveCount(0);
  await expect(pending).toHaveText(['huevos']);
  // Lo comprado se recuerda y vuelve con un toque
  await page.locator('.sugg').getByRole('button', { name: '+ pan' }).click();
  await expect(pending).toHaveText(['pan', 'huevos']);
  await expect(page.locator('.sugg').getByRole('button', { name: '+ pan' })).toHaveCount(0);

  // En el listado se ve lo pendiente
  await page.getByRole('link', { name: 'Listas' }).first().click();
  await expect(page.locator('.lcard', { hasText: 'Compra' })).toContainText('2 por hacer de 2');
  // Crear otra vez «Compra» abre la existente en vez de duplicarla
  await page.getByRole('button', { name: 'Nueva lista' }).click();
  await page.locator('.preset', { hasText: 'Compra' }).click();
  await expect(page.getByRole('heading', { name: 'Compra' })).toBeVisible();
  expect((await api<any[]>('GET', '/lists')).length).toBe(1);
});

test('maleta: plantilla con elementos, desmarcar todo y compartir con otra persona', async ({ browser }) => {
  const other = await register(browser, 'pareja');
  const { page } = await register(browser, 'viaje');
  await page.goto('/lists');
  await page.getByRole('button', { name: 'Nueva lista' }).click();
  await page.locator('.preset', { hasText: 'Maleta' }).click();
  const pending = page.locator('ul.items:not(.done) li label');
  await expect(pending).toHaveCount(7);
  for (const item of ['Cargador del móvil', 'DNI o pasaporte']) await pending.filter({ hasText: item }).getByRole('checkbox').check();
  await expect(page.locator('ul.items.done li')).toHaveCount(2);
  await page.getByRole('button', { name: 'Desmarcar todo' }).click();
  await expect(pending).toHaveCount(7);

  await page.getByRole('button', { name: 'Compartir Maleta' }).click();
  await page.getByLabel('Nombre de usuario o email').fill(other.username);
  await page.getByRole('button', { name: 'Invitar' }).click();
  await expect(toast(page)).toContainText('Lista compartida');
  await page.getByRole('dialog', { name: 'Compartir Maleta' }).getByRole('button', { name: 'Cerrar', exact: true }).click();

  // La otra persona la ve y añade algo; aparece en la lista compartida
  await other.page.goto('/lists');
  await other.page.locator('.lcard', { hasText: 'Maleta' }).click();
  await other.page.getByLabel('Añadir a la lista').fill('Bañador');
  await other.page.getByRole('button', { name: 'Añadir', exact: true }).click();
  await expect(other.page.locator('ul.items li label').first()).toHaveText('Bañador');
  await page.reload();
  await expect(pending.first()).toHaveText('Bañador');
  await expect(page.locator('.title p')).toContainText(`compartida con ${other.name}`);
});

test('dictar varios elementos a la vez', async ({ browser }) => {
  const { context, page } = await register(browser, 'vozlista');
  await context.addInitScript(`
    window.SpeechRecognition = window.webkitSpeechRecognition = class {
      start() { setTimeout(() => { const r = [{ transcript: 'tomates, cebollas y pimientos' }]; r.isFinal = true;
        this.onresult && this.onresult({ results: [r] }); this.onend && this.onend(); }, 150); }
      stop() {} abort() {}
    };`);
  await page.goto('/lists');
  await page.getByRole('button', { name: 'Crear «Compra»' }).click();
  await page.getByRole('button', { name: 'Dictar por voz' }).click();
  await expect(page.getByLabel('Añadir a la lista')).toHaveValue('tomates, cebollas, pimientos');
  await page.getByRole('button', { name: 'Añadir', exact: true }).click();
  await expect(page.locator('ul.items li label')).toHaveText(['pimientos', 'cebollas', 'tomates']);
});
