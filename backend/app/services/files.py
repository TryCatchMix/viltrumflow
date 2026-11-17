"""Almacenamiento en disco de las imágenes adjuntas."""
import logging
import uuid
from pathlib import Path
from typing import Optional

from sqlalchemy import event, func
from sqlalchemy.orm import Session

from ..config import settings
from ..models import Attachment

logger = logging.getLogger(__name__)

EXTENSIONS = {"image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp"}
IMAGE_SUFFIXES = (".png", ".jpg", ".jpeg", ".gif", ".webp")
URL_PREFIX = f"{settings.API_V1_STR}/attachments/"


class UploadError(ValueError):
    pass


def sniff(data: bytes) -> Optional[str]:
    """Tipo real según los primeros bytes. No se confía en la extensión ni en el tipo que declara el cliente."""
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None  # SVG queda fuera a propósito: puede llevar scripts


def path_for(att: Attachment) -> Path:
    return Path(settings.UPLOAD_DIR) / str(att.owner_id) / att.id


def url_for(att: Attachment) -> str:
    return URL_PREFIX + att.id


def store(db: Session, owner_id: int, filename: str, data: bytes, note_id: Optional[int] = None) -> Attachment:
    """Valida y guarda una imagen. No hace commit: la fila queda pendiente en la sesión."""
    if len(data) > settings.MAX_UPLOAD_MB * 1024 * 1024:
        raise UploadError(f"La imagen supera {settings.MAX_UPLOAD_MB} MB")
    content_type = sniff(data)
    if not content_type:
        raise UploadError("Solo se admiten imágenes PNG, JPEG, GIF o WebP")
    used = db.query(func.coalesce(func.sum(Attachment.size), 0)).filter(Attachment.owner_id == owner_id).scalar()
    if used + len(data) > settings.USER_STORAGE_MB * 1024 * 1024:
        raise UploadError(f"Has alcanzado el límite de {settings.USER_STORAGE_MB} MB de imágenes")
    att = Attachment(
        id=uuid.uuid4().hex, owner_id=owner_id, note_id=note_id, content_type=content_type, size=len(data),
        filename=(Path(filename.replace("\\", "/")).name or "imagen")[:255],
    )
    target = path_for(att)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    db.add(att)
    return att


@event.listens_for(Attachment, "after_delete")
def _remove_file(_mapper, _connection, att: Attachment) -> None:
    """Al borrar la fila (también en cascada desde su nota) se borra el fichero."""
    try:
        path_for(att).unlink(missing_ok=True)
    except OSError as exc:  # pragma: no cover
        logger.warning("No se pudo borrar el adjunto %s: %s", att.id, exc)
