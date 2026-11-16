from functools import lru_cache
from typing import List, Optional

from pydantic_settings import BaseSettings, SettingsConfigDict

INSECURE_SECRET = "dev-insecure-secret-change-me-please-32chars"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", case_sensitive=True, extra="ignore")

    PROJECT_NAME: str = "ViltrumFlow"
    VERSION: str = "2.0.0"
    API_V1_STR: str = "/api/v1"
    ENVIRONMENT: str = "development"
    DEBUG: bool = True

    # SQLite por defecto para poder arrancar sin infraestructura; Postgres en Docker.
    DATABASE_URL: str = "sqlite:///./viltrumflow.db"
    DB_ECHO: bool = False

    SECRET_KEY: str = INSECURE_SECRET
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # Protección del inicio de sesión: intentos fallidos permitidos por IP y usuario en la ventana
    LOGIN_MAX_ATTEMPTS: int = 5
    LOGIN_WINDOW_MINUTES: int = 15
    PASSWORD_RESET_MINUTES: int = 30

    BACKEND_CORS_ORIGINS: List[str] = ["http://localhost:4200", "http://localhost"]
    ALLOWED_HOSTS: List[str] = ["*"]

    # URL pública del frontend (destino tras el OAuth de Google)
    FRONTEND_URL: str = "http://localhost:4200"

    # Google Calendar (opcional). Sin estas variables la integración aparece como "no configurada".
    GOOGLE_CLIENT_ID: Optional[str] = None
    GOOGLE_CLIENT_SECRET: Optional[str] = None
    GOOGLE_REDIRECT_URI: str = "http://localhost:8000/api/v1/calendar/callback"

    # Email (opcional): recordatorios y resumen diario. Sin SMTP_HOST solo hay avisos en el navegador.
    SMTP_HOST: Optional[str] = None
    SMTP_PORT: int = 587
    SMTP_USER: Optional[str] = None
    SMTP_PASSWORD: Optional[str] = None
    SMTP_FROM: Optional[str] = None
    SMTP_STARTTLS: bool = True
    # Desactívalo en todas las réplicas menos una si ejecutas varios procesos del backend
    SCHEDULER_ENABLED: bool = True

    @property
    def email_configured(self) -> bool:
        return bool(self.SMTP_HOST and (self.SMTP_FROM or self.SMTP_USER))

    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT == "production"

    @property
    def google_configured(self) -> bool:
        return bool(self.GOOGLE_CLIENT_ID and self.GOOGLE_CLIENT_SECRET)


@lru_cache()
def get_settings() -> Settings:
    s = Settings()
    if s.is_production and (s.SECRET_KEY == INSECURE_SECRET or len(s.SECRET_KEY) < 32):
        raise RuntimeError("SECRET_KEY debe definirse (≥32 caracteres) en producción")
    return s


settings = get_settings()
