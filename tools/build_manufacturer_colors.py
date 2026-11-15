#!/usr/bin/env python3
"""Build filament_manager/backend/app/data/manufacturer_colors.json (Filly 1.19.0).

The colour library offered in the spool form and the filament catalog. Sources:

* SpoolmanDB (https://github.com/Donkie/SpoolmanDB, MIT licence) - community
  data for most brands. Pinned to one commit, recorded in the output.
* SUNLU product pages (https://www.sunlu.com/products/<slug>) - the official
  "Color Code / Hex Code" tables. Colours found there are marked "official"
  and their hex wins over SpoolmanDB; SUNLU lines missing in SpoolmanDB
  (Twinkling, Metallic, PVA, PVB, High Speed PLA+ ...) come only from here.
* Polymaker wiki "HEX Codes and Transmission Distances" - official table with
  SKU, product, colour and hex. Polymaker is taken from this table only.

Every colour carries its source: "official" or "community". Colours without a
valid hex value are skipped. Only the Python standard library is used.

Usage:
    python tools/build_manufacturer_colors.py [--spoolmandb-ref <sha|main>]
        [--cache <dir>] [--out <file>]
"""
from __future__ import annotations

import argparse
import datetime as _dt
import html
import json
import re
import sys
import tempfile
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUT = ROOT / "filament_manager" / "backend" / "app" / "data" / "manufacturer_colors.json"
UA = {"User-Agent": "Mozilla/5.0 (filament-manager color library builder)"}

SPOOLMANDB_REPO = "Donkie/SpoolmanDB"
SPOOLMANDB_LICENSE = "MIT License, Copyright (c) 2024 Donkie"
SUNLU_BASE = "https://www.sunlu.com/products/"
POLYMAKER_URL = ("https://wiki.polymaker.com/polymaker-products/more-about-our-products/"
                 "hex-codes-and-transmission-distances")

# SpoolmanDB file -> brand name as used in Filly. Polymaker comes from its wiki.
SPOOLMANDB_BRANDS = {
    "sunlu": "SUNLU",
    "bambulab": "Bambu Lab",
    "esun": "eSUN",
    "geeetech": "Geeetech",
    "anycubic": "ANYCUBIC",
    "eryone": "ERYONE",
    "jayo": "Jayo",
    "tecbears": "TECBEARS",
    "elegoo": "Elegoo",
}

