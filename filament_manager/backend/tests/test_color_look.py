"""
Colour look (1.18.0): color_mode + color_effect on spools and the filament
catalog — validation, normalisation, migration, export/import round trip.
"""
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.pool import StaticPool

from tests.conftest import make_spool_payload
from app.main import migrate_color_look
from app.util import clean_color_effect, clean_color_mode


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

class TestHelpers:
    def test_valid_mode_kept(self):
        assert clean_color_mode("gradient", None) == "gradient"

    def test_missing_mode_derived_from_second_colour(self):
        assert clean_color_mode(None, "#112233") == "multicolor"
        assert clean_color_mode("", None) == "solid"
        assert clean_color_mode("rainbow", None) == "solid"

    def test_effect_only_with_special(self):
        assert clean_color_effect("special", "glow") == "glow"
        assert clean_color_effect("solid", "glow") is None
        assert clean_color_effect("special", "sparkle") is None


# ---------------------------------------------------------------------------
# Spools API
# ---------------------------------------------------------------------------

class TestSpoolColorLook:
    def test_default_is_solid(self, client):
        r = client.post("/api/spools", json=make_spool_payload())
        assert r.status_code == 201
        assert r.json()["color_mode"] == "solid"
        assert r.json()["color_effect"] is None

    def test_create_special_with_effect(self, client):
        r = client.post("/api/spools", json=make_spool_payload(color_mode="special", color_effect="glitter"))
        assert r.status_code == 201
        assert r.json()["color_mode"] == "special"
        assert r.json()["color_effect"] == "glitter"

    def test_effect_dropped_when_not_special(self, client):
        r = client.post("/api/spools", json=make_spool_payload(color_mode="gradient", color_effect="glow",
                                                               color2_hex="#00FF00"))
        assert r.status_code == 201
        assert r.json()["color_mode"] == "gradient"
        assert r.json()["color_effect"] is None

    def test_invalid_mode_rejected(self, client):
        r = client.post("/api/spools", json=make_spool_payload(color_mode="rainbow"))
        assert r.status_code == 422

    def test_invalid_effect_rejected(self, client):
        r = client.post("/api/spools", json=make_spool_payload(color_mode="special", color_effect="sparkle"))
        assert r.status_code == 422

    def test_patch_switching_away_from_special_clears_effect(self, client):
        sid = client.post("/api/spools", json=make_spool_payload(color_mode="special", color_effect="thermo")).json()["id"]
        r = client.patch(f"/api/spools/{sid}", json={"color_mode": "solid"})
        assert r.status_code == 200
        assert r.json()["color_mode"] == "solid"
        assert r.json()["color_effect"] is None

    def test_unrelated_patch_keeps_look(self, client):
        sid = client.post("/api/spools", json=make_spool_payload(color_mode="special", color_effect="marble")).json()["id"]
        r = client.patch(f"/api/spools/{sid}", json={"notes": "x"})
        assert r.json()["color_mode"] == "special"
        assert r.json()["color_effect"] == "marble"


# ---------------------------------------------------------------------------
# Filament catalog
# ---------------------------------------------------------------------------

def _catalog_payload(**kw):
    p = {"brand": "Bambu Lab", "material": "PLA", "color_name": "Galaxy", "color_hex": "#222222",
         "article_number": "A-1"}
    p.update(kw)
    return p


class TestCatalogColorLook:
    def test_create_and_list(self, client):
        r = client.post("/api/settings/filament-catalog",
                        json=_catalog_payload(color_mode="special", color_effect="glitter"))
        assert r.status_code == 201, r.text
        entry = client.get("/api/settings/filament-catalog").json()[0]
        assert entry["color_mode"] == "special"
        assert entry["color_effect"] == "glitter"

    def test_invalid_mode_rejected(self, client):
        r = client.post("/api/settings/filament-catalog", json=_catalog_payload(color_mode="x"))
        assert r.status_code == 422

    def test_propagates_look_to_spools(self, client):
        eid = client.post("/api/settings/filament-catalog", json=_catalog_payload()).json()["id"]
        sid = client.post("/api/spools", json=make_spool_payload(article_number="A-1")).json()["id"]
        r = client.patch(f"/api/settings/filament-catalog/{eid}",
                         json={"color_mode": "special", "color_effect": "glow", "propagate_to_spools": True})
        assert r.status_code == 200
        spool = client.get(f"/api/spools/{sid}").json()
        assert spool["color_mode"] == "special"
        assert spool["color_effect"] == "glow"


# ---------------------------------------------------------------------------
# Export / import
# ---------------------------------------------------------------------------

