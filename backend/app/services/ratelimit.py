"""Límite de intentos en memoria. Suficiente para un solo proceso; con varias réplicas, cada una cuenta por separado."""
import time
from collections import defaultdict, deque
from threading import Lock
from typing import Deque, Dict

from fastapi import HTTPException

_hits: Dict[str, Deque[float]] = defaultdict(deque)
_lock = Lock()


def _prune(q: Deque[float], window: float, now: float) -> None:
    while q and q[0] <= now - window:
        q.popleft()


def check(key: str, limit: int, window_seconds: float) -> None:
    """Lanza 429 si la clave ya ha agotado sus intentos en la ventana."""
    now = time.monotonic()
    with _lock:
        q = _hits[key]
        _prune(q, window_seconds, now)
        if len(q) >= limit:
            retry = max(1, int(q[0] + window_seconds - now))
            raise HTTPException(
                429, f"Demasiados intentos. Vuelve a probar en {max(1, round(retry / 60))} min.",
                headers={"Retry-After": str(retry)},
            )


def hit(key: str) -> None:
    with _lock:
        _hits[key].append(time.monotonic())
        if len(_hits) > 50_000:  # tope de memoria ante un barrido de claves
            for k in [k for k, q in _hits.items() if not q][:10_000]:
                del _hits[k]


def clear(key: str) -> None:
    with _lock:
        _hits.pop(key, None)


def reset() -> None:
    with _lock:
        _hits.clear()
