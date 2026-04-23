"""Sentence loader — reads semantic-split sentences from sentences.v2.jsonl (#661).

Replaces frontend punctuation-based `splitIntoSentences()` with Opus 4.7's
semantic boundaries. The JSONL is aligned 1:1 with TTS mp3 cache keys so the
sentence the student sees in the retry UI matches exactly what TTS plays.

The file is loaded once at import time into an in-memory index.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import TypedDict

logger = logging.getLogger(__name__)


class Sentence(TypedDict):
    paragraph_idx: int
    sentence_idx: int
    text: str


# Absolute path resolved from this file's location so it works under Cloud Run
# (where the working directory differs from dev).
_DATA_PATH = Path(__file__).resolve().parent.parent.parent / "data" / "sentences.v2.jsonl"

# Indexed by lesson_id. Each lesson's list is sorted by (paragraph_idx, sentence_idx).
_BY_LESSON: dict[int, list[Sentence]] = {}


def _load() -> None:
    """Read the JSONL file once and build the in-memory index."""
    if not _DATA_PATH.exists():
        logger.warning("sentences.v2.jsonl not found at %s", _DATA_PATH)
        return

    with _DATA_PATH.open("r", encoding="utf-8") as f:
        for line_num, line in enumerate(f, start=1):
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
                lesson_id = int(obj["lesson_id"])
                sent: Sentence = {
                    "paragraph_idx": int(obj["paragraph_idx"]),
                    "sentence_idx": int(obj["sentence_idx"]),
                    "text": str(obj["text"]),
                }
            except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
                logger.warning("sentences.v2.jsonl line %d invalid: %s", line_num, exc)
                continue
            _BY_LESSON.setdefault(lesson_id, []).append(sent)

    # Sort each lesson's sentences so callers can rely on order.
    for sentences in _BY_LESSON.values():
        sentences.sort(key=lambda s: (s["paragraph_idx"], s["sentence_idx"]))

    total = sum(len(v) for v in _BY_LESSON.values())
    logger.info(
        "sentence_loader: loaded %d sentences across %d lessons from %s",
        total, len(_BY_LESSON), _DATA_PATH.name,
    )


_load()


def get_sentences(lesson_id: int) -> list[Sentence]:
    """Return all semantic sentences for a lesson, ordered by paragraph then sentence.

    Returns an empty list when the lesson has no v2 JSONL entry (frontend then
    falls back to regex-based `splitIntoSentences()`).
    """
    return list(_BY_LESSON.get(lesson_id, []))
