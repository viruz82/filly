"""Share the collection (1.20.0): manage public links on the Filly share Worker.

The browser only talks to these routes; the Worker key stays in the backend.

GET    /api/share/status              configured?, last upload, last error
GET    /api/share/preview             exactly the data that would be shared
POST   /api/share/push                upload now
GET    /api/share/links               links with view counters (+ full url)
POST   /api/share/links               new link
PATCH  /api/share/links/{id}          name, expiry, active, hide empty, language
POST   /api/share/links/{id}/renew    new address, old one stops working
DELETE /api/share/links/{id}
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import share
from ..database import get_db

router = APIRouter(prefix="/api/share", tags=["share"])

Lang = Literal["de", "en", "es"]

_STATUS = {
    "not_configured": 409, "invalid_url": 409, "invalid_key": 409,
    "unreachable": 502, "key_rejected": 502, "worker_error": 502,
    "not_found": 404, "too_many_links": 409,
}


def _fail(exc: share.ShareError) -> HTTPException:
    return HTTPException(status_code=_STATUS.get(exc.code, 502 if not exc.status else exc.status), detail=exc.code)


def _iso(dt: Optional[datetime]) -> Optional[str]:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _check_id(link_id: str) -> None:
    if not share.LINK_ID_RE.match(link_id):
        raise HTTPException(status_code=404, detail="not_found")


def _with_url(cfg: share.ShareConfig, link: dict) -> dict:
    return {**link, "url": f"{cfg.url}/s/{link['id']}"}


class LinkCreate(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    expires_at: Optional[datetime] = None
    hide_empty: bool = True
    lang: Lang = "de"


class LinkUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=60)
    expires_at: Optional[datetime] = None
    hide_empty: Optional[bool] = None
    active: Optional[bool] = None
    lang: Optional[Lang] = None


@router.get("/status")
def get_status():
    cfg, problem = share.load_config()
    st = share.state
    return {
        "configured": cfg is not None,
        "problem": problem,
        "base_url": cfg.url if cfg else None,
        "last_push_at": _iso(st.last_ok_at),
        "last_error": st.last_error,
        "spool_count": st.spool_count,
    }


@router.get("/preview")
def get_preview(db: Session = Depends(get_db)):
    return share.build_snapshot(db)


@router.post("/push")
async def push_now():
    result = await share.push(force=True)
    if result != "pushed":
        raise HTTPException(status_code=_STATUS.get(result, 502), detail=result)
    return get_status()


@router.get("/links")
async def list_links():
    try:
        cfg, body = await share.call_worker("GET", "/api/links")
        if not body.get("snapshot_received_at"):
            # fresh Worker (or new deployment): give it data right away
            if await share.push(force=True) == "pushed":
                cfg, body = await share.call_worker("GET", "/api/links")
    except share.ShareError as exc:
        raise _fail(exc)
    return {**body, "links": [_with_url(cfg, link) for link in body.get("links", [])]}


@router.post("/links", status_code=201)
async def create_link(payload: LinkCreate):
    data = payload.model_dump()
    data["expires_at"] = _iso(payload.expires_at)
    try:
        cfg, link = await share.call_worker("POST", "/api/links", data)
    except share.ShareError as exc:
        raise _fail(exc)
    if share.state.last_hash is None:
        await share.push(force=True)
    return _with_url(cfg, link)


@router.patch("/links/{link_id}")
async def update_link(link_id: str, payload: LinkUpdate):
    _check_id(link_id)
    data = payload.model_dump(exclude_unset=True)
    for key in ("name", "hide_empty", "active", "lang"):
        if key in data and data[key] is None:
            raise HTTPException(status_code=422, detail=f"{key} must not be null")
    if "expires_at" in data:
        data["expires_at"] = _iso(payload.expires_at)
    try:
        cfg, link = await share.call_worker("PATCH", f"/api/links/{link_id}", data)
    except share.ShareError as exc:
        raise _fail(exc)
    return _with_url(cfg, link)


@router.post("/links/{link_id}/renew")
async def renew_link(link_id: str):
    _check_id(link_id)
    try:
        cfg, link = await share.call_worker("POST", f"/api/links/{link_id}/renew")
    except share.ShareError as exc:
        raise _fail(exc)
    return _with_url(cfg, link)


@router.delete("/links/{link_id}")
async def delete_link(link_id: str):
    _check_id(link_id)
    try:
        await share.call_worker("DELETE", f"/api/links/{link_id}")
    except share.ShareError as exc:
        raise _fail(exc)
    return {"ok": True}
