"""Source-adapter registry for the ``choice`` round type.

Every adapter has the same signature —
``generate_items(lesson_uid: str, lesson: dict, rng: random.Random | None) -> list[QuizItem]``
— so the ``choice`` round type (and later any other round type that wants
multiple-choice questions) can call any of them identically. Adding a new
question type is exactly one new module + one new line here (PRD
independence rule #2); nothing else changes.

``zhuyin`` (注音挑戰) is a thin wrapper around the independent
``app.services.zhuyin_challenge`` module (its own PR, #3551, merged into
staging — owns the polyphonic-character/heteronym logic entirely; this
adapter only reshapes its output into QuizItem). It is REQUIRED — one of
the four selectable question types — not optional; the ``try/except``
below is defensive (so a local checkout mid-rebase doesn't hard-crash the
whole registry import), not a feature flag.
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
