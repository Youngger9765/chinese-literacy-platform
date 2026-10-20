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
    if not isinstance(target_index, int) or not (0 <= target_index < len(stem)):
        return None
    start = max(0, target_index - 1)
    end = min(len(stem), target_index + 2)
    word = stem[start:end]
    if not word:
        return None
    return f"這個字出現在「{word}」這個詞裡"
