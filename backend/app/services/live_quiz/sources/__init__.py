"""Source-adapter registry for the ``choice`` round type.

Every adapter has the same signature —
``generate_items(lesson_uid: str, lesson: dict, rng: random.Random | None) -> list[QuizItem]``
— so the ``choice`` round type (and later any other round type that wants
multiple-choice questions) can call any of them identically. Adding a new
question type is exactly one new module + one new line here (PRD
independence rule #2); nothing else changes.

``zhuyin`` (注音挑戰) is registered conditionally: its question-generation
module (``feat/issue-3551-zhuyin-challenge``, a sibling PR) owns the
polyphonic-character logic, so this adapter is a thin wrapper around its
public ``generate_zhuyin_questions()``. Until that module lands, importing
it fails and the adapter is simply left out of the registry — the setup
screen's question-type picker only offers types present here.
"""
from __future__ import annotations

from . import comprehension, vocab_application, vocab_definitions

SOURCE_ADAPTERS: dict = {
    "comprehension": comprehension.generate_items,
    "vocab_definitions": vocab_definitions.generate_items,
    "vocab_application": vocab_application.generate_items,
}

try:
    from . import zhuyin  # noqa: F401 — side-effect import only

    SOURCE_ADAPTERS["zhuyin"] = zhuyin.generate_items
except ImportError:
    pass

# Human-readable labels for the setup screen (kept here, next to the
# registry, so a new source module updates both at once).
SOURCE_MODULE_LABELS: dict = {
    "comprehension": "閱讀理解",
    "vocab_definitions": "詞語理解",
    "vocab_application": "語詞應用",
    "zhuyin": "注音挑戰",
}
