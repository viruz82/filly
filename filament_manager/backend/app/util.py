"""Small shared helpers."""
from datetime import datetime, timezone


def utcnow() -> datetime:
    """Naive-UTC now — the storage convention for all DateTime columns.

    Replaces the deprecated datetime.utcnow() (removed in Python 3.13+).
    """
    return datetime.now(timezone.utc).replace(tzinfo=None)


# ── Colour look (1.18.0) ─────────────────────────────────────────────────────

COLOR_MODES = ("solid", "gradient", "multicolor", "special")
COLOR_EFFECTS = ("glitter", "glow", "thermo", "marble")
COLOR_MODE_PATTERN = r"^(solid|gradient|multicolor|special)$"
COLOR_EFFECT_PATTERN = r"^(glitter|glow|thermo|marble)$"


def clean_color_mode(mode, color2_hex=None) -> str:
    """Valid mode as given; otherwise derive it (second colour → multicolor)."""
    if mode in COLOR_MODES:
        return mode
    return "multicolor" if color2_hex else "solid"


def clean_color_effect(mode, effect):
    """An effect only belongs to the "special" mode; anything else is dropped."""
    return effect if mode == "special" and effect in COLOR_EFFECTS else None


def normalize_color_look(obj) -> None:
    """Apply clean_color_mode/clean_color_effect to a Spool or FilamentCatalog row."""
    obj.color_mode = clean_color_mode(getattr(obj, "color_mode", None), getattr(obj, "color2_hex", None))
    obj.color_effect = clean_color_effect(obj.color_mode, getattr(obj, "color_effect", None))
