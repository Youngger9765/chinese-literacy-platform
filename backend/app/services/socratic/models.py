import time
from dataclasses import dataclass, field


@dataclass
class SessionState:
    session_id: str
    story_title: str
    story_text: str
    conversation: list[dict] = field(default_factory=list)  # {role, text}
    understood_count: int = 0
    total_attempts: int = 0
    current_phase: str = "factual"  # factual -> inferential -> evaluative
    created_at: float = field(default_factory=time.time)
    consecutive_errors: int = 0
    # Optional reading results from LiveTutor (Issue #17)
    mispronounced_words: list[str] | None = None
    accuracy: float | None = None
    cpm: float | None = None
    # Teacher special instructions for individualized learning (Issue #90)
    teacher_instructions: list[str] | None = None
    # Genre-aware Socratic (#615)
    genre: str | None = None
    reading_strategy: str | None = None