# Official SUNLU pages: slug -> (material, line label). Labels match the ones
# derived from SpoolmanDB so both sources merge into one line.
SUNLU_PAGES = {
    "asa-uv-resistant-filament": ("ASA", ""),
    "pp-filament-3d": ("PP", ""),
    "PP2.0": ("PP 2.0", ""),
    "transparent-pla-filament": ("PLA", "Transparent"),
    "pva-water-soluble-filament": ("PVA", ""),
    "polycarbonate-pc-filament": ("PC", ""),
    "pla-3d-printing-filament": ("PLA", ""),
    "pla-matte-filament": ("PLA", "Matte"),
    "pvb-filament": ("PVB", ""),
    "pc-abs-filament": ("PC-ABS", ""),
    "pla-plus-filament": ("PLA+", ""),
    "glow-in-the-dark-pla-filament": ("PLA", "Glow"),
    "pla-meta-filament": ("PLA", "Meta"),
    "abs-flame-retardant-filament": ("ABS", "FR"),
    "high-speed-abs-filament": ("ABS", "High Speed"),
    "pla-plus-2.0-3d-printing-filament": ("PLA+ 2.0", ""),
    "lightweight-pla-filament": ("PLA", "Lightweight"),
    "petg-3d-printing-filament": ("PETG", ""),
    "abs-gf-3d-filament": ("ABS-GF", ""),
    "silk-pla-plus-filament": ("PLA+", "Silk"),
    "Silk PLA+2.0": ("PLA+ 2.0", "Silk"),
    "high-speed-pla-filament": ("PLA", "High Speed"),
    "carbon-fiber-pla-filament": ("PLA-CF", ""),
    "easy-pa-nylon-filament": ("PA", "Easy"),
    "abs-3d-printing-filament": ("ABS", ""),
    "wood-pla-filament": ("Wood", ""),
    "high-speed-pla-plus-filament": ("PLA+", "High Speed"),
    "high-speed-pla-plus-2-0-filament": ("PLA+ 2.0", "High Speed"),
    "carbon-fiber-petg-filament": ("PETG-CF", ""),
    "pa6-carbon-fiber-filament": ("PA6-CF", ""),
    "pa12-carbon-fiber-20-filament": ("PA12-CF", ""),
    "pa6-glass-fiber-filament": ("PA6-GF", ""),
    "pcl-3d-printing-filament": ("PCL", ""),
    "tpu-90a-flexible-filament": ("TPU", "90A"),
    "tpu-95a-flexible-filament": ("TPU", "95A"),
    "silk-tpu-filament": ("TPU", "Silk"),
    "apla-filament": ("APLA", ""),
    "twinkling-pla-filament": ("PLA", "Twinkling"),
    "high-speed-matte-pla-filament": ("PLA", "High Speed Matte"),
    "high-speed-matte-petg-filament": ("PETG", "High Speed Matte"),
    "pla-lite-filament": ("PLA", "Lite"),
    "pla-classic-filament": ("PLA", "Classic"),
    "transparent-abs-filament": ("ABS", "Transparent"),
    "transparent-petg-filament": ("PETG", "Transparent"),
    "petg-glow-in-the-dark": ("PETG", "Glow"),
    "pla-metallic-3d-printing-filament": ("PLA", "Metallic"),
    "peek-high-performance-filament": ("PEEK", ""),
    "high-speed-pla-marble-filament": ("PLA", "High Speed Marble"),
}

# Label keyword -> Filly subtype (first two by position become subtype/subtype2).
SUBTYPE_RULES = [
    (r"high speed|\bhs\b|\brapid\b", "High Speed"),
    (r"\bmatte\b", "Matte"),
    (r"\bsilk\+", "Silk+"),
    (r"\bsilk\b(?!\+)", "Silk"),
    (r"\blite\b", "Lite"),
    (r"\bmeta\b", "Meta"),
    (r"\bmetal(lic)?\b", "Metal"),
    (r"\bmarble\b", "Marble"),
    (r"\bgalaxy\b", "Galaxy"),
    (r"\bglow\b|\bluminous\b", "Glow"),
    (r"\btranslucent\b|\btransparent\b", "Translucent"),
    (r"\bbasic\b", "Basic"),
    (r"\bhf\b", "HF"),
    (r"\bwood\b", "Wood"),
    (r"\bplus\b", "Plus"),
]

EFFECT_RULES = [  # order = priority
    (r"galaxy|sparkle|twinkling|starlight|celestial|glitter", "glitter"),
    (r"marble", "marble"),
    (r"\bglow\b|luminous", "glow"),
    (r"temperature|thermo", "thermo"),
]

MODE_MAX = {"gradient": 4, "multicolor": 3}

HEX_RE = re.compile(r"#?([0-9A-Fa-f]{6})\b")


# ── helpers ──────────────────────────────────────────────────────────────────

def clean_text(s: str) -> str:
    s = html.unescape(s or "")
    s = re.sub(r"[​‌‍﻿]", "", s)
    s = s.replace("\xa0", " ").replace("™", "").replace("®", "")
    return re.sub(r"\s+", " ", s).strip()


def norm_key(s: str) -> str:
    return re.sub(r"[^a-z0-9+]", "", clean_text(s).lower())


def parse_hexes(value) -> list[str]:
    if isinstance(value, list):
        vals = value
    else:
        vals = HEX_RE.findall(str(value or ""))
    out = []
    for v in vals:
        m = HEX_RE.fullmatch(str(v).strip()) or HEX_RE.search(str(v))
        if m:
            out.append("#" + m.group(1).upper())
    return out


