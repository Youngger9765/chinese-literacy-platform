"""Single registry of every student-facing game mode — issue #3663 round 2
("既獨立且彈性": a new mode should be one registry entry + its own package,
not a hand-edited list copy-pasted into N files). Round 3 extends this to
the TEACHER side (ClassroomPkSettingsPanel.tsx's switches panel,
TeacherGameHubPage.tsx's management-page nav) — the goal stated then is now
literal: adding a mode is one registry entry + its own package, for
students AND teachers.

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

Round-2-to-round-3 correction worth flagging: `label`/`description` here
now consistently mean the STUDENT hub card's text for every mode (they
used to diverge from the frontend mirror `gameModes.ts` specifically for
`pk_human` — this file said "真人 PK" / "同學之間配對對戰" while the
frontend mirror already said "PK 對戰" / "一對一，隨時挑戰同學或文學家" —
nothing in the backend actually read this field's value anywhere, so
fixing the drift here was a no-op for runtime behavior). The teacher
SWITCH's own distinct copy ("真人 PK") now lives in `teacher_switch_title`
below, where it belongs conceptually.
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
    (`StudentGameHubPage.tsx`) for every mode. The teacher-facing switch's
    OWN title (which differs from this for `pk_human`: "真人 PK" vs this
    field's "PK 對戰") is `teacher_switch_title` below, not this field."""

    description: str
    """Short Chinese description, one sentence, no trailing punctuation
    (matches this repo's `rules/chinese-style.md`) — matches the student
    hub card's subtitle, same scope note as `label` above."""

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

    # ------------------------------------------------------------------
    # Teacher side (issue #3663 round 3) — None for a mode with no
    # teacher-facing switch / no teacher management page. The two groups
    # (switch fields, hub fields) are independent: pk_human has switch
    # fields but no hub fields (no `/teacher/pk` management page exists);
    # escape_room/team_arena have neither (no teacher involvement at all
    # today). Enforced "all-or-none within a group" by
    # _assert_teacher_fields_consistent() below, not just documented.
    # ------------------------------------------------------------------

    teacher_switch_order: int | None = None
    """This mode's position in `ClassroomPkSettingsPanel.tsx`'s switches
    list — NOT the same as this tuple's own declaration order (the panel's
    on-screen order is 真人PK, 跨班賽季, 課堂搶答; this registry orders
    league/live_quiz first because those two are what the STUDENT hub
    cares about locking — see module docstring). Must be unique among
    modes that have one."""

    teacher_switch_title: str | None = None
    """The switch panel's own title for this mode — may differ from
    `label` (see `pk_human`)."""

    teacher_switch_description: str | None = None
    """The switch panel's own description — typically ends with "，預設
    關閉" (switch-specific copy explaining what toggling it does), unlike
    the student hub card's `description` which explains what the ACTIVITY
    is."""

    teacher_switch_aria_label: str | None = None

    teacher_hub_route: str | None = None
    """Where `TeacherGameHubPage.tsx`'s management-page nav button for
    this mode goes — distinct from the student `hub_route` (e.g. league:
    student goes to `/student/our-class`, teacher goes to
    `/teacher/league`). `None` if this mode has no teacher management
    page at all (pk_human/escape_room/team_arena today)."""

    teacher_hub_label: str | None = None
    teacher_hub_description: str | None = None
    teacher_hub_emoji: str | None = None


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
        teacher_switch_order=1,
        teacher_switch_title="跨班賽季",
        teacher_switch_description="跟其他班一起比幾週，附故事劇情包，預設關閉",
        teacher_switch_aria_label="跨班賽季開關",
        teacher_hub_route="/teacher/league",
        teacher_hub_label="跨班賽季",
        teacher_hub_description="查看排行榜、建立邀請",
        teacher_hub_emoji="🏆",
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
        teacher_switch_order=2,
        teacher_switch_title="課堂搶答",
        teacher_switch_description="現在全班一起即時搶答，約 10 分鐘，預設關閉",
        teacher_switch_aria_label="課堂搶答開關",
        teacher_hub_route="/teacher/live",
        teacher_hub_label="課堂搶答",
        teacher_hub_description="主持即時搶答",
        teacher_hub_emoji="🎮",
    ),
    GameMode(
        key="pk_human",
        label="PK 對戰",
        description="一對一，隨時挑戰同學或文學家",
        hub_route="/pk",
        classroom_gated=True,
        default_enabled=False,
        has_legacy_usage_fallback=False,
        requires_classroom_membership=True,
        host_note="同學配對對戰需屬於開啟真人 PK 的班級；挑戰文學家（AI）不受此開關限制，任何已登入學生皆可玩，且其 hub 入口（PK 對戰）本身從不因此開關被鎖",
        teacher_switch_order=0,
        teacher_switch_title="真人 PK",
        teacher_switch_description="同學之間配對對戰，預設關閉",
        teacher_switch_aria_label="真人 PK 開關",
        # No teacher_hub_* — there is no `/teacher/pk` management page;
        # ClassroomPkSettingsPanel's switch is the only teacher-facing
        # surface this mode has.
    ),
    GameMode(
        key="escape_room",
        label="迷城密室",
        description="闖關解謎，救回被困的同伴",
        hub_route="/escape-room",
        classroom_gated=False,
        # Meaningless field for a non-gated mode (see `GameMode.default_enabled`
        # docstring) — held at its one valid value (False) and enforced by
        # _assert_default_enabled_only_meaningful_when_gated() below, not
        # just documented, so a future entry can't silently set this True
        # and have it look like a real "defaults on" claim.
        default_enabled=False,
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
        default_enabled=False,  # see escape_room's comment above
        has_legacy_usage_fallback=False,
        requires_classroom_membership=False,
        host_note="v2：學生自行開房／加入房號，不受班級設定影響（v1 曾有班級開關，已於 #3632 v2 移除，非只是預設關閉）",
    ),
)


