# backend/app/schemas/preferences.py
from pydantic import BaseModel, Field
from typing import Optional
from enum import Enum

class ThemeEnum(str, Enum):
    LIGHT = "light"
    DARK = "dark"
    AUTO = "auto"

class UserPreferencesResponse(BaseModel):
    """Respuesta con las preferencias del usuario"""
    theme: ThemeEnum
    language: str
    notifications_enabled: bool

    class Config:
        from_attributes = True

class UserPreferencesUpdate(BaseModel):
    """Schema para actualizar preferencias del usuario"""
    theme: Optional[ThemeEnum] = Field(None, description="Tema de la aplicación")
    language: Optional[str] = Field(None, max_length=5, description="Código de idioma")
    notifications_enabled: Optional[bool] = Field(None, description="Notificaciones habilitadas")

    class Config:
        json_schema_extra = {
            "example": {
                "theme": "dark",
                "language": "es",
                "notifications_enabled": True
            }
        }

class ThemeUpdate(BaseModel):
    """Schema para actualizar solo el tema"""
    theme: ThemeEnum = Field(..., description="Tema de la aplicación")

    class Config:
        json_schema_extra = {
            "example": {
                "theme": "dark"
            }
        }

class PreferencesSuccessResponse(BaseModel):
    """Respuesta exitosa de preferencias"""
    success: bool = True
    message: str
    preferences: UserPreferencesResponse