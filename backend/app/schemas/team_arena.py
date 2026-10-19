"""Request schemas for /api/team-arena/*. Issue #3632,
docs/prd/2026-10-18-team-arena-prd.md.

Same precedent as schemas/pk.py: response bodies are plain dicts from
app.services.team_arena.engine (role-aware shapes vary too much to be
worth a parallel Pydantic mirror). And the same CTO-review-driven absence:
``TeamArenaAnswerRequest`` carries no ``elapsed_ms`` — the server computes
it from its own clock (engine.submit_answer), a client cannot supply a
timing value even if it wanted to (PRD §7 "計時" row).
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, field_validator

from ..services.team_arena.teams import LANES

SCOPE_TYPES = ("lesson", "grade_pool")
TURNS_PER_PLAYER_CHOICES = (1, 2, 3)
# PRD §3.5: "作答...20／30／45 秒（老師可選）".
ANSWER_SECONDS_CHOICES = (20, 30, 45)


class TeamArenaSessionCreateRequest(BaseModel):
    classroom_id: int
    scope_type: str
    scope_ref: str
    turns_per_player: int = 2
    answer_seconds: int = 30
    reading_speed: Literal["slow", "standard", "fast"] = "standard"
    story_pack_key: str | None = None

    @field_validator("scope_type")
    @classmethod
    def _scope_type_allowed(cls, v: str) -> str:
        if v not in SCOPE_TYPES:
            raise ValueError(f"scope_type must be one of {SCOPE_TYPES}")
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


class TeamArenaTeamsAutoRequest(BaseModel):
    action: Literal["auto"]


class TeamArenaTeamsSwapRequest(BaseModel):
    action: Literal["swap"]
    student_a_id: int
    student_b_id: int


class TeamArenaTeamsOverrideRequest(BaseModel):
    action: Literal["override"]
    student_id: int
    grade_pool_override: bool


# PRD §6 老師投影頁 step 2 bundles three distinct teacher actions under one
# "分隊" screen (自動分隊／拖曳互換／個別降一級); §10 lists exactly one API
# row for all three ("POST .../teams") rather than three routes, so this
# discriminated union is the request shape for that single row.
TeamArenaTeamsRequest = (
    TeamArenaTeamsAutoRequest | TeamArenaTeamsSwapRequest | TeamArenaTeamsOverrideRequest
)


class TeamArenaLaneRequest(BaseModel):
    lane: str

    @field_validator("lane")
    @classmethod
    def _lane_allowed(cls, v: str) -> str:
        if v not in LANES:
            raise ValueError(f"lane must be one of {LANES}")
        return v


class TeamArenaControlRequest(BaseModel):
    action: Literal["start", "pause", "resume", "next", "end"]


class TeamArenaAnswerRequest(BaseModel):
    choice_key: str | None = None