def _assert_default_enabled_only_meaningful_when_gated(modes: tuple["GameMode", ...]) -> None:
    """Makes the `default_enabled` docstring's claim ("meaningless — always
    False — when classroom_gated is False") an enforced invariant instead
    of just a comment a future entry could silently violate. Raises
    ValueError naming every offending mode (not just the first) so a
    multi-mode mistake isn't fixed one error at a time."""
    offenders = [m.key for m in modes if not m.classroom_gated and m.default_enabled]
    if offenders:
        raise ValueError(
            "GameMode.default_enabled must be False when classroom_gated is "
            f"False (it has no meaning otherwise): {offenders!r}"
        )


def _assert_teacher_fields_consistent(modes: tuple["GameMode", ...]) -> None:
    """Two invariants, both enforced (not just documented) because a half-
    specified entry here would silently crash or misrender the Python/TS
    consumers rather than failing loudly at import time:

    1. The four `teacher_switch_*` fields are all-set or all-None together
       (a mode either has a switch or it doesn't — there's no valid
       "has a title but no aria-label" state).
    2. Same for the four `teacher_hub_*` fields.
    3. `teacher_switch_order` is unique among modes that have one (a
       duplicate would make the panel's render order ambiguous/arbitrary).
    """
    switch_group_errors = []
    hub_group_errors = []
    for m in modes:
        switch_fields = (m.teacher_switch_order, m.teacher_switch_title,
                          m.teacher_switch_description, m.teacher_switch_aria_label)
        if any(f is not None for f in switch_fields) and any(f is None for f in switch_fields):
            switch_group_errors.append(m.key)
        hub_fields = (m.teacher_hub_route, m.teacher_hub_label,
                      m.teacher_hub_description, m.teacher_hub_emoji)
        if any(f is not None for f in hub_fields) and any(f is None for f in hub_fields):
            hub_group_errors.append(m.key)
    if switch_group_errors:
        raise ValueError(
            f"GameMode teacher_switch_* fields must be all-set or all-None: {switch_group_errors!r}"
        )
    if hub_group_errors:
        raise ValueError(
            f"GameMode teacher_hub_* fields must be all-set or all-None: {hub_group_errors!r}"
        )

    orders = [m.teacher_switch_order for m in modes if m.teacher_switch_order is not None]
    duplicates = sorted({o for o in orders if orders.count(o) > 1})
    if duplicates:
        raise ValueError(f"GameMode.teacher_switch_order has duplicate values: {duplicates!r}")


_assert_default_enabled_only_meaningful_when_gated(MODES)
_assert_teacher_fields_consistent(MODES)

MODES_BY_KEY: dict[str, GameMode] = {m.key: m for m in MODES}
CLASSROOM_GATED_MODES: tuple[GameMode, ...] = tuple(m for m in MODES if m.classroom_gated)
CLASSROOM_GATED_KEYS: tuple[str, ...] = tuple(m.key for m in CLASSROOM_GATED_MODES)

# Teacher-facing switch list, in the panel's own on-screen order — the
# single source `ClassroomPkSettingsPanel.tsx`'s SWITCHES array is derived
# from (via the mirrored frontend/src/data/gameModes.ts).
TEACHER_SWITCH_MODES: tuple[GameMode, ...] = tuple(
    sorted((m for m in MODES if m.teacher_switch_order is not None), key=lambda m: m.teacher_switch_order)
)

# Teacher game-hub management-page nav buttons, in MODES' own declaration
# order (league then live_quiz today — matches the page's existing
# left-to-right button order; no separate ordering field needed since
# nothing has required one to differ from declaration order yet).
TEACHER_HUB_MODES: tuple[GameMode, ...] = tuple(m for m in MODES if m.teacher_hub_route is not None)


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
