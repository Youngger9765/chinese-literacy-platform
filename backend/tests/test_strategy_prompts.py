"""
Tests for strategy_prompts loader (#1404).

Covers:
  1. Known strategy type loads its prompt.yml
  2. Unknown strategy type falls back to default.yml
  3. None / empty string falls back to default.yml
  4. Required default exists with required schema keys
  5. list_available_strategies returns strategies with prompt.yml
  6. Cache invalidation works
  7. summary_psr prompt has 5 steps
  8. graphic_text_integration prompt has 5 steps
  9. All 7 designated lessons' strategy types resolve cleanly

Run with:
    cd backend && python -m pytest tests/test_strategy_prompts.py -v
"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from app.services.strategy_prompts import (
    StrategyPromptError,
    clear_cache,
    list_available_strategies,
    load_strategy_prompt,
)


@pytest.fixture(autouse=True)
def _clear_cache_each_test():
    """Each test starts with a clean LRU cache."""
    clear_cache()
    yield
    clear_cache()


# ── Specific strategy resolution ─────────────────────────────────────────────


class TestKnownStrategyResolves:
    def test_summary_psr_loads(self):
        prompt = load_strategy_prompt("summary_psr")
        assert prompt["strategy"] == "summary_psr"
        assert "opening" in prompt
        assert "steps" in prompt

    def test_graphic_text_integration_loads(self):
        prompt = load_strategy_prompt("graphic_text_integration")
        assert prompt["strategy"] == "graphic_text_integration"

    def test_default_loads(self):
        prompt = load_strategy_prompt("default")
        assert prompt["strategy"] == "default"


# ── Fallback to default for unknown / none / empty ───────────────────────────


class TestUnknownFallsBackToDefault:
    def test_unknown_strategy_falls_back(self):
        prompt = load_strategy_prompt("nonexistent_strategy_xyz")
        assert prompt["strategy"] == "default"

    def test_none_falls_back(self):
        prompt = load_strategy_prompt(None)
        assert prompt["strategy"] == "default"

    def test_empty_string_falls_back(self):
        prompt = load_strategy_prompt("")
        assert prompt["strategy"] == "default"

    def test_whitespace_only_falls_back(self):
        prompt = load_strategy_prompt("   ")
        assert prompt["strategy"] == "default"


# ── Schema sanity for required strategies ────────────────────────────────────


class TestPromptSchema:
    REQUIRED_KEYS = {"strategy", "display_name", "opening", "steps"}

    def test_default_has_required_keys(self):
        prompt = load_strategy_prompt("default")
        missing = self.REQUIRED_KEYS - prompt.keys()
        assert not missing, f"default.yml missing keys: {missing}"

    def test_default_has_5_steps(self):
        prompt = load_strategy_prompt("default")
        assert len(prompt["steps"]) == 5

    def test_summary_psr_has_5_steps(self):
        prompt = load_strategy_prompt("summary_psr")
        assert len(prompt["steps"]) == 5

    def test_graphic_text_integration_has_5_steps(self):
        prompt = load_strategy_prompt("graphic_text_integration")
        assert len(prompt["steps"]) == 5

    def test_each_step_has_required_fields(self):
        prompt = load_strategy_prompt("summary_psr")
        for i, step in enumerate(prompt["steps"]):
            for key in ("step", "name", "label", "intent"):
                assert key in step, f"summary_psr step {i} missing {key}"


# ── Listing ──────────────────────────────────────────────────────────────────


class TestListAvailable:
    def test_list_includes_default(self):
        strategies = list_available_strategies()
        assert "default" in strategies

    def test_list_includes_summary_psr(self):
        strategies = list_available_strategies()
        assert "summary_psr" in strategies

    def test_list_includes_graphic_text_integration(self):
        strategies = list_available_strategies()
        assert "graphic_text_integration" in strategies

    def test_list_is_sorted(self):
        strategies = list_available_strategies()
        assert strategies == sorted(strategies)


# ── 7 designated lessons all resolve to a non-error prompt ───────────────────


class TestSevenDesignatedLessonsResolve:
    """The 7 lessons assigned for 7/1 deadline must each resolve to a prompt
    (either specific or default fallback), never raise."""

    DESIGNATED_TYPES = [
        # G6-L22, G6-L23, G6-L24, G6-L25 → summary_psr
        ("summary_psr", "G6-L22~25"),
        # G7-L28, G7-L29, G7-L30 → graphic_text_integration
        ("graphic_text_integration", "G7-L28~30"),
    ]

    def test_all_seven_resolve(self):
        for strategy_type, lessons in self.DESIGNATED_TYPES:
            prompt = load_strategy_prompt(strategy_type)
            assert prompt is not None, f"{lessons} ({strategy_type}) didn't resolve"
            assert "opening" in prompt, f"{lessons} prompt missing opening"

    def test_seven_lessons_use_non_default_specific_prompts(self):
        """7 designated lessons should use SPECIFIC prompts, not fall back."""
        for strategy_type, lessons in self.DESIGNATED_TYPES:
            prompt = load_strategy_prompt(strategy_type)
            assert prompt["strategy"] == strategy_type, (
                f"{lessons} ({strategy_type}) fell back to {prompt['strategy']!r} "
                "— specific prompt.yml missing"
            )


# ── Cache behavior ────────────────────────────────────────────────────────────


class TestCacheBehavior:
    def test_repeated_load_returns_same_object(self):
        a = load_strategy_prompt("summary_psr")
        b = load_strategy_prompt("summary_psr")
        # LRU cache returns same object reference
        assert a is b

    def test_clear_cache_re_reads(self):
        a = load_strategy_prompt("summary_psr")
        clear_cache()
        b = load_strategy_prompt("summary_psr")
        # After clear, contents equal but objects differ
        assert a == b
        assert a is not b
