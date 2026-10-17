"""#3615 drift lock: the frontend's story-pack sweep tests render every
builtin pack from a JSON fixture (the frontend has no other copy of the
pack content — it always arrives over the API). This test keeps that
fixture byte-for-byte equal to BUILTIN_PACKS, so a pack edited here can't
leave the frontend sweep testing stale wording.

Regenerate after editing a builtin pack:
    UPDATE_STORY_PACK_FIXTURE=1 pytest tests/test_story_pack_frontend_fixture.py
"""
from __future__ import annotations

import json
import os
from pathlib import Path

from app.services.story_pack_defaults import BUILTIN_PACKS

FIXTURE = (
    Path(__file__).resolve().parents[2]
    / "frontend" / "src" / "components" / "league" / "__tests__" / "fixtures" / "builtinStoryPacks.json"
)


def _expected() -> list[dict]:
    return [p.model_dump(mode="json") for p in BUILTIN_PACKS.values()]


def test_frontend_fixture_matches_builtin_packs():
    expected = _expected()
    if os.environ.get("UPDATE_STORY_PACK_FIXTURE") == "1":
        FIXTURE.parent.mkdir(parents=True, exist_ok=True)
        FIXTURE.write_text(json.dumps(expected, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    assert FIXTURE.exists(), f"missing {FIXTURE} — run with UPDATE_STORY_PACK_FIXTURE=1"
    actual = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert actual == expected, "frontend story-pack fixture is stale — run with UPDATE_STORY_PACK_FIXTURE=1"


def test_fixture_covers_all_five_builtin_packs():
    # Positive control for the frontend sweep: it can only be as wide as
    # this fixture.
    keys = [p["key"] for p in _expected()]
    assert keys == ["myth", "tang-dynasty", "song-dynasty", "wuxia", "detective"]
