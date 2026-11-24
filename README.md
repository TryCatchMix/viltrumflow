# ViltrumFlow

Gestor de tareas con base de conocimiento enlazada: tareas, tablero, calendario (con Google Calendar),
notas Markdown con `[[enlaces]]` al estilo Obsidian, vista de grafo y panel con gráficos.

**Stack:** FastAPI · SQLAlchemy 2 · PostgreSQL (o SQLite en local) · Angular 19 · CodeMirror 6 · d3-force

## Funciones

| Área | Qué incluye |
| --- | --- |
| **Notas** | Editor Markdown con resaltado, modos edición / dividido / lectura, autoguardado, carpetas, notas fijadas, nota diaria |
| **Imágenes** | Pega, arrastra o elige una imagen en el editor (PNG, JPEG, GIF, WebP; 5 MB); son privadas y viajan en la exportación e importación |
| **Enlaces** | `[[Nota]]`, `[[Nota\|alias]]`, autocompletado al escribir `[[`, enlaces entrantes con contexto, creación de la nota al abrir un enlace sin resolver, renombrar una nota actualiza los enlaces que apuntan a ella |
| **Secciones e incrustaciones** | `[[Nota#Sección]]` abre la nota en ese encabezado; `![[Nota]]` y `![[Nota#Sección]]` muestran su contenido dentro de otra |
| **Menciones sin enlazar** | Detecta las notas que nombran a la actual sin enlazarla y las convierte en enlace con un clic |
| **Plantillas** | Las notas de la carpeta `Plantillas` sirven de modelo (`{{title}}`, `{{date}}`, `{{time}}`); la plantilla «Diario» se usa para la nota diaria |
| **Historial** | Versiones anteriores de cada nota, con vista previa y restauración |
| **Etiquetas** | `#etiqueta` y anidadas `#proyecto/web`, filtro por etiqueta |
| **Grafo** | Notas, enlaces, notas sin crear y (opcional) etiquetas; zoom, arrastre, resaltado de vecinos y búsqueda. Cada nota muestra además su grafo local |
| **Captura rápida** | «Llamar a Juan mañana a las 10 ~15m #trabajo !alta @web cada semana» rellena fecha, hora, duración, etiquetas, prioridad, proyecto y repetición |
| **Hoy** | Lista diaria al estilo de una checklist: rutinas y tareas del día, objetivos de la semana y aviso de revisión pendiente |
| **Rutinas flexibles** | Días concretos o «N veces por semana», cantidad diaria («8 vasos») y aviso a la hora prevista |
| **Planificador del día** | Vista *Día* del calendario: arrastra tareas y rutinas a una hora, mueve bloques y alarga su duración |
| **Revisión semanal** | Resumen de la semana, reprogramar lo atrasado y fijar objetivos para la siguiente |
| **Avisos con la app cerrada** | Notificaciones Web Push de recordatorios, rutinas, tareas asignadas y fin del Pomodoro |
| **Estadísticas de rutinas** | Qué se cumple y qué no día a día, porcentaje, rachas, a qué hora se marcan, puntualidad frente a la hora prevista y cumplimiento por día de la semana |
| **Pomodoro** | Reloj configurable (concentración, descansos, bloques por serie, inicio automático, sonido y aviso); cada bloque suma tiempo a la tarea elegida |
| **Progreso** | Experiencia por tareas, rutinas y concentración; niveles, diez rangos del Imperio, logros y gráficos |
| **Misiones y recompensas** | Tres misiones semanales con experiencia y monedas, protector de racha y premios propios que se canjean con monedas |
| **Tareas** | Alta rápida, subtareas, comentarios, prioridad, etiquetas, fecha con o sin hora, filtros y agrupación |
| **Recurrentes** | Cada día, días laborables, cada semana, cada 2 semanas, cada mes o cada año: al completar una tarea se crea la siguiente |
| **Recordatorios** | Aviso en el navegador antes del vencimiento y, con SMTP configurado, por email; resumen diario por la mañana |
| **Importar / exportar** | Todas las notas como `.zip` de archivos `.md` (se abre como vault en Obsidian) e importación de un vault o de `.md` sueltos |
| **Casillas de notas** | Los `- [ ]` escritos en cualquier nota aparecen en *Tareas → Casillas de notas*, se marcan desde ahí y se pueden convertir en tareas enlazadas a la nota |
| **Tablero** | Kanban con arrastrar y soltar; el orden se guarda |
| **Calendario** | Vistas de mes y semana con tareas y eventos de Google Calendar; arrastra una tarea a otro día para cambiar su fecha |
| **Tiempo** | Cronómetro por tarea, corrección manual y comparación con la estimación en el panel |
| **Panel** | Actividad diaria, carga pendiente, reparto por estado / prioridad y avance por proyecto |
| **Proyectos compartidos** | Invita a otros usuarios como editores o con solo lectura, asigna tareas a un responsable y recibe aviso cuando te asignan una |
| **Papelera** | Las notas y tareas eliminadas se pueden restaurar durante 30 días |
| **Sin conexión** | Instalable como aplicación (PWA): se abre sin red, muestra lo ya consultado y permite seguir escribiendo notas |
| **General** | Buscador y comandos con `Ctrl/⌘ + K`, tema claro/oscuro, diseño adaptable a móvil |

