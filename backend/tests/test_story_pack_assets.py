"""Regression lock for the codex-generated SVG art bundled under
backend/app/assets/league_themes/. Two things must always hold:
  1. Every bundled .svg file independently passes the SAME allow-list
     sanitizer the admin-upsert endpoint runs on a human/LLM-pasted theme
     (codex's raw output is not special-cased or trusted more than that).
  2. The two shipped themes actually reference this bundled art (not
     accidentally left on the old emoji placeholders).
"""
from __future__ import annotations

from pathlib import Path

import pytest

from app.schemas.story_pack import sanitize_svg
from app.services.story_pack_defaults import SONG_PACK, TANG_PACK

_ASSETS_DIR = Path(__file__).resolve().parent.parent / "app" / "assets" / "league_themes"
_SVG_FILES = sorted(_ASSETS_DIR.glob("*.svg"))


def test_bundled_svg_files_exist():
    names = {p.name for p in _SVG_FILES}
    assert names == {
        "tang-background.svg",
        "song-background.svg",
        "tang-chest.svg",
        "song-chest.svg",
    }


@pytest.mark.parametrize("path", _SVG_FILES, ids=lambda p: p.name)
def test_each_bundled_svg_passes_the_real_sanitizer(path: Path):
    raw = path.read_text(encoding="utf-8").strip()
    sanitize_svg(raw)  # raises SvgValidationError on failure


def test_tang_theme_uses_bundled_background_and_chest_art():
    assert TANG_PACK.background_art is not None
    assert TANG_PACK.background_art.kind == "svg"
    assert TANG_PACK.chest.art.kind == "svg"
    assert "<svg" in TANG_PACK.background_art.value
    assert "<svg" in TANG_PACK.chest.art.value


def test_song_theme_uses_bundled_background_and_chest_art():
    assert SONG_PACK.background_art is not None
    assert SONG_PACK.background_art.kind == "svg"
    assert SONG_PACK.chest.art.kind == "svg"


def test_tang_and_song_background_art_differ():
    assert TANG_PACK.background_art.value != SONG_PACK.background_art.value


def test_prompts_json_documents_every_asset():
    import json

    prompts = json.loads((_ASSETS_DIR / "_prompts.json").read_text(encoding="utf-8"))
    documented = set(prompts["assets"].keys())
    actual = {p.name for p in _SVG_FILES}
    assert documented == actual
