import { expect, test } from '@playwright/test';
import { register, toast } from './helpers';

// PNG de 2×3 px: basta para recorrerse el camino de la foto (reducir, enviar, guardar como imagen de la carta)
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAEklEQVR4nGP4z8DAwMDAxMDAAAAoAAP/nqCaCwAAAABJRU5ErkJggg==', 'base64');
const photo = { name: 'carta.png', mimeType: 'image/png', buffer: PNG };
const tile = (page: import('@playwright/test').Page, label: string) => page.locator('.tile', { hasText: label }).locator('strong');

test('colección TCG sin reconocimiento: añadir a mano, sumar copias y editar', async ({ browser }) => {
  const { page, api } = await register(browser, 'tcg');
  await page.getByRole('link', { name: 'Colección TCG' }).click();
  await expect(page).toHaveURL(/\/collection/);
  await expect(page.getByText('El reconocimiento de cartas no está configurado')).toBeVisible();

  await page.getByRole('button', { name: 'Añadir carta a mano' }).click();
  const modal = page.locator('.modal');
  await modal.getByLabel('Nombre').fill('Judy Alvarez');
  await modal.getByLabel('Número').fill('14');
  await modal.getByLabel('Rareza').fill('Rare');
  await modal.getByRole('button', { name: 'Añadir a la colección' }).click();
  const result = page.getByTestId('scan-result');
  await expect(result).toContainText('Añadida a tu colección');
  await expect(result).toContainText('Judy Alvarez');
  await expect(result).toContainText('014 · Rare');
  await expect(result).toContainText('Tienes 1 copia');
  await expect(result).toContainText('Total de tu colección: 1 carta · 1 distintas');
  await expect(page.locator('.recent')).toContainText('+1');

  // Lista: + y − suman y restan, y los totales se actualizan
  await page.getByRole('tab', { name: /Mi colección/ }).click();
  const row = page.locator('.item', { hasText: 'Judy Alvarez' });
  await row.getByRole('button', { name: 'Añadir una copia de Judy Alvarez' }).click();
  await row.getByRole('button', { name: 'Añadir una copia de Judy Alvarez' }).click();
  await expect(row.locator('.n')).toHaveText('3');
  await expect(tile(page, 'Cartas en total')).toHaveText('3');
  await expect(tile(page, 'Repetidas')).toHaveText('2');

  // Añadir otra carta desde la lista, como deseada
  await page.getByRole('button', { name: 'Añadir', exact: true }).click();
  await modal.getByLabel('Nombre').fill('Adam Smasher');
  await modal.getByLabel('Copias').fill('0');
  await modal.getByLabel('En la lista de deseos').check();
  await modal.getByRole('button', { name: 'Guardar' }).click();
  await expect(toast(page).first()).toContainText('Carta añadida');
  await expect(tile(page, 'Lista de deseos')).toHaveText('1');
  await page.getByRole('button', { name: 'Deseos' }).click();
  await expect(page.locator('.item')).toHaveCount(1);
  await expect(page.locator('.item')).toContainText('Deseada');

  // Editar: nombre duplicado no se permite; cambiar foto y borrar
  await page.getByRole('button', { name: 'Todas' }).click();
  await page.getByRole('button', { name: 'Editar Adam Smasher' }).click();
  await modal.getByLabel('Nombre').fill('judy alvarez');
  await modal.getByLabel('Número').fill('014');
  await modal.getByRole('button', { name: 'Guardar' }).click();
  await expect(toast(page).last()).toContainText('Ya tienes otra carta con ese nombre y número');
  await modal.locator('input[type=file]').setInputFiles(photo);
  await expect(toast(page).last()).toContainText('Foto actualizada');
  await modal.getByRole('button', { name: 'Eliminar' }).click();
  await expect(page.locator('.item')).toHaveCount(1);
  const col = await api<any>('GET', '/tcg');
  expect(col.totals).toEqual({ copies: 3, unique: 1, duplicates: 2, wanted: 0 });
});

