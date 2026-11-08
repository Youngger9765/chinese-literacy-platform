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

import os
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


def _safe_prompt_path(norm: str) -> str | None:
    """Join `norm` under `_PROMPTS_DIR` and return the path only if it's
    actually contained there — otherwise None.

    #3957 follow-up: the `norm not in list_available_strategies()` allowlist
    check below closes the real vulnerability, but CodeQL's
    `py/path-injection` sanitizer model doesn't recognize an
    allowlist-membership check as a barrier — it specifically recognizes
    `os.path.normpath()` (moves the value to a "normalized" state) followed
    by `str.startswith(base)` (the containment check), the same idiom used
    in curriculum_qa_service.py's `_safe_join` (#3955). `os.sep` is
    appended to the base to rule out a sibling-prefix collision (e.g.
    ".../strategy_prompts" wrongly "containing" ".../strategy_prompts-evil").
    """
    base = os.path.normpath(str(_PROMPTS_DIR))
    candidate = os.path.normpath(os.path.join(base, norm, _PROMPT_FILENAME))
    if not candidate.startswith(base + os.sep):
        return None
    return candidate


def _read_yaml(path: Path | str) -> dict[str, Any]:
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

    # #3957: `strategy_type` arrives from an authenticated-but-untrusted
    # request body (any logged-in student — McqRescueStartRequest.strategy_type
    # is only length-capped, no format/allowlist check) and used to flow
    # straight into a filesystem path. Validate against the real strategy
    # directories on disk BEFORE constructing any path — anything that isn't
    # a known strategy name (e.g. a traversal string) falls straight through
    # to the default fallback below, the same as an unknown-but-benign value
    # always did, instead of ever touching the filesystem with attacker input.
    if norm != _DEFAULT_TYPE and norm not in list_available_strategies():
        norm = _DEFAULT_TYPE

    # Try specific strategy first
    specific = _safe_prompt_path(norm)
    if specific is not None and os.path.exists(specific):
        return _read_yaml(specific)

    # Fallback to default
    default = _safe_prompt_path(_DEFAULT_TYPE)
    if default is not None and os.path.exists(default):
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
