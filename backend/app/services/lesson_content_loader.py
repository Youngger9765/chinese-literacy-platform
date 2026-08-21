"""lesson_content_loader.py — runtime supply of the typed ``Lesson`` contract.

Turns an already-loaded story into the typed ``lesson_content`` the story-detail API
hands to the frontend renderer. One story in, one validated ``Lesson`` dict out.

DATA FLOW
---------
``get_lesson_content(story)``:
  1. flag OFF (env ``LESSON_RENDERER_V1`` != "true")  → None
  2. no ``story["spotlight_v2"]``                     → None
  3. else run the deterministic bridge adapter (``app.services.spotlight_to_lesson_content``)
     on the SAME in-memory spotlight dict the story already carries — no file re-read,
     no DB, no network, no AI
  4. validate through ``Lesson.model_validate`` and return ``model_dump(mode="json")``

WHY THIS IS SHORTER THAN IT WAS (#2683 二修重刷)
-----------------------------------------------
It used to carry three extra machines, all of which existed to paper over the two-layer
merge that the second-edition re-ink abolished:

  - ``_try_ai_lesson`` read ``data/lessons/_ai_lessons/<code>.lesson.yml``
  - ``_hydrate_reading_from_parsed`` re-read ``data/lessons/_parsed_2026-05-01/<code>.yml``
    to overwrite paragraph text and figure assets
  - ``catalog_to_parsed_code`` re-bound the keypoints/title CONTENT source through a
    hand-maintained G8 ±1 offset table, plus a 張冠李戴 guard that flagged every exercise
    ``needs_review`` when the two bindings disagreed

All three keyed off ``grade_code`` — a lesson's POSITION in the catalogue, which the
renumber changes. Measured on the second edition before removal: the ``_parsed`` layer
supplied 0/175 lessons, the ``_ai_lessons`` layer 0/175, and the offset table still
rewrote 11 codes using first-edition numbering. Inert, but pointed at the wrong lesson
the moment either directory came back. Identity now comes from ``lesson_uid`` and the
content from that lesson's own ``spotlight.yml`` / ``keypoints.yml`` in the uid tree, so
there is no second binding to disagree with.

FAIL-CLOSED: any exception (ValidationError, bad spotlight shape) is logged at WARNING and
swallowed → None. The API emits ``lesson_content: null`` and the frontend falls back to
its ``storyToLesson`` stopgap. A supply gap never white-screens a page.

Note this is what surfaces the 32 lessons whose extraction produced zero spotlight blocks:
``Lesson`` requires ``blocks`` to be non-empty, so they validate-fail and serve null rather
than an empty shell. That is the intended behaviour — see
``backend/data/curriculum_qa/content_known_gaps.yaml``.

CACHING: lessons are import-time singletons and the adapter is pure CPU, so the produced
dict is cached per ``story["id"]``. Content is stable for the process lifetime, so no TTL
or mtime invalidation is needed. Each uvicorn worker holds its own cache.
"""
from __future__ import annotations

import functools
import logging
import os
from typing import Any, Optional

logger = logging.getLogger(__name__)


def _flag_on() -> bool:
    """Backend LESSON_RENDERER_V1 flag. Default ON (unset → enabled); set the env to a
    non-"true" value (e.g. "false") to force OFF. Read live so tests can monkeypatch
    ``os.environ`` per-case without a module reload."""
    return os.getenv("LESSON_RENDERER_V1", "true").strip().lower() == "true"


# Module-level singleton for the imported adapter (import once, reuse).
_adapter = None


def _get_adapter():
    """Import the bridge adapter on first use. Cached module-level.

    #2680: this module used to live under ``scripts/`` and was pulled in via a sys.path
    trick — but ``backend/Dockerfile`` never COPYs ``scripts/`` (nor can it: the build
    context is ``./backend`` and ``scripts/`` is one level up), so in the container this
    raised ModuleNotFoundError and the fail-closed path returned null lesson_content for
    every spotlight lesson. It is now part of the app package.
    """
    global _adapter
    if _adapter is None:
        from app.services import spotlight_to_lesson_content as adapter

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
        # No `_parsed` twin any more. The adapter used it for two things: the
        # ex-keypoints block (from `story_structure_table`) and a fallback title.
        # The uid tree carries keypoints as its own structured `keypoints.yml`, served
        # separately on `story["keypoints"]` for the 重點表 step, and the title comes
        # from `lesson.yml` below — so there is nothing left for it to supply.
        # with_keypoints=False rather than an empty dict: asking for a block from a
        # source that no longer exists would log a `no_keypoints_source` gap against
        # all 175 lessons, which reads as a content defect and is not one.
        lesson_dict = adapter.assemble_lesson(
            spot, {}, adapter.GapLog(), with_keypoints=False
        )
        # Title authority: the display lesson's own title is what the student sees.
        # Prefer it over whatever the spotlight carried; fall back to the assembled one.
        display_title = story.get("title")
        if display_title:
            lesson_dict["title"] = display_title

        lesson = adapter.to_lesson(lesson_dict)  # model_validate — fail LOUD → caught
        # exclude_none: the frontend zod contract uses `.optional()` (accepts ABSENT), not
        # `.nullish()`, for the char-range anchor fields — an explicit `char_start: null`
        # would FAIL LessonSchema.safeParse and silently drop the payload back to the
        # storyToLesson stopgap. Dropping null-valued optionals makes the wire dict match
        # the zod contract exactly. Every required field is non-None by construction.
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
