import { expect, test } from '@playwright/test';
import { register, toast } from './helpers';

test('hoy: rutinas como checks, tareas del día y estadísticas de cumplimiento', async ({ browser }) => {
  const { page, api } = await register(browser);
  await page.goto('/today');

  await page.getByLabel('Añadir rutina diaria').fill('Leer 20 minutos');
  await page.keyboard.press('Enter');
  const routine = page.locator('.item', { hasText: 'Leer 20 minutos' });
  await expect(routine.locator('.xp')).toHaveText('+10 XP');
  await page.getByLabel('Añadir tarea para hoy').fill('Enviar informe');
  await page.keyboard.press('Enter');
  await expect(page.locator('.summary')).toContainText('0 de 2');

  await routine.locator('.check').check();
  await expect(toast(page).filter({ hasText: '+10 XP' })).toBeVisible();
  await expect(routine).toContainText('a las');  // queda anotada la hora
  await page.locator('.item', { hasText: 'Enviar informe' }).locator('.check').check();
  await expect(page.locator('.summary')).toContainText('2 de 2');
  await expect(page.locator('.summary')).toContainText('Día completo');
  await expect(page.locator('.sidebar .level')).toContainText('Aspirante');
  await expect.poll(async () => (await api('GET', '/game/profile')).xp).toBe(35);  // rutina 10 + tarea normal a tiempo 25

  // desmarcar retira la experiencia
  await routine.locator('.check').uncheck();
  await expect.poll(async () => (await api('GET', '/game/profile')).xp).toBe(25);
  await routine.locator('.check').check();

  // gestionar: solo de lunes a viernes, con hora prevista y más difícil
  await page.getByRole('tab', { name: 'Rutinas' }).click();
  await page.getByTitle('Editar rutina').click();
  await page.getByRole('button', { name: 'Sábado' }).click();
  await page.getByRole('button', { name: 'Domingo' }).click();
  await page.locator('.modal input[type=time]').fill('22:00');
  await page.locator('.modal select[name=difficulty]').selectOption({ label: 'Difícil' });
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect.poll(async () => (await api('GET', '/habits'))[0]).toMatchObject({ days: '01234', target_time: '22:00', difficulty: 3 });

  // estadísticas
  await page.getByRole('tab', { name: 'Estadísticas' }).click();
  await expect(page.locator('.tile', { hasText: 'Cumplimiento' })).toBeVisible();
  await expect(page.locator('.heat tbody tr')).toHaveCount(1);
  await expect(page.locator('.tbl.tall tbody tr')).toContainText('Leer 20 minutos');
  await expect(page.locator('app-column-chart')).toBeVisible();
});

test('pomodoro personalizable: el bloque suma tiempo a la tarea y experiencia', async ({ browser }) => {
  const { page, api } = await register(browser);
  await api('POST', '/tasks', { title: 'Estudiar oposición' });
  await page.clock.install();
  await page.goto('/focus');

  // reloj a medida: bloques de 2 minutos, descansos de 1 y series de 2
  await page.locator('input[name=focus]').fill('2');
  await page.locator('input[name=short]').fill('1');
  await page.locator('input[name=cycles]').fill('2');
  await page.locator('input[name=sound]').uncheck();
  await page.locator('input[name=notify]').uncheck();
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByRole('timer')).toHaveText('02:00');
  await page.getByLabel('Tarea').selectOption({ label: 'Estudiar oposición' });

  await page.getByRole('button', { name: 'Empezar' }).click();
  await page.clock.fastForward('01:00');
  await expect(page.getByRole('timer')).toHaveText('01:00');
  // el reloj sigue al cambiar de página, y se ve en el menú
  await page.getByRole('link', { name: 'Tareas' }).click();
  await expect(page.locator('.sidebar .pomo')).toContainText('Estudiar oposición');
  await page.locator('.sidebar .pomo').click();

  await page.clock.fastForward('01:05');
  await expect(page.locator('.phase')).toHaveText('Descanso corto');
  await expect(page.getByRole('timer')).toHaveText('01:00');
  await expect(toast(page).filter({ hasText: 'Bloque terminado' })).toBeVisible();
  await expect.poll(async () => (await api('GET', '/tasks'))[0].time_spent_seconds).toBe(120);
  await expect.poll(async () => (await api('GET', '/pomodoro/stats')).today_sessions).toBe(1);
  await expect(page.locator('.stats')).toContainText('1bloques');
  expect((await api('GET', '/pomodoro/settings')).focus_minutes).toBe(2);
});

test('progreso: experiencia según dificultad, subida de nivel y rangos', async ({ browser }) => {
  const { page, api } = await register(browser);
  const epic = await api('POST', '/tasks', { title: 'Migrar el servidor', difficulty: 4 });
  await api('PUT', `/tasks/${epic.id}`, { status: 'completed' });  // 80 XP
  await api('POST', '/tasks', { title: 'Revisar correo' });        // normal: 20 XP → 100 = nivel 2

  await page.goto('/tasks');
  await expect(page.locator('.sidebar .level')).toContainText('Nv. 1');
  await page.locator('.task', { hasText: 'Revisar correo' }).locator('.check').check();

  const modal = page.getByRole('alertdialog');
  await expect(modal).toContainText('Nivel 2');
  await modal.getByRole('link', { name: 'Ver mi progreso' }).click();

  await expect(page.locator('.hero .rank')).toHaveText('Aspirante');
  await expect(page.locator('.hero')).toContainText('Nivel 2');
  await expect(page.locator('.hero')).toContainText('Siguiente rango: Recluta en el nivel 3');
  await expect(page.locator('.ladder li')).toHaveCount(10);
  await expect(page.locator('.ladder li.current')).toContainText('Aspirante');
  await expect(page.locator('.ladder li').last()).toContainText('Regente del Imperio');
  await expect(page.locator('.a.on')).toHaveCount(2);  // primera conquista + hazaña épica
  await expect(page.locator('.ev').first()).toContainText('Revisar correo');
  await expect(page.locator('.ev').first()).toContainText('+20 XP');

  // un salto de rango se anuncia como tal
  for (let i = 0; i < 3; i++) {
    const t = await api('POST', '/tasks', { title: `Épica ${i}`, difficulty: 4 });
    if (i < 2) await api('PUT', `/tasks/${t.id}`, { status: 'completed' });
  }
  await page.goto('/tasks');
  await expect(page.locator('.sidebar .level')).toContainText('Nv. 2');  // 260 XP
  await page.locator('.task', { hasText: 'Épica 2' }).locator('.check').check();  // 340 XP → nivel 3
  await expect(page.getByRole('alertdialog')).toContainText('Nuevo rango');
  await expect(page.getByRole('alertdialog').locator('h2')).toHaveText('Recluta');
});
