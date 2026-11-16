import { Browser, BrowserContext, Page, expect } from '@playwright/test';

export const PASSWORD = 'Secreta123';
let seq = 0;

/** Nombre único por prueba: todas comparten la misma base de datos. */
export function unique(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${(seq++).toString(36)}`;
}

export interface Session {
  context: BrowserContext;
  page: Page;
  username: string;
  /** Nombre visible (el registro lo guarda con la inicial en mayúscula). */
  name: string;
  /** Llamada directa a la API con la sesión del usuario, para preparar datos o comprobar el resultado. */
  api: <T = any>(method: string, path: string, body?: unknown) => Promise<T>;
}

/** Registra un usuario nuevo por la interfaz y devuelve su sesión ya dentro de la app. */
export async function register(browser: Browser, prefix = 'user'): Promise<Session> {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('dialog', d => d.accept());  // confirmaciones de borrado
  const username = unique(prefix);
  const name = username.charAt(0).toUpperCase() + username.slice(1);

  await page.goto('/register');
  await page.locator('input[name=full_name]').fill(name);
  await page.locator('input[name=email]').fill(`${username}@example.com`);
  await page.locator('input[name=username]').fill(username);
  await page.locator('input[name=password]').fill(PASSWORD);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(page).toHaveURL(/dashboard/);

  const api = <T>(method: string, path: string, body?: unknown) =>
    page.evaluate(async ([method, path, body]) => {
      const r = await fetch('/api/v1' + path, {
        method: method as string,
        headers: { Authorization: 'Bearer ' + localStorage.getItem('vf-access'), 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return r.status === 204 ? null : r.json();
    }, [method, path, body] as const) as Promise<T>;

  return { context, page, username, name, api };
}

export const toast = (page: Page) => page.locator('.toast');
export const taskRow = (page: Page, title: string) => page.locator('.task', { hasText: title });
export const noteItem = (page: Page, title: string) => page.locator('.tree .item', { hasText: title });

/** Abre una nota del árbol y espera a que esté cargada. */
export async function openNote(page: Page, title: string) {
  await noteItem(page, title).click();
  await expect(page.locator('input.title')).toHaveValue(title);
}

/** Escribe al final de la nota abierta (cambia a modo edición si hace falta). */
export async function typeAtEnd(page: Page, text: string) {
  await page.getByTitle('Editar', { exact: true }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(text);
}
