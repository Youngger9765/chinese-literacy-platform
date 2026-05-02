"""
Strategy Prompts loader — plugin pattern for per-strategy AI tutor prompts.

Architecture: docs/architecture/strategy-step-plugin-pattern.md

Each reading_strategy_type maps to a directory under
backend/data/strategy_prompts/{type}/ containing prompt.yml (and optionally
step_sequence.yml).

Resolution chain:
  1. backend/data/strategy_prompts/{strategy_type}/prompt.yml
  2. backend/data/strategy_prompts/default/prompt.yml (fallback)
  3. RuntimeError if neither exists (default is required at deploy)

Usage:
  from app.services.strategy_prompts import load_strategy_prompt
  prompt = load_strategy_prompt('summary_psr')
  # → dict with keys: strategy, display_name, opening, steps, ...

This module is intentionally narrow: just yaml loading + fallback. Prompt
construction (system prompt assembly, history threading) is the caller's job
in mcq_rescue_agent.py.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml


# Resolved at import time — directory containing strategy folders.
_PROMPTS_DIR = Path(__file__).parent.parent.parent / "data" / "strategy_prompts"
_DEFAULT_TYPE = "default"
_PROMPT_FILENAME = "prompt.yml"


class StrategyPromptError(RuntimeError):
    """Raised when no prompt yaml can be resolved (default missing)."""


def _read_yaml(path: Path) -> dict[str, Any]:
    """Read a yaml file, return parsed dict. Raises if file is empty/invalid."""
    with open(path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f)
    if not isinstance(data, dict):
        raise StrategyPromptError(
            f"Strategy prompt yaml must be a dict, got {type(data).__name__}: {path}"
        )
    return data


@lru_cache(maxsize=32)
def _load_prompt_uncached(strategy_type: str | None) -> dict[str, Any]:
    """Inner cached loader — keyed on normalized strategy_type."""
    norm = (strategy_type or _DEFAULT_TYPE).strip()
    if not norm:
        norm = _DEFAULT_TYPE

    # Try specific strategy first
    specific = _PROMPTS_DIR / norm / _PROMPT_FILENAME
    if specific.exists():
        return _read_yaml(specific)

    # Fallback to default
    default = _PROMPTS_DIR / _DEFAULT_TYPE / _PROMPT_FILENAME
    if default.exists():
        return _read_yaml(default)

    raise StrategyPromptError(
        f"No prompt.yml found for strategy_type={norm!r} and no default at {default}"
    )


def load_strategy_prompt(strategy_type: str | None) -> dict[str, Any]:
    """Load the prompt yaml for a given reading_strategy_type.

    Args:
        strategy_type: canonical strategy type from lesson.yml (e.g. 'summary_psr',
            'graphic_text_integration', 'inference', 'general'). None or empty
            string falls back to default.

    Returns:
        Parsed yaml dict with keys: strategy, display_name, description, opening,
        steps, terminate_conditions, tone, etc. Caller must validate the keys
        it needs.

    Raises:
        StrategyPromptError: if no specific or default yaml is reachable.
    """
    return _load_prompt_uncached(strategy_type)


def list_available_strategies() -> list[str]:
    """Return list of strategy_type names with a prompt.yml on disk.

    Used for /admin endpoints / debugging which strategies have custom prompts
    vs which fall back to default.
    """
    if not _PROMPTS_DIR.exists():
        return []
    return sorted(
        d.name for d in _PROMPTS_DIR.iterdir()
        if d.is_dir() and (d / _PROMPT_FILENAME).exists()
    )


def clear_cache() -> None:
    """Clear the LRU cache. Used in tests after writing fixture yaml."""
    _load_prompt_uncached.cache_clear()
