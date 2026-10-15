"""Request schemas for /api/live-quiz/*. Issue #3551.

Response bodies are returned as plain dicts from
``app.services.live_quiz.engine`` (role-aware state/results shapes vary too
much per-poll to be worth a second, parallel Pydantic mirror — see
``engine.build_state`` / ``engine.get_game_results`` docstrings for the
authoritative shape). Only writes are schema-validated here.
"""
from __future__ import annotations

from pydantic import BaseModel, Field, field_validator

ALLOWED_SECONDS = (20, 30, 45, 60)
ALLOWED_QUESTION_COUNT_MODES = ("all", 10, 15, 20)
MAX_READING_SECONDS = 30


class LiveQuizCreateRequest(BaseModel):
    lesson_uids: list[str] = Field(min_length=1)
    source_modules: list[str] | None = None
    round_type: str = "choice"
    # UI/UX review §12: "設定頁預設只露...題數（預設 10）、秒數（預設 30）".
    question_count_mode: str | int = 10
    seconds: int = 30
    # UI/UX review 2026-10-15 #2: stem-alone reading phase before the answer
    # window opens. 0 is explicitly allowed (disables the delay).
    reading_seconds: int = 4
    classroom_id: int | None = None
    shuffle: bool = False
    show_leaderboard_after_each: bool = True
    # #11: paused pending Young's ranking-policy decision — kept wired and
    # defaulting OFF (already were), but not getting further work right now.
    double_points_last: bool = False
    streak_bonus: bool = False
    practice_mode: bool = False

    @field_validator("seconds")
    @classmethod
    def _seconds_allowed(cls, v: int) -> int:
        if v not in ALLOWED_SECONDS:
            raise ValueError(f"seconds must be one of {ALLOWED_SECONDS}")
        return v

    @field_validator("reading_seconds")
    @classmethod
    def _reading_seconds_bounded(cls, v: int) -> int:
        if not (0 <= v <= MAX_READING_SECONDS):
            raise ValueError(f"reading_seconds must be 0-{MAX_READING_SECONDS}")
        return v

    @field_validator("question_count_mode")
    @classmethod
    def _count_mode_allowed(cls, v):
        if v not in ALLOWED_QUESTION_COUNT_MODES and str(v) not in {
            str(m) for m in ALLOWED_QUESTION_COUNT_MODES
        }:
            raise ValueError(f"question_count_mode must be one of {ALLOWED_QUESTION_COUNT_MODES}")
        return v


class LiveQuizAnswerRequest(BaseModel):
    submission: dict = Field(default_factory=dict)


class HostControlRequest(BaseModel):
    """Body for start/reveal/next/end. UI/UX review #4: host takeover on a
    second device is an explicit action, not automatic — ``device_id`` is a
    client-generated id (NOT the user id; the same teacher logged in on two
    tabs is exactly the case this exists for), ``confirm_takeover`` must be
    true to proceed once a DIFFERENT device is already recognised as host.
    """
    device_id: str | None = None
    confirm_takeover: bool = False
