from __future__ import annotations

import json
import logging
import os

from .normalization import (
    _cache_key,
    _clean_for_tts,
    _split_sentences,
    strip_classical_markup,
)

logger = logging.getLogger(__name__)

_SENTENCES_V2_PATH = os.path.join(
    os.path.dirname(__file__), "..", "..", "..", "data", "sentences.v2.jsonl"
)

_SENTENCES_V2_CACHE: dict | None = None


def _load_sentences_v2() -> dict:
    global _SENTENCES_V2_CACHE
    if _SENTENCES_V2_CACHE is not None:
        return _SENTENCES_V2_CACHE

    mapping: dict = {}
    path = os.path.normpath(_SENTENCES_V2_PATH)
    try:
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                row = json.loads(line)
                lid = int(row["lesson_id"])
                pidx = int(row["paragraph_idx"])
                text = row["text"]
                h = _cache_key(text)
                mapping.setdefault(lid, {}).setdefault(pidx, []).append(
                    {"text": text, "hash": h, "chars": len(text)}
                )
        logger.info("Loaded sentences.v2.jsonl: %d lessons", len(mapping))
    except FileNotFoundError:
        logger.warning("sentences.v2.jsonl not found at %s — falling back to regex split", path)
    except Exception as exc:
        logger.warning("Failed to load sentences.v2.jsonl: %s — falling back to regex split", exc)

    _SENTENCES_V2_CACHE = mapping
    return mapping


def synthesize_sentence(text: str) -> bytes:
    from . import synthesize_speech

    return synthesize_speech(text)


def build_lesson_tts_mapping(lesson: dict) -> dict:
    lesson_id = lesson.get("id") or lesson.get("lesson_number")
    # 文言文那批的 `paragraphs` 是空的，本文在 `classical_text.paragraphs`。
    # 不接這條的話 mapping 回 0 句 → 預熱腳本從 mapping 列舉 → 這 10 課永遠
    # 不在預熱範圍 → 每次「AI 朗讀」都是冷合成（#2792，症狀同 #2764）。
    paragraphs_raw = lesson.get("paragraphs") or []
    is_classical = False
    if not paragraphs_raw:
        classical = (lesson.get("classical_text") or {}).get("paragraphs") or []
        if classical:
            paragraphs_raw = classical
            is_classical = True

    v2_index = _load_sentences_v2()
    lesson_data = v2_index.get(int(lesson_id)) if lesson_id is not None else None

    mapping_paragraphs = []

    if lesson_data:
        for para_idx, para_sentences in sorted(lesson_data.items()):
            entries = [s for s in para_sentences if s["text"].strip()]
            if entries:
                mapping_paragraphs.append({"index": para_idx, "sentences": entries})
    else:
        logger.debug(
            "build_lesson_tts_mapping: lesson %s not in v2 JSONL, using regex fallback",
            lesson_id,
        )
        for idx, paragraph in enumerate(paragraphs_raw):
            if not paragraph or not str(paragraph).strip():
                continue
            text = str(paragraph)
            if is_classical:
                # 斷詞點與註腳數字是給眼睛看的，會被念出來
                text = strip_classical_markup(text)
            cleaned_paragraph = _clean_for_tts(text)
            if not cleaned_paragraph:
                continue
            sentences = _split_sentences(cleaned_paragraph)
            sentence_entries = []
            for sent in sentences:
                if not sent.strip():
                    continue
                h = _cache_key(sent)
                sentence_entries.append({
                    "text": sent,
                    "hash": h,
                    "chars": len(sent),
                })
            if sentence_entries:
                mapping_paragraphs.append({"index": idx, "sentences": sentence_entries})

    return {
        "lesson_id": lesson_id,
        "paragraphs": mapping_paragraphs,
    }
