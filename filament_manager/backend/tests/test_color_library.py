"""
Manufacturer colour library (1.19.0): bundled data file, GET /api/color-library,
POST /api/color-library/to-catalog and the pure helpers of
tools/build_manufacturer_colors.py.
"""
import importlib.util
import re
from pathlib import Path

import pytest

from app.models import FilamentBrand, FilamentCatalog, FilamentMaterial, FilamentSubtype
from app.routers import color_library
from app.util import COLOR_EFFECTS, COLOR_MODES

HEX = re.compile(r"^#[0-9A-F]{6}$")
MODE_RANGE = {"solid": (1, 1), "special": (1, 1), "gradient": (2, 4), "multicolor": (2, 3)}

TOOLS = Path(__file__).resolve().parents[3] / "tools" / "build_manufacturer_colors.py"


# ---------------------------------------------------------------------------
# Bundled data file
# ---------------------------------------------------------------------------

class TestDataFile:
    @pytest.fixture(scope="class")
    def lib(self):
        color_library.load_library.cache_clear()
        return color_library.load_library()

    def test_file_present_with_lines(self, lib):
        assert lib["schema"] == 1
        assert len(lib["lines"]) > 100
        assert sum(len(l["colors"]) for l in lib["lines"]) > 1000

    def test_sources_and_licence(self, lib):
        ids = {s["id"] for s in lib["sources"]}
        assert {"spoolmandb", "sunlu", "polymaker"} <= ids
        spoolman = next(s for s in lib["sources"] if s["id"] == "spoolmandb")
        assert "MIT" in spoolman["license"]
        assert re.fullmatch(r"[0-9a-f]{40}", spoolman["commit"])

    def test_expected_brands(self, lib):
        brands = {l["brand"] for l in lib["lines"]}
        assert {"SUNLU", "Bambu Lab", "eSUN", "Geeetech", "ANYCUBIC", "ERYONE",
                "Jayo", "TECBEARS", "Elegoo", "Polymaker"} <= brands

    def test_every_colour_is_valid_for_filly(self, lib):
        for line in lib["lines"]:
            assert line["brand"] and line["material"]
            names = set()
            for c in line["colors"]:
                assert c["name"].strip() == c["name"] and c["name"]
                assert c["src"] in ("official", "community")
                assert all(HEX.match(h) for h in c["hex"]), c
                mode = c.get("mode", "solid")
                assert mode in COLOR_MODES
                lo, hi = MODE_RANGE[mode]
                assert lo <= len(c["hex"]) <= hi, (line["line"], c)
                eff = c.get("effect")
                if eff is not None:
                    assert mode == "special" and eff in COLOR_EFFECTS
                key = c["name"].casefold()
                assert key not in names, (line["brand"], line["line"], c["name"])
                names.add(key)

    def test_sunlu_official_and_polymaker_official(self, lib):
        sunlu = [c for l in lib["lines"] if l["brand"] == "SUNLU" for c in l["colors"]]
        poly = [c for l in lib["lines"] if l["brand"] == "Polymaker" for c in l["colors"]]
        assert sum(c["src"] == "official" for c in sunlu) > 300
        assert poly and all(c["src"] == "official" for c in poly)
        assert any(c.get("sku") for c in poly)

    def test_known_official_values(self, lib):
        def find(brand, material, line, name):
            for l in lib["lines"]:
                if (l["brand"], l["material"], l["line"]) == (brand, material, line):
                    for c in l["colors"]:
                        if c["name"].casefold() == name.casefold():
                            return c
            return None
        oak = find("SUNLU", "PLA+ 2.0", "", "Oak")
        assert oak and oak["hex"] == ["#C2B29A"] and oak["src"] == "official"
        hs_orange = find("SUNLU", "PLA+", "High Speed", "Orange")
        assert hs_orange and hs_orange["src"] == "official"


# ---------------------------------------------------------------------------
# GET /api/color-library
# ---------------------------------------------------------------------------

