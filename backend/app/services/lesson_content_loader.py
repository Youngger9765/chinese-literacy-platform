"""lesson_content_loader.py — runtime supply of the typed ``Lesson`` contract.

Part of the 閱讀聚光燈 EDD refactor (DARK wiring, ``docs/spotlight-edd-handoff.md`` §4-#2).
This is the ONE place the backend turns an already-loaded story into the new typed
``lesson_content`` and hands it to the story-detail API — WITHOUT touching any existing
API behaviour when the flag is OFF.

DATA FLOW (flag ON only)
------------------------
``get_lesson_content(story)``:
  1. flag OFF (env ``LESSON_RENDERER_V1`` != "true")           → return None
  2. no ``story["spotlight_v2"]`` (identity-resolved inner spotlight dict, attached at
     import time by ``lesson_layer_loaders._spotlight_enrichment``)  → return None
  3. else: import the deterministic bridge adapter
     (``scripts/spotlight_to_lesson_content.py``) and run its PUBLIC pipeline on the
     SAME in-memory spotlight dict the legacy renderer already consumes — NO new identity
     path, NO file re-read, NO DB, NO network, NO AI. The adapter fingerprints identity
     off ``spot["lesson"]`` (already ``content_mapping_registry``-rebound upstream), so the
     張冠李戴 risk equals the current spotlight_v2 supply exactly.
  4. validate through ``Lesson.model_validate`` (adapter ``to_lesson``) and return
     ``model_dump(mode="json")`` — a pure snake_case JSON-safe dict.

FAIL-CLOSED: ANY exception (missing parsed source, ValidationError, import error, bad
spotlight shape) is logged at WARNING and swallowed → return None. The story-detail API
then emits ``lesson_content: null`` and the frontend falls back to its ``storyToLesson``
stopgap. A supply gap NEVER white-screens a page and NEVER raises out of ``get_story``.

CACHING (on-disk decision: NONE — see handoff §4-#1, deliberately not pre-empted)
--------------------------------------------------------------------------------
Lessons are import-time singletons (``lesson_loader._LESSONS_BY_ID`` builds each story
dict once). The adapter is pure CPU + a read of an immutable ``_parsed`` YAML, so we cache
the produced dict per ``story["id"]`` with ``functools.lru_cache``. First call for an id
runs the adapter once; subsequent calls are O(1). Content is stable for the process
lifetime (source is immutable), so no TTL / mtime invalidation is needed. Each uvicorn
worker holds its own cache (~hundreds of small dicts, acceptable). We write NO
``*.lesson.yml`` to disk — the正式 on-disk location remains a team decision.
"""
from __future__ import annotations

import functools
import logging
import os
import sys
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

# scripts/ (adapter lives here, alongside the rest of the EDD bridge tooling).
_REPO_ROOT = Path(__file__).resolve().parents[3]
_SCRIPTS_DIR = _REPO_ROOT / "scripts"


def _flag_on() -> bool:
    """Backend LESSON_RENDERER_V1 flag. Default OFF (DARK). Read live so tests can
    monkeypatch ``os.environ`` per-case without a module reload."""
    return os.getenv("LESSON_RENDERER_V1", "").strip().lower() == "true"


# Module-level singleton for the imported adapter (import once, reuse).
_adapter = None


def _get_adapter():
    """Import scripts/spotlight_to_lesson_content.py on first use (sys.path trick),
    same public entrypoints the eval + dry-run runner use. Cached module-level."""
    global _adapter
    if _adapter is None:
        if str(_SCRIPTS_DIR) not in sys.path:
            sys.path.insert(0, str(_SCRIPTS_DIR))
        import spotlight_to_lesson_content as adapter  # noqa: E402

        _adapter = adapter
    return _adapter


# Registry of the in-memory story dicts, keyed by id, so the lru_cache below can take a
# hashable key (story dicts are unhashable) yet still reach the live spotlight_v2 payload.
_STORY_REGISTRY: dict[int, dict[str, Any]] = {}


@functools.lru_cache(maxsize=None)
def _build_by_story_id(story_id: int) -> Optional[dict]:
    """Produce the typed lesson_content dict for a registered story id (cached).

    Returns None (fail-closed) on any adapter/validation error. The story dict is looked
    up from ``_STORY_REGISTRY`` (populated by ``get_lesson_content``) so this function's
    only argument is the hashable id — keeping the cache correct and cheap.
    """
    story = _STORY_REGISTRY.get(story_id)
    if story is None:
        return None
    spot = story.get("spotlight_v2")
    if not isinstance(spot, dict) or not spot:
        return None
    try:
        adapter = _get_adapter()
        # Identity: fingerprint off the spotlight's own (already-rebound) lesson code;
        # fall back to grade_code only if the spotlight omitted it. NO new identity path.
        raw_code = spot.get("lesson") or story.get("grade_code")
        code = adapter.normalize_manifest_code(str(raw_code))
        parsed, parsed_kind = adapter.load_parsed(code)
        lesson_dict = adapter.assemble_lesson(
            spot,
            parsed,
            adapter.GapLog(),
            with_keypoints=True,
            parsed_source_kind=parsed_kind,
        )
        lesson = adapter.to_lesson(lesson_dict)  # Lesson.model_validate — fail LOUD → caught
        # exclude_none: the frontend zod contract uses `.optional()` (accepts ABSENT), not
        # `.nullish()`, for the char-range anchor fields — an explicit `char_start: null`
        # would FAIL LessonSchema.safeParse and silently drop the payload back to the
        # storyToLesson stopgap. Dropping null-valued optionals makes the wire dict match
        # the zod contract exactly (a whole-block anchor simply omits its char range). Every
        # required field is non-None by construction, so nothing load-bearing is lost.
        return lesson.model_dump(mode="json", exclude_none=True)
    except Exception as exc:  # noqa: BLE001 — fail-closed by design (see module docstring)
        logger.warning(
            "lesson_content supply failed for story id=%s (fail-closed → null): %s",
            story_id,
            exc,
        )
        return None


def get_lesson_content(story: dict) -> Optional[dict]:
    """Return the typed ``lesson_content`` dict for a story, or None.

    None when: flag OFF, no spotlight_v2 source, or any adapter/validation failure
    (fail-closed). See module docstring for the full data flow. Called from the
    story-detail route ONLY — every other endpoint is untouched.
    """
    if not _flag_on():
        return None
    if not isinstance(story, dict):
        return None
    spot = story.get("spotlight_v2")
    if not isinstance(spot, dict) or not spot:
        return None
    story_id = story.get("id")
    if story_id is None:
        return None
    # Register the live dict so the id-keyed cache can reach spotlight_v2. Stored once;
    # the story dicts are import-time singletons so the pointer stays valid + stable.
    _STORY_REGISTRY[story_id] = story
    return _build_by_story_id(story_id)


def _reset_caches_for_test() -> None:
    """Test-only: clear the lru_cache + registry so flag/env changes take effect per-case."""
    _build_by_story_id.cache_clear()
    _STORY_REGISTRY.clear()
