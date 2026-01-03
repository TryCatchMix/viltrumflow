from sqlalchemy import create_engine, event
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session
from sqlalchemy.pool import QueuePool
from typing import Generator
import logging
from .config import settings

logger = logging.getLogger(__name__)

# Configuración del engine con pool de conexiones
engine = create_engine(
    settings.DATABASE_URL,
    poolclass=QueuePool,
    pool_size=10,
    max_overflow=20,
    pool_pre_ping=True,  # Verifica conexiones antes de usarlas
    pool_recycle=3600,   # Recicla conexiones cada hora
    echo=settings.DB_ECHO,
    connect_args={
        "connect_timeout": 10,
        "keepalives": 1,
        "keepalives_idle": 30,
        "keepalives_interval": 10,
        "keepalives_count": 5,
    }
)

# SessionLocal class
SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine
)

# Base class for models
Base = declarative_base()


# Event listeners para logging
@event.listens_for(engine, "connect")
def receive_connect(dbapi_conn, connection_record):
    """Log cuando se establece una nueva conexión"""
    logger.debug("Database connection established")


@event.listens_for(engine, "checkout")
def receive_checkout(dbapi_conn, connection_record, connection_proxy):
    """Log cuando se obtiene una conexión del pool"""
    logger.debug("Connection checked out from pool")


# Dependency para obtener sesión de DB
def get_db() -> Generator[Session, None, None]:
    """
    Dependency que proporciona una sesión de base de datos.
    Se asegura de cerrar la sesión después de cada request.
    """
    db = SessionLocal()
    try:
        yield db
    except Exception as e:
        logger.error(f"Database session error: {str(e)}")
        db.rollback()
        raise
    finally:
        db.close()


# Función para inicializar la base de datos
def init_db() -> None:
    """
    Crea todas las tablas en la base de datos.
    Solo usar en desarrollo. En producción usar Alembic.
    """
    try:
        Base.metadata.create_all(bind=engine)
        logger.info("Database tables created successfully")
    except Exception as e:
        logger.error(f"Error creating database tables: {str(e)}")
        raise


# Función para verificar la conexión
def check_db_connection() -> bool:
    """
    Verifica que la conexión a la base de datos funcione correctamente.
    """
    try:
        with engine.connect() as connection:
            connection.execute("SELECT 1")
        logger.info("Database connection check successful")
        return True
    except Exception as e:
        logger.error(f"Database connection check failed: {str(e)}")
        return False