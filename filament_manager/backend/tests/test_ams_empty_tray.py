"""An emptied AMS tray must lose its old material/colour in the cache."""
import pytest

from app import bambu_cloud_client as bcc

SERIAL = "TESTSERIAL"


@pytest.fixture(autouse=True)
def _clean_cache():
    bcc._ams_cache.pop(SERIAL, None)
    yield
    bcc._ams_cache.pop(SERIAL, None)


def _msg(trays, bits=None):
    unit = {"id": "0", "tray": trays}
    if bits is not None:
        unit["tray_exist_bits"] = bits
    return {"ams": [unit]}


FULL = {"id": "3", "remain": -1, "tray_type": "PLA", "tray_color": "000000FF", "tray_sub_brands": "SUNLU PLA+"}


def test_only_id_means_empty_and_clears_profile():
    bcc._parse_ams_into_cache(SERIAL, _msg([FULL]))
    assert bcc._ams_cache[SERIAL]["ams1_tray4"]["material"] == "SUNLU PLA+"
    bcc._parse_ams_into_cache(SERIAL, _msg([{"id": "3"}]))
    slot = bcc._ams_cache[SERIAL]["ams1_tray4"]
    assert slot == {"empty": True}
    assert not slot.get("material") and not slot.get("color")


def test_exist_bits_zero_means_empty():
    bcc._parse_ams_into_cache(SERIAL, _msg([FULL]))
    bcc._parse_ams_into_cache(SERIAL, _msg([{"id": "3", "remain": -1}], bits="7"))
    assert bcc._ams_cache[SERIAL]["ams1_tray4"] == {"empty": True}


def test_exist_bit_set_keeps_slot_and_incremental_remain_keeps_profile():
    bcc._parse_ams_into_cache(SERIAL, _msg([FULL], bits="f"))
    bcc._parse_ams_into_cache(SERIAL, _msg([{"id": "3", "remain": 55}], bits="f"))
    slot = bcc._ams_cache[SERIAL]["ams1_tray4"]
    assert slot["material"] == "SUNLU PLA+" and slot["color"] == "#000000" and slot["remain"] == 55
    assert "empty" not in slot


def test_profile_wins_over_stale_bits():
    bcc._parse_ams_into_cache(SERIAL, _msg([FULL], bits="7"))
    assert bcc._ams_cache[SERIAL]["ams1_tray4"]["material"] == "SUNLU PLA+"


def test_refilled_slot_is_no_longer_empty():
    bcc._parse_ams_into_cache(SERIAL, _msg([{"id": "3"}]))
    bcc._parse_ams_into_cache(SERIAL, _msg([FULL]))
    slot = bcc._ams_cache[SERIAL]["ams1_tray4"]
    assert "empty" not in slot and slot["material"] == "SUNLU PLA+"
