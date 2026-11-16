import logging
import smtplib
from email.message import EmailMessage
from html import escape
from typing import List, Tuple

from ..config import settings

logger = logging.getLogger(__name__)


def send_email(to: str, subject: str, text: str, html: str) -> bool:
    """Envía un correo por SMTP. Devuelve False (sin lanzar) si no está configurado o falla."""
    if not settings.email_configured:
        return False
    msg = EmailMessage()
    msg["From"] = settings.SMTP_FROM or settings.SMTP_USER
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(text)
    msg.add_alternative(html, subtype="html")
    try:
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=15) as smtp:
            if settings.SMTP_STARTTLS:
                smtp.starttls()
            if settings.SMTP_USER and settings.SMTP_PASSWORD:
                smtp.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            smtp.send_message(msg)
        return True
    except (smtplib.SMTPException, OSError) as exc:
        logger.warning("No se pudo enviar el correo a %s: %s", to, exc)
        return False


def render(title: str, sections: List[Tuple[str, List[str]]]) -> Tuple[str, str]:
    """Cuerpo en texto y en HTML a partir de secciones (encabezado, líneas). Todo el contenido se escapa."""
    url = settings.FRONTEND_URL.rstrip("/") + "/tasks"
    text = [title, ""]
    html = [f'<div style="font-family:system-ui,sans-serif;max-width:520px;color:#1c1b1f"><h2 style="font-size:18px">{escape(title)}</h2>']
    for heading, lines in sections:
        text += [heading] + [f"  - {l}" for l in lines] + [""]
        items = "".join(f"<li>{escape(l)}</li>" for l in lines)
        html.append(f'<h3 style="font-size:14px;margin:16px 0 6px">{escape(heading)}</h3><ul style="margin:0;padding-left:20px;line-height:1.6">{items}</ul>')
    text.append(f"Abrir ViltrumFlow: {url}")
    html.append(f'<p style="margin-top:20px"><a href="{escape(url)}" style="color:#6a4ae0">Abrir ViltrumFlow</a></p></div>')
    return "\n".join(text), "".join(html)
