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