## Puesta en marcha

### Con Docker

```bash
cp .env.example .env        # opcional en desarrollo
docker compose up --build
```

- Aplicación: http://localhost:4200
- Documentación de la API: http://localhost:8000/docs

### Sin Docker

```bash
# Backend (usa SQLite si no defines DATABASE_URL)
cd backend
python -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
uvicorn app.main:app --reload

# Frontend, en otra terminal
cd frontend
npm install
npm start
```

### Tests

```bash
cd backend && pytest
# contra PostgreSQL:
TEST_DATABASE_URL=postgresql://usuario:clave@localhost:5432/viltrumflow_test pytest
```

Pruebas de navegador (Playwright), contra la build de producción. Arrancan solas el backend y la app:

```bash
cd frontend
npx playwright install chromium   # solo la primera vez
npm run e2e                       # compila y ejecuta; `npm run e2e:only` reutiliza la build
```

Cada push y cada pull request ejecutan en GitHub Actions los tests del backend (SQLite y PostgreSQL), las
pruebas de navegador y la construcción y arranque de las imágenes Docker (`.github/workflows/ci.yml`).

## Iniciar sesión con Google

Usa el mismo cliente OAuth que Google Calendar (pasos de la sección siguiente). Basta con añadir una
segunda **URI de redirección autorizada**: `http://localhost:8000/api/v1/auth/google/callback`
(en producción, `https://tu-dominio/api/v1/auth/google/callback`). Con `GOOGLE_CLIENT_ID` y
`GOOGLE_CLIENT_SECRET` definidos aparece el botón **Continuar con Google** al entrar y al registrarse
(`GOOGLE_LOGIN_ENABLED=false` lo oculta y deja solo Calendar).

- **Primera vez**: se crea la cuenta con el nombre, email y foto de Google, y las notas de bienvenida. Para
  entrar también con usuario y contraseña, elige una en **Ajustes → Contraseña** (no pide la actual).
- **Cuenta que ya existía**: entra con tu contraseña y pulsa **Ajustes → Vincular cuenta de Google**. Por
  seguridad no se vincula sola aunque el email coincida: alguien pudo registrar ese email sin ser su dueño.
- La cuenta queda ligada a la identidad de Google, no al email: si cambias el email de Google sigues entrando.
- **Desvincular** solo es posible si la cuenta tiene contraseña (si no, no podrías volver a entrar).
- Seguridad del flujo: `state` firmado y un nonce en cookie que liga la vuelta de Google al navegador que lo
  empezó; los tokens de sesión nunca viajan en la URL (la SPA canjea un código de un solo uso de 2 minutos).

## Google Calendar

La integración es opcional; sin configurar, el resto de la aplicación funciona igual.

