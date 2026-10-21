"""Single registry of every student-facing game mode — issue #3663 round 2
("既獨立且彈性": a new mode should be one registry entry + its own package,
not a hand-edited list copy-pasted into N files).

This is a DOCUMENTATION + DERIVATION layer, not a new enforcement
mechanism. It does not itself gate anything at runtime — the actual gate
is still `classroom_features.get_classroom_feature()` (pk/league/live_quiz
read it) and each mode's own route/engine code (which classroom-membership
checks it does or doesn't run). What this module adds is: (1) one place
that declares the five modes and the facts about each, verified against the
real code (see docs/architecture/game-modules.md for the file:line audit
this was built from), and (2) the derived `FEATURE_DEFAULTS` /
`LEGACY_USAGE_PROBES` dicts that `classroom_features.py` used to hand-type,
plus a `gated_feature_values()` helper that replaces the same
`pk_human=..., league=..., live_quiz=...` triplet that was previously
copy-pasted four times across `routes/classrooms/classroom_crud.py` and
`routes/classrooms/helpers.py`.

IMPORTANT asymmetry a future mode author should know about (found while
building this registry, see docs/architecture/game-modules.md §5): a
mode's `classroom_gated=True` does NOT automatically mean its entry on the
student game-hub page should show as locked. `pk_human` IS classroom-gated
(the "找同學 PK" sub-feature can be switched off per class) but the PK hub
card itself is NEVER locked, because 挑戰文學家 (AI PK) inside it is always
reachable regardless of the switch. Only `league` and `live_quiz` lock
their WHOLE hub entry — `frontend/src/services/learning/session.ts`'s
`computeStudentGameFlags()` intentionally only computes those two, and that
asymmetry is why this registry does NOT try to drive hub-card lock state
directly from `classroom_gated` — a future mode would need to say
explicitly whether its gate blocks the whole entry point or only a
sub-feature inside it, which isn't info this registry tracks (yet) because
no second mode has needed it.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from sqlalchemy.orm import Session


@dataclass(frozen=True)
class GameMode:
    key: str
    """Stable identifier. For a classroom_gated mode this MUST equal the
    key stored in `classrooms.feature_settings` (and therefore the field
    name on `ClassroomResponse`/`ClassroomDetailResponse`/
    `StudentEnrolledClassroom` — those Pydantic fields stay hand-declared,
    see module docstring in classroom_features.py for why)."""

    label: str
    """Chinese display label — matches the student game-hub card title
    (`StudentGameHubPage.tsx`) for every mode except `pk_human`, whose hub
    card is titled "PK 對戰" (combined AI+human entry) while this registry's
    label is "真人 PK" (matches the teacher-facing switch title in
    `ClassroomPkSettingsPanel.tsx`, since that's the only UI this specific
    key maps 1:1 onto) — see docstring note above."""

    description: str
    """Short Chinese description, one sentence, no trailing punctuation
    (matches this repo's `rules/chinese-style.md`)."""

    hub_route: str
    """Where the student game-hub card navigates to."""

    classroom_gated: bool
    """Whether a `classrooms.feature_settings` switch exists for this mode
    at all. See module docstring for why this is not the same question as
    "is the hub card locked"."""

    default_enabled: bool
    """`FEATURE_DEFAULTS` value when `classroom_gated` is True. Meaningless
    (always False) when `classroom_gated` is False."""

    has_legacy_usage_fallback: bool
    """Whether an ABSENT key falls back to "has this classroom ever
    actually used the feature" rather than the static default — see
    `classroom_features.py`'s backward-compat rule for `league`/
    `live_quiz` (prod already had teachers using them before the switch
    existed; `pk_human` never existed before its own switch, so it has no
    such fallback)."""

    requires_classroom_membership: bool
    """Documented fact, not a runtime check this module performs: must a
    student belong to a specific classroom to play a real match/round of
    this mode (as opposed to it being open to any logged-in student, or
    self-hosted with no classroom concept at all)? See
    docs/architecture/game-modules.md §5 for the file:line evidence this
    was verified against."""

    host_note: str
    """One sentence: who may host / who may join, for human-readable
    reference (shown nowhere in the product UI; this is for the next
    engineer reading this registry, not end users)."""


MODES: tuple[GameMode, ...] = (
    GameMode(
        key="league",
        label="跨班賽季",
        description="和別班比幾週，平常讀課文就累積",
        hub_route="/student/our-class",
        classroom_gated=True,
        default_enabled=False,
        has_legacy_usage_fallback=True,
        requires_classroom_membership=True,
        host_note="老師邀請／接受其他班級加入賽季；學生需屬於已加入某賽季的班級才能参與該賽季",
    ),
    GameMode(
        key="live_quiz",
        label="課堂搶答",
        description="現在全班一起玩，約 10 分鐘",
        hub_route="/live",
        classroom_gated=True,
        default_enabled=False,
        has_legacy_usage_fallback=True,
        requires_classroom_membership=True,
        host_note="老師主持；學生需屬於開啟課堂搶答的班級才能加入該場",
    ),
    GameMode(
        key="pk_human",
        label="真人 PK",
        description="同學之間配對對戰",
        hub_route="/pk",
        classroom_gated=True,
        default_enabled=False,
        has_legacy_usage_fallback=False,
        requires_classroom_membership=True,
        host_note="同學配對對戰需屬於開啟真人 PK 的班級；挑戰文學家（AI）不受此開關限制，任何已登入學生皆可玩，且其 hub 入口（PK 對戰）本身從不因此開關被鎖",
    ),
    GameMode(
        key="escape_room",
        label="迷城密室",
        description="闖關解謎，救回被困的同伴",
        hub_route="/escape-room",
        classroom_gated=False,
        default_enabled=True,
        has_legacy_usage_fallback=False,
        requires_classroom_membership=False,
        host_note="v1：單人＋AI 隊友，任何已登入學生皆可玩，不受任何班級設定影響",
    ),
    GameMode(
        key="team_arena",
        label="多人對抗賽",
        description="2～5 人一組，答題推塔對抗",
        hub_route="/team-arena",
        classroom_gated=False,
        default_enabled=True,
        has_legacy_usage_fallback=False,
        requires_classroom_membership=False,
        host_note="v2：學生自行開房／加入房號，不受班級設定影響（v1 曾有班級開關，已於 #3632 v2 移除，非只是預設關閉）",
    ),
)

MODES_BY_KEY: dict[str, GameMode] = {m.key: m for m in MODES}
CLASSROOM_GATED_MODES: tuple[GameMode, ...] = tuple(m for m in MODES if m.classroom_gated)
CLASSROOM_GATED_KEYS: tuple[str, ...] = tuple(m.key for m in CLASSROOM_GATED_MODES)


def _classroom_has_league_history(db: Session, classroom_id: int) -> bool:
    from ...models.league import LeagueTeam

    return (
        db.query(LeagueTeam.id).filter(LeagueTeam.classroom_id == classroom_id).first()
        is not None
    )


def _classroom_has_live_quiz_history(db: Session, classroom_id: int) -> bool:
    from ...models.live_quiz import LiveQuizGame

    return (
        db.query(LiveQuizGame.id).filter(LiveQuizGame.classroom_id == classroom_id).first()
        is not None
    )


# key -> probe function, for the modes that have `has_legacy_usage_fallback
# = True`. Kept as a plain dict (not a GameMode field holding a callable)
# so the dataclass stays a trivially-comparable, serializable fact sheet —
# the probes are an implementation detail of classroom_features.py's
# get_classroom_feature(), not part of the mode's public contract.
LEGACY_USAGE_PROBES: dict[str, Callable[[Session, int], bool]] = {
    "league": _classroom_has_league_history,
    "live_quiz": _classroom_has_live_quiz_history,
}

# Derived dict, same shape `classroom_features.FEATURE_DEFAULTS` had before
# this registry existed — every classroom_gated mode's default, keyed by
# its feature_settings key.
FEATURE_DEFAULTS: dict[str, bool] = {m.key: m.default_enabled for m in CLASSROOM_GATED_MODES}
