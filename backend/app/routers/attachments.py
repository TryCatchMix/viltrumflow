from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..deps import get_current_user
from ..models import Attachment, Note, User
from ..services import files

router = APIRouter()


class AttachmentOut(BaseModel):
    id: str
    url: str
    filename: str
    size: int


def _get(db: Session, user: User, attachment_id: str) -> Attachment:
    att = db.get(Attachment, attachment_id)
    if not att or att.owner_id != user.id:
        raise HTTPException(404, "Imagen no encontrada")
    return att


@router.post("", response_model=AttachmentOut, status_code=201)
async def upload(file: UploadFile = File(...), note_id: Optional[int] = None,
                 user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Sube una imagen para insertarla en una nota (PNG, JPEG, GIF o WebP)."""
    if note_id is not None:
        note = db.get(Note, note_id)
        if not note or note.owner_id != user.id or note.deleted_at is not None:
            raise HTTPException(400, "Nota no válida")
    data = await file.read(settings.MAX_UPLOAD_MB * 1024 * 1024 + 1)
    try:
        att = files.store(db, user.id, file.filename or "imagen", data, note_id)
    except files.UploadError as exc:
        raise HTTPException(413 if "supera" in str(exc) or "límite" in str(exc) else 415, str(exc))
    db.commit()
    return AttachmentOut(id=att.id, url=files.url_for(att), filename=att.filename, size=att.size)


@router.get("/{attachment_id}")
def download(attachment_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    att = _get(db, user, attachment_id)
    path = files.path_for(att)
    if not path.is_file():
        raise HTTPException(404, "Imagen no encontrada")
    return FileResponse(path, media_type=att.content_type, headers={
        "X-Content-Type-Options": "nosniff",           # el navegador no reinterpreta el contenido
        "Content-Disposition": "inline",
        "Cache-Control": "private, max-age=31536000, immutable",  # el id identifica un contenido que no cambia
    })


@router.delete("/{attachment_id}", status_code=204)
def delete(attachment_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db.delete(_get(db, user, attachment_id))
    db.commit()