class TestGetLibrary:
    def test_overview_without_lines(self, client):
        r = client.get("/api/color-library")
        assert r.status_code == 200
        body = r.json()
        assert "lines" not in body
        brands = {b["brand"]: b for b in body["brands"]}
        assert brands["SUNLU"]["official"] > 0
        assert brands["SUNLU"]["colors"] == brands["SUNLU"]["official"] + brands["SUNLU"]["community"]
        assert "PLA" in body["materials"]
        assert body["notice"]

    def test_brand_filter_is_case_insensitive(self, client):
        body = client.get("/api/color-library", params={"brand": "sunlu"}).json()
        assert body["lines"] and {l["brand"] for l in body["lines"]} == {"SUNLU"}
        assert body["count"] == sum(len(l["colors"]) for l in body["lines"])

    def test_material_filter(self, client):
        body = client.get("/api/color-library", params={"brand": "SUNLU", "material": "PETG"}).json()
        assert body["lines"] and all(l["material"] == "PETG" for l in body["lines"])

    def test_search_all_brands(self, client):
        body = client.get("/api/color-library", params={"q": "sunlu oak"}).json()
        names = [(l["brand"], c["name"]) for l in body["lines"] for c in l["colors"]]
        assert ("SUNLU", "Oak") in names
        assert all(b == "SUNLU" for b, _ in names)

    def test_search_by_hex(self, client):
        body = client.get("/api/color-library", params={"q": "#C2B29A"}).json()
        assert any(c["hex"][0] == "#C2B29A" for l in body["lines"] for c in l["colors"])

    def test_limit_truncates(self, client):
        body = client.get("/api/color-library", params={"brand": "Polymaker", "limit": 5}).json()
        assert body["count"] == 5 and body["truncated"] is True

    def test_missing_file_gives_empty_library(self, client, monkeypatch, tmp_path):
        monkeypatch.setattr(color_library, "DATA_FILE", tmp_path / "missing.json")
        color_library.load_library.cache_clear()
        try:
            body = client.get("/api/color-library", params={"brand": "SUNLU"}).json()
            assert body["brands"] == [] and body["lines"] == []
        finally:
            color_library.load_library.cache_clear()


# ---------------------------------------------------------------------------
# POST /api/color-library/to-catalog
# ---------------------------------------------------------------------------

def _pick(**kw):
    base = dict(brand="Polymaker", material="PLA", subtype="Matte", color_name="Charcoal Black",
                hex=["#2F2E30"], color_mode="solid", color_effect=None, article_number="PA02001")
    base.update(kw)
    return base


class TestToCatalog:
    def test_adds_rows_and_missing_list_entries(self, client, session):
        r = client.post("/api/color-library/to-catalog", json={"items": [
            _pick(),
            _pick(color_name="Dual Silk Crown", subtype="Silk", hex=["#c49449", "BCC2C8"],
                  color_mode="multicolor", article_number="CA03027"),
        ]})
        assert r.status_code == 200
        body = r.json()
        assert body["added"] == 2 and body["skipped"] == 0 and len(body["ids"]) == 2
        assert body["lists_added"]["brands"] == ["Polymaker"]
        assert set(body["lists_added"]["subtypes"]) == {"Matte", "Silk"}
        dual = session.get(FilamentCatalog, body["ids"][1])
        assert (dual.color_hex, dual.color2_hex, dual.color_mode) == ("#C49449", "#BCC2C8", "multicolor")
        assert session.query(FilamentBrand).filter_by(name="Polymaker").count() == 1
        assert session.query(FilamentMaterial).filter_by(name="PLA").count() == 1
        assert session.query(FilamentSubtype).filter_by(name="Silk").count() == 1

    def test_skips_duplicates(self, client, session):
        client.post("/api/color-library/to-catalog", json={"items": [_pick()]})
        body = client.post("/api/color-library/to-catalog", json={"items": [
            _pick(),                                              # same article number
            _pick(article_number=None, color_name="charcoal black"),  # same key, other case
            _pick(article_number=None, color_name="Cotton White", hex=["#E6DDDB"]),
        ]}).json()
        assert body["added"] == 1 and body["skipped"] == 2
        assert session.query(FilamentCatalog).count() == 2

    def test_special_effect_kept_and_normalized(self, client, session):
        body = client.post("/api/color-library/to-catalog", json={"items": [
            _pick(color_name="Starlight Mars", subtype=None, hex=["#8E3B2B"],
                  color_mode="special", color_effect="glitter", article_number=None),
            _pick(color_name="Plain", subtype=None, hex=["#111111"],
                  color_mode="solid", color_effect="glow", article_number=None),
        ]}).json()
        a, b = (session.get(FilamentCatalog, i) for i in body["ids"])
        assert (a.color_mode, a.color_effect) == ("special", "glitter")
        assert (b.color_mode, b.color_effect) == ("solid", None)

    def test_existing_list_names_not_duplicated(self, client, session):
        session.add(FilamentBrand(name="polymaker"))
        session.commit()
        body = client.post("/api/color-library/to-catalog", json={"items": [_pick()]}).json()
        assert body["lists_added"]["brands"] == []

    @pytest.mark.parametrize("bad", [
        {"hex": []},
        {"hex": ["#12345"]},
        {"hex": ["#111111"] * 5},
        {"color_mode": "rainbow"},
        {"color_effect": "sparkle"},
        {"color_name": ""},
    ])
    def test_validation(self, client, bad):
        r = client.post("/api/color-library/to-catalog", json={"items": [_pick(**bad)]})
        assert r.status_code == 422

    def test_empty_items_rejected(self, client):
        assert client.post("/api/color-library/to-catalog", json={"items": []}).status_code == 422


