import { expect, test } from '@playwright/test';
import { PASSWORD, noteItem, openNote, register, typeAtEnd } from './helpers';

test('registro, cierre de sesión e inicio de sesión', async ({ browser }) => {
  const { page, username, name } = await register(browser, 'ana');
  await expect(page.locator('h1')).toContainText(name);

  await page.getByTitle('Cerrar sesión').click();
  await expect(page).toHaveURL(/login/);
  // sin sesión, las rutas privadas redirigen al login
  await page.goto('/tasks');
  await expect(page).toHaveURL(/login/);

  await page.locator('input[name=username]').fill(username);
  await page.locator('input[name=password]').fill('incorrecta');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('alert')).toContainText('incorrectos');

  await page.locator('input[name=password]').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/tasks/);  // vuelve a donde quería ir
});

test('notas: enlaces, autocompletado, autoguardado y casillas', async ({ browser }) => {
  const { page, api } = await register(browser);
  await api('POST', '/notes', { title: 'Proyecto', content: '# Proyecto\n\nVer [[Reunión]].\n\n- [ ] Elegir tipografía\n\n#diseño' });
  await api('POST', '/notes', { title: 'Arquitectura', content: 'Notas' });

  await page.goto('/notes');
  await openNote(page, 'Proyecto');
  await page.getByTitle('Dividido').click();

  // el enlace a una nota que no existe aparece atenuado y como saliente sin resolver
  await expect(page.locator('.read a.wikilink.missing')).toHaveText('Reunión');
  await expect(page.locator('.sub .chip.tag')).toHaveText('#diseño');

  // autocompletado de [[ y autoguardado
  await typeAtEnd(page, '\nEnlace a [[Arq');
  await expect(page.locator('.cm-tooltip-autocomplete')).toContainText('Arquitectura');
  await page.keyboard.press('Enter');
  await expect(page.locator('.status')).toHaveText('Guardado');
  expect((await api('GET', '/notes/by-title/Proyecto')).content).toContain('[[Arquitectura]]');
  await expect(page.locator('.side .out', { hasText: 'Arquitectura' })).toBeVisible();

  // marcar una casilla en la vista de lectura modifica la nota
  await page.getByTitle('Dividido').click();
  await page.locator('.read li.task input').check();
  await expect.poll(async () => (await api('GET', '/notes/by-title/Proyecto')).content).toContain('- [x] Elegir tipografía');

  // abrir un enlace sin resolver crea la nota, y esta enlaza de vuelta
  await page.locator('.read a.wikilink.missing').click();
  await expect(page.locator('input.title')).toHaveValue('Reunión');
  await expect(page.locator('.side .back')).toContainText('Proyecto');

  // renombrar actualiza los enlaces de las notas que apuntaban aquí
  await page.locator('input.title').fill('Reunión inicial');
  await page.locator('input.title').press('Enter');
  await expect(noteItem(page, 'Reunión inicial')).toBeVisible();
  expect((await api('GET', '/notes/by-title/Proyecto')).content).toContain('[[Reunión inicial]]');
});

test('buscador rápido y grafo', async ({ browser }) => {
  const { page, api } = await register(browser);
  await api('POST', '/notes', { title: 'Receta de pan', content: 'Harina, agua y [[Masa madre]]' });

  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.keyboard.press('Control+k');
  await page.getByLabel('Buscar', { exact: true }).fill('harina');
  await expect(page.getByRole('option').first()).toContainText('Receta de pan');
  await page.keyboard.press('Enter');
  await expect(page.locator('input.title')).toHaveValue('Receta de pan');

  await page.goto('/graph');
  await expect(page.getByText(/3 notas · 2 enlaces/)).toBeVisible();
  await expect(page.locator('canvas')).toBeVisible();
});

test('recuperar contraseña: páginas y validación del enlace', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('link', { name: '¿Has olvidado tu contraseña?' }).click();
  await expect(page.getByRole('heading', { name: 'Recupera tu contraseña' })).toBeVisible();
  await page.locator('input[name=email]').fill('alguien@example.com');
  await page.getByRole('button', { name: 'Enviar enlace' }).click();
  // el servidor de pruebas no tiene correo configurado y lo dice con claridad
  await expect(page.getByRole('alert')).toContainText('no tiene configurado el envío de correos');

  await page.goto('/reset-password?token=no-es-valido');
  await expect(page).toHaveURL(/reset-password$/);  // el token se retira de la barra de direcciones
  await page.locator('input[name=password]').fill('Nueva12345');
  await page.getByRole('button', { name: 'Guardar contraseña' }).click();
  await expect(page.getByRole('alert')).toContainText('no es válido o ha caducado');

  await page.goto('/reset-password');
  await expect(page.getByRole('alert')).toContainText('le falta el código');
  await expect(page.getByRole('button', { name: 'Guardar contraseña' })).toBeDisabled();
});

test('imágenes en notas: pegar en el editor y ver en la lectura', async ({ browser }) => {
  const { page, api } = await register(browser);
  await page.goto('/notes');
  await openNote(page, 'Ideas');
  await page.getByTitle('Dividido').click();

  // PNG de 1×1 pegado desde el portapapeles
  await page.locator('.cm-content').click();
  await page.evaluate(() => {
    const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), c => c.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([bytes], 'captura.png', { type: 'image/png' }));
    document.querySelector('.cm-content')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(page.locator('.cm-content')).toContainText('![captura](/api/v1/attachments/');
  await expect(page.locator('.status')).toHaveText('Guardado');

  // la vista de lectura la descarga con la sesión y la muestra como blob
  const img = page.locator('.read img');
  await expect(img).toHaveAttribute('src', /^blob:/);
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(1);

  // sin sesión la imagen no es accesible
  const url = /\(\/api\/v1\/attachments\/[0-9a-f]{32}\)/.exec((await api('GET', '/notes/by-title/Ideas')).content)![0].slice(1, -1);
  expect((await page.request.get(url)).status()).toBe(401);
});
