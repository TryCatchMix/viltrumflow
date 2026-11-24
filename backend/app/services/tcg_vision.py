"""Lectura de una carta de Cyberpunk TCG a partir de una foto, con la visión de Claude."""
import base64
import logging
from typing import Iterable, Literal, Optional, Tuple

import anthropic
from pydantic import BaseModel, Field

from ..config import settings

logger = logging.getLogger(__name__)

MAX_KNOWN = 400  # cartas de la colección que se le pasan como referencia para escribir el nombre igual

SYSTEM = """You read photos of physical cards from Cyberpunk TCG, the trading card game set in Night City \
(Cyberpunk 2077 and Cyberpunk: Edgerunners), and transcribe what is printed on the card shown.

Rules:
- name: the card title exactly as printed (keep its capitalisation, punctuation and any subtitle such as "Yorinobu Arasaka").
- number: the collector number exactly as printed, without the set total. Keep a "β" prefix (beta printing) \
and any letter suffix, e.g. "β001", "014", "005b". If it reads "014/131", answer "014".
- set_name: the set or product name if it is printed or clearly identifiable from the set symbol; otherwise "".
- rarity: the rarity if printed or shown by a clear rarity mark (e.g. Common, Uncommon, Rare, Iconic Rare); otherwise "".
- card_type: the card type line if printed (e.g. Legend, Unit, Gear, Program, Location); otherwise "".
- Use "" for anything you cannot read with confidence. Never guess a number you cannot see.
- If the list of cards already in the collection contains this card, copy its name exactly as written there.
- is_card is false when the photo does not show a Cyberpunk TCG card face (a card back, another game, \
an empty table, or too blurry to read the title).
- confidence: "high" when name and number are both clearly legible, "medium" when one of them is uncertain, \
"low" otherwise."""


class CardReading(BaseModel):
    is_card: bool
    name: str = Field(description="Card title as printed, or empty")
    number: str = Field(description="Collector number as printed, without the set total, or empty")
    set_name: str
    rarity: str
    card_type: str
    confidence: Literal["high", "medium", "low"]


class VisionError(RuntimeError):
    """Fallo al leer la carta; el mensaje se muestra tal cual al usuario."""


_client: Optional[anthropic.Anthropic] = None


def _get_client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        _client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY, timeout=60.0, max_retries=2)
    return _client


def read_card(image: bytes, media_type: str, known: Iterable[Tuple[str, str]] = ()) -> CardReading:
    """Transcribe la carta de la foto. `known` son (número, nombre) de la colección del usuario."""
    if not settings.tcg_vision_configured:
        raise VisionError("El reconocimiento de cartas no está configurado (falta ANTHROPIC_API_KEY)")
    lines = [f"{num or '—'} · {name}" for num, name in list(known)[:MAX_KNOWN]]
    hint = ("Cards already in this collection (number · name):\n" + "\n".join(lines)) if lines \
        else "The collection is still empty."
    try:
        response = _get_client().beta.messages.parse(
            model=settings.TCG_VISION_MODEL,
            max_tokens=4096,
            system=SYSTEM,
            messages=[{"role": "user", "content": [
                {"type": "image", "source": {"type": "base64", "media_type": media_type,
                                             "data": base64.standard_b64encode(image).decode("ascii")}},
                {"type": "text", "text": hint + "\n\nTranscribe the card in the photo."},
            ]}],
            output_format=CardReading,
            output_config={"effort": settings.TCG_VISION_EFFORT},
            # Si un filtro de seguridad rechazase la petición por error, la repite con otro modelo
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        )
    except anthropic.AuthenticationError:
        raise VisionError("La clave de la API de Claude no es válida (revisa ANTHROPIC_API_KEY)")
    except anthropic.PermissionDeniedError:
        raise VisionError("La clave de la API de Claude no tiene permiso para este modelo")
    except anthropic.RateLimitError:
        raise VisionError("Demasiadas lecturas seguidas: espera unos segundos y vuelve a intentarlo")
    except anthropic.BadRequestError as exc:
        logger.warning("Petición de lectura rechazada: %s", exc.message)
        raise VisionError("No se pudo procesar la foto; prueba con otra")
    except anthropic.APIStatusError as exc:
        logger.warning("Fallo del servicio de lectura (%s): %s", exc.status_code, exc.message)
        raise VisionError("El servicio de reconocimiento no responde; inténtalo de nuevo en un momento")
    except anthropic.APIConnectionError:
        raise VisionError("No hay conexión con el servicio de reconocimiento")
    if response.stop_reason == "refusal" or response.parsed_output is None:
        raise VisionError("No se pudo leer la carta; prueba con otra foto")
    return response.parsed_output
