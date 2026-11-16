import logging
from typing import Generator

from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import StaticPool

from .config import settings

logger = logging.getLogger(__name__)

DATABASE_URL = settings.DATABASE_URL
if DATABASE_URL.startswith(("postgresql://", "postgres://")):
    # Driver explícito: el predeterminado de SQLAlchemy para "postgresql://" depende de la versión
    DATABASE_URL = "postgresql+psycopg2://" + DATABASE_URL.split("://", 1)[1]
_is_sqlite = DATABASE_URL.startswith("sqlite")

if _is_sqlite:
    _kwargs = {"connect_args": {"check_same_thread": False}}
    if DATABASE_URL in ("sqlite://", "sqlite:///:memory:"):
        _kwargs["poolclass"] = StaticPool
    engine = create_engine(DATABASE_URL, echo=settings.DB_ECHO, **_kwargs)

    @event.listens_for(engine, "connect")
    def _sqlite_fk(dbapi_conn, _record):  # SQLite ignora las FK si no se activa
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()
else:
    engine = create_engine(
        DATABASE_URL,
        pool_size=10,
        max_overflow=20,
        pool_pre_ping=True,
        pool_recycle=3600,
        echo=settings.DB_ECHO,
    )

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


BASELINE = "0001"  # esquema de la versión 2.0, anterior a las migraciones


def init_db() -> None:
    """Lleva el esquema a la última versión con Alembic (se ejecuta al arrancar)."""
    from pathlib import Path

    from alembic import command
    from alembic.config import Config
    from sqlalchemy import inspect

    root = Path(__file__).resolve().parent.parent
    cfg = Config(str(root / "alembic.ini"))
    cfg.set_main_option("script_location", str(root / "migrations"))
    with engine.begin() as conn:
        cfg.attributes["connection"] = conn
        tables = set(inspect(conn).get_table_names())
        if "users" in tables and "alembic_version" not in tables:
            # Base creada con create_all antes de existir las migraciones: se marca como línea base
            command.stamp(cfg, BASELINE)
        command.upgrade(cfg, "head")


def check_db_connection() -> bool:
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception as exc:  # pragma: no cover
        logger.error("Database connection check failed: %s", exc)
        return False