def fetch(url: str, cache: Path, name: str, retries: int = 3) -> bytes:
    p = cache / name
    if p.exists() and p.stat().st_size > 0:
        return p.read_bytes()
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers=UA)
            data = urllib.request.urlopen(req, timeout=60).read()
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(data)
            time.sleep(0.3)
            return data
        except Exception as e:  # pragma: no cover - network
            last = e
            time.sleep(1 + i)
    raise RuntimeError(f"download failed: {url}: {last}")


def subtypes_for(label: str) -> tuple[str | None, str | None]:
    low = label.lower()
    hits = []
    for rx, name in SUBTYPE_RULES:
        m = re.search(rx, low)
        if m and name not in [h[1] for h in hits]:
            hits.append((m.start(), name))
    hits.sort()
    names = [h[1] for h in hits][:2]
    return (names[0] if names else None, names[1] if len(names) > 1 else None)


def effect_for(text: str) -> str | None:
    low = text.lower()
    for rx, eff in EFFECT_RULES:
        if re.search(rx, low):
            return eff
    return None


def look_for(hexes: list[str], direction: str | None, label: str, effect: str | None):
    """(mode, effect, hexes) following the Filly 1.18.0 colour modes."""
    # glow and thermo filaments list "day" and "changed" colour: one colour + effect
    two_states = effect in ("glow", "thermo") and not re.search(r"gradient|dual|tri|rainbow", label, re.I)
    if len(hexes) >= 2 and not two_states:
        if direction == "longitudinal":
            mode = "gradient"
        elif direction == "coaxial":
            mode = "multicolor"
        else:
            mode = "gradient" if re.search(r"gradient|rainbow", label, re.I) else "multicolor"
        if mode == "multicolor" and len(hexes) > MODE_MAX["multicolor"]:
            mode = "gradient"
        return mode, None, hexes[:MODE_MAX[mode]]
    if effect:
        return "special", effect, hexes[:1]
    return "solid", None, hexes[:1]


class Library:
    """Lines keyed by (brand, material, label); colours keyed by normalized name."""

    def __init__(self):
        self.lines: dict[tuple, dict] = {}
        self.stats = {"official_overrides": 0, "hex_changed": []}

    def line(self, brand: str, material: str, label: str) -> dict:
        key = (brand, material, label.lower())
        if key not in self.lines:
            st1, st2 = subtypes_for(label)
            self.lines[key] = {
                "brand": brand, "line": label, "material": material,
                "subtype": st1, "subtype2": st2, "colors": {},
            }
        return self.lines[key]

    def add(self, line: dict, name: str, hexes: list[str], src: str, mode: str,
            effect: str | None, sku: str | None = None):
        name = clean_text(name)
        if not name or not hexes:
            return
        k = norm_key(name)
        old = line["colors"].get(k)
        entry = {"name": name, "hex": hexes, "src": src}
        if mode != "solid":
            entry["mode"] = mode
        if effect:
            entry["effect"] = effect
        if sku:
            entry["sku"] = sku
        if old is None:
            line["colors"][k] = entry
            return
        if src == "official" and old["src"] != "official":
            self.stats["official_overrides"] += 1
            if old["hex"] != hexes:
                self.stats["hex_changed"].append(
                    f'{line["brand"]} {line["material"]} {line["line"]} {name}: {old["hex"][0]} -> {hexes[0]}')
            # keep a community-derived look (mode/effect) when the table has one colour only
            if len(hexes) == 1 and old.get("mode") == "special":
                entry["mode"], entry["effect"] = "special", old.get("effect")
            line["colors"][k] = entry

    def drop_community_duplicates(self) -> list[str]:
        """In lines with an official table, drop community colours that are the
        same colour under another name (same hex, "Blue (Klein Blue)" next to
        "Klein Blue", "Cherry" next to "Cherry wood")."""
        generic = re.compile(r"\b(wood|white)\b", re.I)

        def base(name: str) -> str:
            return norm_key(generic.sub("", re.sub(r"\(.*?\)", "", name)))

        dropped = []
        for line in self.lines.values():
            official = [c for c in line["colors"].values() if c["src"] == "official"]
            if not official:
                continue
            o_hex = {c["hex"][0] for c in official}
            o_names = {norm_key(c["name"]) for c in official} | {base(c["name"]) for c in official}
            for k, c in list(line["colors"].items()):
                if c["src"] != "community":
                    continue
                paren = re.findall(r"\((.*?)\)", c["name"])
                same_name = base(c["name"]) in o_names or any(norm_key(p) in o_names for p in paren)
                if c["hex"][0] in o_hex or same_name:
                    dropped.append(f'{line["brand"]} {line["material"]} {line["line"]} {c["name"]}')
                    del line["colors"][k]
        return dropped


