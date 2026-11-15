"""Share the collection (1.20.0): whitelist, configuration, upload rules, proxy routes."""
import json
import re
from datetime import datetime

import httpx
import pytest

from app import share
from app.models import Spool, UserPreferences

KEY = "k" * 40
URL = "https://sammlung.example.workers.dev"
LINK_A = "A" * 22
LINK_B = "B" * 22


def make_spool(session, **over):
    data = dict(
        brand="SUNLU", material="PLA", subtype="Matte", color_name="Mint Green", color_hex="#00c7b1",
        initial_weight_g=1000.0, current_weight_g=550.0, spool_weight_g=150.0,
        purchase_price=19.99, purchase_location="Amazon", storage_location="Regal 3",
        article_number="ART-4711", notes="geheime Notiz", ams_slot="A1", custom_id=12,
        bambu_spool_id="998877", purchased_at=datetime(2026, 1, 2),
    )
    data.update(over)
    s = Spool(**data)
    session.add(s)
    session.commit()
    return s


@pytest.fixture(autouse=True)
def fresh_state(monkeypatch, tmp_path, session_factory):
    monkeypatch.setattr(share, "state", share._PushState())
    monkeypatch.setattr(share, "_lock", None)
    monkeypatch.setattr(share, "_options_path", lambda: tmp_path / "options.json")
    monkeypatch.setattr(share, "SessionLocal", session_factory)
    return tmp_path


def configure(tmp_path, url=URL, key=KEY):
    (tmp_path / "options.json").write_text(json.dumps({"share_url": url, "share_key": key}), encoding="utf-8")


class FakeWorker:
    def __init__(self):
        self.calls = []
        self.snapshot = None
        self.links = {}
        self.fail = None

    async def send(self, cfg, method, path, payload=None):
        self.calls.append((method, path, payload, cfg.key))
        req = httpx.Request(method, cfg.url + path)
        if self.fail == "unreachable":
            raise httpx.ConnectError("down", request=req)
        if self.fail == "401":
            return httpx.Response(401, json={"error": "unauthorized"}, request=req)
        if (method, path) == ("PUT", "/api/snapshot"):
            self.snapshot = payload
            return httpx.Response(200, json={"received_at": "2026-11-15T12:00:00Z",
                                             "spool_count": len(payload["spools"])}, request=req)
        if (method, path) == ("GET", "/api/links"):
            return httpx.Response(200, json={
                "snapshot_received_at": "2026-11-15T12:00:00Z" if self.snapshot else None,
                "snapshot_generated_at": None, "spool_count": len((self.snapshot or {}).get("spools", [])),
                "links": list(self.links.values())}, request=req)
        if (method, path) == ("POST", "/api/links"):
            link = {"id": LINK_A, "active": True, "views": 0, **payload}
            self.links[LINK_A] = link
            return httpx.Response(201, json=link, request=req)
        m = re.match(r"^/api/links/([^/]+)(/renew)?$", path)
        if m and m.group(1) in self.links:
            if m.group(2):
                link = {**self.links.pop(m.group(1)), "id": LINK_B, "views": 0}
                self.links[LINK_B] = link
                return httpx.Response(200, json=link, request=req)
            if method == "PATCH":
                self.links[m.group(1)].update(payload)
                return httpx.Response(200, json=self.links[m.group(1)], request=req)
            if method == "DELETE":
                del self.links[m.group(1)]
                return httpx.Response(200, json={"ok": True}, request=req)
        return httpx.Response(404, json={"error": "not_found"}, request=req)


@pytest.fixture
def worker(monkeypatch):
    w = FakeWorker()
    monkeypatch.setattr(share, "_send", w.send)
    return w


# ── whitelist ────────────────────────────────────────────────────────────────

def test_public_spool_has_only_whitelisted_fields(session):
    s = make_spool(session)
    out = share.public_spool(s)
    assert out == {
        "number": s.id, "brand": "SUNLU", "material": "PLA", "subtype": "Matte", "color_name": "Mint Green",
        "colors": ["#00C7B1"], "color_mode": "solid", "color_effect": None, "remaining_pct": 55,
        "weight_g": 550, "spool_g": 1000,
    }


def test_weights_are_whole_grams_and_never_negative(session):
    out = share.public_spool(make_spool(session, current_weight_g=-12.0, initial_weight_g=1000.4))
    assert (out["weight_g"], out["spool_g"]) == (0, 1000)
    assert share.public_spool(make_spool(session, current_weight_g=549.6))["weight_g"] == 550


