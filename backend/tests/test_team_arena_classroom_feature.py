"""TDD for the `team_arena` classroom feature-flag key — PRD §9.2:
"在 services/pk/classroom_features.py 的 FEATURE_DEFAULTS 加 team_arena:
False...需要照既有流程讓老師在『班級功能設定』打開才看得到入口".

`team_arena` is brand new (like `pk_human`, not like `league`/`live_quiz`)
— there is no legacy usage to preserve, so an absent key must resolve to
the static `False` default even when a `db` session is supplied, never a
history-based fallback.
"""
from __future__ import annotations

from app.services.pk import classroom_features as svc


class _FakeClassroom:
    def __init__(self, feature_settings, id=1):
        self.feature_settings = feature_settings
        self.id = id


class TestTeamArenaFeatureFlag:
    def test_registered_with_default_false(self):
        assert svc.FEATURE_DEFAULTS["team_arena"] is False

    def test_empty_settings_defaults_to_false(self):
        c = _FakeClassroom({})
        assert svc.get_classroom_feature(c, "team_arena") is False

    def test_explicit_true_overrides_default(self):
        c = _FakeClassroom({"team_arena": True})
        assert svc.get_classroom_feature(c, "team_arena") is True

    def test_explicit_false_is_respected(self):
        c = _FakeClassroom({"team_arena": False})
        assert svc.get_classroom_feature(c, "team_arena") is False

    def test_has_no_legacy_usage_fallback_like_pk_human(self):
        """Unlike league/live_quiz, team_arena never existed before this
        toggle — passing a db session must not grant it an implicit True
        via history. We don't have a real TeamArenaSession row to probe
        from a pure unit test; the contract is simply that `team_arena` is
        absent from `_LEGACY_USAGE_PROBES`."""
        assert "team_arena" not in svc._LEGACY_USAGE_PROBES

    def test_patch_accepts_team_arena_key(self):
        cleaned = svc.validate_feature_settings_patch({"team_arena": True})
        assert cleaned == {"team_arena": True}

    def test_patch_rejects_non_boolean_team_arena_value(self):
        import pytest

        with pytest.raises(ValueError):
            svc.validate_feature_settings_patch({"team_arena": "yes"})
