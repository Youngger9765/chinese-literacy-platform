"""#3477 — eight G8 covers were the wrong lesson's picture because the registry's
first-edition code↔title pairs are shifted in that block. They are pinned by hand in
scripts/reuse_lesson_thumbnails.py; this keeps the pin and the committed covers in step,
so a rerun of the script cannot quietly put the wrong images back."""
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LESSONS = ROOT / "backend" / "data" / "lessons"


def _manual_covers() -> dict[str, str]:
    spec = importlib.util.spec_from_file_location("reuse_thumbs", ROOT / "scripts" / "reuse_lesson_thumbnails.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.MANUAL_COVERS


def test_the_eight_g8_lessons_are_pinned():
    assert set(_manual_covers()) == {"L0108", "L0109", "L0117", "L0126", "L0128", "L0129", "L0147", "L0148"}


def test_committed_covers_match_the_pin():
    for uid, code in _manual_covers().items():
        src = json.loads((LESSONS / uid / "v3" / "assets" / "thumbnail.source.json").read_text(encoding="utf-8"))
        assert src["first_edition_code"] == code, uid
        assert src["matched_on"] == "manual", uid
        assert (LESSONS / uid / "v3" / "assets" / "thumbnail.webp").read_bytes()[:4] == b"RIFF", uid


def test_no_two_pinned_lessons_share_a_cover():
    codes = list(_manual_covers().values())
    assert len(codes) == len(set(codes))
