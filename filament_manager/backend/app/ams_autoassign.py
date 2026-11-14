"""Silent spool assignment for AMS slots.

Printing books the used grams from the spool that is assigned to the slot when the print starts.
For third-party filament (no RFID chip) the printer only reports a basic type and a colour, so a
slot stays without a spool until somebody assigns one. This module assigns it when the match is
sure and records every assignment so it can be undone from the dashboard.

A match is "sure" when
  * the slot has no spool assigned,
  * exactly one active spool with weight left fits the reported material and colour (colour
    distance within COLOR_TOLERANCE) and is not sitting in another slot, and
  * that spool's colour is very close (SURE_DELTA).
Anything else stays a question for the user (dashboard card "Which spool is in …?").

An assignment that was undone, dismissed or later removed by hand is never repeated for the same
slot + spool + reported colour/material (the log entry is the memory).
"""
import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from . import ha_publisher, moisture
from .models import PrinterConfig, Spool, UserPreferences

log = logging.getLogger(__name__)

SURE_DELTA = 3.0
MAX_LOG = 50

# log entry states: "new" (shown on the dashboard) | "seen" (dismissed) | "undone"
NEW, SEEN, UNDONE = "new", "seen", "undone"


def _prefs(db: Session) -> UserPreferences:
    prefs = db.get(UserPreferences, 1)
    if prefs is None:
        prefs = UserPreferences(id=1)
        db.add(prefs)
        db.flush()
    return prefs


def get_log(db: Session) -> list[dict]:
    prefs = db.get(UserPreferences, 1)
    return list(prefs.ams_auto_log or []) if prefs else []


def _save_log(db: Session, entries: list[dict]) -> None:
    # new list object: JSON columns are not change-tracked in place
    _prefs(db).ams_auto_log = entries[-MAX_LOG:]


def _label(s: Spool) -> str:
    num = f"#{s.custom_id} " if s.custom_id else ""
    return f"{num}{s.brand} {s.material} — {s.color_name}"


def _slot_holder(db: Session, printer_name: str, slot_key: str) -> Spool | None:
    return (
        db.query(Spool).filter(Spool.ams_slot == f"{printer_name}:{slot_key}").first()
        or db.query(Spool).filter(Spool.ams_slot == slot_key).first()
    )


def sure_candidate(tray: dict, spools: list[Spool]) -> Spool | None:
    """The one spool that surely is in this tray, or None (see module docstring)."""
    material = tray.get("material") or ""
    color = tray.get("color") or ""
    if not material or not color:
        return None
    fitting: list[tuple[Spool, float]] = []
    for s in spools:
        if s.archived or s.current_weight_g <= 0 or s.ams_slot:
            continue
        if not ha_publisher.material_matches(material, s):
            continue
        d = ha_publisher.color_delta(color, s.color_hex or "")
        if d is not None and d <= ha_publisher.COLOR_TOLERANCE:
            fitting.append((s, d))
    if len(fitting) != 1:
        return None
    spool, delta = fitting[0]
    return spool if delta <= SURE_DELTA else None


def run_for_printer(db: Session, printer: PrinterConfig) -> list[dict]:
    """Assign sure matches for all slots of one printer; returns the new log entries."""
    from . import bambu_cloud_client

    if not printer.bambu_serial:
        return []
    ams = bambu_cloud_client.get_ams_detail_for_serial(printer.bambu_serial)
    if not ams:
        return []

    log_entries = get_log(db)
    done = {(e["printer_id"], e["slot_key"], e["spool_id"], e.get("color"), e.get("material")) for e in log_entries}
    spools = db.query(Spool).filter(Spool.archived == False).all()  # noqa: E712
    created: list[dict] = []

    for slot_key, tray in ams.items():
        remain = tray.get("remain")
        if remain is None or remain <= 0:
            continue                     # not tracked / empty
        if _slot_holder(db, printer.name, slot_key) is not None:
            continue                     # already assigned (a mismatch is a question, not for us)
        spool = sure_candidate(tray, spools)
        if spool is None:
            continue
        key = (printer.id, slot_key, spool.id, tray.get("color"), tray.get("material"))
        if key in done:
            continue                     # was assigned before and undone / removed / dismissed
        moisture.set_ams_slot(spool, f"{printer.name}:{slot_key}")
        spool.ams_slot = f"{printer.name}:{slot_key}"
        entry = {
            "id": uuid.uuid4().hex[:8],
            "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "printer_id": printer.id,
            "printer": printer.name,
            "slot_key": slot_key,
            "spool_id": spool.id,
            "label": _label(spool),
            "color": tray.get("color"),
            "material": tray.get("material"),
            "state": NEW,
        }
        created.append(entry)
        log_entries.append(entry)
        spools = [s for s in spools if s.id != spool.id]
        log.info("AMS auto-assign: %s → %s %s", _label(spool), printer.name, slot_key)

    if created:
        _save_log(db, log_entries)
        db.commit()
        ha_publisher.trigger()
    return created


def run(db: Session) -> list[dict]:
    created: list[dict] = []
    for printer in db.query(PrinterConfig).filter(PrinterConfig.is_active == True).all():  # noqa: E712
        created += run_for_printer(db, printer)
    return created


def set_state(db: Session, entry_id: str, state: str) -> dict | None:
    """Change the state of one log entry; "undone" also takes the spool out of the slot."""
    entries = get_log(db)
    entry = next((e for e in entries if e["id"] == entry_id), None)
    if entry is None:
        return None
    if state == UNDONE:
        spool = db.get(Spool, entry["spool_id"])
        if spool is not None and (spool.ams_slot or "").endswith(f":{entry['slot_key']}"):
            moisture.set_ams_slot(spool, None)
    entry = {**entry, "state": state}
    _save_log(db, [entry if e["id"] == entry_id else e for e in entries])
    db.commit()
    ha_publisher.trigger()
    return entry
