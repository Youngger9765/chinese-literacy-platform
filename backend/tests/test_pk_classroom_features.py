"""TDD for app.services.pk.classroom_features — PRD §7.4 (2026-10-16 revision:
one JSON `classrooms.feature_settings` column instead of a dedicated boolean
column). Only recognized key today: "pk_human", default False.
"""
from __future__ import annotations

import pytest

from app.services.pk import classroom_features as svc


class _FakeClassroom:
    def __init__(self, feature_settings):
        self.feature_settings = feature_settings


class TestGetClassroomFeature:
    def test_empty_dict_gets_the_default_for_pk_human(self):
        c = _FakeClassroom({})
        assert svc.get_classroom_feature(c, "pk_human") is False

    def test_none_feature_settings_gets_the_default(self):
        """Defense in depth: a row written before the column had a value
        (shouldn't happen given NOT NULL + server_default, but the reader
        must not crash if it ever does)."""
        c = _FakeClassroom(None)
        assert svc.get_classroom_feature(c, "pk_human") is False

    def test_explicit_true_overrides_the_default(self):
        c = _FakeClassroom({"pk_human": True})
        assert svc.get_classroom_feature(c, "pk_human") is True

    def test_explicit_false_is_respected(self):
        c = _FakeClassroom({"pk_human": False})
        assert svc.get_classroom_feature(c, "pk_human") is False

    def test_unknown_key_raises(self):
        c = _FakeClassroom({})
        with pytest.raises(KeyError):
            svc.get_classroom_feature(c, "not_a_real_key")


class TestValidateFeatureSettingsPatch:
    def test_accepts_known_boolean_key(self):
        cleaned = svc.validate_feature_settings_patch({"pk_human": True})
        assert cleaned == {"pk_human": True}

    def test_rejects_unknown_key(self):
        with pytest.raises(Exception):
            svc.validate_feature_settings_patch({"made_up_feature": True})

    def test_rejects_non_boolean_value(self):
        with pytest.raises(Exception):
            svc.validate_feature_settings_patch({"pk_human": "yes"})

    def test_empty_patch_is_valid_noop(self):
        assert svc.validate_feature_settings_patch({}) == {}
