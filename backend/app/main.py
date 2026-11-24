import asyncio
import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware

from .config import settings
from .database import SessionLocal, check_db_connection, init_db
from .routers import attachments, auth, calendar, goals, google_auth, game, habits, pomodoro, push, review, notes, projects, reminders, search, stats, tasks, trash
from datetime import datetime, timezone

from .services import google_calendar as gcal
from .services import notify
from .services.reminders import run_tick

logging.basicConfig(
    level=logging.DEBUG if settings.DEBUG else logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("viltrumflow")


def _tick(full: bool) -> None:
    now = datetime.now(timezone.utc)
    with SessionLocal() as db:
        notify.push_pomodoro(db, now)  # el fin de un Pomodoro se avisa con precisión de segundos
        if full:
            run_tick(db, now)
            notify.push_notices(db, now)
            gcal.pull_all(db)


async def _scheduler() -> None:
    """
    Cada 15 s avisa del fin de los Pomodoro; cada minuto envía recordatorios (correo y push), resúmenes,
    purga la papelera y trae cambios de Google Calendar.
    """
    n = 0
    while True:
        try:
            await asyncio.to_thread(_tick, n % 4 == 0)
        except Exception:
            logger.exception("Fallo en el planificador de avisos")
        n += 1
        await asyncio.sleep(15)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting %s v%s (%s)", settings.PROJECT_NAME, settings.VERSION, settings.ENVIRONMENT)
    init_db()
    scheduler = None
    if settings.SCHEDULER_ENABLED:  # correos (si hay SMTP) y purga de la papelera
        scheduler = asyncio.create_task(_scheduler())
    yield
    if scheduler:
        scheduler.cancel()


app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    description="ViltrumFlow API — tareas, proyectos, notas enlazadas y Google Calendar",
    docs_url=None if settings.is_production else "/docs",
    redoc_url=None if settings.is_production else "/redoc",
    openapi_url=None if settings.is_production else "/openapi.json",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.BACKEND_CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(GZipMiddleware, minimum_size=1000)
if settings.ALLOWED_HOSTS != ["*"]:
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.ALLOWED_HOSTS)


@app.middleware("http")
async def process_time(request: Request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    response.headers["X-Process-Time"] = f"{time.perf_counter() - start:.4f}"
    return response


@app.get("/", tags=["Root"])
def root():
    return {"name": settings.PROJECT_NAME, "version": settings.VERSION, "status": "running"}


@app.get("/health", tags=["Health"])
def health():
    ok = check_db_connection()
    return {"status": "healthy" if ok else "unhealthy", "database": "connected" if ok else "disconnected"}


P = settings.API_V1_STR
app.include_router(auth.router, prefix=f"{P}/auth", tags=["Auth"])
app.include_router(google_auth.router, prefix=f"{P}/auth/google", tags=["Auth"])
app.include_router(projects.router, prefix=f"{P}/projects", tags=["Projects"])
app.include_router(tasks.router, prefix=f"{P}/tasks", tags=["Tasks"])
app.include_router(notes.router, prefix=f"{P}/notes", tags=["Notes"])
app.include_router(stats.router, prefix=f"{P}/stats", tags=["Stats"])
app.include_router(search.router, prefix=f"{P}/search", tags=["Search"])
app.include_router(attachments.router, prefix=f"{P}/attachments", tags=["Attachments"])
app.include_router(habits.router, prefix=f"{P}/habits", tags=["Habits"])
app.include_router(pomodoro.router, prefix=f"{P}/pomodoro", tags=["Pomodoro"])
app.include_router(game.router, prefix=f"{P}/game", tags=["Game"])
app.include_router(push.router, prefix=f"{P}/push", tags=["Push"])
app.include_router(review.router, prefix=f"{P}/review", tags=["Review"])
app.include_router(goals.router, prefix=f"{P}/goals", tags=["Goals"])
app.include_router(trash.router, prefix=f"{P}/trash", tags=["Trash"])
app.include_router(reminders.router, prefix=f"{P}/reminders", tags=["Reminders"])
app.include_router(calendar.router, prefix=f"{P}/calendar", tags=["Calendar"])
