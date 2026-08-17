#!/usr/bin/env python3
"""reading_audio_units.py — 執行期實際會請求哪些合成單位 (#2605, #2606).

WHY THIS FILE EXISTS SEPARATELY
-------------------------------
Three attempts at pre-generating 朗讀 audio have now missed, all the same way: each one
generated the unit it seemed obvious to generate instead of the unit the playback path
actually asks for.

  · #1208 — the front end split paragraphs with its own regex, so the sha256 it requested
    was never the sha256 that had been generated. 303 of 2871 matched.
  · #2605 — the cache key gained the pronunciation-table fingerprint and the corpus was
    never regenerated. 0 of 7236 matched.
  · 2026-08-17 — this author generated one clip per SENTENCE for every track, having read
    the sentence table and not the player. `ttsApi.ts` sends a whole PARAGRAPH whenever it
    has lesson context. 53 of 1657 matched.

So the unit is derived here, once, from the call sites, and both the report and the
generator import it. Getting it wrong stays possible; getting it *inconsistently* wrong
between counting and generating does not.

WHAT THE KEY IS COMPUTED ON
---------------------------
`backend/app/services/tts/__init__.py`:

    key = _cache_key(text)          # ← the client's text, verbatim
    ...
    cleaned = _clean_for_tts(text)  # ← only afterwards, for the synthesiser

The key is the sha256 of **what the browser sent**, before any server-side cleaning. So
the unit is whatever string `ttsApi.ts` puts in the request body — which is why the
front end's cleaner has to be mirrored here rather than the backend's.

THE TWO FAMILIES
----------------
A. **paragraph units** — `speakText(text, lessonId, paragraphIdx)`.
   `ttsApi.ts::_speakViaBackend` fetches `/api/tts/mapping/{lessonId}` and sends
   `canonical.join('').trim()` — one request per paragraph, deliberately: splitting costs
   prosody (the pitch contour resets at every sentence) for no measurable latency gain.
   Call sites: `ParagraphReading.tsx:191`, `useFullTextTtsQueue.ts:126` (+ its prefetch),
   `Intro.tsx:220`.

B. **sentence units** — `speakText(text)` with no lesson context.
   Falls to `_splitSentences(_cleanForTts(text))` in the BROWSER, one request per
   sentence. Call sites: `useKeyPassageReadingTtsQueue.ts:55` (重點朗讀 — the step
   students actually use), `LessonAudioTable.tsx:559` (admin 試聽), `Intro.tsx:222`.

Both families are derived from `body.yml` only. The key passage is required to be one of
`body.yml`'s paragraphs (#2720 check 3, and #2718's test asserted it before that), so
family B over every body paragraph covers every passage — the one deployed today and the
one any later re-extraction picks. Nothing here depends on which `key_reading.yml` is
live, which is what lets the audio be generated and tested before that merges.

THE FRONT END'S CLEANER IS NOT THE BACKEND'S
--------------------------------------------
They are line-for-line identical except that the backend strips one more class:

    re.sub(r'[\\uf410\\U000E01E0-\\U000E01E4]+', '', text)   # backend only

A private-use character and four variation selectors that Word embeds inside words. For
family B the browser's string is what gets hashed, so mirroring the backend there would
produce a key nothing requests. That single line is the whole reason this module has its
own cleaner instead of importing one.

Sentence length is measured in UTF-16 code units, because `MAX_SENTENCE_LEN` is compared
against JavaScript's `String.length`. For BMP text that equals the code-point count; for
the variation selectors above it does not, and a paragraph near the 40-character boundary
would split differently.
"""

from __future__ import annotations

import glob
import os
import re
import sys
import unicodedata
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from app.services.tts.normalization import (  # noqa: E402
    _cache_key, _clean_for_tts, _split_sentences,
)

LESSONS = ROOT / "backend" / "data" / "lessons"

#: `ttsApi.ts`'s MAX_SENTENCE_LEN. Its comment says "must match backend
#: MAX_SENTENCE_LEN"; asserted below rather than trusted.
FRONTEND_MAX_SENTENCE_LEN = 40


def _js_len(s: str) -> int:
    """`String.length` — UTF-16 code units, not code points."""
    return len(s.encode("utf-16-le")) // 2


