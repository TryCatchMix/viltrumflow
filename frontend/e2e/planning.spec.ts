import { Page, expect, test } from '@playwright/test';
import { register, taskRow, toast } from './helpers';

const madridDay = (offset = 0) => {
  const d = new Date(); d.setDate(d.getDate() + offset);
  return d.toLocaleDateString('sv', { timeZone: 'Europe/Madrid' });
};
const madridTime = (iso: string) => new Date(iso).toLocaleTimeString('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' });

test('estimación en minutos u horas', async ({ browser }) => {
  const { page, api } = await register(browser);
  await page.goto('/tasks');
  await page.getByLabel('Añadir tarea rápida').fill('Responder correo ~20m');
  await page.keyboard.press('Enter');
  await expect(taskRow(page, 'Responder correo')).toContainText('20 min');

  await taskRow(page, 'Responder correo').click();
  const drawer = page.locator('.drawer');
  await expect(drawer.getByLabel('Duración estimada')).toHaveValue('20');
  await expect(drawer.getByLabel('Unidad de la estimación')).toHaveValue('min');
  await drawer.getByLabel('Duración estimada').fill('1,5');
  await drawer.getByLabel('Unidad de la estimación').selectOption('h');
  await drawer.getByRole('button', { name: 'Guardar' }).click();
  await expect.poll(async () => (await api('GET', '/tasks'))[0].estimated_minutes).toBe(90);
  await expect(taskRow(page, 'Responder correo')).toContainText('1 h 30 min');
});

test('rutinas flexibles: cantidad diaria y veces por semana', async ({ browser }) => {
  const { page, api } = await register(browser);
  await page.goto('/today');
  await page.getByRole('tab', { name: 'Rutinas' }).click();

  await page.getByRole('button', { name: 'Nueva rutina' }).click();
  const modal = page.locator('.modal');
  await modal.locator('input[name=title]').fill('Beber agua');
  await modal.getByLabel('Cantidad objetivo').fill('8');
  await modal.getByLabel('Unidad').fill('vasos');
  await modal.getByRole('button', { name: 'Guardar' }).click();

  await page.getByRole('button', { name: 'Nueva rutina' }).click();
  await modal.locator('input[name=title]').fill('Correr');
  await modal.getByRole('radio', { name: 'Veces por semana' }).click();
  await modal.getByLabel('Veces por semana').fill('3');
  await modal.locator('input[type=time]').fill('19:00');
  await modal.getByText('Avisarme a la hora prevista').click();
  await modal.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.locator('.item', { hasText: 'Correr' })).toContainText('3× por semana');
  expect((await api('GET', '/habits')).find((h: any) => h.title === 'Correr')).toMatchObject({ weekly_target: 3, target_time: '19:00', remind: true });

  await page.getByRole('tab', { name: 'Mi día' }).click();
  const water = page.locator('.item', { hasText: 'Beber agua' });
  await expect(water.locator('.n')).toHaveText('0/8 vasos');
  for (let i = 0; i < 3; i++) await water.getByLabel('Uno más').click();
  await expect(water.locator('.n')).toHaveText('3/8 vasos');
  await expect(water.locator('.check')).not.toBeChecked();
  await water.locator('.check').check();  // marcarla la da por completa
  await expect(water.locator('.n')).toHaveText('8/8 vasos');
  await expect(toast(page).filter({ hasText: 'XP' })).toBeVisible();

  const run = page.locator('.item', { hasText: 'Correr' });
  await expect(run).toContainText('0/3 esta semana');
  await run.locator('.check').check();
  await expect(run).toContainText('1/3 esta semana');
});

async function dropAt(page: Page, source: ReturnType<Page['locator']>, minutes: number) {
  const line = page.locator('.timeline');
  await line.scrollIntoViewIfNeeded();
  await page.locator('.timeline-wrap').evaluate((el, top) => (el.scrollTop = top), (minutes - 60) * (52 / 60));
  await source.dragTo(line, { targetPosition: { x: 120, y: minutes * (52 / 60) + 2 } });
}

test('planificador del día: colocar, mover, alargar y quitar la hora', async ({ browser }) => {
  const { page, api } = await register(browser);
  const day = madridDay();
  await api('POST', '/tasks', { title: 'Preparar presentación', due_date: `${day}T00:00:00Z`, estimated_minutes: 60 });
  await api('POST', '/tasks', { title: 'Atrasada sin hora', due_date: '2020-01-01T00:00:00Z' });
  await api('POST', '/habits', { title: 'Meditar' });

  await page.goto('/today');
  await page.getByRole('link', { name: 'Planificar por horas' }).click();
  await expect(page).toHaveURL(/calendar/);
  const pool = page.locator('.pool');
  await expect(pool).toContainText('Preparar presentación');
  await expect(pool).toContainText('Atrasada sin hora');
  await expect(pool).toContainText('Meditar');

  // a las 10:00
  await dropAt(page, pool.locator('.chipblock', { hasText: 'Preparar presentación' }), 10 * 60);
  const block = page.locator('.block.task', { hasText: 'Preparar presentación' });
  await expect(block).toContainText('10:00 – 11:00');
  await expect.poll(async () => {
    const t = (await api('GET', '/tasks')).find((x: any) => x.title === 'Preparar presentación');
    return [t.all_day, madridTime(t.due_date)];
  }).toEqual([false, '10:00']);

  // alargarla hasta las 11:30 arrastrando el borde inferior
  const box = (await block.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height - 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 90 * (52 / 60), { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await api('GET', '/tasks')).find((x: any) => x.title === 'Preparar presentación').estimated_minutes).toBe(90);
  await expect(block).toContainText('10:00 – 11:30');

  // la rutina fija su hora prevista
  await dropAt(page, pool.locator('.chipblock', { hasText: 'Meditar' }), 7 * 60 + 30);
  await expect(page.locator('.block.habit', { hasText: 'Meditar' })).toBeVisible();
  await expect.poll(async () => (await api('GET', '/habits'))[0].target_time).toBe('07:30');

  // devolverla a «Por colocar» le quita la hora pero la deja en el día
  await block.dragTo(pool);
  await expect(pool).toContainText('Preparar presentación');
  await expect.poll(async () => {
    const t = (await api('GET', '/tasks')).find((x: any) => x.title === 'Preparar presentación');
    return [t.all_day, t.due_date.slice(0, 10)];
  }).toEqual([true, day]);
});

