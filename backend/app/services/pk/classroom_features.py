"""Typed reader/writer for `classrooms.feature_settings` — PRD §7.4
(2026-10-16 revision, Young: "跟班級有關的都讓老師可以控制" / "default 真人
PK 是 disable"). One JSON column instead of a dedicated boolean column per
feature, so a future class-level toggle never needs another migration.

Despite living under `services/pk/` (its original home, issue #3586), this
module is now the general accessor for EVERY per-classroom feature toggle,
not just 真人 PK — issue #3607 (2026-10-17, Young: "班級的 跨班賽季＋劇情包、
班級內 PK、課堂搶答 都是 default off，要老師啟動才能用") added two more
recognized keys here rather than creating a second, parallel mechanism.

2026-10-21 (issue #3663 round 2): the recognized-key list, each key's
default, and the legacy-usage-fallback probes moved to
`services/game_core/modes.py` — that module is now the single declaration
point ("new mode = one registry entry"), this module just imports it under
its original names so every existing caller (and every test that imports
`FEATURE_DEFAULTS` or calls `get_classroom_feature`/
`validate_feature_settings_patch`) keeps working unchanged. See that
module's docstring for the full list of recognized keys and why
team_arena/escape_room/AI-PK are deliberately absent from it.

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

from ..game_core.modes import CLASSROOM_GATED_KEYS, FEATURE_DEFAULTS, LEGACY_USAGE_PROBES

# Re-exported under its original private name — `_LEGACY_USAGE_PROBES` has
# never been imported by anything outside this file (confirmed by grep
# before this refactor), kept as an alias purely so a reader who remembers
# the old name finds it immediately.
_LEGACY_USAGE_PROBES = LEGACY_USAGE_PROBES


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


def gated_feature_values(classroom: Any, db: Session) -> dict[str, bool]:
    """``{key: get_classroom_feature(classroom, key, db=db) for key in
    CLASSROOM_GATED_KEYS}`` — replaces the ``pk_human=...``/``league=...``/
    ``live_quiz=...`` triplet that used to be copy-pasted four times across
    ``routes/classrooms/classroom_crud.py`` and
    ``routes/classrooms/helpers.py`` (issue #3663 round 2). Spread this
    into a ``ClassroomResponse``/``ClassroomDetailResponse``/
    ``StudentEnrolledClassroom`` constructor call via ``**`` — those
    Pydantic models still declare `pk_human`/`league`/`live_quiz` as their
    own static fields (see docs/architecture/game-modules.md's note on why
    that's intentionally not auto-generated), this only removes the
    duplicated *values* side, not the schema declarations.
    """
    return {key: get_classroom_feature(classroom, key, db=db) for key in CLASSROOM_GATED_KEYS}


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