# ── SpoolmanDB ───────────────────────────────────────────────────────────────

def resolve_spoolmandb_ref(ref: str, cache: Path) -> str:
    if re.fullmatch(r"[0-9a-f]{40}", ref):
        return ref
    data = fetch(f"https://api.github.com/repos/{SPOOLMANDB_REPO}/commits/{ref}",
                 cache, f"spoolmandb-commit-{ref}-{_dt.date.today()}.json")
    return json.loads(data)["sha"]


def spoolmandb_label(raw_name: str, material: str, fil: dict, brand: str):
    """(material, label) for one SpoolmanDB filament entry."""
    label = clean_text(raw_name.replace("{color_name}", " "))
    label = label.strip(" -")
    mat = material
    if mat.upper().startswith("TPU-") and re.fullmatch(r"TPU-\d+A", mat.upper()):
        label = (mat.split("-", 1)[1] + " " + label).strip()
        mat = "TPU"
    if mat == "PLA+WOOD":
        mat = "PLA"
        if "wood" not in label.lower():
            label = (label + " Wood").strip()
    elif mat == "WOOD":
        mat = "Wood"
    elif mat == "PC+ABS":
        mat = "PC-ABS"
    # leading material word ("PLA-Basic", "ePLA+HS", "High Speed Matte PETG -")
    label = re.sub(rf"^e?{re.escape(mat)}(?:[-\s]+|(?=[A-Z]))", "", label, flags=re.I).strip(" -")
    label = re.sub(rf"\s+{re.escape(mat)}$", "", label, flags=re.I).strip(" -")
    if re.search(r"(^|\s)2\.0(\s|$)", label):
        mat = f"{mat} 2.0"
        label = re.sub(r"(^|\s)2\.0(\s|$)", " ", label).strip()
    label = re.sub(r"\s+", " ", label)
    if label and label == label.lower():
        label = label[:1].upper() + label[1:]
    low = label.lower()
    if fil.get("glow") is True and not re.search(r"glow|luminous", low):
        label = ("Glow " + label).strip()
    if fil.get("pattern") == "marble" and "marble" not in low:
        label = (label + " Marble").strip()
    if fil.get("finish") == "matte" and "matte" not in low:
        label = (label + " Matte").strip()
    if fil.get("translucent") is True and not re.search(r"translucent|transparent|clear", low):
        label = (label + " Translucent").strip()
    if fil.get("multi_color_direction") == "longitudinal" and not label:
        label = "Gradient"
    if brand == "Bambu Lab" and mat == "PLA" and not label:
        label = "Basic"
    return mat, label


