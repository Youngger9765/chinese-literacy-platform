"""多人對抗賽 v2：組隊大小與座位 — PRD §0 v2 改版 C,
docs/prd/2026-10-18-team-arena-prd.md.

v2 replaces v1's whole "一鍵分隊／四條路線自動分配／支援位" module (v1
`teams.py`, never shipped past staging — that logic assumed a TEACHER
auto-splitting a whole class into several matches). There is no auto-
split, no lane, and no "系統補位" left: a student host picks ONE
`team_size`, and every subsequent join is a student PICKING their own
side — the engine (slice 2) does that seat-counting directly against
`TeamArenaMember` rows, so this module is now just the shared constants +
the one validation rule both `schemas/team_arena.py` and the engine need
to agree on.
"""
from __future__ import annotations

# PRD v2 rule C: "每隊 2～5 人，開房的人選人數".
TEAM_SIZE_CHOICES: tuple[int, ...] = (2, 3, 4, 5)

SIDE_KEYS: tuple[str, ...] = ("a", "b")
SIDE_TO_COLUMN: dict[str, int] = {"a": 0, "b": 1}
COLUMN_TO_SIDE: dict[int, str] = {0: "a", 1: "b"}


def is_valid_team_size(team_size: int) -> bool:
    return team_size in TEAM_SIZE_CHOICES
