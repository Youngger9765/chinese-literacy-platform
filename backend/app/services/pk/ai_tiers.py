"""The seven AI opponent tiers — PRD §5.1/§5.2.

Rule-based, NOT an LLM (PRD §0: "規則型機器人，不叫 LLM"). Each tier rolls an
independent die per question for correctness, then samples an elapsed time
from a truncated normal distribution — both walk through the SAME PK scoring
rule real players use (services/pk/scoring.py), so "AI" is just a different
source of an answer, never a different scoring path (PRD §5.1 closing
paragraph).
"""
from __future__ import annotations

import math
import random
from dataclasses import dataclass

MIN_ELAPSED_MS = 500
MAX_ELAPSED_MS = 20_000

# PRD §5.2: virtual_rating(tier_n) = 1000 + 173.7*ln(p_n/(1-p_n)) -
# 173.7*ln(p_1/(1-p_1)), 173.7 ≈ 400/ln(10).
_ELO_SCALE = 400.0 / math.log(10.0)


def _logit(p: float) -> float:
    return math.log(p / (1.0 - p))


@dataclass(frozen=True)
class AiTier:
    tier: int
    slug: str
    name: str
    accuracy: float  # p_n
    speed_label: str
    # Average elapsed time as a fraction of the 20s window, and its
    # standard deviation (also a fraction) — PRD §5.1 second table.
    speed_mean_pct: float
    speed_sd_pct: float
    virtual_rating: int


def virtual_rating_formula(accuracy: float, base_accuracy: float = 0.50) -> int:
    """The PRD §5.2 formula, exposed standalone so a test can confirm the
    hardcoded table below (next function) is this formula's output, not a
    hand-typed number that silently drifted from it."""
    return round(1000 + _ELO_SCALE * (_logit(accuracy) - _logit(base_accuracy)))


def _build_tiers() -> tuple[AiTier, ...]:
    raw = [
        # tier, slug,         name,    accuracy, speed_label, mean_pct, sd_pct, virtual_rating
        # virtual_rating is PRD §5.2's own table verbatim (not re-derived via
        # float math here) so the served numbers can never drift by a
        # rounding tie-break — test_pk_ai_tiers.py separately proves
        # virtual_rating_formula() reproduces each of these within ±1.
        (1, "luo-binwang", "駱賓王", 0.50, "慢", 0.75, 0.12, 1000),
        (2, "meng-haoran", "孟浩然", 0.60, "慢", 0.65, 0.12, 1070),
        (3, "bai-juyi", "白居易", 0.70, "中", 0.50, 0.10, 1147),
        (4, "li-qingzhao", "李清照", 0.78, "中", 0.42, 0.10, 1220),
        (5, "du-fu", "杜甫", 0.85, "中快", 0.33, 0.08, 1301),
        (6, "su-shi", "蘇軾", 0.90, "快", 0.22, 0.06, 1382),
        (7, "li-bai", "李白", 0.95, "非常快", 0.15, 0.05, 1511),
    ]
    tiers = []
    for tier, slug, name, accuracy, speed_label, mean_pct, sd_pct, virtual_rating in raw:
        tiers.append(
            AiTier(
                tier=tier,
                slug=slug,
                name=name,
                accuracy=accuracy,
                speed_label=speed_label,
                speed_mean_pct=mean_pct,
                speed_sd_pct=sd_pct,
                virtual_rating=virtual_rating,
            )
        )
    return tuple(tiers)


TIERS: tuple[AiTier, ...] = _build_tiers()
_BY_TIER = {t.tier: t for t in TIERS}


def get_tier(tier: int) -> AiTier:
    if tier not in _BY_TIER:
        raise ValueError(f"Unknown PK AI tier: {tier!r} (must be 1-7)")
    return _BY_TIER[tier]


def recommend_tier(student_rating: int) -> AiTier:
    """PRD §5.2: "推薦「虛擬積分離學生目前積分最近」的那一位" — recommendation
    only, never a hard constraint on which tier a student may challenge."""
    return min(TIERS, key=lambda t: abs(t.virtual_rating - student_rating))


def sample_ai_answer(tier: int, payload: dict, rng: random.Random) -> dict:
    """One AI answer for one round — PRD §5.1: "先擲正確率骰子決定對錯，再從
    對應分布抽 elapsed_ms（clamp 在 0.5s–20s 之間）".

    Returns {"choice_key", "is_correct", "elapsed_ms"} — the caller
    (services/pk/engine.py) runs this through the same
    services/pk/scoring.score_pk_answer() real players use, so points are
    never computed here.
    """
    t = get_tier(tier)
    options = payload["options"]
    correct_key = payload["correct_key"]
    seconds = payload.get("seconds", 20)
    limit_ms = int(seconds) * 1000

    is_correct = rng.random() < t.accuracy
    if is_correct:
        choice_key = correct_key
    else:
        wrong_keys = [o["key"] for o in options if o["key"] != correct_key]
        choice_key = rng.choice(wrong_keys) if wrong_keys else correct_key

    mean_ms = t.speed_mean_pct * limit_ms
    sd_ms = t.speed_sd_pct * limit_ms
    elapsed_ms = int(rng.gauss(mean_ms, sd_ms))
    elapsed_ms = max(MIN_ELAPSED_MS, min(MAX_ELAPSED_MS, min(elapsed_ms, limit_ms)))

    return {"choice_key": choice_key, "is_correct": is_correct, "elapsed_ms": elapsed_ms}