def add_spoolmandb(lib: Library, sha: str, cache: Path) -> dict:
    counts = {}
    for fname, brand in SPOOLMANDB_BRANDS.items():
        url = f"https://raw.githubusercontent.com/{SPOOLMANDB_REPO}/{sha}/filaments/{fname}.json"
        data = json.loads(fetch(url, cache, f"spoolmandb-{sha[:12]}-{fname}.json"))
        n = 0
        for fil in data.get("filaments", []):
            mat, label = spoolmandb_label(fil.get("name", ""), fil.get("material", ""), fil, brand)
            line = lib.line(brand, mat, label)
            line_effect = None
            if fil.get("pattern") == "sparkle":
                line_effect = "glitter"
            elif fil.get("pattern") == "marble":
                line_effect = "marble"
            elif fil.get("glow") is True:
                line_effect = "glow"
            else:
                line_effect = effect_for(label)
            for c in fil.get("colors", []):
                hexes = parse_hexes(c.get("hexes") or [c.get("hex", "")])
                direction = c.get("multi_color_direction") or fil.get("multi_color_direction")
                eff = "glow" if c.get("glow") is True else line_effect
                mode, eff, hexes = look_for(hexes, direction, label, eff)
                lib.add(line, c.get("name", ""), hexes, "community", mode, eff)
                n += 1
        counts[brand] = n
    return counts


# ── SUNLU (official) ─────────────────────────────────────────────────────────

def parse_sunlu_table(page: str) -> list[tuple[str, str]]:
    m = re.search(r'<table class="color-code-table".*?</table>', page, re.S)
    if not m:
        return []
    rows = []
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", m.group(0), re.S):
        tds = [clean_text(re.sub(r"<[^>]+>", "", x)) for x in re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)]
        if len(tds) >= 2:
            rows.append((tds[0], tds[1]))
    return rows


def add_sunlu(lib: Library, cache: Path) -> dict:
    stats = {"pages": 0, "colors": 0, "skipped_no_hex": 0}
    for slug, (mat, label) in SUNLU_PAGES.items():
        url = SUNLU_BASE + urllib.parse.quote(slug, safe="+.")
        page = fetch(url, cache, f"sunlu-{norm_key(slug)}.html").decode("utf-8", "replace")
        rows = parse_sunlu_table(page)
        if not rows:
            continue
        stats["pages"] += 1
        line = lib.line("SUNLU", mat, label)
        effect = effect_for(label)
        for name, hexval in rows:
            hexes = parse_hexes(hexval)
            if not hexes:
                stats["skipped_no_hex"] += 1
                continue
            mode, eff, hexes = look_for(hexes, None, label, effect)
            lib.add(line, name, hexes, "official", mode, eff)
            stats["colors"] += 1
    return stats


# ── Polymaker (official) ─────────────────────────────────────────────────────

POLYMAKER_SKIP = re.compile(
    r"bundle|\bbox\b|pack|sample|nebulizer|dryer|hedgehog|easter|polysupport|"
    r"dissolve s2|refill|general|lm show", re.I)


def polymaker_material(product: str) -> str | None:
    p = product.upper()
    if "POLYSMOOTH" in p or "POLYCAST" in p:
        return "PVB"
    if "POLYDISSOLVE" in p:
        return "PVA"
    if "COPE" in p:
        return "CoPE"
    if re.search(r"\bPA(\d+|\b)|COPA", p):
        return "PA-CF" if "CF" in p else "PA-GF" if "GF" in p else "PA"
    if "PPS" in p:
        return "PPS-CF" if "CF" in p else "PPS-GF"
    if re.search(r"\bPET-", p):
        return "PET-CF" if "CF" in p else "PET-GF"
    if "PETG" in p:
        return "PETG-CF" if "CF" in p else "PETG"
    if "PC-ABS" in p:
        return "PC-ABS"
    if "PC-PBT" in p:
        return "PC-PBT"
    if re.search(r"\bPC\b", p):
        return "PC"
    if "ASA" in p:
        return "ASA-CF" if "CF" in p else "ASA"
    if "ABS" in p:
        return "ABS"
    if "TPU" in p:
        return "TPU"
    if "PLA+" in p:
        return "PLA+"
    if "PLA-CF" in p:
        return "PLA-CF"
    if "PLA" in p:
        return "PLA"
    return None


