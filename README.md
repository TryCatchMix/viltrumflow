# ViltrumFlow

Gestor de tareas con base de conocimiento enlazada: tareas, tablero, calendario (con Google Calendar),
notas Markdown con `[[enlaces]]` al estilo Obsidian, vista de grafo y panel con gráficos.

**Stack:** FastAPI · SQLAlchemy 2 · PostgreSQL (o SQLite en local) · Angular 19 · CodeMirror 6 · d3-force

## Funciones

| Área | Qué incluye |
| --- | --- |
| **Notas** | Editor Markdown con resaltado, modos edición / dividido / lectura, autoguardado, carpetas, notas fijadas, nota diaria |
| **Enlaces** | `[[Nota]]`, `[[Nota\|alias]]`, autocompletado al escribir `[[`, enlaces entrantes con contexto, creación de la nota al abrir un enlace sin resolver, renombrar una nota actualiza los enlaces que apuntan a ella |
| **Etiquetas** | `#etiqueta` y anidadas `#proyecto/web`, filtro por etiqueta |
| **Grafo** | Notas, enlaces, notas sin crear y (opcional) etiquetas; zoom, arrastre, resaltado de vecinos y búsqueda |
| **Tareas** | Alta rápida, subtareas, comentarios, prioridad, etiquetas, fecha con o sin hora, filtros y agrupación |
| **Recurrentes** | Cada día, días laborables, cada semana, cada 2 semanas, cada mes o cada año: al completar una tarea se crea la siguiente |
| **Recordatorios** | Aviso en el navegador antes del vencimiento y, con SMTP configurado, por email; resumen diario por la mañana |
| **Importar / exportar** | Todas las notas como `.zip` de archivos `.md` (se abre como vault en Obsidian) e importación de un vault o de `.md` sueltos |
| **Casillas de notas** | Los `- [ ]` escritos en cualquier nota aparecen en *Tareas → Casillas de notas* y se pueden marcar desde ahí |
| **Tablero** | Kanban con arrastrar y soltar; el orden se guarda |
| **Calendario** | Vista mensual con tareas y eventos de Google Calendar |
| **Panel** | Actividad diaria, carga pendiente, reparto por estado / prioridad y avance por proyecto |
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

## Google Calendar

La integración es opcional; sin configurar, el resto de la aplicación funciona igual.

1. En [Google Cloud Console](https://console.cloud.google.com/) crea un proyecto y habilita **Google Calendar API**.
2. Configura la **pantalla de consentimiento OAuth** y añade tu cuenta como usuario de prueba.
3. En **Credenciales → Crear credenciales → ID de cliente de OAuth → Aplicación web**, añade como
   **URI de redirección autorizada** `http://localhost:8000/api/v1/calendar/callback`
   (en producción, `https://tu-dominio/api/v1/calendar/callback`).
4. Copia el ID y el secreto a `.env` (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) y reinicia el backend.
5. En la aplicación: **Calendario → Conectar Google Calendar**.

Qué hace:

- Muestra en el calendario los eventos de tu calendario principal (solo lectura).
- Crea un evento por cada tarea con fecha y lo mantiene al día: cambios de título, fecha u hora,
  marca `✓` al completarla y lo elimina si borras la tarea o le quitas la fecha.
- «Sincronizar ahora» envía las tareas que ya existían antes de conectar.
- La sincronización automática se puede desactivar; «Desconectar» revoca el acceso.

Permisos solicitados: `calendar.events` y el email de la cuenta. Los tokens se guardan cifrados.

## Recordatorios y email

- **En el navegador**: en *Ajustes → Recordatorios y avisos* pulsa «Activar». Los avisos llegan mientras
  ViltrumFlow está abierto en una pestaña (no hay notificaciones push con la app cerrada).
- **Por email**: define `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` y `SMTP_FROM` en `.env`, reinicia el
  backend y activa «Recordatorios por email» o «Resumen diario» en Ajustes. El resumen incluye las tareas de hoy
  y las atrasadas, se envía una vez al día a la hora local elegida y se omite si no hay nada pendiente.
- Las tareas de día completo se consideran vencidas a las 9:00 (hora local) a efectos de recordatorio.
- Los correos los envía un planificador dentro del backend. Si ejecutas varias réplicas, deja
  `SCHEDULER_ENABLED=true` solo en una para no duplicar envíos.

## Importar y exportar notas

En *Ajustes → Tus notas*:

- **Exportar** descarga un `.zip` con un archivo `.md` por nota, dentro de sus carpetas.
- **Importar** acepta un `.zip` (por ejemplo, tu carpeta de Obsidian comprimida) o archivos `.md`. El nombre del
  archivo es el título; se ignoran `.obsidian/`, `.trash/` y lo que no sea Markdown. El frontmatter YAML se conserva
  y sus `tags` se reconocen como etiquetas. Las notas que ya existen se omiten salvo que marques «Sobrescribir».
- Límites: 50 MB por importación y 1 MB por nota. Los adjuntos (imágenes, PDF) no se importan.

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
    routers/    auth · tasks · projects · notes · stats · search · reminders · calendar
    services/   markdown · notes · vault (importar/exportar) · recurrence · reminders · mailer · google_calendar
  migrations/   versiones de Alembic
  tests/
frontend/src/app/
  core/      API, sesión, interceptor (renovación de token), tema, utilidades
  layout/    barra lateral y buscador rápido
  pages/     dashboard · tasks · kanban · projects · notes · graph · calendar · settings · auth
  shared/    editor, vista Markdown, gráficos, panel de tarea, iconos
```

## API

Todas las rutas cuelgan de `/api/v1` y, salvo registro e inicio de sesión, requieren `Authorization: Bearer <token>`.

| Recurso | Rutas |
| --- | --- |
| Sesión | `POST /auth/register` · `POST /auth/login` · `POST /auth/refresh` · `GET/PUT/DELETE /auth/me` · `POST /auth/change-password` |
| Tareas | `GET/POST /tasks` · `GET/PUT/DELETE /tasks/{id}` · `PATCH /tasks/{id}/move` · `/tasks/{id}/comments` |
| Proyectos | `GET/POST /projects` · `GET/PUT/DELETE /projects/{id}` |
| Notas | `GET/POST /notes` · `GET/PUT/DELETE /notes/{id}` · `GET /notes/by-title/{título}` · `POST /notes/daily` · `GET /notes/graph` · `GET /notes/tags` · `GET /notes/checklist` · `PATCH /notes/{id}/checklist` · `GET /notes/export` · `POST /notes/import` |
| Otros | `GET /stats/overview` · `GET /search` · `POST /reminders/poll` · `GET /reminders/status` |
| Calendario | `GET /calendar/status` · `GET /calendar/auth-url` · `GET /calendar/events` · `POST /calendar/sync` · `PUT /calendar/settings` · `DELETE /calendar/disconnect` |

## Licencia

MIT
