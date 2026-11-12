"""Request schemas for /api/pk/*. Issue #3586.

Response bodies are plain dicts from app.services.pk.engine /
app.services.pk.matchmaking (same "role-aware shape varies too much to be
worth a parallel Pydantic mirror" reasoning as schemas/live_quiz.py).

CTO review #1 (PRD §17): note what is deliberately ABSENT here —
``PkAnswerRequest`` carries no ``elapsed_ms`` field. The server computes it
from its own clock (engine.submit_match_answer); a client cannot supply a
timing value even if it wanted to.
"""
from __future__ import annotations

from pydantic import BaseModel, Field, field_validator

SCOPE_TYPES = ("lesson", "grade_pool")


class PkQueueJoinRequest(BaseModel):
    scope_type: str
    scope_ref: str
    classroom_id: int | None = None
    invite_code: str | None = None

    @field_validator("scope_type")
    @classmethod
    def _scope_type_allowed(cls, v: str) -> str:
        if v not in SCOPE_TYPES:
            raise ValueError(f"scope_type must be one of {SCOPE_TYPES}")
        return v


class PkInviteCreateRequest(BaseModel):
    scope_type: str
    scope_ref: str
    classroom_id: int

    @field_validator("scope_type")
    @classmethod
    def _scope_type_allowed(cls, v: str) -> str:
        if v not in SCOPE_TYPES:
            raise ValueError(f"scope_type must be one of {SCOPE_TYPES}")
        return v


class PkChallengeAiRequest(BaseModel):
    scope_type: str
    scope_ref: str
    bot_tier: int = Field(ge=1, le=7)
    classroom_id: int | None = None

    @field_validator("scope_type")
    @classmethod
    def _scope_type_allowed(cls, v: str) -> str:
        if v not in SCOPE_TYPES:
            raise ValueError(f"scope_type must be one of {SCOPE_TYPES}")
        return v


class PkAnswerRequest(BaseModel):
    choice_key: str | None = None
