from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from contextlib import asynccontextmanager
import logging
import time
from .config import settings
from .database import engine, Base, check_db_connection
from .routers import auth, users, tasks, projects, comments

# Configurar logging
logging.basicConfig(
    level=logging.DEBUG if settings.DEBUG else logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


# Lifespan events
@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Gestiona el ciclo de vida de la aplicación
    """
    # Startup
    logger.info(f"Starting {settings.PROJECT_NAME} v{settings.VERSION}")
    logger.info(f"Environment: {settings.ENVIRONMENT}")
    
    # Verificar conexión a BD
    if check_db_connection():
        logger.info("Database connection successful")
    else:
        logger.error("Database connection failed")
    
    # Crear tablas (solo en desarrollo)
    if settings.is_development:
        logger.info("Creating database tables...")
        Base.metadata.create_all(bind=engine)
    
    yield
    
    # Shutdown
    logger.info("Shutting down application...")


# Crear aplicación FastAPI
app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    description="Advanced Task Manager API - ViltrumFlow",
    docs_url="/docs" if settings.DEBUG else None,
    redoc_url="/redoc" if settings.DEBUG else None,
    openapi_url="/openapi.json" if settings.DEBUG else None,
    lifespan=lifespan
)


# ============ Middlewares ============

# CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.BACKEND_CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Total-Count"]
)

# GZip Compression
app.add_middleware(GZipMiddleware, minimum_size=1000)

# Trusted Host (solo en producción)
if settings.is_production:
    app.add_middleware(
        TrustedHostMiddleware,
        allowed_hosts=["viltrumflow.com", "*.viltrumflow.com"]
    )


# ============ Custom Middleware ============

@app.middleware("http")
async def add_process_time_header(request: Request, call_next):
    """Añade header con tiempo de procesamiento"""
    start_time = time.time()
    response = await call_next(request)
    process_time = time.time() - start_time
    response.headers["X-Process-Time"] = str(process_time)
    return response


@app.middleware("http")
async def log_requests(request: Request, call_next):
    """Log de todas las requests"""
    logger.info(f"{request.method} {request.url.path}")
    response = await call_next(request)
    logger.info(f"Status: {response.status_code}")
    return response


# ============ Exception Handlers ============

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """Maneja errores de validación"""
    logger.error(f"Validation error: {exc}")
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={
            "detail": exc.errors(),
            "message": "Validation error"
        }
    )


@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    """Maneja excepciones generales"""
    logger.error(f"Unhandled exception: {str(exc)}", exc_info=True)
    
    if settings.is_production:
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"detail": "Internal server error"}
        )
    else:
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={
                "detail": str(exc),
                "type": type(exc).__name__
            }
        )


# ============ Routes ============

@app.get("/", tags=["Root"])
async def root():
    """Root endpoint"""
    return {
        "name": settings.PROJECT_NAME,
        "version": settings.VERSION,
        "status": "running",
        "environment": settings.ENVIRONMENT
    }


@app.get("/health", tags=["Health"])
async def health_check():
    """Health check endpoint"""
    db_status = check_db_connection()
    
    return {
        "status": "healthy" if db_status else "unhealthy",
        "database": "connected" if db_status else "disconnected",
        "timestamp": time.time()
    }


@app.get("/info", tags=["Info"])
async def app_info():
    """Application information"""
    return {
        "name": settings.PROJECT_NAME,
        "version": settings.VERSION,
        "environment": settings.ENVIRONMENT,
        "debug": settings.DEBUG,
        "cors_origins": settings.BACKEND_CORS_ORIGINS,
    }


# ============ Include Routers ============

# Prefix para API v1
API_PREFIX = settings.API_V1_STR

# Auth router
app.include_router(
    auth.router,
    prefix=f"{API_PREFIX}/auth",
    tags=["Authentication"]
)

# Users router
app.include_router(
    users.router,
    prefix=f"{API_PREFIX}/users",
    tags=["Users"]
)

# Projects router
app.include_router(
    projects.router,
    prefix=f"{API_PREFIX}/projects",
    tags=["Projects"]
)

# Tasks router
app.include_router(
    tasks.router,
    prefix=f"{API_PREFIX}/tasks",
    tags=["Tasks"]
)

# Comments router
app.include_router(
    comments.router,
    prefix=f"{API_PREFIX}/comments",
    tags=["Comments"]
)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=settings.is_development
    )