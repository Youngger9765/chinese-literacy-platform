"""Tests for `app.services.game_core.modes` — the mode registry added by
issue #3663 round 2. Two invariants a security review flagged as "should
be executable, not just documented":

1. `default_enabled` is meaningless for a non-classroom-gated mode (it is
   never read into `FEATURE_DEFAULTS`, which only iterates
   `CLASSROOM_GATED_MODES`) — a future entry setting it True anyway would
   be a landmine for whoever next reads `.default_enabled` directly
   without checking `.classroom_gated` first. Enforced by
   `_assert_default_enabled_only_meaningful_when_gated()`, run at import
   time against the real `MODES`.
2. Every CURRENT classroom-gated mode's default is False (PRD #3586/#3607:
   "要老師啟動才能用" — a brand-new/legacy class must never come up with a
   gated feature silently on). This is a snapshot of today's product
   decision, not a law of nature — if a future mode legitimately needs to
   default True, this test is EXPECTED to need updating in the same PR
   that makes that call, with the reasoning written right here.
"""
from __future__ import annotations

import pytest

from app.services.game_core import modes


def test_real_registry_passes_the_invariant_at_import_time():
    """The module already ran this at import — re-running it here against
    the real MODES is a direct, named regression lock (vs. only ever
    observing it indirectly via "the import didn't raise")."""
    modes._assert_default_enabled_only_meaningful_when_gated(modes.MODES)


def test_invariant_rejects_a_non_gated_mode_with_default_enabled_true():
    """Mutation check: prove the guard has teeth by handing it a
    deliberately-violating mode, not just a non-violating one."""
    violator = modes.GameMode(
        key="fake_mode",
        label="假模式",
        description="",
        hub_route="/fake",
        classroom_gated=False,
        default_enabled=True,
        has_legacy_usage_fallback=False,
        requires_classroom_membership=False,
        host_note="",
    )
    with pytest.raises(ValueError, match="fake_mode"):
        modes._assert_default_enabled_only_meaningful_when_gated((violator,))


def test_invariant_names_every_offender_not_just_the_first():
    violator_a = modes.GameMode(
        key="fake_a", label="", description="", hub_route="/a",
        classroom_gated=False, default_enabled=True,
        has_legacy_usage_fallback=False, requires_classroom_membership=False, host_note="",
    )
    violator_b = modes.GameMode(
        key="fake_b", label="", description="", hub_route="/b",
        classroom_gated=False, default_enabled=True,
        has_legacy_usage_fallback=False, requires_classroom_membership=False, host_note="",
    )
    with pytest.raises(ValueError) as exc:
        modes._assert_default_enabled_only_meaningful_when_gated((violator_a, violator_b))
    assert "fake_a" in str(exc.value)
    assert "fake_b" in str(exc.value)


def test_invariant_allows_a_gated_mode_with_default_enabled_true():
    """The invariant is specifically about NON-gated modes — a
    classroom_gated mode is free to default True (no mode does today, see
    test below, but the invariant itself must not forbid it)."""
    ok = modes.GameMode(
        key="fake_gated", label="", description="", hub_route="/x",
        classroom_gated=True, default_enabled=True,
        has_legacy_usage_fallback=False, requires_classroom_membership=True, host_note="",
    )
    modes._assert_default_enabled_only_meaningful_when_gated((ok,))


def test_escape_room_and_team_arena_default_enabled_is_false():
    """Not just "the invariant doesn't raise" — pin the actual current
    values too, so a drive-by edit that flips one to True without
    understanding why gets caught here even before the invariant would
    otherwise just silently accept it (classroom_gated=False,
    default_enabled=False both stay compliant)."""
    assert modes.MODES_BY_KEY["escape_room"].default_enabled is False
    assert modes.MODES_BY_KEY["team_arena"].default_enabled is False


def test_every_classroom_gated_mode_defaults_to_false_today():
    """PRD #3586/#3607: "要老師啟動才能用" — every switch that exists today
    defaults OFF. If this ever needs to change, change it here WITH a
    reason, not as a side effect of an unrelated edit."""
    assert modes.FEATURE_DEFAULTS == {"pk_human": False, "league": False, "live_quiz": False}
    assert all(default is False for default in modes.FEATURE_DEFAULTS.values())


# ---------------------------------------------------------------------------
# Teacher side (issue #3663 round 3) — ClassroomPkSettingsPanel.tsx's switch
# order and TeacherGameHubPage.tsx's nav buttons now derive from these
# fields. Pinned here exactly as today's UI renders them.
# ---------------------------------------------------------------------------

def test_teacher_switch_order_matches_the_panels_on_screen_order_today():
    """ClassroomPkSettingsPanel.tsx's SWITCHES array order, pre-registry,
    was 真人PK / 跨班賽季 / 課堂搶答 — pinned here by key, not by assuming
    MODES' own declaration order (which is league/live_quiz/pk_human, a
    DIFFERENT order, on purpose — see module docstring)."""
    ordered_keys = [m.key for m in modes.TEACHER_SWITCH_MODES]
    assert ordered_keys == ["pk_human", "league", "live_quiz"]


