import { expect, test } from '@playwright/test';
import { PASSWORD, unique } from './helpers';

/**
 * Inicio de sesión con Google desde la SPA. El servidor de pruebas no tiene credenciales de Google:
 * se simulan sus respuestas a la SPA (proveedores disponibles y canje del código de un solo uso).
 * El flujo del servidor con Google está cubierto en backend/tests/test_google_login.py.
 */

// Con el service worker activo, sus peticiones no pasarían por page.route
test.use({ serviceWorkers: 'block' });

test('sin Google configurado no aparece el botón', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continuar con Google' })).toHaveCount(0);
});

test('el botón lleva al servidor y la vuelta con código abre la sesión', async ({ page, request }) => {
  // Cuenta real para que el canje devuelva tokens válidos
  const username = unique('goo');
  await request.post('/api/v1/auth/register', { data: { email: `${username}@example.com`, username, password: PASSWORD } });
  const tokens = await (await request.post('/api/v1/auth/login', { form: { username, password: PASSWORD } })).json();

  await page.route('**/api/v1/auth/providers', r => r.fulfill({ json: { google: true } }));
  let exchanged = '';
  await page.route('**/api/v1/auth/google/exchange', async r => {
    exchanged = r.request().postDataJSON().code;
    await r.fulfill({ json: tokens });
  });

  await page.goto('/register');
  await expect(page.getByRole('button', { name: 'Continuar con Google' })).toBeVisible();
  await page.goto('/login');
  const start = page.waitForRequest(r => r.url().endsWith('/api/v1/auth/google/start'));
  await page.getByRole('button', { name: 'Continuar con Google' }).click();
  await start;  // sin credenciales, el servidor de pruebas devuelve a /login?google=unavailable
  await expect(page.getByRole('alert')).toContainText('no está disponible');

  // Vuelta de Google con éxito: código en el fragmento, que desaparece de la barra de direcciones.
  // Se llega desde otro sitio (Google), así que es una carga completa de la página
  await page.goto('about:blank');
  await page.goto('/login#google_code=codigo-de-prueba');
  await expect(page).toHaveURL(/dashboard/);
  expect(exchanged).toBe('codigo-de-prueba');
  expect(page.url()).not.toContain('google_code');
});

test('explica por qué no se pudo entrar con Google', async ({ page }) => {
  await page.goto('/login?google=exists');
  await expect(page.getByRole('alert')).toContainText('Ya hay una cuenta con ese email');
  await expect(page).toHaveURL(/\/login$/);
});

test('en Ajustes se vincula Google y quien no tiene contraseña la elige sin la actual', async ({ page, request }) => {
  const username = unique('gset');
  await request.post('/api/v1/auth/register', { data: { email: `${username}@example.com`, username, password: PASSWORD } });
  const tokens = await (await request.post('/api/v1/auth/login', { form: { username, password: PASSWORD } })).json();
  await page.route('**/api/v1/auth/providers', r => r.fulfill({ json: { google: true } }));
  await page.route('**/api/v1/auth/google/exchange', r => r.fulfill({ json: tokens }));
  await page.goto('/login#google_code=x');
  await expect(page).toHaveURL(/dashboard/);

  // Cuenta con contraseña y sin Google: ofrece vincular y pide la contraseña actual
  await page.goto('/settings');
  await expect(page.getByRole('button', { name: 'Vincular cuenta de Google' })).toBeVisible();
  await expect(page.locator('input[name=cur]')).toBeVisible();

  // Simula una cuenta creada con Google (vinculada y sin contraseña)
  await page.route('**/api/v1/auth/me', async r => {
    if (r.request().method() !== 'GET') return r.continue();
    const res = await r.fetch();
    const me = await res.json();
    await r.fulfill({ response: res, json: { ...me, google_linked: true, has_password: false } });
  });
  await page.reload();
  await expect(page.getByText('Tu cuenta está vinculada')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Desvincular Google' })).toHaveCount(0);
  await expect(page.locator('input[name=cur]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Guardar contraseña' })).toBeVisible();

  // Vuelta de la vinculación
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await page.goto('/settings?google=taken');
  await expect(page.locator('.toast')).toContainText('ya está vinculada a otro usuario');
});
