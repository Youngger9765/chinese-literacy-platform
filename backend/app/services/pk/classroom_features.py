"""Typed reader/writer for `classrooms.feature_settings` — PRD §7.4
(2026-10-16 revision, Young: "跟班級有關的都讓老師可以控制" / "default 真人
PK 是 disable"). One JSON column instead of a dedicated boolean column per
feature, so a future class-level toggle never needs another migration.

Despite living under `services/pk/` (its original home, issue #3586), this
module is now the general accessor for EVERY per-classroom feature toggle,
not just 真人 PK — issue #3607 (2026-10-17, Young: "班級的 跨班賽季＋劇情包、
班級內 PK、課堂搶答 都是 default off，要老師啟動才能用") added two more
recognized keys here rather than creating a second, parallel mechanism:

- "pk_human"   (真人 PK — 同學配對對戰／邀請碼, PRD §2)
- "league"     (跨班賽季＋劇情包 — cross-class invitational seasons)
- "live_quiz"  (課堂搶答 — in-class live-paced quiz)

"挑戰文學家" (AI PK) is deliberately NOT a key here — Young 2026-10-16:
"AI PK 跟班級無關", it is always available to any logged-in student
regardless of class or class settings, including a student with no class
at all (see routes/pk.py challenge_ai — no feature check, only the existing
classroom-membership check if a classroom_id happens to be supplied, which
is an authz/attribution concern, not a feature gate).

Backward compatibility (issue #3607): league and live_quiz EXISTED and were
unconditionally available before this toggle — prod already has 3 teachers
using them. A brand-new classroom's `feature_settings` is `{}`, and so is an
OLD classroom's that simply never had this column touched; the two must not
collapse to the same answer. So for league/live_quiz specifically, an ABSENT
key falls back to "has this classroom actually used the feature before" (a
real `LeagueTeam` row, or a real `LiveQuizGame` row, already exists for it)
rather than jumping straight to the static False default. `pk_human` has no
such fallback — it never existed before this toggle, so there is nothing to
preserve. An EXPLICIT value in `feature_settings` (True *or* False) always
wins over the legacy-usage fallback; a teacher who deliberately flips a
class off must be obeyed, not second-guessed by that class's own history.

The fallback only runs when a `db` session is supplied — callers that don't
have one handy (or don't care, e.g. a pure-True/False sanity check) simply
get the static default for an absent key, same as before this revision.
"""
from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

# PRD: "default 真人 PK 是 disable" — a brand-new class (feature_settings
# == {}) must NOT be treated as "everything off" implicitly; each key has
# its own explicit default here so adding a second key later can default
# to `True` without silently flipping every existing class.
FEATURE_DEFAULTS: dict[str, bool] = {
    "pk_human": False,
    "league": False,
    "live_quiz": False,
}


def _classroom_has_league_history(db: Session, classroom_id: int) -> bool:
    """True iff this classroom has ever registered a league team (which
    only ever happens via an accepted invitation — see
    services/league_service.py:_register_team). Imported lazily to avoid
    a module-load-order dependency between services/pk/ and models/league.py
    (neither currently imports the other; keeping the import local here
    keeps it that way even if that ever changes)."""
    from ...models.league import LeagueTeam

    return (
        db.query(LeagueTeam.id).filter(LeagueTeam.classroom_id == classroom_id).first()
        is not None
    )


def _classroom_has_live_quiz_history(db: Session, classroom_id: int) -> bool:
    """True iff this classroom has ever hosted a live-quiz game (any
    status — even an 'ended' one is evidence the class used the feature)."""
    from ...models.live_quiz import LiveQuizGame

    return (
        db.query(LiveQuizGame.id).filter(LiveQuizGame.classroom_id == classroom_id).first()
        is not None
    )


# Only league/live_quiz get a legacy-usage fallback (see module docstring).
# pk_human is deliberately absent from this dict — it never existed before
# the toggle, so there is no history that could ever justify an implicit True.
_LEGACY_USAGE_PROBES = {
    "league": _classroom_has_league_history,
    "live_quiz": _classroom_has_live_quiz_history,
}


def get_classroom_feature(classroom: Any, key: str, db: Session | None = None) -> bool:
    """``classroom``: anything with ``.feature_settings`` and ``.id``
    attributes (the ORM model, or a lightweight stand-in in tests — the
    legacy-usage fallback additionally needs ``.id`` to scope its query,
    but only when it actually runs). Raises KeyError for an unrecognized
    key — callers should only ever pass a key from FEATURE_DEFAULTS, so an
    unknown key is a programming error, not a user-facing 404/422.

    ``db``: optional. Pass it when you want the legacy-usage backward-compat
    rule (see module docstring) to apply for league/live_quiz; omit it (or
    pass None) to get the plain static default for an absent key, same as
    this function always behaved before issue #3607.
    """
    if key not in FEATURE_DEFAULTS:
        raise KeyError(f"Unknown classroom feature key: {key!r}")
    settings = getattr(classroom, "feature_settings", None) or {}
    if key in settings:
        # Explicit value — True or False — always wins over any fallback.
        return bool(settings[key])

    probe = _LEGACY_USAGE_PROBES.get(key)
    if probe is not None and db is not None:
        classroom_id = getattr(classroom, "id", None)
        if classroom_id is not None and probe(db, classroom_id):
            return True

    return FEATURE_DEFAULTS[key]


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
