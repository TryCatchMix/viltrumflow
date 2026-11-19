"""Inicio de sesión con Google (OpenID Connect, flujo de código de autorización)."""
import base64
import json
import time
from typing import Dict, Optional
from urllib.parse import urlencode

from ..config import settings
from . import google_calendar as gcal

ISSUERS = ("https://accounts.google.com", "accounts.google.com")
SCOPES = "openid email profile"


class GoogleLoginError(Exception):
    pass


def build_url(state: str, nonce: str) -> str:
    return gcal.AUTH_URL + "?" + urlencode({
        "client_id": settings.GOOGLE_CLIENT_ID,
        "redirect_uri": settings.google_login_redirect_uri,
        "response_type": "code",
        "scope": SCOPES,
        "prompt": "select_account",
        "nonce": nonce,
        "state": state,
    })


def _claims(id_token: Optional[str]) -> dict:
    try:
        payload = id_token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        return json.loads(base64.urlsafe_b64decode(payload))
    except Exception:
        raise GoogleLoginError("Respuesta de Google sin identidad")


def exchange(code: str, nonce: str) -> dict:
    """
    Cambia el código por la identidad del usuario. El id_token llega directamente del endpoint de tokens
    de Google por TLS, así que (según OpenID Connect) basta con validar emisor, audiencia, caducidad y nonce.
    """
    with gcal._client() as c:
        r = c.post(gcal.TOKEN_URL, data={
            "code": code,
            "client_id": settings.GOOGLE_CLIENT_ID,
            "client_secret": settings.GOOGLE_CLIENT_SECRET,
            "redirect_uri": settings.google_login_redirect_uri,
            "grant_type": "authorization_code",
        })
    if r.status_code != 200:
        raise GoogleLoginError(f"Intercambio de código rechazado ({r.status_code})")
    claims = _claims(r.json().get("id_token"))
    aud = claims.get("aud")
    audiences = aud if isinstance(aud, list) else [aud]
    if claims.get("iss") not in ISSUERS or settings.GOOGLE_CLIENT_ID not in audiences:
        raise GoogleLoginError("Identidad emitida para otra aplicación")
    if float(claims.get("exp", 0)) < time.time():
        raise GoogleLoginError("Identidad caducada")
    if claims.get("nonce") != nonce or not claims.get("sub"):
        raise GoogleLoginError("Identidad no válida")
    return claims


# Códigos de un solo uso ya canjeados (jti → caducidad). En memoria: basta para un único proceso
_used: Dict[str, float] = {}


def consume_once(jti: str, ttl: float) -> bool:
    now = time.time()
    for k in [k for k, exp in _used.items() if exp < now]:
        del _used[k]
    if not jti or jti in _used:
        return False
    _used[jti] = now + ttl
    return True
