"""QuizItem — the one shape every question-source adapter must produce.

PRD independence rule #2 (#3551): "要加新題型（例如注音），只新增一支
adapter、在清單登記，不改引擎。adapter 只做「轉換」，不寫任何資料". An
adapter reads one already-loaded lesson dict (from
``app.services.lesson_uid_loader.load_lesson``) and returns zero or more
``QuizItem``s — it never touches the DB and never knows a game exists.
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class QuizOption:
    key: str    # "A".."D" — display key shown on the host projector
    text: str


@dataclass(frozen=True)
class QuizItem:
    source_module: str          # "comprehension" | "vocab_definitions" | "vocab_application" | "zhuyin"
    lesson_uid: str
    lesson_title: str
    stem: str
    options: list = field(default_factory=list)   # list[QuizOption], 2-4 of them
    correct_key: str = ""
    # Provenance for the recomputability requirement (#3551 external review
    # #2): which lesson EDITION this question came from, and its own
    # position within that module's item list — together with
    # source_module/lesson_uid this makes a stable `item_id` so a later
    # audit can trace a round back to the exact source row, independent of
    # the per-game option shuffle applied on top (see round_types/choice.py).
    version_id: str = ""
    source_index: str = ""
    # Round-type-specific extras an adapter needs to carry through to the
    # frozen payload without the engine/round-type having to know about it.
    # UI/UX review 2026-10-15 #10: the zhuyin adapter (once its sibling PR
    # merges) sets {"target_index": N} here — the position of the target
    # character within `stem` — so `stem` itself can stay PLAIN TEXT (never
    # zhuyin-annotated) and the frontend bolds/underlines that one index.
    extra: dict | None = None

    def __post_init__(self) -> None:
        if not (2 <= len(self.options) <= 4):
            raise ValueError(
                f"QuizItem must have 2-4 options, got {len(self.options)} "
                f"({self.source_module}/{self.lesson_uid})"
            )
        if self.correct_key not in {o.key for o in self.options}:
            raise ValueError(
                f"QuizItem.correct_key {self.correct_key!r} is not one of its own "
                f"option keys ({self.source_module}/{self.lesson_uid})"
            )

    @property
    def item_id(self) -> str:
        return f"{self.source_module}:{self.lesson_uid}:{self.version_id}:{self.source_index}"

    def to_payload(self, seconds: int) -> dict:
        """The frozen, host+player-shared part of a round's snapshot payload.

        Callers that care about the per-game option shuffle (external review
        #1a) build the payload via ``round_types.choice._finalize_options``
        instead of calling this directly with the adapter's raw option order.
        """
        payload = {
            "item_id": self.item_id,
            "source_module": self.source_module,
            "lesson_uid": self.lesson_uid,
            "lesson_version_id": self.version_id,
            "lesson_title": self.lesson_title,
            "stem": self.stem,
            "options": [{"key": o.key, "text": o.text} for o in self.options],
            "correct_key": self.correct_key,
            "seconds": seconds,
        }
        if self.extra:
            payload["extra"] = self.extra
        return payload
