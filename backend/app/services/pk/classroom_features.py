"""Typed reader/writer for `classrooms.feature_settings` — PRD §7.4
(2026-10-16 revision, Young: "跟班級有關的都讓老師可以控制" / "default 真人
PK 是 disable"). One JSON column instead of a dedicated boolean column per
feature, so a future class-level toggle never needs another migration.

Only recognized key today: "pk_human" (真人 PK — 同學配對對戰／邀請碼,
PRD §2). "挑戰文學家" (AI PK) is deliberately NOT a key here — Young
2026-10-16: "AI PK 跟班級無關", it is always available to any logged-in
student regardless of class or class settings, including a student with no
class at all (see routes/pk.py challenge_ai — no feature check, only the
existing classroom-membership check if a classroom_id happens to be
supplied, which is an authz/attribution concern, not a feature gate).
"""
from __future__ import annotations

from typing import Any

# PRD: "default 真人 PK 是 disable" — a brand-new class (feature_settings
# == {}) must NOT be treated as "everything off" implicitly; each key has
# its own explicit default here so adding a second key later can default
# to `True` without silently flipping every existing class.
FEATURE_DEFAULTS: dict[str, bool] = {
    "pk_human": False,
}


def get_classroom_feature(classroom: Any, key: str) -> bool:
    """``classroom``: anything with a ``.feature_settings`` attribute (the
    ORM model, or a lightweight stand-in in tests). Raises KeyError for an
    unrecognized key — callers should only ever pass a key from
    FEATURE_DEFAULTS, so an unknown key is a programming error, not a
    user-facing 404/422."""
    if key not in FEATURE_DEFAULTS:
        raise KeyError(f"Unknown classroom feature key: {key!r}")
    settings = getattr(classroom, "feature_settings", None) or {}
    if key not in settings:
        return FEATURE_DEFAULTS[key]
    return bool(settings[key])


def validate_feature_settings_patch(payload: dict) -> dict:
    """Used by the teacher-facing PATCH endpoint. PRD: "Unknown keys
    rejected on write; values boolean only." Returns a cleaned dict safe to
    merge into the stored JSON; raises ValueError on any violation (the
    route converts this to a 422)."""
    cleaned: dict[str, bool] = {}
    for key, value in payload.items():
        if key not in FEATURE_DEFAULTS:
            raise ValueError(f"Unknown classroom feature key: {key!r}")
        if not isinstance(value, bool):
            raise ValueError(f"Classroom feature {key!r} must be a boolean, got {type(value).__name__}")
        cleaned[key] = value
    return cleaned