class TestTransfer:
    def test_json_round_trip(self, client):
        client.post("/api/spools", json=make_spool_payload(color_mode="special", color_effect="glow"))
        client.post("/api/settings/filament-catalog",
                    json=_catalog_payload(color_mode="gradient", color2_hex="#FFFFFF"))
        bundle = client.get("/api/data/export").json()
        assert bundle["spools"][0]["color_mode"] == "special"
        assert bundle["settings"]["filament_catalog"][0]["color_mode"] == "gradient"

        # import into the same DB again: spool is duplicated by fingerprint rules
        # only if it differs, so change created_at to force a new spool
        bundle["spools"][0]["created_at"] = "2020-01-01T00:00:00"
        r = client.post("/api/data/import", json=bundle)
        assert r.status_code == 200, r.text
        modes = sorted((s["color_mode"], s["color_effect"]) for s in client.get("/api/spools").json())
        assert modes == [("special", "glow"), ("special", "glow")]

    def test_old_bundle_without_fields(self, client):
        bundle = {"version": 1, "spools": [
            {"id": 1, "brand": "Jayo", "material": "PLA", "color_name": "Duo",
             "color_hex": "#FF0000", "color2_hex": "#0000FF",
             "initial_weight_g": 1000.0, "current_weight_g": 800.0},
            {"id": 2, "brand": "Jayo", "material": "PLA", "color_name": "Red",
             "color_hex": "#FF0000", "initial_weight_g": 1000.0, "current_weight_g": 800.0},
        ]}
        r = client.post("/api/data/import", json=bundle)
        assert r.status_code == 200, r.text
        by_name = {s["color_name"]: s for s in client.get("/api/spools").json()}
        assert by_name["Duo"]["color_mode"] == "multicolor"
        assert by_name["Red"]["color_mode"] == "solid"

    def test_csv_export_has_columns(self, client):
        client.post("/api/spools", json=make_spool_payload(color_mode="special", color_effect="marble"))
        csv_text = client.get("/api/data/export-spools-csv").text
        header, row = csv_text.lstrip("﻿").splitlines()[:2]
        assert "color_mode" in header and "color_effect" in header
        assert "special" in row and "marble" in row

    def test_csv_import_invalid_values_normalised(self, client):
        text_csv = ("brand,material,color_name,color_hex,color2_hex,color_mode,color_effect,initial_weight_g\n"
                    "Jayo,PLA,A,#FF0000,,rainbow,glow,1000\n"
                    "Jayo,PLA,B,#FF0000,#00FF00,,,1000\n"
                    "Jayo,PLA,C,#FF0000,,special,thermo,1000\n")
        r = client.post("/api/data/import-spools-csv",
                        files={"file": ("s.csv", text_csv.encode("utf-8"), "text/csv")})
        assert r.status_code == 200, r.text
        by_name = {s["color_name"]: s for s in client.get("/api/spools").json()}
        assert (by_name["A"]["color_mode"], by_name["A"]["color_effect"]) == ("solid", None)
        assert (by_name["B"]["color_mode"], by_name["B"]["color_effect"]) == ("multicolor", None)
        assert (by_name["C"]["color_mode"], by_name["C"]["color_effect"]) == ("special", "thermo")


# ---------------------------------------------------------------------------
# Migration
# ---------------------------------------------------------------------------

class TestMigration:
    def _old_db(self):
        eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        with eng.connect() as conn:
            for table in ("spools", "filament_catalog"):
                conn.execute(text(f"CREATE TABLE {table} (id INTEGER PRIMARY KEY, color_hex TEXT, color2_hex TEXT)"))
                conn.execute(text(f"INSERT INTO {table} (id, color_hex, color2_hex) VALUES "
                                  "(1, '#111111', NULL), (2, '#111111', '#222222'), (3, '#111111', '')"))
            conn.commit()
        return eng

    def test_adds_columns_and_marks_multicolor(self):
        eng = self._old_db()
        with eng.connect() as conn:
            migrate_color_look(conn, inspect(eng))
            for table in ("spools", "filament_catalog"):
                rows = conn.execute(text(f"SELECT id, color_mode, color_effect FROM {table} ORDER BY id")).all()
                assert [tuple(r) for r in rows] == [(1, "solid", None), (2, "multicolor", None), (3, "solid", None)]

    def test_idempotent(self):
        eng = self._old_db()
        with eng.connect() as conn:
            migrate_color_look(conn, inspect(eng))
            conn.execute(text("UPDATE spools SET color_mode = 'gradient' WHERE id = 2"))
            conn.commit()
            migrate_color_look(conn, inspect(eng))
            assert conn.execute(text("SELECT color_mode FROM spools WHERE id = 2")).scalar() == "gradient"