test('revisión semanal: reprogramar pendientes, fijar objetivos y verlos en Hoy', async ({ browser }) => {
  const { page, api } = await register(browser);
  const done = await api('POST', '/tasks', { title: 'Informe enviado', difficulty: 3 });
  await api('PUT', `/tasks/${done.id}`, { status: 'completed' });
  await api('POST', '/tasks', { title: 'Llamar al banco', due_date: '2020-01-01T00:00:00Z' });
  await api('POST', '/tasks', { title: 'Ordenar el trastero', due_date: '2020-01-02T00:00:00Z' });

  // la revisión de la semana en curso (en la de la semana pasada no habría tareas completadas)
  const monday = madridDay(-((new Date(madridDay() + 'T12:00:00').getDay() + 6) % 7));
  await page.goto('/review');
  // Antes de leer la semana mostrada, esperar a que cargue (si no, el rótulo aún está vacío)
  await expect(page.locator('.page-head p')).toContainText('Del ');
  if (!(await page.locator('.page-head p').innerText()).includes(String(Number(monday.slice(8))))) {
    await page.getByRole('button', { name: 'Semana siguiente' }).click();
  }
  await expect(page.locator('.tile', { hasText: 'Tareas completadas' }).locator('strong')).toHaveText('1');
  await expect(page.locator('.box', { hasText: 'Lo que completaste' })).toContainText('Informe enviado');

  await page.getByRole('button', { name: /Siguiente: pendientes/ }).click();
  const bank = page.locator('.pend', { hasText: 'Llamar al banco' });
  await bank.getByRole('button', { name: 'Mañana' }).click();
  await expect(bank).toHaveCount(0);
  await page.locator('.pend', { hasText: 'Ordenar el trastero' }).getByRole('button', { name: 'Archivar' }).click();
  await expect(page.getByText('Nada pendiente de semanas anteriores')).toBeVisible();
  const tasks = await api('GET', '/tasks?include_archived=true');
  expect(tasks.find((t: any) => t.title === 'Llamar al banco').due_date.slice(0, 10)).toBe(madridDay(1));
  expect(tasks.find((t: any) => t.title === 'Ordenar el trastero').status).toBe('archived');

  await page.getByRole('button', { name: /Siguiente: próxima semana/ }).click();
  await page.getByLabel('Objetivo 1').fill('Terminar el curso de inglés');
  await page.getByRole('button', { name: 'Añadir objetivo' }).click();
  await page.getByLabel('Objetivo 2').fill('Correr tres veces');
  await page.getByRole('button', { name: /Terminar revisión · \+30 XP/ }).click();
  await expect(toast(page).filter({ hasText: 'Revisión terminada' })).toBeVisible();
  await expect(page.locator('.page-head')).toContainText('hecha');

  // los objetivos de la semana pasada se ven en «Hoy»: se simula que esta revisión era la de la semana anterior
  const prev = new Date(monday + 'T12:00:00'); prev.setDate(prev.getDate() - 7);
  await api('PUT', '/review', { week_start: prev.toLocaleDateString('sv'), goals: [{ text: 'Leer un libro', done: false }], reflection: '' });
  await page.goto('/today');
  const goal = page.locator('.item', { hasText: 'Leer un libro' });
  await goal.locator('.check').check();
  await expect.poll(async () => (await api('GET', '/review/today')).goals[0].done).toBe(true);
});

test('avisos con la app cerrada: activar, registrar el dispositivo y desactivar', async ({ browser }) => {
  const { page, context, api } = await register(browser);
  // El navegador de pruebas no tiene servicio de push: se simula la suscripción del navegador
  await context.addInitScript(() => {
    const fake = {
      endpoint: 'https://push.example.test/sub/123', options: {},
      toJSON: () => ({ endpoint: 'https://push.example.test/sub/123', keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) } }),
      unsubscribe: async () => { (window as any).__pushSub = null; return true; },
    };
    (window as any).__pushSub = null;
    PushManager.prototype.subscribe = async function () { (window as any).__pushSub = fake; return fake as any; };
    PushManager.prototype.getSubscription = async function () { return (window as any).__pushSub; };
    Object.defineProperty(Notification, 'permission', { get: () => 'granted' });
  });
  await page.goto('/settings');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  const row = page.locator('.opt', { hasText: 'Avisos con la app cerrada' });
  await row.getByRole('button', { name: 'Activar' }).click();
  await expect(toast(page).filter({ hasText: 'Avisos activados' })).toBeVisible();
  await expect(row.getByRole('button', { name: 'Desactivar' })).toBeVisible();
  expect((await api('GET', '/push/devices')).count).toBe(1);

  await row.getByRole('button', { name: 'Desactivar' }).click();
  await expect(row.getByRole('button', { name: 'Activar' })).toBeVisible();
  expect((await api('GET', '/push/devices')).count).toBe(0);
});
