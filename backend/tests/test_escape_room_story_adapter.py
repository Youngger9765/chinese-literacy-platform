import pytest

from app.schemas.story_pack import BannedTermError, _forbid_banned_terms
from app.services.escape_room import story_adapter
from app.services.escape_room.story_adapter import resolve_story_for_run


def test_story_adapter_uses_pack_or_safe_fallback():
    present = resolve_story_for_run("myth")
    assert present["intro"]
    assert "三位夥伴" in present["intro"]
    assert "較量" not in present["intro"]
    assert "background_art" in present
    assert present["skin_art"]
    fallback = resolve_story_for_run("missing-pack")
    assert fallback["dialogue"]["mist"]
    assert resolve_story_for_run(None)["dialogue"] == fallback["dialogue"]


def test_story_adapter_falls_back_when_pack_lookup_raises(monkeypatch):
    class BrokenPacks(dict):
        def get(self, *_args, **_kwargs):
            raise TimeoutError("story store timeout")

    monkeypatch.setattr(story_adapter, "BUILTIN_PACKS", BrokenPacks())
    assert resolve_story_for_run("myth")["dialogue"]["escape"] == "團隊逃出了迷城！"


def test_story_pack_existing_banned_term_validator_still_rejects_copy():
    with pytest.raises(BannedTermError):
        # _forbid_banned_terms no longer accepts field_name after #3619.
        _forbid_banned_terms("中國")
