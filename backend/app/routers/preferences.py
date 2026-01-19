# backend/app/routers/preferences.py
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import Dict, Any

from app.database import get_db
from app.models.user import User
from app.schemas.preferences import (
    UserPreferencesResponse,
    UserPreferencesUpdate,
    ThemeUpdate,
    PreferencesSuccessResponse
)
from app.dependencies import get_current_user

router = APIRouter(
    prefix="/preferences",
    tags=["preferences"]
)

@router.get("/", response_model=Dict[str, Any])
async def get_preferences(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Obtener las preferencias del usuario autenticado
    """
    preferences = UserPreferencesResponse(
        theme=current_user.theme,
        language=current_user.language,
        notifications_enabled=current_user.notifications_enabled
    )
    
    return {
        "success": True,
        "preferences": preferences
    }

@router.put("/", response_model=PreferencesSuccessResponse)
async def update_preferences(
    preferences_update: UserPreferencesUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Actualizar las preferencias del usuario
    
    - **theme**: light, dark o auto
    - **language**: Código de idioma (ej: es, en)
    - **notifications_enabled**: true o false
    """
    
    # Actualizar solo los campos que se enviaron
    if preferences_update.theme is not None:
        current_user.theme = preferences_update.theme
    
    if preferences_update.language is not None:
        current_user.language = preferences_update.language
    
    if preferences_update.notifications_enabled is not None:
        current_user.notifications_enabled = preferences_update.notifications_enabled
    
    try:
        db.commit()
        db.refresh(current_user)
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error al actualizar preferencias: {str(e)}"
        )
    
    preferences = UserPreferencesResponse(
        theme=current_user.theme,
        language=current_user.language,
        notifications_enabled=current_user.notifications_enabled
    )
    
    return PreferencesSuccessResponse(
        success=True,
        message="Preferencias actualizadas correctamente",
        preferences=preferences
    )

@router.put("/theme", response_model=Dict[str, Any])
async def update_theme(
    theme_update: ThemeUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Actualizar solo el tema del usuario
    
    - **theme**: light, dark o auto
    """
    
    current_user.theme = theme_update.theme
    
    try:
        db.commit()
        db.refresh(current_user)
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error al actualizar tema: {str(e)}"
        )
    
    return {
        "success": True,
        "message": "Tema actualizado correctamente",
        "theme": current_user.theme
    }