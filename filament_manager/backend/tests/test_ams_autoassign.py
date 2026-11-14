"""Silent AMS spool assignment: assign only sure matches, log them, never repeat an undone one."""
import pytest
from unittest.mock import patch

from app import ams_autoassign
from app.models import PrinterConfig, Spool


def _spool(session, *, material="PLA+ 2.0", color="#C2B29A", weight=400.0, **kw) -> Spool:
    s = Spool(brand="SUNLU", material=material, color_name="Oak", color_hex=color,
              initial_weight_g=1000.0, current_weight_g=weight, **kw)
    session.add(s)
    session.commit()
    return s


def _printer(session) -> PrinterConfig:
    p = PrinterConfig(name="Bambu Lab A1", bambu_serial="SER1", is_active=True)
    session.add(p)
    session.commit()
    return p


def _ams(color="#C2B29A", material="PLA", remain=100):
    return {"ams1_tray1": {"material": material, "color": color, "remain": remain}}


def _run(session, printer, ams):
    with patch("app.bambu_cloud_client.get_ams_detail_for_serial", return_value=ams):
        return ams_autoassign.run_for_printer(session, printer)


class TestSureMatch:
    def test_assigns_the_one_fitting_spool_and_logs_it(self, session):
        p, s = _printer(session), _spool(session)
        created = _run(session, p, _ams())
        assert len(created) == 1
        session.refresh(s)
        assert s.ams_slot == "Bambu Lab A1:ams1_tray1"
        log = ams_autoassign.get_log(session)
        assert log[0]["spool_id"] == s.id and log[0]["state"] == "new" and "Oak" in log[0]["label"]

    def test_slightly_different_shade_within_sure_distance(self, session):
        p, s = _printer(session), _spool(session, color="#C2B29A")
        assert _run(session, p, _ams(color="#C4B49C"))

    def test_two_fitting_spools_is_a_question_not_an_assignment(self, session):
        p = _printer(session)
        _spool(session); _spool(session, material="PLA+")
        assert _run(session, p, _ams()) == []

    def test_colour_only_roughly_right_is_not_sure(self, session):
        p, s = _printer(session), _spool(session, color="#C2B29A")
        assert _run(session, p, _ams(color="#D4C3A9")) == []     # within tolerance (6.3), but not "very close"
        session.refresh(s)
        assert s.ams_slot is None

    def test_wrong_material_or_colour_is_ignored(self, session):
        p = _printer(session)
        _spool(session)
        assert _run(session, p, _ams(material="PETG")) == []
        assert _run(session, p, _ams(color="#2E9E5B")) == []

    def test_archived_empty_and_already_placed_spools_are_not_candidates(self, session):
        p = _printer(session)
        _spool(session, archived=True)
        _spool(session, weight=0.0)
        _spool(session, ams_slot="Bambu Lab A1:ams1_tray2")
        assert _run(session, p, _ams()) == []

    def test_slot_with_a_spool_is_left_alone(self, session):
        p = _printer(session)
        placed = _spool(session, ams_slot="Bambu Lab A1:ams1_tray1", color="#2E9E5B")   # mismatch = a question
        other = _spool(session)
        assert _run(session, p, _ams()) == []
        session.refresh(placed); session.refresh(other)
        assert placed.ams_slot == "Bambu Lab A1:ams1_tray1" and other.ams_slot is None

    def test_untracked_or_empty_tray_is_skipped(self, session):
        p = _printer(session)
        _spool(session)
        assert _run(session, p, _ams(remain=-1)) == []
        assert _run(session, p, _ams(remain=0)) == []


class TestUndo:
    def test_undo_frees_the_slot_and_is_not_repeated(self, session):
        p, s = _printer(session), _spool(session)
        entry = _run(session, p, _ams())[0]
        ams_autoassign.set_state(session, entry["id"], ams_autoassign.UNDONE)
        session.refresh(s)
        assert s.ams_slot is None
        assert _run(session, p, _ams()) == []                    # same slot + spool + colour: do not ask again
        assert ams_autoassign.get_log(session)[0]["state"] == "undone"

    def test_new_colour_in_the_slot_is_a_new_decision(self, session):
        p, s = _printer(session), _spool(session, color="#C2B29A")
        entry = _run(session, p, _ams())[0]
        ams_autoassign.set_state(session, entry["id"], ams_autoassign.UNDONE)
        s.color_hex = "#C3B39B"; session.commit()
        assert len(_run(session, p, _ams(color="#C3B39B"))) == 1

    def test_dismissed_and_manually_removed_assignment_is_not_repeated(self, session):
        p, s = _printer(session), _spool(session)
        entry = _run(session, p, _ams())[0]
        ams_autoassign.set_state(session, entry["id"], ams_autoassign.SEEN)
        s.ams_slot = None; session.commit()                      # user removes it by hand
        assert _run(session, p, _ams()) == []

    def test_unknown_entry_returns_none(self, session):
        assert ams_autoassign.set_state(session, "nope", ams_autoassign.SEEN) is None
