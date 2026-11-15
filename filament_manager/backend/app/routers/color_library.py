"""Manufacturer colour library (1.19.0).

Read-only reference data shipped with the add-on (app/data/manufacturer_colors.json,
built by tools/build_manufacturer_colors.py from SpoolmanDB and the manufacturers'
own pages). Every colour carries its source: "official" or "community".

GET  /api/color-library                    overview: brands with counts, materials, sources
GET  /api/color-library?brand=SUNLU        + the lines of that brand (optionally &material=, &q=)
GET  /api/color-library?q=oak              + search across all brands (at most `limit` colours)
POST /api/color-library/to-catalog         copy picked colours into the filament catalog
"""
from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import FilamentBrand, FilamentCatalog, FilamentMaterial, FilamentSubtype
from ..util import COLOR_EFFECT_PATTERN, COLOR_MODE_PATTERN, normalize_color_look

router = APIRouter(prefix="/api/color-library", tags=["color-library"])

DATA_FILE = Path(__file__).resolve().parent.parent / "data" / "manufacturer_colors.json"
_HEX = re.compile(r"^#[0-9A-Fa-f]{6}$")


@lru_cache(maxsize=1)
def load_library() -> dict:
    """The bundled library; an empty one when the file is missing or broken."""
    try:
        data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
        if isinstance(data.get("lines"), list):
            return data
    except Exception:
        pass
    return {"schema": 1, "generated": None, "sources": [], "notice": "", "lines": []}


def _fold(s: str | None) -> str:
    return (s or "").casefold().strip()


def _brand_summary(lines: list[dict]) -> list[dict]:
    out: dict[str, dict] = {}
    for line in lines:
        b = out.setdefault(line["brand"], {"brand": line["brand"], "lines": 0, "colors": 0,
                                           "official": 0, "community": 0})
        b["lines"] += 1
        for c in line["colors"]:
            b["colors"] += 1
            b["official" if c.get("src") == "official" else "community"] += 1
    return sorted(out.values(), key=lambda b: b["brand"].casefold())


def _match(line: dict, color: dict, words: list[str]) -> bool:
    hay = " ".join([line["brand"], line["material"], line.get("line") or "",
                    line.get("subtype") or "", line.get("subtype2") or "",
                    color["name"], " ".join(color["hex"]), color.get("sku") or ""]).casefold()
    return all(w in hay for w in words)


@router.get("")
def get_library(
    brand: str | None = None,
    material: str | None = None,
    q: str | None = None,
    limit: int = Query(400, ge=1, le=5000),
):
    lib = load_library()
    lines = lib["lines"]
    result = {
        "generated": lib.get("generated"),
        "notice": lib.get("notice", ""),
        "sources": lib.get("sources", []),
        "brands": _brand_summary(lines),
        "materials": sorted({l["material"] for l in lines}, key=str.casefold),
    }
    if not (brand or q):
        return result

    words = [w for w in _fold(q).split() if w]
    picked, count, truncated = [], 0, False
    for line in lines:
        if brand and _fold(line["brand"]) != _fold(brand):
            continue
        if material and _fold(line["material"]) != _fold(material):
            continue
        colors = [c for c in line["colors"] if not words or _match(line, c, words)]
        if not colors:
            continue
        if count + len(colors) > limit:
            colors = colors[: max(0, limit - count)]
            truncated = True
        if colors:
            picked.append({**line, "colors": colors})
            count += len(colors)
        if truncated:
            break
    result.update({"lines": picked, "count": count, "truncated": truncated})
    return result


# ── copy into the catalog ────────────────────────────────────────────────────

class LibraryPick(BaseModel):
    brand: str = Field(min_length=1)
    material: str = Field(min_length=1)
    subtype: str | None = None
    subtype2: str | None = None
    color_name: str = Field(min_length=1)
    hex: list[str] = Field(min_length=1, max_length=4)
    color_mode: str = Field(default="solid", pattern=COLOR_MODE_PATTERN)
    color_effect: str | None = Field(default=None, pattern=COLOR_EFFECT_PATTERN)
    article_number: str | None = None

    @field_validator("hex")
    @classmethod
    def _hexes(cls, v: list[str]) -> list[str]:
        out = []
        for h in v:
            h = h.strip()
            if not h.startswith("#"):
                h = "#" + h
            if not _HEX.match(h):
                raise ValueError(f"invalid hex colour: {h}")
            out.append(h.upper())
        return out


class ToCatalogBody(BaseModel):
    items: list[LibraryPick] = Field(min_length=1, max_length=500)


def _catalog_key(brand, material, subtype, color_name) -> tuple:
    return (_fold(brand), _fold(material), _fold(subtype), _fold(color_name))


def _ensure_names(db: Session, model, names: set[str]) -> list[str]:
    existing = {_fold(r.name) for r in db.query(model).all()}
    added = []
    for n in sorted(names):
        if n and _fold(n) not in existing:
            db.add(model(name=n))
            existing.add(_fold(n))
            added.append(n)
    return added


@router.post("/to-catalog")
def copy_to_catalog(body: ToCatalogBody, db: Session = Depends(get_db)):
    """Add picked colours to the filament catalog. Rows already present (same
    article number, or same brand + material + subtype + colour name) are skipped.
    Brands, materials and subtypes missing from the selection lists are added."""
    rows = db.query(FilamentCatalog).all()
    by_key = {_catalog_key(r.brand, r.material, r.subtype, r.color_name) for r in rows}
    by_article = {(_fold(r.brand), _fold(r.article_number)) for r in rows if r.article_number}

    added, skipped, ids = 0, 0, []
    new_rows = []
    for it in body.items:
        key = _catalog_key(it.brand, it.material, it.subtype, it.color_name)
        art = (_fold(it.brand), _fold(it.article_number)) if it.article_number else None
        if key in by_key or (art and art in by_article):
            skipped += 1
            continue
        hexes = it.hex + [None] * (4 - len(it.hex))
        entry = FilamentCatalog(
            brand=it.brand.strip(), material=it.material.strip(),
            subtype=(it.subtype or None), subtype2=(it.subtype2 or None),
            color_name=it.color_name.strip(),
            color_hex=hexes[0], color2_hex=hexes[1], color3_hex=hexes[2], color4_hex=hexes[3],
            color_mode=it.color_mode, color_effect=it.color_effect,
            article_number=(it.article_number or None),
        )
        normalize_color_look(entry)
        db.add(entry)
        new_rows.append(entry)
        by_key.add(key)
        if art:
            by_article.add(art)
        added += 1

    lists_added = {
        "brands": _ensure_names(db, FilamentBrand, {e.brand for e in new_rows}),
        "materials": _ensure_names(db, FilamentMaterial, {e.material for e in new_rows}),
        "subtypes": _ensure_names(db, FilamentSubtype,
                                  {s for e in new_rows for s in (e.subtype, e.subtype2) if s}),
    }
    db.commit()
    ids = [e.id for e in new_rows]
    return {"added": added, "skipped": skipped, "ids": ids, "lists_added": lists_added}