# ---------------------------------------------------------------------------
# tools/build_manufacturer_colors.py — pure helpers
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def builder():
    if not TOOLS.exists():
        pytest.skip("tools/ not present")
    spec = importlib.util.spec_from_file_location("build_manufacturer_colors", TOOLS)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class TestBuilder:
    def test_direction_maps_to_mode(self, builder):
        assert builder.look_for(["#111111", "#222222"], "longitudinal", "", None)[0] == "gradient"
        assert builder.look_for(["#111111", "#222222"], "coaxial", "Silk", None)[0] == "multicolor"
        assert builder.look_for(["#111111", "#222222"], None, "Dual Matte", None)[0] == "multicolor"
        assert builder.look_for(["#111111", "#222222"], None, "Gradient Silk", None)[0] == "gradient"

    def test_four_coaxial_colours_become_gradient(self, builder):
        mode, _, hexes = builder.look_for(["#111111"] * 4, "coaxial", "Silk", None)
        assert mode == "gradient" and len(hexes) == 4

    def test_effects(self, builder):
        assert builder.look_for(["#111111"], None, "Galaxy", "glitter")[:2] == ("special", "glitter")
        # glow and thermo list two states but stay one colour with effect
        assert builder.look_for(["#111111", "#22FF22"], None, "Glow", "glow")[:2] == ("special", "glow")
        assert builder.look_for(["#111111"], None, "", None)[:2] == ("solid", None)

    def test_subtypes_in_label_order(self, builder):
        assert builder.subtypes_for("High Speed Matte") == ("High Speed", "Matte")
        assert builder.subtypes_for("Silk+") == ("Silk+", None)
        assert builder.subtypes_for("Panchroma Luminous PLA") == ("Glow", None)
        assert builder.subtypes_for("PolyLite PLA Pro") == (None, None)

    def test_spoolmandb_labels(self, builder):
        f = {}
        assert builder.spoolmandb_label("2.0 {color_name}", "PLA+", f, "SUNLU") == ("PLA+ 2.0", "")
        assert builder.spoolmandb_label("Silk 2.0 {color_name}", "PLA+", f, "SUNLU") == ("PLA+ 2.0", "Silk")
        assert builder.spoolmandb_label("{color_name}", "TPU-95A", f, "SUNLU") == ("TPU", "95A")
        assert builder.spoolmandb_label("High Speed Matte PETG - {color_name}", "PETG", f, "SUNLU") == ("PETG", "High Speed Matte")
        assert builder.spoolmandb_label("ePLA+HS {color_name}", "PLA+", f, "eSUN") == ("PLA+", "HS")
        assert builder.spoolmandb_label("PLA-lite {color_name}", "PLA", f, "eSUN") == ("PLA", "Lite")
        assert builder.spoolmandb_label("{color_name}", "PLA", {}, "Bambu Lab") == ("PLA", "Basic")
        assert builder.spoolmandb_label("{color_name}", "PLA", {"glow": True}, "SUNLU") == ("PLA", "Glow")

    def test_polymaker_material(self, builder):
        assert builder.polymaker_material("Panchroma Matte PLA") == "PLA"
        assert builder.polymaker_material("Fiberon PA6-CF20") == "PA-CF"
        assert builder.polymaker_material("PolyMide CoPA") == "PA"
        assert builder.polymaker_material("PolySmooth") == "PVB"
        assert builder.polymaker_material("Panchroma CoPE") == "CoPE"
        assert builder.polymaker_material("PolyLite PETG") == "PETG"

    def test_parse_hexes(self, builder):
        assert builder.parse_hexes("#c49449, #AA538E") == ["#C49449", "#AA538E"]
        assert builder.parse_hexes(["9cdbd9", "FFFFFF"]) == ["#9CDBD9", "#FFFFFF"]
        assert builder.parse_hexes("—") == []
