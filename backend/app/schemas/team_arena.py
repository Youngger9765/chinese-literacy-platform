"""Request schemas for /api/team-arena/* — v2, docs/prd/2026-10-18-team-
arena-prd.md §0 "⭐ v2 改版".

Same precedent as schemas/pk.py: response bodies are plain dicts from
app.services.team_arena.engine (role-aware shapes vary too much to be
worth a parallel Pydantic mirror). And the same CTO-review-driven absence
v1 already established: no request here ever carries a client-supplied
`elapsed_ms` — the server computes it from its own clock
(engine.submit_answer).
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, field_validator

from ..services.team_arena.teams import SIDE_KEYS, TEAM_SIZE_CHOICES
from ..services.team_arena.weapons import WEAPON_KEYS

TURNS_PER_PLAYER_CHOICES = (1, 2, 3)
# PRD §3.5 (unchanged by v2): "作答...20／30／45 秒".
ANSWER_SECONDS_CHOICES = (20, 30, 45)


class TeamArenaSessionCreateRequest(BaseModel):
    """PRD §0 v2 rule A/C: any student opens a room — no classroom_id, no
    scope_type/scope_ref (the host's OWN grade pool is resolved server-
    side, rule K)."""

    team_size: int = 5
    turns_per_player: int = 2
    answer_seconds: int = 30
    story_pack_key: str | None = None
    # Which side the host themself sits on — every student (including the
    # host) picks a side (rule C: "學生加入時自己選隊"); the host is simply
    # the one student who also gets to configure + start the room.
    side: Literal["a", "b"] = "a"

    @field_validator("team_size")
    @classmethod
    def _team_size_allowed(cls, v: int) -> int:
        if v not in TEAM_SIZE_CHOICES:
            raise ValueError(f"team_size must be one of {TEAM_SIZE_CHOICES}")
        return v

    @field_validator("turns_per_player")
    @classmethod
    def _turns_per_player_allowed(cls, v: int) -> int:
        if v not in TURNS_PER_PLAYER_CHOICES:
            raise ValueError(f"turns_per_player must be one of {TURNS_PER_PLAYER_CHOICES}")
        return v

    @field_validator("answer_seconds")
    @classmethod
    def _answer_seconds_allowed(cls, v: int) -> int:
        if v not in ANSWER_SECONDS_CHOICES:
            raise ValueError(f"answer_seconds must be one of {ANSWER_SECONDS_CHOICES}")
        return v


class TeamArenaJoinRequest(BaseModel):
    """PRD §0 v2 rule C: "加入時自己選隊"."""

    side: Literal["a", "b"]

    @field_validator("side")
    @classmethod
    def _side_allowed(cls, v: str) -> str:
        if v not in SIDE_KEYS:
            raise ValueError(f"side must be one of {SIDE_KEYS}")
        return v


class TeamArenaControlRequest(BaseModel):
    action: Literal["start", "pause", "resume", "next", "end"]


class TeamArenaAnswerRequest(BaseModel):
    choice_key: str | None = None


class TeamArenaWeaponRequest(BaseModel):
    """PRD §0 v2 rule F — one of the three fixed weapons. No free-text
    field anywhere on this request (or any other team-arena request) —
    PRD rule H: "只能點選項，不能打字"."""

    weapon: str

    @field_validator("weapon")
    @classmethod
    def _weapon_allowed(cls, v: str) -> str:
        if v not in WEAPON_KEYS:
            raise ValueError(f"weapon must be one of {WEAPON_KEYS}")
        return v


class TeamArenaSuggestRequest(BaseModel):
    """A non-active teammate's 呼叫隊友 suggestion — a single option KEY
    (e.g. "A"), never free text (PRD rule H: "只能點選項，不能打字")."""

    choice_key: str