def test_teacher_switch_text_matches_todays_panel_exactly():
    by_key = modes.MODES_BY_KEY
    assert by_key["pk_human"].teacher_switch_title == "真人 PK"
    assert by_key["pk_human"].teacher_switch_description == "同學之間配對對戰，預設關閉"
    assert by_key["pk_human"].teacher_switch_aria_label == "真人 PK 開關"
    assert by_key["league"].teacher_switch_title == "跨班賽季"
    assert by_key["league"].teacher_switch_description == "跟其他班一起比幾週，附故事劇情包，預設關閉"
    assert by_key["league"].teacher_switch_aria_label == "跨班賽季開關"
    assert by_key["live_quiz"].teacher_switch_title == "課堂搶答"
    assert by_key["live_quiz"].teacher_switch_description == "現在全班一起即時搶答，約 10 分鐘，預設關閉"
    assert by_key["live_quiz"].teacher_switch_aria_label == "課堂搶答開關"


def test_only_league_and_live_quiz_have_a_teacher_hub_entry():
    """TeacherGameHubPage.tsx has exactly two management-page nav
    buttons today — pk_human/escape_room/team_arena have none."""
    hub_keys = [m.key for m in modes.TEACHER_HUB_MODES]
    assert hub_keys == ["league", "live_quiz"]


def test_teacher_hub_text_matches_todays_page_exactly():
    by_key = modes.MODES_BY_KEY
    assert by_key["league"].teacher_hub_route == "/teacher/league"
    assert by_key["league"].teacher_hub_label == "跨班賽季"
    assert by_key["league"].teacher_hub_description == "查看排行榜、建立邀請"
    assert by_key["league"].teacher_hub_emoji == "🏆"
    assert by_key["live_quiz"].teacher_hub_route == "/teacher/live"
    assert by_key["live_quiz"].teacher_hub_label == "課堂搶答"
    assert by_key["live_quiz"].teacher_hub_description == "主持即時搶答"
    assert by_key["live_quiz"].teacher_hub_emoji == "🎮"


def test_pk_human_and_non_gated_modes_have_no_teacher_hub_entry():
    for key in ("pk_human", "escape_room", "team_arena"):
        m = modes.MODES_BY_KEY[key]
        assert m.teacher_hub_route is None
        assert m.teacher_hub_label is None
        assert m.teacher_hub_description is None
        assert m.teacher_hub_emoji is None


def test_escape_room_and_team_arena_have_no_teacher_switch_either():
    for key in ("escape_room", "team_arena"):
        m = modes.MODES_BY_KEY[key]
        assert m.teacher_switch_order is None
        assert m.teacher_switch_title is None
        assert m.teacher_switch_description is None
        assert m.teacher_switch_aria_label is None


class TestTeacherFieldsConsistencyInvariant:
    """Mutation checks for `_assert_teacher_fields_consistent` — same
    "prove the guard has teeth" discipline as the default_enabled
    invariant tests above."""

    def _mode(self, **overrides):
        base = dict(
            key="fake", label="", description="", hub_route="/x",
            classroom_gated=False, default_enabled=False,
            has_legacy_usage_fallback=False, requires_classroom_membership=False, host_note="",
        )
        base.update(overrides)
        return modes.GameMode(**base)

    def test_real_registry_passes(self):
        modes._assert_teacher_fields_consistent(modes.MODES)

    def test_rejects_half_specified_switch_fields(self):
        violator = self._mode(teacher_switch_order=0, teacher_switch_title="X")
        # title+order set but description/aria_label left None -> half-specified
        with pytest.raises(ValueError, match="fake"):
            modes._assert_teacher_fields_consistent((violator,))

    def test_rejects_half_specified_hub_fields(self):
        violator = self._mode(teacher_hub_route="/teacher/x")
        with pytest.raises(ValueError, match="fake"):
            modes._assert_teacher_fields_consistent((violator,))

    def test_rejects_duplicate_switch_order(self):
        a = self._mode(
            key="fake_a", teacher_switch_order=0, teacher_switch_title="A",
            teacher_switch_description="a", teacher_switch_aria_label="a",
        )
        b = self._mode(
            key="fake_b", teacher_switch_order=0, teacher_switch_title="B",
            teacher_switch_description="b", teacher_switch_aria_label="b",
        )
        with pytest.raises(ValueError, match=r"\[0\]"):
            modes._assert_teacher_fields_consistent((a, b))

    def test_allows_fully_specified_switch_and_hub_fields(self):
        ok = self._mode(
            teacher_switch_order=0, teacher_switch_title="X",
            teacher_switch_description="d", teacher_switch_aria_label="a",
            teacher_hub_route="/teacher/x", teacher_hub_label="X",
            teacher_hub_description="d", teacher_hub_emoji="🎮",
        )
        modes._assert_teacher_fields_consistent((ok,))
