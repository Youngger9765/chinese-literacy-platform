"""
Spec: ai-usage-cost — estimate_cost formula + PRICING rate lock.

Canonical source: backend/app/services/ai_usage_tracker.py
Related issues: #1730 (OMO grader pricing), #1744 (default model), #1729 (identifier)
Module spec: specs/modules/ai-usage-cost/INTENT.md

Pure-function contracts — no DB, no AI, no network. Run in < 1 ms.
"""

import sys
from pathlib import Path

# Make app importable regardless of invocation cwd
_BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from app.services.ai_usage_tracker import PRICING, estimate_cost

_DEFAULT_MODEL = "gemini-2.5-flash-lite"


# ---------------------------------------------------------------------------
# I-1: estimate_cost formula
# ---------------------------------------------------------------------------

class TestCostFormula:
    def test_formula_matches_per_million_pricing(self):
        # 1M input + 1M output on 2.5-flash = 0.30 + 2.50 = 2.80 USD
        cost = estimate_cost("gemini-2.5-flash", 1_000_000, 1_000_000)
        assert cost == 0.30 + 2.50

    def test_partial_million_scales_linearly(self):
        # 500k input + 200k output on 2.5-flash-lite
        cost = estimate_cost(_DEFAULT_MODEL, 500_000, 200_000)
        expected = (500_000 * 0.075 + 200_000 * 0.30) / 1_000_000
        assert cost == expected

    def test_zero_tokens_is_zero_cost(self):
        assert estimate_cost("gemini-2.5-flash", 0, 0) == 0.0


# ---------------------------------------------------------------------------
# I-2: PRICING rates are the documented, decision-locked values
# ---------------------------------------------------------------------------

class TestPricingRatesLocked:
    def test_omo_grader_model_rate(self):
        # #1730 — OMO grader locked to gemini-2.5-flash
        assert PRICING["gemini-2.5-flash"] == {"input": 0.30, "output": 2.50}

    def test_default_model_rate(self):
        # #1744 — non-OMO default
        assert PRICING[_DEFAULT_MODEL] == {"input": 0.075, "output": 0.30}


# ---------------------------------------------------------------------------
# I-3: unknown model fails soft to the default pricing (never crash / 0 / None)
# ---------------------------------------------------------------------------

class TestUnknownModelFallback:
    def test_unknown_model_uses_default_pricing(self):
        unknown = estimate_cost("gpt-9-ultra-imaginary", 1_000_000, 1_000_000)
        default = estimate_cost(_DEFAULT_MODEL, 1_000_000, 1_000_000)
        assert unknown == default

    def test_unknown_model_does_not_return_zero_or_none(self):
        cost = estimate_cost("does-not-exist", 1_000_000, 0)
        assert cost is not None
        assert cost > 0


# ---------------------------------------------------------------------------
# I-4: monotonic + non-negative
# ---------------------------------------------------------------------------

class TestMonotonicNonNegative:
    def test_more_tokens_never_cheaper(self):
        small = estimate_cost("gemini-2.5-flash", 1_000, 1_000)
        big = estimate_cost("gemini-2.5-flash", 100_000, 100_000)
        assert big >= small

    def test_cost_never_negative(self):
        for model in PRICING:
            assert estimate_cost(model, 0, 0) >= 0
            assert estimate_cost(model, 1_000_000, 1_000_000) >= 0


# ---------------------------------------------------------------------------
# I-5: default model is the cheapest (guards "expensive = default" regression, #1744)
# ---------------------------------------------------------------------------

class TestDefaultIsCheapest:
    def test_default_model_cheapest_on_equal_workload(self):
        workload = (1_000_000, 1_000_000)
        default_cost = estimate_cost(_DEFAULT_MODEL, *workload)
        for model in PRICING:
            assert default_cost <= estimate_cost(model, *workload)
