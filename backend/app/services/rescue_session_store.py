"""
rescue_session_store.py — In-memory session store for MCQ Rescue dialogues.

Extracted from mcq_rescue_agent.py (Issue #1887).
Mirrors SessionStore from socratic_agent.py.

Key: mcq_rescue_{user_id}_{question_id}
TTL: 30 minutes
Rate limit: 30 requests / 60 seconds per session
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field


# ---------------------------------------------------------------------------
# Session State dataclass
# ---------------------------------------------------------------------------

@dataclass
class RescueSessionState:
    session_id: str
    user_id: int
    question_id: str
    lesson_id: str
    wrong_choice: str
    question_text: str
    correct_answer: str
    strategy_type: str | None
    # SOP state
    current_step: int = 1          # 1-5
    conversation: list[dict] = field(default_factory=list)   # {role, text}
    consecutive_errors: int = 0
    give_up_count: int = 0         # consecutive "不知道" / "我不會"
    created_at: float = field(default_factory=time.time)
    is_terminated: bool = False


# ---------------------------------------------------------------------------
# Session Store
# ---------------------------------------------------------------------------

class RescueSessionStore:
    """In-memory session store for MCQ rescue dialogues.

    Mirrors SessionStore from socratic_agent.py.
    Key: mcq_rescue_{user_id}_{question_id}
    TTL: 30 minutes (same as Socratic agent)
    Rate limit: 30 requests / 60 seconds per session
    """

    TTL_SECONDS = 30 * 60
    RATE_LIMIT = 30
    RATE_WINDOW = 60

    def __init__(self) -> None:
        self._sessions: dict[str, RescueSessionState] = {}
        self._rate_counts: dict[str, list[float]] = {}

    @staticmethod
    def make_key(user_id: int, question_id: str) -> str:
        return f"mcq_rescue_{user_id}_{question_id}"

    def get(self, session_id: str) -> RescueSessionState | None:
        self._cleanup()
        return self._sessions.get(session_id)

    def save(self, state: RescueSessionState) -> None:
        self._sessions[state.session_id] = state

    def delete(self, session_id: str) -> None:
        self._sessions.pop(session_id, None)

    def check_rate_limit(self, session_id: str) -> bool:
        """Return True if rate limit exceeded."""
        now = time.time()
        timestamps = self._rate_counts.get(session_id, [])
        timestamps = [t for t in timestamps if now - t < self.RATE_WINDOW]
        if len(timestamps) >= self.RATE_LIMIT:
            return True
        timestamps.append(now)
        self._rate_counts[session_id] = timestamps
        return False

    def _cleanup(self) -> None:
        now = time.time()
        expired = [
            sid for sid, s in self._sessions.items()
            if now - s.created_at > self.TTL_SECONDS
        ]
        for sid in expired:
            del self._sessions[sid]