def test_snapshot_never_contains_private_data(session):
    make_spool(session)
    make_spool(session, color_name="Archiviert", archived=True)
    session.add(UserPreferences(id=1, low_stock_threshold_pct=25, almost_empty_threshold_pct=5))
    session.commit()
    snap = share.build_snapshot(session)
    assert set(snap) == {"generated_at", "low_pct", "empty_pct", "spools"}
    assert (snap["low_pct"], snap["empty_pct"]) == (25, 5)
    assert len(snap["spools"]) == 1
    raw = json.dumps(snap, ensure_ascii=False)
    for secret in ("19.99", "Amazon", "Regal 3", "ART-4711", "geheime", "A1", "998877", "Archiviert", "2026-01-02"):
        assert secret not in raw


@pytest.mark.parametrize("over, colors, mode, effect", [
    (dict(color2_hex="#ff0000"), ["#00C7B1", "#FF0000"], "multicolor", None),           # old rows: 2 colours
    (dict(color_mode="gradient"), ["#00C7B1"], "solid", None),                           # gradient needs 2
    (dict(color_mode="gradient", color2_hex="#111111", color3_hex="#222222", color4_hex="#333333"),
     ["#00C7B1", "#111111", "#222222", "#333333"], "gradient", None),
    (dict(color_mode="multicolor", color2_hex="#111111", color3_hex="#222222", color4_hex="#333333"),
     ["#00C7B1", "#111111", "#222222"], "multicolor", None),                             # max 3
    (dict(color_mode="special", color_effect="glitter", color2_hex="#111111"), ["#00C7B1"], "special", "glitter"),
    (dict(color_mode="solid", color_effect="glitter"), ["#00C7B1"], "solid", None),
    (dict(color_hex="kaputt"), ["#888888"], "solid", None),
])
def test_look_matches_frontend(session, over, colors, mode, effect):
    out = share.public_spool(make_spool(session, **over))
    assert (out["colors"], out["color_mode"], out["color_effect"]) == (colors, mode, effect)


def test_text_and_percent_are_bounded(session):
    out = share.public_spool(make_spool(
        session, brand="  x  " + "y" * 200, subtype="Matte", subtype2="Silk", current_weight_g=1200.0))
    assert len(out["brand"]) == 60 and out["brand"].startswith("x y")
    assert out["subtype"] == "Matte, Silk"
    assert out["remaining_pct"] == 100
    assert share.public_spool(make_spool(session, current_weight_g=0.0))["remaining_pct"] == 0


# ── configuration ────────────────────────────────────────────────────────────

@pytest.mark.parametrize("opts, problem", [
    (None, "not_configured"),
    ({}, "not_configured"),
    ({"share_url": "http://example.com", "share_key": KEY}, "invalid_url"),
    ({"share_url": "https://example.com/pfad", "share_key": KEY}, "invalid_url"),
    ({"share_url": "https://example.com?x=1", "share_key": KEY}, "invalid_url"),
    ({"share_url": URL, "share_key": "kurz"}, "invalid_key"),
    ({"share_url": URL + "/", "share_key": KEY}, None),
    ({"share_url": "http://127.0.0.1:8787", "share_key": KEY}, None),
])
def test_load_config(fresh_state, opts, problem):
    if opts is not None:
        (fresh_state / "options.json").write_text(json.dumps(opts), encoding="utf-8")
    cfg, why = share.load_config()
    assert why == problem
    assert (cfg is None) == (problem is not None)
    if cfg:
        assert not cfg.url.endswith("/")


def test_upload_only_on_change_and_not_too_often(monkeypatch):
    monkeypatch.setattr(share, "state", share._PushState(last_hash="abc", last_attempt=1000.0))
    assert share.due("abc", 5000.0) is False                 # unchanged
    assert share.due("neu", 1000.0 + 299) is False           # changed, but too soon
    assert share.due("neu", 1000.0 + 300) is True
    assert share.due("abc", 1001.0, force=True) is True


@pytest.mark.anyio
async def test_push_sends_once_then_waits(session, fresh_state, worker):
    configure(fresh_state)
    make_spool(session)
    assert await share.push() == "pushed"
    assert await share.push() == "unchanged"
    make_spool(session, color_name="Neu")
    assert await share.push() == "waiting"
    assert await share.push(force=True) == "pushed"
    puts = [c for c in worker.calls if c[0] == "PUT"]
    assert len(puts) == 2 and all(c[3] == KEY for c in puts)
    assert len(worker.snapshot["spools"]) == 2


@pytest.mark.anyio
async def test_push_without_config_does_nothing(worker):
    assert await share.push(force=True) == "not_configured"
    assert worker.calls == []


@pytest.mark.anyio
async def test_push_failure_is_remembered(session, fresh_state, worker):
    configure(fresh_state)
    worker.fail = "401"
    assert await share.push(force=True) == "key_rejected"
    assert share.state.last_error == "key_rejected"
    assert share.state.last_hash is None


# ── routes ───────────────────────────────────────────────────────────────────