1. En [Google Cloud Console](https://console.cloud.google.com/) crea un proyecto y habilita **Google Calendar API**.
2. Configura la **pantalla de consentimiento OAuth** y añade tu cuenta como usuario de prueba.
3. En **Credenciales → Crear credenciales → ID de cliente de OAuth → Aplicación web**, añade como
   **URI de redirección autorizada** `http://localhost:8000/api/v1/calendar/callback`
   (en producción, `https://tu-dominio/api/v1/calendar/callback`). Para iniciar sesión con Google añade
   también `…/api/v1/auth/google/callback`.
4. Copia el ID y el secreto a `.env` (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) y reinicia el backend.
5. En la aplicación: **Calendario → Conectar Google Calendar**.

Qué hace:

- Muestra en el calendario los eventos de tu calendario principal (solo lectura).
- Crea un evento por cada tarea con fecha y lo mantiene al día: cambios de título, fecha u hora,
  marca `✓` al completarla y lo elimina si borras la tarea o le quitas la fecha.
- **En ambos sentidos**: si mueves de día u hora o renombras en Google el evento de una tarea, la tarea se
  actualiza (cada 10 minutos, o al momento con «Sincronizar ahora»). Si borras el evento, la tarea se conserva y
  deja de estar enlazada.
- «Sincronizar ahora» envía las tareas que ya existían antes de conectar.
- La sincronización automática se puede desactivar; «Desconectar» revoca el acceso.

- Puedes elegir en qué calendario se crean los eventos de las tareas (por defecto, el principal).

Permisos solicitados: `calendar.events`, la lista de tus calendarios (solo lectura) y el email de la cuenta.
Si conectaste la cuenta antes de existir la elección de calendario, desconecta y vuelve a conectar para concederlo. Los tokens se guardan cifrados.

## Rutinas, Pomodoro y progreso

**Hoy** reúne las rutinas del día y las tareas con fecha de hoy (más las atrasadas). Una rutina es un check que
vuelve a aparecer cada día que le toca; se crea escribiéndola en «Añadir rutina diaria» y en la pestaña *Rutinas*
se configura:

- **Frecuencia**: días concretos de la semana, o «N veces por semana» (aparece todos los días y se cumple al llegar a N).
- **Cantidad diaria**: por ejemplo 8 vasos o 20 páginas; se suma con los botones − y +, y cuenta como hecha al llegar.
- **Hora prevista** y, si quieres, **aviso** a esa hora mientras siga pendiente (en la app, o con la app cerrada si
  activaste los avisos push).

Si olvidaste marcar algo, puedes volver hasta 7 días atrás.

**Planificar por horas** (vista *Día* del calendario, o el enlace desde «Hoy»): las tareas del día sin hora, las
atrasadas y las rutinas sin hora esperan en «Por colocar». Arrástralas a una franja (en tramos de 15 minutos), mueve
los bloques, alarga su duración tirando del borde inferior o devuélvelas a «Por colocar» para quitarles la hora. La
duración de un bloque es la estimación de la tarea (30 minutos si no tiene); con Google Calendar conectado, el evento
dura lo mismo.

**Revisión semanal** (menú lateral; «Hoy» la recuerda de viernes a martes): tres pasos con el resumen de la semana,
lo que se quedó atrás para reprogramarlo, darlo por hecho o archivarlo, y hasta 5 objetivos para la semana siguiente
que luego se ven y se marcan en «Hoy». Terminarla da 30 XP una vez por semana.

La pestaña **Estadísticas** muestra, para 14, 30 o 90 días: porcentaje de cumplimiento, días completos, rachas,
una cuadrícula día a día (cumplida / no cumplida / pendiente / no tocaba), a qué hora sueles marcarlas y qué
porcentaje se hizo antes de su hora prevista. El día en curso no cuenta como fallo hasta que termina.

**Enfoque** es un reloj Pomodoro. Se ajustan los minutos de concentración y de descanso, los bloques por serie, el
inicio automático, el sonido y la notificación. Sigue corriendo al cambiar de página o cerrar la pestaña. Al terminar
un bloque, su tiempo se suma a la tarea elegida.

**Progreso** convierte todo eso en experiencia (XP):

| Origen | Experiencia |
| --- | --- |
| Tarea completada | 10 / 20 / 40 / 80 según la dificultad (fácil, normal, difícil, épica) |
| Esfuerzo | +1 por cada 5 minutos registrados en la tarea (máx. 60); sin registro, +1 por cada 12 minutos estimados (máx. 40) |
| Puntualidad y prioridad | +25 % de la base si se termina antes de su fecha; +3 prioridad alta, +5 urgente |
| Subtarea | 5 |
| Rutina | 5 / 10 / 15 / 25 según la dificultad, +1 por día de racha (máx. 10) |
| Concentración | 1 por cada 5 minutos de bloque terminado |
| Revisión semanal | 30, una vez por semana |
| Misión semanal | 40 a 80 según la misión, más monedas |

Reabrir una tarea o desmarcar una rutina retira su experiencia, y cada cosa puntúa una sola vez. En un proyecto
compartido, la experiencia es para quien completa la tarea. Cada nivel pide 100 XP más que el anterior
(nivel 2 a los 100, nivel 3 a los 300, nivel 4 a los 600…). Los rangos se alcanzan por nivel:
Aspirante (1), Recluta (3), Soldado (5), Guerrero (8), Veterano (12), Centurión (16), Conquistador (20),
Comandante (25), General (30) y Regente del Imperio (40).

## Misiones, monedas y recompensas

En **Misiones** (menú lateral):

- **Misiones de la semana**: tres retos que se eligen el lunes según lo que sueles hacer (un 20 % por encima de tu
  media de las cuatro semanas anteriores, con un mínimo). Por ejemplo «Completa 8 tareas», «Completa 2 tareas difíciles
  o épicas», «Termina 4 tareas antes de su fecha», «Cumple todas tus rutinas 3 días», «Concéntrate 150 minutos» o «Haz
  la revisión de esta semana». Si tienes rutinas, siempre hay una de rutinas. Al completarlas se reclama su
  recompensa (experiencia y monedas); reclamar las tres abre el **cofre semanal**, que regala un protector de racha.
- **Monedas**: 1 por cada 10 XP ganados, más las de las misiones. Si se retira experiencia (al reabrir una tarea o
  desmarcar una rutina), también se retiran sus monedas.
- **Protector de racha**: cuesta 50 monedas y se pueden tener 2. Cuando termina un día en el que no cumpliste una
  rutina diaria que llevaba racha, se gasta solo y la racha se salva: ese día no la alarga, pero tampoco la rompe, y en
  las estadísticas aparece como «salvada» (no cuenta ni a favor ni en contra del cumplimiento). Si después marcas ese
  día como hecho, el protector se devuelve. Las rutinas «N veces por semana» no lo necesitan.
- **Recompensas propias**: premios que te pones tú («una tarde libre», «comprarme el libro») con un precio en monedas;
  pueden repetirse o ser de una sola vez. Un canje se puede deshacer desde el historial de movimientos.

## Recordatorios y email

- **Con la app cerrada (Web Push)**: en *Ajustes → Recordatorios y avisos → Avisos con la app cerrada* pulsa
  «Activar» en cada dispositivo. Llegan los recordatorios de tareas, las rutinas a su hora, las tareas que te asignan
  y el final de cada fase del Pomodoro. Requiere la versión publicada por HTTPS (o `localhost`), no `ng serve`; en
  iPhone y iPad, con la app añadida a la pantalla de inicio (iOS 16.4 o posterior). Las claves VAPID se generan solas
  la primera vez; `VAPID_SUBJECT` (opcional) identifica el servidor ante los servicios de push (`mailto:` o `https://`).

- **En el navegador**: en *Ajustes → Recordatorios y avisos* pulsa «Activar». Los avisos llegan mientras
  ViltrumFlow está abierto en una pestaña (no hay notificaciones push con la app cerrada).
- **Por email**: define `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` y `SMTP_FROM` en `.env`, reinicia el
  backend y activa «Recordatorios por email» o «Resumen diario» en Ajustes. El resumen incluye las tareas de hoy
  y las atrasadas, se envía una vez al día a la hora local elegida y se omite si no hay nada pendiente.
- Las tareas de día completo se consideran vencidas a las 9:00 (hora local) a efectos de recordatorio.
- Los correos los envía un planificador dentro del backend. Si ejecutas varias réplicas, deja
  `SCHEDULER_ENABLED=true` solo en una para no duplicar envíos.

## Proyectos compartidos

En *Proyectos*, el botón de personas de cada tarjeta abre «Compartir»:

- Se invita por **nombre de usuario o email exactos** a alguien que ya tenga cuenta.
- **Puede editar**: crea, modifica, mueve y elimina tareas del proyecto. **Solo lectura**: las ve y puede comentar.
- Solo el propietario edita, archiva o elimina el proyecto y gestiona quién tiene acceso. Cualquier miembro puede salirse.
- Dentro de un proyecto compartido todas sus tareas son visibles para todos los miembros. Las notas y las tareas sin
  proyecto son siempre privadas.
- Una tarea se puede **asignar** a cualquier participante. El responsable recibe un aviso en la app (y por email si
  tiene activados los recordatorios por email); los recordatorios y el panel de inicio cuentan las tareas de las que
  cada uno es responsable.
- Quien pierde el acceso a un proyecto deja de ver sus tareas, incluidas las que creó dentro. Si el proyecto se
  elimina, cada tarea vuelve a quien la creó.
- Google Calendar sincroniza cada tarea con el calendario de quien la creó.

## Papelera

Eliminar una nota o una tarea la envía a la *Papelera*, desde donde se restaura o se borra definitivamente. Pasados
30 días se elimina sola. Al restaurar una nota se reconstruyen sus enlaces; si entretanto creaste otra con el mismo
título, vuelve como «Título (restaurada)». Las subtareas eliminadas una a una y los proyectos no pasan por la papelera.

## Uso sin conexión (PWA)

Disponible en la build de producción (no con `ng serve`) y servida por HTTPS o en `localhost`:

- **Instalar**: el navegador ofrece «Instalar ViltrumFlow» en la barra de direcciones o en su menú.
- **Leer sin red**: la aplicación se abre y muestra las tareas, notas y proyectos que ya habías consultado con conexión.
- **Escribir notas sin red**: los cambios se guardan en el dispositivo y se envían al reconectar. Si la nota cambió
  mientras tanto en otro sitio, no se sobrescribe: tu versión se guarda como «Título (copia sin conexión)».
- **Crear tareas y notas sin red**: se guardan en el dispositivo marcadas como «pendiente» (se pueden corregir o
  borrar) y se envían al reconectar.
- **Lo demás necesita conexión**: modificar tareas que ya existen, proyectos, comentarios o subir imágenes sin red
  muestra un aviso y no se guarda.
- Al cerrar sesión se borran del dispositivo los datos guardados para uso sin conexión.

## Importar y exportar notas

En *Ajustes → Tus notas*:

- **Exportar** descarga un `.zip` con un archivo `.md` por nota, dentro de sus carpetas.
- **Importar** acepta un `.zip` (por ejemplo, tu carpeta de Obsidian comprimida) o archivos `.md`. El nombre del
  archivo es el título; se ignoran `.obsidian/`, `.trash/` y lo que no sea Markdown. El frontmatter YAML se conserva
  y sus `tags` se reconocen como etiquetas. Las notas que ya existen se omiten salvo que marques «Sobrescribir».
- Las imágenes viajan con las notas: la exportación las guarda en `adjuntos/` y la importación sube las que las
  notas referencian, tanto `![](ruta)` como `![[imagen.png]]`.
- Límites: 50 MB por importación, 1 MB por nota y 5 MB por imagen. Otros adjuntos (PDF, audio) no se importan.

## Migraciones de base de datos

El esquema se gestiona con Alembic y se actualiza solo al arrancar el backend. Una base creada con la
versión anterior (sin migraciones) se detecta y se actualiza conservando los datos.

```bash
cd backend
alembic revision --autogenerate -m "describe el cambio"   # tras modificar app/models.py
alembic upgrade head                                       # también se ejecuta al arrancar
```

Revisa siempre la migración generada. En SQLite evita el modo «batch» (recrea la tabla y el borrado en
cascada eliminaría filas relacionadas); añadir o quitar columnas funciona sin él.

## Seguridad de las cuentas

- **Límite de intentos**: tras 5 inicios de sesión fallidos de una misma IP para una cuenta (configurable con
  `LOGIN_MAX_ATTEMPTS` y `LOGIN_WINDOW_MINUTES`), se bloquean más intentos durante 15 minutos. El contador vive en la
  memoria del backend: con varias réplicas, cada una cuenta por separado.
- **Recuperar contraseña**: «¿Has olvidado tu contraseña?» envía por email un enlace de un solo uso que caduca a los
  30 minutos. Necesita SMTP configurado; sin él, la pantalla lo indica.
- **Cierre de sesiones**: cambiar o restablecer la contraseña invalida todas las sesiones abiertas en otros dispositivos.

## Copias de seguridad

En producción, el servicio `backup` guarda una copia de la base de datos al arrancar y después cada 24 horas en
`BACKUP_DIR` (por defecto `./backups`), y conserva las de los últimos `BACKUP_KEEP_DAYS` días (14). Cada copia se
verifica antes de darla por buena. Junto a cada copia se guarda un `…-imagenes.tar.gz` con las imágenes de las notas,
que viven en el volumen `uploads` y no en la base de datos. **Las copias quedan en el mismo servidor**: cópialas además a otro sitio
(otro disco, almacenamiento en la nube) para que sobrevivan a un fallo de la máquina.

```bash
C="docker compose -f docker-compose.prod.yml"
$C exec backup sh /usr/local/bin/backup.sh once      # copia inmediata
ls backups/

# Restaurar (sustituye el contenido actual de la base de datos)
$C stop backend
$C exec backup sh /usr/local/bin/backup.sh restore /backups/viltrumflow-AAAAMMDD-HHMMSS.dump
$C start backend
```

## Producción

```bash
cp .env.example .env   # define DB_*, SECRET_KEY y PUBLIC_URL
docker compose -f docker-compose.prod.yml up -d --build
```

El contenedor `web` (nginx) sirve la aplicación y redirige `/api/` al backend. Escucha en HTTP: coloca
delante tu terminación TLS (Caddy, Traefik, un balanceador…).

## Estructura

```
backend/
  app/
    main.py  config.py  database.py  models.py  schemas.py  security.py  deps.py
    routers/    auth · tasks · projects · notes · habits · pomodoro · game · stats · search · reminders · trash · attachments · calendar
    services/   markdown · notes · vault (importar/exportar) · access (permisos) · trash · recurrence · reminders · notify (push) · mailer · game · economy · missions · google_calendar
  migrations/   versiones de Alembic
  tests/
frontend/src/app/
  core/      API, sesión, interceptor (renovación de token), tema, avisos, borradores sin conexión, utilidades
  layout/    barra lateral y buscador rápido
  pages/     dashboard · today · focus · review · missions · progress · tasks · kanban · projects · notes · graph · calendar · trash · settings · auth
  shared/    editor, vista Markdown, gráficos, panel de tarea, iconos
```

## API

Todas las rutas cuelgan de `/api/v1` y, salvo registro e inicio de sesión, requieren `Authorization: Bearer <token>`.

| Recurso | Rutas |
| --- | --- |
| Sesión | `POST /auth/register` · `POST /auth/login` · `POST /auth/refresh` · `GET/PUT/DELETE /auth/me` · `POST /auth/change-password` · `GET /auth/providers` |
| Google (acceso) | `GET /auth/google/start` · `GET /auth/google/callback` · `POST /auth/google/exchange` · `POST /auth/google/link-ticket` · `DELETE /auth/google/link` |
| Tareas | `GET/POST /tasks` · `GET/PUT/DELETE /tasks/{id}` · `PATCH /tasks/{id}/move` · `/tasks/{id}/comments` |
| Proyectos | `GET/POST /projects` · `GET/PUT/DELETE /projects/{id}` · `GET/POST /projects/{id}/members` · `PUT/DELETE /projects/{id}/members/{user_id}` |
| Rutinas | `GET/POST /habits` · `PUT/DELETE /habits/{id}` · `GET /habits/day` · `PUT /habits/{id}/check` · `GET /habits/stats` |
| Avisos push y revisión | `GET /push/key` · `POST /push/subscribe` · `POST /push/unsubscribe` · `POST /push/test` · `GET/PUT /review` · `POST /review/complete` · `GET /review/today` · `PUT /review/goal` |
| Pomodoro y progreso | `GET/PUT /pomodoro/settings` · `POST /pomodoro/sessions` · `GET /pomodoro/stats` · `GET /game/profile` · `GET /game/history` |
| Misiones y recompensas | `GET /game/wallet` · `POST /game/freezes/buy` · `GET /game/missions` · `POST /game/missions/{key}/claim` · `GET/POST /game/rewards` · `PUT/DELETE /game/rewards/{id}` · `POST /game/rewards/{id}/redeem` · `GET /game/coins/history` · `DELETE /game/coins/{id}` |
| Papelera | `GET/DELETE /trash` · `POST /trash/{note\|task}/{id}/restore` · `DELETE /trash/{note\|task}/{id}` |
| Notas | `GET/POST /notes` · `GET/PUT/DELETE /notes/{id}` · `GET /notes/by-title/{título}` · `POST /notes/daily` · `GET /notes/graph` · `GET /notes/tags` · `GET /notes/checklist` · `PATCH /notes/{id}/checklist` · `GET /notes/export` · `POST /notes/import` |
| Otros | `GET /stats/overview` · `GET /search` · `POST /reminders/poll` · `GET /reminders/status` |
| Calendario | `GET /calendar/status` · `GET /calendar/auth-url` · `GET /calendar/events` · `POST /calendar/sync` · `PUT /calendar/settings` · `DELETE /calendar/disconnect` |

## Licencia

MIT
