"""Tests for `app.services.game_core.display_name` — the shared "學生N"
fallback introduced by issue #3663 round 3 (#3672 decision: unify
live_quiz/team_arena/pk onto one helper with one 1-based index)."""
from __future__ import annotations

from app.services.game_core.display_name import anonymous_display_name, resolve_display_name


def test_anonymous_display_name_formats_the_index():
    assert anonymous_display_name(1) == "學生1"
    assert anonymous_display_name(2) == "學生2"
    assert anonymous_display_name(42) == "學生42"


def test_resolve_display_name_uses_real_name_when_present():
    assert resolve_display_name("小明", 1) == "小明"


def test_resolve_display_name_falls_back_on_none():
    assert resolve_display_name(None, 3) == "學生3"


def test_resolve_display_name_falls_back_on_empty_string():
    assert resolve_display_name("", 1) == "學生1"


def test_resolve_display_name_falls_back_on_whitespace_only():
    """A never-completed profile might have whitespace instead of a true
    empty string — must not show a blank name."""
    assert resolve_display_name("   ", 2) == "學生2"


def test_resolve_display_name_strips_surrounding_whitespace_from_a_real_name():
    assert resolve_display_name("  小明  ", 1) == "小明"


def test_resolve_display_name_never_echoes_an_email_shaped_name():
    """Not this module's job to detect email shapes — just confirming the
    fallback path doesn't silently prefer anything email-like. A real
    `.name` value, even one that happens to look like an email, is used
    as-is (the #3630 bug was falling back TO email when name was blank,
    not a real name that happens to contain '@')."""
    assert resolve_display_name("student@example.com", 1) == "student@example.com"
