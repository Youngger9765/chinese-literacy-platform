"""多人對抗賽 v2：三種武器的純函式邏輯 — PRD §0 v2 改版 F/G/H/I/J,
docs/prd/2026-10-18-team-arena-prd.md.

Pure functions only (no DB) — the engine (slice 2) owns persistence (per-
member usage quotas, the round cache); this module only owns "given this
round's data, what does using this weapon actually change."

Three weapons, each usable at most once per player per game (enforced by
the engine against `TeamArenaMember.question_queue["weapons_used"]`, not
here — this module has no concept of "already used"):

  call_teammate — no per-item logic here at all; it only flips a round-
    cache flag the engine reads (「呼叫隊友」顯示同一題給隊友). Nothing in
    THIS module changes because of it.
  eliminate     — `apply_eliminate` below.
  hint          — `build_hint` below.
"""
from __future__ import annotations

import random

WEAPON_KEYS: tuple[str, ...] = ("call_teammate", "eliminate", "hint")

# PRD v2 rule I: "刪減法：刪到剩 2 個選項（保留正解＋1 個錯的）；本來就只有
# 2 個選項的題目不能用，按鈕灰掉且不扣次數".
MIN_OPTIONS_TO_ELIMINATE = 3


def can_eliminate(options: list[dict]) -> bool:
    return len(options) >= MIN_OPTIONS_TO_ELIMINATE


def apply_eliminate(options: list[dict], correct_key: str, rng: random.Random) -> list[dict]:
    """Returns a NEW 2-item list: the correct option plus exactly one
    randomly-kept wrong option, in their ORIGINAL relative order (not
    re-lettered) — keeping each option's own `key` means `correct_key`
    stays valid against this reduced list without the engine needing a
    second, parallel "what's correct now" value.

    Raises ValueError if `options` already has fewer than
    `MIN_OPTIONS_TO_ELIMINATE` entries — the engine is expected to check
    `can_eliminate` BEFORE calling this (and not consume the weapon's
    quota when it returns False), never after a ValueError.
    """
    if not can_eliminate(options):
        raise ValueError(
            f"apply_eliminate needs >= {MIN_OPTIONS_TO_ELIMINATE} options, got {len(options)}"
        )
    wrong = [o for o in options if o.get("key") != correct_key]
    if not wrong:
        raise ValueError("apply_eliminate found no wrong option to keep (every option is correct_key?)")
    keep_wrong = rng.choice(wrong)
    kept_keys = {correct_key, keep_wrong.get("key")}
    return [o for o in options if o.get("key") in kept_keys]


def build_hint(payload: dict) -> str | None:
    """Returns a short hint string that never reveals the answer (PRD v2
    rule J: "提示不得直接透露答案"), or None when this question has no
    non-leaking hint data available — the engine must treat None exactly
    like "this question has no hint data" (PRD: 按鈕灰掉且不扣次數), not
    as an error.

    Honest, documented limitation (Claude 判斷): only `zhuyin` questions
    carry hint-worthy data today (`QuizItem.extra.target_index`, the
    position of the asked character within `stem` — see
    `services/live_quiz/sources/zhuyin.py`). PRD J's own worked examples
    for 詞義/閱讀 ("顯示課文例句"/"顯示相關段落") would need source data
    none of `vocab_definitions`/`vocab_application`/`comprehension`'s
    adapters carry today (verified against the real lesson YAML shape,
    e.g. `backend/data/lessons/L0165/v3/vocab_definitions.ff3jp.yml` has
    no example-sentence field) — inventing one here would mean guessing
    content, which this function refuses to do. Returning None for those
    three source modules is exactly the PRD-sanctioned "no hint data"
    case, not a shortcut around it.
    """
    source_module = payload.get("source_module")
    if source_module != "zhuyin":
        return None
    extra = payload.get("extra") or {}
    target_index = extra.get("target_index")
    stem = payload.get("stem") or ""
    lesson_uid = payload.get("lesson_uid")
    if not isinstance(target_index, int) or not (0 <= target_index < len(stem)) or not lesson_uid:
        return None
    # Staging QA (2026-10-20): the old hint took one neighbour on each side and
    # called it 「這個詞」, which was usually not a word (「索不是」) and only
    # repeated what the stem already shows. Instead point to ANOTHER sentence of
    # the same lesson where this character has the same curated reading — true,
    # useful, and it never prints the reading itself.
    from ..lesson_zhuyin import lesson_zhuyin_table

    table = lesson_zhuyin_table(lesson_uid) or {}
    # The stem is a slice of a passage, so look the reading up from the answer
    # key the server already holds (this runs server-side; the reading itself
    # is never put in the hint text).
    correct_key = payload.get("correct_key")
    reading = next((o.get("text") for o in payload.get("options") or [] if o.get("key") == correct_key), None)
    if not reading:
        return None
    char = stem[target_index]
    best: tuple[tuple[int, int], str] | None = None
    for text, readings in table.items():
        own = text.find(stem)
        for i, ch in enumerate(text):
            if own >= 0 and i == own + target_index:
                continue  # the very occurrence this question asks about
            if ch == char and readings.get(i) == reading:
                clause, whole = _clause_around(text, i)
                # Some lessons print the reading inline (「暈ㄩㄣˋ」); a clause
                # carrying 注音 would hand the student the answer.
                if any(_is_zhuyin(ch2) for ch2 in clause):
                    continue
                if clause and clause != char:
                    # Prefer a clause shown in full that is long enough to read
                    # as a phrase (≥4 chars); then a trimmed long one; a tiny
                    # whole clause like 「他了」 only as a last resort.
                    tier = 0 if whole and len(clause) >= MIN_CLAUSE_CHARS else 1 if not whole else 2
                    rank = (tier, len(clause))
                    if best is None or rank < best[0]:
                        best = (rank, clause)
    if best is None:
        return None
    return f"同一課「{best[1]}」裡的「{char}」，唸法跟這題一樣"


MIN_CLAUSE_CHARS = 4


def _is_zhuyin(ch: str) -> bool:
    return "\u3105" <= ch <= "\u312f" or "\u31a0" <= ch <= "\u31bf" or ch in "ˊˇˋ˙"


_CLAUSE_BREAKS = set("，。！？；：、「」『』（）()…—\n ")


def _clause_around(text: str, i: int, limit: int = 14) -> tuple[str, bool]:
    """The punctuation-delimited clause containing text[i], trimmed to `limit`
    characters centred on i. Returns (clause, shown_in_full)."""
    start = i
    while start > 0 and text[start - 1] not in _CLAUSE_BREAKS:
        start -= 1
    end = i + 1
    while end < len(text) and text[end] not in _CLAUSE_BREAKS:
        end += 1
    if end - start <= limit:
        return text[start:end], True
    start = max(start, i - limit // 2)
    end = min(end, start + limit)
    return text[start:end], False
