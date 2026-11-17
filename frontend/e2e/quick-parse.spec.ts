import { expect, test } from '@playwright/test';
import { parseQuick } from '../src/app/core/quick-parse';

// Miércoles 12 de noviembre de 2025, 10:00
const NOW = new Date(2025, 10, 12, 10, 0);
const p = (s: string) => parseQuick(s, NOW);

test('captura rápida: fechas', () => {
  expect(p('Comprar pan hoy')).toMatchObject({ title: 'Comprar pan', day: '2025-11-12' });
  expect(p('Llamar a Juan mañana')).toMatchObject({ title: 'Llamar a Juan', day: '2025-11-13' });
  expect(p('Dentista pasado mañana')).toMatchObject({ title: 'Dentista', day: '2025-11-14' });
  expect(p('Informe el viernes')).toMatchObject({ title: 'Informe', day: '2025-11-14' });
  expect(p('Reunión el miércoles')).toMatchObject({ title: 'Reunión', day: '2025-11-19' });  // hoy es miércoles: el siguiente
  expect(p('Gimnasio sábado')).toMatchObject({ title: 'Gimnasio', day: '2025-11-15' });
  expect(p('Revisar en 3 días')).toMatchObject({ title: 'Revisar', day: '2025-11-15' });
  expect(p('Renovar en dos semanas')).toMatchObject({ title: 'Renovar', day: '2025-11-26' });
  expect(p('Planificar la semana que viene')).toMatchObject({ title: 'Planificar', day: '2025-11-17' });
  expect(p('Pagar el 20')).toMatchObject({ title: 'Pagar', day: '2025-11-20' });
  expect(p('Pagar el 5')).toMatchObject({ title: 'Pagar', day: '2025-12-05' });  // el 5 ya pasó
  expect(p('Cena 24 de diciembre')).toMatchObject({ title: 'Cena', day: '2025-12-24' });
  expect(p('Cumple el 3 de marzo')).toMatchObject({ title: 'Cumple', day: '2026-03-03' });  // ya pasó este año
  expect(p('ITV 15/01/2027')).toMatchObject({ title: 'ITV', day: '2027-01-15' });
  expect(p('Entrega 30/11')).toMatchObject({ title: 'Entrega', day: '2025-11-30' });
  expect(p('Imposible el 31 de febrero').day).toBeNull();
});

test('captura rápida: horas', () => {
  expect(p('Reunión mañana a las 10')).toMatchObject({ title: 'Reunión', day: '2025-11-13', time: '10:00' });
  expect(p('Llamada a las 9:30')).toMatchObject({ title: 'Llamada', day: '2025-11-12', time: '09:30' });  // sin fecha: hoy
  expect(p('Cine el viernes a las 8 de la tarde')).toMatchObject({ title: 'Cine', day: '2025-11-14', time: '20:00' });
  expect(p('Correr mañana por la mañana a las 7')).toMatchObject({ title: 'Correr', day: '2025-11-13', time: '07:00' });
  expect(p('Tren 18:45')).toMatchObject({ title: 'Tren', time: '18:45' });
  expect(p('Comida 3pm')).toMatchObject({ title: 'Comida', time: '15:00' });
  expect(p('Leer capítulo 12')).toMatchObject({ title: 'Leer capítulo 12', day: null, time: null });  // un número suelto no es hora
});

test('captura rápida: prioridad, etiquetas, proyecto y repetición', () => {
  expect(p('Enviar factura #Trabajo #q4 !alta @web')).toEqual({
    title: 'Enviar factura', day: null, time: null, priority: 'high', tags: ['trabajo', 'q4'], project: 'web', recurrence: null, estimate: null,
  });
  expect(p('Arreglar servidor !!').priority).toBe('urgent');
  expect(p('Algo p4').priority).toBe('low');
  expect(p('¡Sorpresa! para Ana')).toMatchObject({ title: '¡Sorpresa! para Ana', priority: null });
  expect(p('Regar plantas cada semana')).toMatchObject({ title: 'Regar plantas', recurrence: 'weekly', day: null });
  expect(p('Yoga cada martes a las 19:00')).toMatchObject({ title: 'Yoga', recurrence: 'weekly', day: '2025-11-18', time: '19:00' });
  expect(p('Standup días laborables 9:15')).toMatchObject({ title: 'Standup', recurrence: 'weekdays', time: '09:15' });
  expect(p('Pagar alquiler cada mes el 1')).toMatchObject({ title: 'Pagar alquiler', recurrence: 'monthly', day: '2025-12-01' });
  expect(p('Copia de seguridad cada 2 semanas').recurrence).toBe('biweekly');
});

test('captura rápida: texto normal no se altera', () => {
  for (const title of ['Comprar leche', 'Email a soporte@empresa.com', 'Leer «Hoyos»', 'Issue #123 de GitHub', 'Mañanas productivas']) {
    expect(p(title)).toMatchObject({ title, day: null, time: null, priority: null, project: null, recurrence: null });
  }
  expect(p('  #solo   ')).toMatchObject({ title: '#solo', tags: ['solo'] });
});

test('captura rápida: duración estimada', () => {
  expect(p('Responder correo ~15m')).toMatchObject({ title: 'Responder correo', estimate: 15 });
  expect(p('Llamada ~45 min mañana')).toMatchObject({ title: 'Llamada', estimate: 45, day: '2025-11-13' });
  expect(p('Informe ~2h')).toMatchObject({ title: 'Informe', estimate: 120 });
  expect(p('Revisión ~1h30')).toMatchObject({ title: 'Revisión', estimate: 90 });
  expect(p('Diseño ~1,5h')).toMatchObject({ title: 'Diseño', estimate: 90 });
  expect(p('Tarea de 30 minutos').estimate).toBeNull();  // sin «~» es texto normal
});