test.describe('escáner', () => {
  // Las respuestas simuladas no deben pasar por el service worker
  test.use({ serviceWorkers: 'block' });

  test('una foto dudosa pregunta cuál es, se aplica y se deshace', async ({ browser }) => {
    const { page, api } = await register(browser, 'scan');
    const silver = (await api<any>('POST', '/tcg/cards', { name: 'Johnny Silverhand', number: '010', quantity: 1 })).card;
    await api('POST', '/tcg/cards', { name: 'Johnny Silverhand', number: '160', quantity: 2 });

    // El servidor de pruebas no tiene clave de la API: se simula que el reconocimiento está activo y lo que «lee»
    await page.route(u => u.pathname === '/api/v1/tcg', async route => {
      const res = await route.fetch();
      await route.fulfill({ response: res, json: { ...(await res.json()), recognition: true } });
    });
    const reading = { is_card: true, name: 'Johnny Silverhand', number: '', set_name: '', rarity: '', card_type: '', confidence: 'medium' };
    let next: 'choose' | 'missing' = 'choose';
    await page.route('**/api/v1/tcg/scan', async route => {
      const col = await api<any>('GET', '/tcg');
      if (next === 'choose') {
        await route.fulfill({ json: { status: 'choose', mode: 'add', reading, card: null, delta: 0, event_id: null, message: '¿Cuál de estas es?', candidates: col.cards, totals: col.totals } });
      } else {
        await route.fulfill({ json: { status: 'missing', mode: 'check', reading: { ...reading, name: 'Lucy', number: '007', confidence: 'high' }, card: null, delta: 0, event_id: null, message: 'No tienes esta carta en tu colección', candidates: [], totals: col.totals } });
      }
    });

    await page.goto('/collection');
    await expect(page.getByRole('radio', { name: 'Añadir' })).toHaveAttribute('aria-checked', 'true');
    await expect(tile(page, 'Cartas en total')).toHaveText('3');
    await page.getByTestId('photo-input').setInputFiles(photo);
    const result = page.getByTestId('scan-result');
    await expect(result).toContainText('He leído «Johnny Silverhand». ¿Cuál de estas es?');
    await expect(result.locator('.cand')).toHaveCount(2);
    await result.locator('.cand', { hasText: '010' }).click();
    await expect(result).toContainText('Añadida a tu colección');
    await expect(result).toContainText('Tienes 2 copias');
    await expect(result).toContainText('Total de tu colección: 4 cartas · 2 distintas');
    await expect(page.getByTestId('scan-flash')).toHaveText('✓ Johnny Silverhand · tienes 2 · total 4 cartas');
    await expect(tile(page, 'Cartas en total')).toHaveText('4');
    // La foto de la carta se guardó con ella
    expect((await api<any>('GET', '/tcg')).cards.find((c: any) => c.id === silver.id).image_url).toBeTruthy();

    await result.getByRole('button', { name: 'Deshacer' }).click();
    await expect(tile(page, 'Cartas en total')).toHaveText('3');
    await expect(page.getByTestId('scan-result')).toHaveCount(0);

    // Consultar una carta que no tienes: ofrece añadirla con lo leído
    next = 'missing';
    await page.getByRole('radio', { name: 'Consultar' }).click();
    await page.getByTestId('photo-input').setInputFiles(photo);
    await expect(result).toContainText('No tienes esta carta en tu colección');
    await expect(result).toContainText('Lucy');
    await result.getByRole('button', { name: 'A deseos' }).click();
    await expect(result).toContainText('Añadida a tu lista de deseos');
    await expect(result).toContainText('En tu lista de deseos');
    await expect(tile(page, 'Lista de deseos')).toHaveText('1');
    const lucy = (await api<any>('GET', '/tcg')).cards.find((c: any) => c.name === 'Lucy');
    expect(lucy).toMatchObject({ number: '007', quantity: 0, wanted: true });
  });
});
