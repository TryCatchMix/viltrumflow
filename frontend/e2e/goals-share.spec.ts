import { expect, test } from '@playwright/test';
import { register, toast } from './helpers';

test('objetivo con hitos, tareas, proyecto y rutina; cumplirlo da experiencia', async ({ browser }) => {
  const { page, api } = await register(browser, 'goal');
  const project = await api<any>('POST', '/projects', { name: 'Web personal' });
  await api('POST', '/tasks', { title: 'Diseñar portada', project_id: project.id });
  await api('POST', '/tasks', { title: 'Escribir textos', project_id: project.id });
  await api('POST', '/habits', { title: 'Programar 30 min' });

  await page.getByRole('link', { name: 'Objetivos' }).first().click();
  await expect(page.getByText('Aún no tienes objetivos')).toBeVisible();
  await page.getByRole('button', { name: 'Nuevo objetivo' }).click();
  await page.locator('input[name=title]').fill('Lanzar mi web');
  await page.getByRole('button', { name: 'Crear objetivo' }).click();
  await expect(page).toHaveURL(/\/goals\/\d+$/);
  await expect(page.getByLabel('Título del objetivo')).toHaveValue('Lanzar mi web');

  // Hitos
  await page.getByPlaceholder(/Nuevo hito/).fill('Elegir dominio');
  await page.getByRole('button', { name: 'Añadir' }).click();
  await expect(page.getByRole('checkbox', { name: 'Elegir dominio' })).toBeVisible();

  // Proyecto completo, tarea nueva y rutina
  await page.getByLabel('Vincular proyecto').selectOption({ label: 'Web personal' });
  await expect(page.getByText('Diseñar portada')).toBeVisible();
  await page.getByPlaceholder('Nueva tarea para este objetivo').fill('Publicar en internet');
  await page.getByRole('button', { name: 'Crear', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Publicar en internet' })).toBeVisible();
  await page.getByLabel('Vincular rutina').selectOption({ label: 'Programar 30 min' });
  await expect(page.locator('.list li', { hasText: 'Programar 30 min' })).toBeVisible();
  await expect(page.getByText('0/3 hechas')).toBeVisible();

  // Avance: 2 de 4 (un hito y una tarea)
  await page.getByRole('checkbox', { name: 'Elegir dominio' }).check();
  await page.getByRole('checkbox', { name: 'Diseñar portada' }).check();
  await expect(page.getByText('1/3 hechas')).toBeVisible();
  await expect(page.locator('.big strong').first()).toHaveText('50 %');

  // Sale en el inicio
  await page.goto('/dashboard');
  await expect(page.locator('app-bar-list', { hasText: 'Lanzar mi web' })).toContainText('50 %');

  // Cumplirlo
  await page.goto('/goals');
  await page.getByRole('link', { name: /Lanzar mi web/ }).click();
  await page.getByRole('button', { name: /Marcar como cumplido · \+70 XP/ }).click();
  await expect(toast(page)).toContainText('¡Objetivo cumplido! +70 XP');
  await expect(page.locator('.chip', { hasText: 'Cumplido' })).toBeVisible();
  await page.goto('/goals');
  await expect(page.getByText('Aún no tienes objetivos')).toBeVisible();
  await page.getByRole('tab', { name: 'Cumplidos' }).click();
  await expect(page.getByRole('link', { name: /Lanzar mi web/ })).toBeVisible();
});

test('compartir un enlace desde otra app lo guarda como tarea o como nota', async ({ browser }) => {
  const { page, api } = await register(browser, 'share');

  // Como hace Chrome en Android: el enlace llega dentro del texto
  await page.goto('/share?title=' + encodeURIComponent('Guía de Angular') + '&text=' + encodeURIComponent('Mira esto https://angular.dev/guide'));
  await expect(page).toHaveURL(/\/share$/);  // los datos no quedan en el historial
  await expect(page.locator('input[name=title]')).toHaveValue('Guía de Angular');
  await expect(page.getByRole('link', { name: 'https://angular.dev/guide' })).toBeVisible();
  await expect(page.locator('textarea[name=body]')).toHaveValue('Mira esto');
  await page.getByRole('radio', { name: 'Tarea' }).click();
  await page.getByRole('button', { name: 'Crear tarea' }).click();
  await expect(page).toHaveURL(/\/tasks/);
  const tasks = await api<any[]>('GET', '/tasks');
  const task = tasks.find(t => t.title === 'Guía de Angular');
  expect(task.description).toContain('https://angular.dev/guide');

  // Un texto suelto se propone como nota; si el título ya existe, no falla
  for (let i = 0; i < 2; i++) {
    await page.goto('/share?text=' + encodeURIComponent('Idea para el blog\nEscribir sobre hábitos'));
    await expect(page.getByRole('radio', { name: 'Nota' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('input[name=title]')).toHaveValue('Idea para el blog');
    await page.getByRole('button', { name: 'Guardar nota' }).click();
    await expect(page).toHaveURL(/\/notes\/\d+/);
  }
  const notes = await api<any[]>('GET', '/notes');
  expect(notes.map(n => n.title)).toEqual(expect.arrayContaining(['Idea para el blog', 'Idea para el blog (2)']));

  await page.goto('/share');
  await expect(page.getByText('No ha llegado nada.')).toBeVisible();
});

test('el manifiesto declara ViltrumFlow como destino de «Compartir»', async ({ request }) => {
  const manifest = await (await request.get('/manifest.webmanifest')).json();
  expect(manifest.share_target).toEqual({ action: '/share', method: 'GET', params: { title: 'title', text: 'text', url: 'url' } });
});