def clean_for_tts_frontend(text: str) -> str:
    """`ttsApi.ts::_cleanForTts`, transcribed.

    Deliberately NOT the backend's: the backend strips one extra character class, and
    family B hashes the browser's string. See the module docstring.
    """
    text = re.sub(r"[~～]+", "", text)
    text = re.sub(r"[──—–−]+", "，", text)
    text = re.sub(r"-{2,}", "，", text)
    text = re.sub(r"[.]{3,}|[…⋯]+", "，", text)
    text = re.sub(r"#", "", text)
    text = re.sub(r"(\d+)/(\d+)", r"\1 之 \2", text)
    text = re.sub(r"[/\\|]+", "", text)
    text = re.sub(r"[\*\[\]\{\}]+", "", text)
    text = re.sub(r"[·‧・°○]+", "", text)
    text = re.sub(r"%", "百分之", text)
    text = re.sub(r"，{2,}", "，", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def split_sentences_frontend(text: str) -> list[str]:
    """`ttsApi.ts::_splitSentences`, transcribed, measuring in UTF-16 units."""
    parts = [s.strip() for s in re.split(r"(?<=[。！？\n])", text) if s.strip()]
    result: list[str] = []
    for s in parts:
        if _js_len(s) <= FRONTEND_MAX_SENTENCE_LEN:
            result.append(s)
            continue
        chunk = ""
        for part in re.split(r"(?<=[，、；：」）])", s):
            if _js_len(chunk) + _js_len(part) > FRONTEND_MAX_SENTENCE_LEN and chunk:
                result.append(chunk)
                chunk = part
            else:
                chunk += part
        if chunk:
            result.append(chunk)
    return result


def _latest_version(uid_dir: Path) -> Path | None:
    versions = sorted(
        (c for c in uid_dir.iterdir() if c.is_dir() and c.name.startswith("v")),
        key=lambda c: c.name,
    ) if uid_dir.is_dir() else []
    return versions[-1] if versions else None


def lesson_bodies() -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for uid_dir in sorted(LESSONS.glob("L*")):
        vdir = _latest_version(uid_dir)
        if vdir is None:
            continue
        f = vdir / "body.yml"
        if not f.exists():
            continue
        paras = (yaml.safe_load(f.read_text(encoding="utf-8")) or {}).get("paragraphs") or []
        paras = [str(p) for p in paras if p and str(p).strip()]
        if paras:
            out[uid_dir.name] = paras
    return out


def paragraph_unit(paragraph: str) -> str | None:
    """Family A: what `_speakViaBackend` sends when it has lesson context.

    `/api/tts/mapping/{lessonId}` is `build_lesson_tts_mapping`, i.e. the backend's
    `_clean_for_tts` then `_split_sentences`; the browser joins those with '' and trims.
    """
    cleaned = _clean_for_tts(paragraph)
    if not cleaned:
        return None
    sentences = [s for s in _split_sentences(cleaned) if s.strip()]
    if not sentences:
        return None
    unit = "".join(sentences).strip()
    return unit or None


def sentence_units(paragraph: str) -> list[str]:
    """Family B: what the browser sends with no lesson context, one per sentence."""
    cleaned = clean_for_tts_frontend(paragraph)
    if not cleaned:
        return []
    return [s for s in split_sentences_frontend(cleaned) if s.strip()]


def all_units() -> dict[str, dict]:
    """{sha256: {"text", "family", "lessons"}} — every unit the runtime can request."""
    units: dict[str, dict] = {}

    def add(text: str, family: str, uid: str) -> None:
        key = _cache_key(text)
        entry = units.setdefault(key, {"text": text, "family": set(), "lessons": set()})
        entry["family"].add(family)
        entry["lessons"].add(uid)

    for uid, paras in lesson_bodies().items():
        for p in paras:
            unit = paragraph_unit(p)
            if unit:
                add(unit, "paragraph", uid)
            for s in sentence_units(p):
                add(s, "sentence", uid)
    return units


def _self_check() -> None:
    """The transcriptions above are claims about another language's code.

    Cheap to state, and a silent divergence here regenerates a corpus nobody requests.
    """
    from app.services.tts.normalization import MAX_SENTENCE_LEN

    assert MAX_SENTENCE_LEN == FRONTEND_MAX_SENTENCE_LEN, (
        f"ttsApi.ts says its MAX_SENTENCE_LEN must match the backend's, but they are "
        f"{FRONTEND_MAX_SENTENCE_LEN} and {MAX_SENTENCE_LEN}"
    )
    # The two cleaners may differ ONLY by the private-use / variation-selector strip.
    probe = "測試—句子…子/母 100% 的　空白"
    assert clean_for_tts_frontend(probe) == _clean_for_tts(probe), (
        "前後端 cleaner 在不含變體選擇符的文字上就已經分岔了 —— "
        "family B 的 key 會全部對不上，先對齊再生成"
    )


_self_check()


if __name__ == "__main__":
    units = all_units()
    fams: dict[str, int] = {}
    for u in units.values():
        for f in u["family"]:
            fams[f] = fams.get(f, 0) + 1
    print(f"執行期會請求的 unique 單位: {len(units)}")
    for f, n in sorted(fams.items()):
        print(f"  {f}: {n}")
