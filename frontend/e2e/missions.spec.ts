import { expect, test } from '@playwright/test';
import { register, toast } from './helpers';

test('misiones, monedas, protector de racha y recompensas propias', async ({ browser }) => {
  const { page, api } = await register(browser);
  // 7 tareas épicas terminadas a tiempo: 100 XP cada una → 700 XP → 70 monedas
  for (let i = 0; i < 7; i++) {
    const t = await api('POST', '/tasks', { title: `Épica ${i}`, difficulty: 4, due_date: '2099-01-01T00:00:00Z' });
    await api('PUT', `/tasks/${t.id}`, { status: 'completed' });
  }
  await page.goto('/missions');
  const purse = page.locator('.purse strong');
  await expect(purse).toHaveText('70');
  await expect(page.locator('.sidebar .coins')).toContainText('70');

  // sin rutinas, las misiones salen de tareas, puntualidad, concentración y revisión: al menos una ya está cumplida
  const missions = page.locator('.mission');
  await expect(missions).toHaveCount(3);
  const ready = page.locator('.mission.ready').first();
  const reward = Number((await ready.locator('.chip.coin').innerText()).trim());
  const xp = Number((await ready.locator('.chip.xp').innerText()).replace(/\D/g, ''));
  await ready.getByRole('button', { name: 'Reclamar recompensa' }).click();
  await expect(toast(page).filter({ hasText: 'Misión cumplida' })).toBeVisible();
  // monedas de la misión + las que da su experiencia
  await expect(purse).toHaveText(String(70 + reward + Math.floor((700 + xp) / 10) - 70));
  await expect(page.locator('.chip', { hasText: 'Cofre: 1/3' })).toBeVisible();
  const coins = Number(await purse.innerText());

  // recompensa propia desde una idea, canjear y deshacer
  await page.getByRole('button', { name: /Una hora de videojuegos · 40/ }).click();
  const card = page.locator('.reward', { hasText: 'Una hora de videojuegos' });
  await card.getByRole('button', { name: 'Canjear' }).click();
  await expect(toast(page).filter({ hasText: '¡Disfrútalo!' })).toBeVisible();
  await expect(purse).toHaveText(String(coins - 40));
  await expect(card).toContainText('Canjeada 1 vez');
  const entry = page.locator('.ev', { hasText: 'Una hora de videojuegos' });
  await entry.getByRole('button', { name: 'Deshacer' }).click();
  await expect(purse).toHaveText(String(coins));

  // recompensa única y demasiado cara
  await page.getByRole('button', { name: 'Nueva recompensa' }).click();
  await page.locator('.modal input[name=title]').fill('Viaje a Roma');
  await page.locator('.modal input[name=cost]').fill('5000');
  await page.locator('.modal input[name=repeatable]').uncheck();
  await page.getByRole('button', { name: 'Guardar' }).click();
  const trip = page.locator('.reward', { hasText: 'Viaje a Roma' });
  await expect(trip).toContainText('Una sola vez');
  await expect(trip.getByRole('button', { name: 'Canjear' })).toBeDisabled();

  // protector de racha
  await expect(page.locator('.slot.on')).toHaveCount(0);
  await page.getByRole('button', { name: /Comprar por 50/ }).click();
  await expect(page.locator('.slot.on')).toHaveCount(1);
  await expect(purse).toHaveText(String(coins - 50));
  expect((await api('GET', '/game/wallet')).freezes).toBe(1);
});
