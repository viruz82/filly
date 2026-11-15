"""Share the spool collection through the optional Filly share Worker (1.20.0).

Filly never becomes reachable from outside. It sends a cleaned copy of the
inventory to a small Cloudflare Worker (see share_worker/ in the repository),
which serves it under unguessable read-only links.

Only the fields in ``build_snapshot`` leave the add-on: spool number, brand,
material, subtype, colour name, colours, colour mode/effect, remaining percent and
the remaining/nominal filament weight in grams (the Worker shows the grams only on
links that allow it). Prices, storage and purchase locations, notes and dates are
never sent.

Configuration (add-on options, /data/options.json):
    share_url  https://<worker>.<subdomain>.workers.dev
    share_key  the Worker's PUSH_KEY (at least 32 characters)
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import httpx
from sqlalchemy.orm import Session

from .database import DATA_DIR, SessionLocal
from .models import Spool, UserPreferences
from .util import COLOR_EFFECTS, utcnow

log = logging.getLogger(__name__)

CHECK_INTERVAL_S = 60        # how often the loop looks for changes
MIN_PUSH_INTERVAL_S = 300    # at most one upload per 5 minutes
REQUEST_TIMEOUT_S = 10
MIN_KEY_LENGTH = 32
MAX_TEXT = 60

LINK_ID_RE = re.compile(r"^[A-Za-z0-9_-]{22}$")
_HEX_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")
_MAX_COLORS = {"solid": 1, "special": 1, "gradient": 4, "multicolor": 3}


# ── Configuration ────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class ShareConfig:
    url: str
    key: str


def _options_path() -> Path:
    return Path(DATA_DIR) / "options.json"


def _url_ok(url: str) -> bool:
    parts = urlsplit(url)
    if not parts.hostname or parts.query or parts.fragment or parts.path not in ("", "/"):
        return False
    if parts.scheme == "https":
        return True
    # plain http only for a local test Worker (wrangler dev)
    return parts.scheme == "http" and parts.hostname in ("localhost", "127.0.0.1")


def load_config() -> tuple[ShareConfig | None, str | None]:
    """(config, None) when usable, otherwise (None, reason)."""
    try:
        opts = json.loads(_options_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None, "not_configured"
    if not isinstance(opts, dict):
        return None, "not_configured"
    url = str(opts.get("share_url") or "").strip().rstrip("/")
    key = str(opts.get("share_key") or "").strip()
    if not url and not key:
        return None, "not_configured"
    if not _url_ok(url):
        return None, "invalid_url"
    if len(key) < MIN_KEY_LENGTH:
        return None, "invalid_key"
    return ShareConfig(url=url, key=key), None


# ── Snapshot (the whitelist) ─────────────────────────────────────────────────

def _text(value: Any) -> str:
    return " ".join(str(value or "").split())[:MAX_TEXT]


def _look(spool: Spool) -> tuple[list[str], str, str | None]:
    """Colours, mode and effect exactly as the add-on displays them
    (frontend/src/utils/colorLook.ts: effectiveMode/effectiveEffect)."""
    colors = [h.upper() for h in (spool.color_hex, spool.color2_hex, spool.color3_hex, spool.color4_hex)
              if isinstance(h, str) and _HEX_RE.match(h)]
    many = len(colors) > 1
    mode = spool.color_mode
    if mode in ("gradient", "multicolor"):
        mode = mode if many else "solid"
    elif mode != "special":
        mode = "multicolor" if many else "solid"
    effect = spool.color_effect if mode == "special" and spool.color_effect in COLOR_EFFECTS else None
    colors = colors[:_MAX_COLORS[mode]] or ["#888888"]
    return colors, mode, effect


def public_spool(spool: Spool) -> dict:
    colors, mode, effect = _look(spool)
    subtype = ", ".join(t for t in (_text(spool.subtype), _text(spool.subtype2)) if t)[:MAX_TEXT]
    return {
        "number": int(spool.id),
        "brand": _text(spool.brand),
        "material": _text(spool.material),
        "subtype": subtype or None,
        "color_name": _text(spool.color_name),
        "colors": colors,
        "color_mode": mode,
        "color_effect": effect,
        "remaining_pct": int(round(min(100.0, max(0.0, spool.remaining_pct)))),
        "weight_g": int(round(max(0.0, spool.current_weight_g or 0))),
        "spool_g": int(round(max(0.0, spool.initial_weight_g or 0))),
    }


def build_snapshot(db: Session) -> dict:
    prefs = db.get(UserPreferences, 1)
    spools = db.query(Spool).filter(Spool.archived.is_(False)).order_by(Spool.id).all()
    return {
        "generated_at": utcnow().isoformat(timespec="seconds") + "Z",
        "low_pct": prefs.low_stock_threshold_pct if prefs else 20,
        "empty_pct": prefs.almost_empty_threshold_pct if prefs else 8,
        "spools": [public_spool(s) for s in spools],
    }


def snapshot_hash(snapshot: dict) -> str:
    body = {k: v for k, v in snapshot.items() if k != "generated_at"}
    return hashlib.sha256(json.dumps(body, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


# ── Talking to the Worker ────────────────────────────────────────────────────

class ShareError(Exception):
    """code: not_configured | invalid_url | invalid_key | unreachable | key_rejected | worker_error | not_found | ..."""

    def __init__(self, code: str, status: int | None = None):
        super().__init__(code)
        self.code = code
        self.status = status


async def _send(cfg: ShareConfig, method: str, path: str, payload: Any = None) -> httpx.Response:
    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_S, follow_redirects=False) as client:
        return await client.request(
            method, cfg.url + path, json=payload,
            headers={"Authorization": f"Bearer {cfg.key}", "Accept": "application/json"},
        )


async def call_worker(method: str, path: str, payload: Any = None) -> tuple[ShareConfig, Any]:
    cfg, problem = load_config()
    if cfg is None:
        raise ShareError(problem or "not_configured")
    try:
        resp = await _send(cfg, method, path, payload)
    except httpx.HTTPError as exc:
        log.warning("share: Worker not reachable (%s)", type(exc).__name__)
        raise ShareError("unreachable") from None
    if resp.status_code == 401:
        raise ShareError("key_rejected", 401)
    try:
        body = resp.json()
    except ValueError:
        body = None
    if resp.status_code >= 400:
        code = body.get("error") if isinstance(body, dict) and isinstance(body.get("error"), str) else "worker_error"
        raise ShareError(code, resp.status_code)
    return cfg, body


# ── Push loop ────────────────────────────────────────────────────────────────

@dataclass
class _PushState:
    last_hash: str | None = None
    last_attempt: float | None = None       # time.monotonic()
    last_ok_at: datetime | None = None
    last_error: str | None = None
    spool_count: int | None = None


state = _PushState()
_lock: asyncio.Lock | None = None


def _get_lock() -> asyncio.Lock:
    global _lock
    if _lock is None:
        _lock = asyncio.Lock()
    return _lock


def due(snapshot_digest: str, now: float, force: bool = False) -> bool:
    """Upload when forced, or when the data changed and the last attempt is old enough."""
    if force:
        return True
    if snapshot_digest == state.last_hash:
        return False
    return state.last_attempt is None or now - state.last_attempt >= MIN_PUSH_INTERVAL_S


async def push(force: bool = False) -> str:
    """Returns: pushed | unchanged | waiting | not_configured | invalid_* | <error code>."""
    async with _get_lock():
        cfg, problem = load_config()
        if cfg is None:
            return problem or "not_configured"
        with SessionLocal() as db:
            snap = build_snapshot(db)
        digest = snapshot_hash(snap)
        now = time.monotonic()
        if not due(digest, now, force):
            return "unchanged" if digest == state.last_hash else "waiting"
        state.last_attempt = now
        try:
            await call_worker("PUT", "/api/snapshot", snap)
        except ShareError as exc:
            state.last_error = exc.code
            log.warning("share: upload failed (%s)", exc.code)
            return exc.code
        state.last_hash = digest
        state.last_ok_at = utcnow()
        state.last_error = None
        state.spool_count = len(snap["spools"])
        log.info("share: uploaded %d spools", state.spool_count)
        return "pushed"


async def run_periodic() -> None:
    await asyncio.sleep(20)
    while True:
        try:
            await push()
        except asyncio.CancelledError:
            break
        except Exception as exc:   # never let the loop die
            log.warning("share: push loop error: %s", exc, exc_info=True)
        try:
            await asyncio.sleep(CHECK_INTERVAL_S)
        except asyncio.CancelledError:
            break
