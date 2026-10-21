"""Shared "學生N" anonymous display-name fallback — issue #3663 round 3
(#3672 decision: PK gets the same fallback live_quiz/team_arena already
have, and all three share one helper with one index base).

Policy (origin: #3630 security review — a blank `.name` used to fall back
to `user.email`, leaking a student's email to the whole class/room on a
leaderboard or podium): a student with no display name set is shown
"學生{N}" where N is this student's **1-based seat/join/side position
within this specific game/match/room** — never a global id, never
anything that could be cross-referenced to identify them outside it.

All three modes already computed this exact "1-based position" concept,
just under three different names:
  - live_quiz: `len(game.players) + 1` (this join's position, before the
    new player is added to the list)
  - team_arena: `member.rotation_order + 1` (this member's 0-based
    rotation_order, already documented as "1-based rotation position")
  - pk (this round, previously had NO fallback at all — `my_name`/
    `opponent_name` could be `None`): side 'a' is seat 1, side 'b' is
    seat 2 — a fixed, match-stable position, not a join-time counter
    (PK only ever has two sides).

This module does not decide WHAT the index is for a given mode — each
mode still computes its own position the way it always did (join order,
rotation order, or fixed side) — it only provides the one shared
`name or 學生N` decision and the one shared "學生N" string format, so a
bug fix or a future quality change to this exact policy only has to happen
in one place, not three independently-drifting copies.
"""
from __future__ import annotations


def anonymous_display_name(one_based_index: int) -> str:
    return f"學生{one_based_index}"


def resolve_display_name(name: str | None, one_based_index: int) -> str:
    """`name`, stripped, if it's non-empty; otherwise the anonymous
    fallback for this student's 1-based seat/join/side position in this
    game/match/room."""
    stripped = (name or "").strip()
    return stripped or anonymous_display_name(one_based_index)