def test_status_and_links_without_config(client, worker):
    st = client.get("/api/share/status").json()
    assert st["configured"] is False and st["problem"] == "not_configured" and st["base_url"] is None
    r = client.get("/api/share/links")
    assert r.status_code == 409 and r.json()["detail"] == "not_configured"


def test_preview_shows_exactly_the_shared_data(client, session):
    make_spool(session)
    body = client.get("/api/share/preview").json()
    assert body["spools"][0]["color_name"] == "Mint Green"
    assert "Regal 3" not in json.dumps(body)


def test_link_lifecycle(client, session, fresh_state, worker):
    configure(fresh_state)
    make_spool(session)

    r = client.post("/api/share/links", json={"name": "Meine Spulen", "expires_at": "2026-12-31T23:00:00+01:00"})
    assert r.status_code == 201
    link = r.json()
    assert link["url"] == f"{URL}/s/{LINK_A}"
    assert link["expires_at"] == "2026-12-31T22:00:00Z"
    assert worker.snapshot is not None                          # first link uploads data right away

    listed = client.get("/api/share/links").json()
    assert listed["links"][0]["url"] == f"{URL}/s/{LINK_A}"

    r = client.patch(f"/api/share/links/{LINK_A}", json={"active": False, "expires_at": None})
    assert r.status_code == 200 and r.json()["active"] is False and r.json()["expires_at"] is None
    assert client.patch(f"/api/share/links/{LINK_A}", json={"name": None}).status_code == 422

    r = client.post(f"/api/share/links/{LINK_A}/renew")
    assert r.json()["url"] == f"{URL}/s/{LINK_B}"
    assert client.delete(f"/api/share/links/{LINK_B}").status_code == 200
    assert client.delete(f"/api/share/links/{LINK_B}").status_code == 404


def test_filter_and_weight_options_reach_the_worker(client, session, fresh_state, worker):
    configure(fresh_state)
    make_spool(session)
    r = client.post("/api/share/links", json={
        "name": "Gefiltert", "brands": ["SUNLU", "Bambu Lab"], "materials": ["PETG"], "show_weight": False})
    assert r.status_code == 201
    sent = worker.calls[0][2] if worker.calls[0][1] == "/api/links" else next(c[2] for c in worker.calls if c[1] == "/api/links")
    assert sent["brands"] == ["SUNLU", "Bambu Lab"] and sent["materials"] == ["PETG"] and sent["show_weight"] is False

    # defaults: no filter, grams shown
    client.post("/api/share/links", json={"name": "Alles"})
    last = [c for c in worker.calls if c[0] == "POST" and c[1] == "/api/links"][-1][2]
    assert last["brands"] == [] and last["materials"] == [] and last["show_weight"] is True

    r = client.patch(f"/api/share/links/{LINK_A}", json={"brands": [], "show_weight": True})
    assert r.status_code == 200 and r.json()["brands"] == []


def test_filter_input_is_validated(client, fresh_state, worker):
    configure(fresh_state)
    assert client.post("/api/share/links", json={"name": "x", "brands": [""]}).status_code == 422
    assert client.post("/api/share/links", json={"name": "x", "brands": ["a" * 61]}).status_code == 422
    assert client.post("/api/share/links", json={"name": "x", "materials": [str(i) for i in range(41)]}).status_code == 422
    assert client.post("/api/share/links", json={"name": "x", "brands": "SUNLU"}).status_code == 422
    assert client.patch(f"/api/share/links/{LINK_A}", json={"brands": None}).status_code == 422
    assert worker.calls == []


def test_bad_ids_never_reach_the_worker(client, fresh_state, worker):
    configure(fresh_state)
    for bad in ("kurz", "A" * 21 + "%2F", "..%2F..%2Fapi%2Fsnapshot"):
        assert client.delete(f"/api/share/links/{bad}").status_code == 404
    assert worker.calls == []


def test_list_uploads_when_worker_has_no_data(client, session, fresh_state, worker):
    configure(fresh_state)
    make_spool(session)
    body = client.get("/api/share/links").json()
    assert body["snapshot_received_at"] is not None
    assert [c[0] for c in worker.calls] == ["GET", "PUT", "GET"]


@pytest.mark.parametrize("fail, detail", [("unreachable", "unreachable"), ("401", "key_rejected")])
def test_worker_problems_become_502(client, fresh_state, worker, fail, detail):
    configure(fresh_state)
    worker.fail = fail
    r = client.get("/api/share/links")
    assert r.status_code == 502 and r.json()["detail"] == detail


def test_key_never_appears_in_responses(client, session, fresh_state, worker):
    configure(fresh_state)
    make_spool(session)
    client.post("/api/share/links", json={"name": "x"})
    for path in ("/api/share/status", "/api/share/links", "/api/share/preview"):
        assert KEY not in client.get(path).text