def add_polymaker(lib: Library, cache: Path) -> dict:
    text = fetch(POLYMAKER_URL + ".md", cache, f"polymaker-hex-{_dt.date.today()}.md").decode("utf-8", "replace")
    stats = {"rows": 0, "colors": 0, "skipped": 0}
    for tr in re.findall(r"<tr>(.*?)</tr>", text, re.S):
        tds = [clean_text(re.sub(r"<[^>]+>", "", c)) for c in re.findall(r"<td>(.*?)</td>", tr, re.S)]
        if len(tds) < 4:
            continue
        stats["rows"] += 1
        sku, product, color, hexval = tds[:4]
        product = re.sub(r"^polymaker\s+", "", product, flags=re.I).strip()
        mat = polymaker_material(product)
        hexes = parse_hexes(hexval)
        if POLYMAKER_SKIP.search(product) or not mat or not hexes:
            stats["skipped"] += 1
            continue
        line = lib.line("Polymaker", mat, product)
        mode, eff, hexes = look_for(hexes, None, product, effect_for(product))
        lib.add(line, color, hexes, "official", mode, eff, sku=sku or None)
        stats["colors"] += 1
    return stats


# ── main ─────────────────────────────────────────────────────────────────────

def build(ref: str, cache: Path) -> tuple[dict, dict]:
    lib = Library()
    sha = resolve_spoolmandb_ref(ref, cache)
    report = {"spoolmandb": add_spoolmandb(lib, sha, cache)}
    report["sunlu"] = add_sunlu(lib, cache)
    report["polymaker"] = add_polymaker(lib, cache)
    report["community_duplicates_dropped"] = lib.drop_community_duplicates()
    report["official_overrides"] = lib.stats["official_overrides"]
    report["hex_changed"] = lib.stats["hex_changed"]

    lines = []
    for line in lib.lines.values():
        colors = sorted(line["colors"].values(), key=lambda c: c["name"].lower())
        if not colors:
            continue
        lines.append({**{k: v for k, v in line.items() if k != "colors"}, "colors": colors})
    lines.sort(key=lambda l: (l["brand"].lower(), l["material"].lower(), l["line"].lower()))
    today = _dt.date.today().isoformat()
    out = {
        "schema": 1,
        "generated": today,
        "sources": [
            {"id": "spoolmandb", "name": "SpoolmanDB", "kind": "community",
             "url": f"https://github.com/{SPOOLMANDB_REPO}", "commit": sha,
             "license": SPOOLMANDB_LICENSE,
             "brands": sorted(SPOOLMANDB_BRANDS.values(), key=str.lower)},
            {"id": "sunlu", "name": "SUNLU product pages (Color Code tables)", "kind": "official",
             "url": SUNLU_BASE, "retrieved": today, "brands": ["SUNLU"]},
            {"id": "polymaker", "name": "Polymaker Wiki - HEX Codes and Transmission Distances",
             "kind": "official", "url": POLYMAKER_URL, "retrieved": today, "brands": ["Polymaker"]},
        ],
        "notice": ("Colour values are reference values for display. Community values come from "
                   "SpoolmanDB (MIT licence); official values come from the manufacturers' own pages. "
                   "Printed colours can differ from screen colours."),
        "lines": lines,
    }
    report["lines"] = len(lines)
    report["colors"] = sum(len(l["colors"]) for l in lines)
    return out, report


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--spoolmandb-ref", default="main", help="commit sha or branch (default: main)")
    ap.add_argument("--cache", type=Path, default=Path(tempfile.gettempdir()) / "fm-color-library-cache")
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = ap.parse_args(argv)
    args.cache.mkdir(parents=True, exist_ok=True)
    data, report = build(args.spoolmandb_ref, args.cache)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=1))
    print(f"written: {args.out} ({args.out.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
