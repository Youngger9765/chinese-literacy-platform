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
     SAME in-memory spotlight dict the legacy renderer already consumes — NO file re-read
     beyond an immutable ``_parsed`` YAML, NO DB, NO network, NO AI.

     CONTENT-source identity (張冠李戴 fix): the exercise ``lesson_code`` stays the
     spotlight's own display code (``resolve_identity(spot)``), but the keypoints/title
     CONTENT source (the ``_parsed`` twin) is resolved through the platform authority
     ``catalog_to_parsed_code(story["grade_code"])`` — the SAME mapping
     ``load_layer2_lessons`` used to bind this story's ``story_structure_table`` + ``title``
     — NOT the adapter's bare-first ``load_parsed(spot["lesson"])``, which bypasses that
     authority and mis-binds the G8 catalog↔Layer-2 +1 numbering offset onto a NEIGHBOUR
     lesson's keypoints/title. When the spotlight's own declared identity resolves to a
     DIFFERENT ``_parsed`` file than the display lesson's authoritative twin, the spotlight
     BODY may itself be a neighbour's (pre-existing spotlight_v2 mis-map) → every exercise
     block is flagged ``needs_review`` (honest 「需人工檢核」, never a silent 張冠李戴 green).
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

from app.services.lesson_code_normalization import catalog_to_parsed_code

logger = logging.getLogger(__name__)

# scripts/ (adapter lives here, alongside the rest of the EDD bridge tooling).
_REPO_ROOT = Path(__file__).resolve().parents[3]
_SCRIPTS_DIR = _REPO_ROOT / "scripts"
# AI-extracted spotlight lessons (ai-lesson-extract skill). When present for a lesson
# code, these are PREFERRED over the deterministic bridge adapter so the real
# reading-strategy page renders the AI-produced 聚光燈. Still flag-gated + fail-safe.
_AI_LESSONS_DIR = _REPO_ROOT / "backend" / "data" / "lessons" / "_ai_lessons"


_PARSED_DIR = _REPO_ROOT / "backend" / "data" / "lessons" / "_parsed_2026-05-01"


def _load_canonical_parsed(code: str) -> Optional[dict]:
    """Load the authoritative ``_parsed_2026-05-01`` twin for a lesson code — the SAME
    content source 朗讀 / 重點表 / 閱讀理解 read. Resolved through the platform authority
    ``catalog_to_parsed_code`` (with a bare-code fallback). Returns None if absent/unreadable."""
    import yaml  # noqa: E402

    candidates = []
    try:
        pc = catalog_to_parsed_code(str(code))
        if pc:
            candidates.append(pc)
    except Exception:  # noqa: BLE001
        pass
    candidates.append(code)
    for c in candidates:
        p = _PARSED_DIR / f"{c}.yml"
        if p.exists():
            try:
                data = yaml.safe_load(p.read_text(encoding="utf-8"))
                return data if isinstance(data, dict) else None
            except Exception:  # noqa: BLE001
                return None
    return None


def _hydrate_reading_from_parsed(lesson: dict, code: str) -> None:
    """Overwrite paragraph TEXT and figure ASSET in an AI-extracted lesson with the
    authoritative values from the ``_parsed`` twin, so 課文 (paragraph text) + 圖 (image
    asset) ALWAYS match the shared canonical source — GCS-correct filenames, complete
    paragraphs — regardless of what the extraction transcribed. This is why the
    ai-lesson-extract skill no longer needs to (re)analyse the course text or pick image
    assets (the two recurring conversion-bug sources).

    Presentation ORDER + anchors stay exactly as the AI authored them (the AI judges layout
    from the PDF). Tables are left untouched (verified-correct + non-trivial to reshape).
    Mutates in place; fully fail-safe — any count mismatch / structural surprise leaves that
    block as-is (never worse than before)."""
    parsed = _load_canonical_parsed(code)
    if parsed is None:
        return
    blocks = lesson.get("blocks")
    if not isinstance(blocks, list):
        return

    paras = [str(p) for p in (parsed.get("paragraphs") or []) if str(p).strip()]
    images = [im for im in (parsed.get("images") or []) if isinstance(im, dict)]
    by_label = {
        str(im.get("figure_label")): im for im in images if im.get("figure_label")
    }

    para_blocks = [b for b in blocks if isinstance(b, dict) and b.get("type") == "paragraph"]
    fig_blocks = [b for b in blocks if isinstance(b, dict) and b.get("type") == "figure"]

    # Paragraphs: hydrate only when counts match exactly (else skip — a differing split
    # could misalign text onto the wrong paragraph; safer to keep the AI's own).
    if paras and len(para_blocks) == len(paras):
        for blk, text in zip(para_blocks, paras):
            blk["text"] = text

    # Figures: match by 圖N label; fall back to positional order. Asset is authoritative
    # (kills the GCS/local numbering mismatch); AI caption kept when present.
    for i, blk in enumerate(fig_blocks):
        im = by_label.get(str(blk.get("label"))) if blk.get("label") else None
        if im is None and i < len(images):
            im = images[i]
        if im and im.get("filename"):
            blk["asset"] = im["filename"]
            if not blk.get("caption") and im.get("caption"):
                blk["caption"] = im["caption"]


def _try_ai_lesson(story: dict) -> Optional[dict]:
    """If an AI-extracted spotlight lesson exists for this story's code, load + serve it
    (contract-validated). Reading-material CONTENT (paragraph text + figure asset) is
    hydrated from the authoritative ``_parsed`` twin so 課文/圖 always match the shared
    canonical source. Returns None (→ fall through to the deterministic adapter) when
    absent or on any error."""
    code = story.get("grade_code")
    if not code:
        return None
    path = _AI_LESSONS_DIR / f"{code}.lesson.yml"
    if not path.exists():
        return None
    try:
        import yaml  # noqa: E402
        from app.schemas.lesson_content import Lesson  # noqa: E402

        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
        _hydrate_reading_from_parsed(raw, str(code))
        # Title authority: serve the DISPLAY lesson's own title (same rule the deterministic
        # path applies below), never a full/half-width colon variant the extraction happened
        # to transcribe. Keeps the 張冠李戴 title-authority invariant across both paths.
        display_title = story.get("title")
        if display_title:
            raw["title"] = display_title
        lesson = Lesson.model_validate(raw)
        return lesson.model_dump(mode="json", exclude_none=True)
    except Exception as exc:  # noqa: BLE001 — fail-safe: fall back to the adapter
        logger.warning(
            "AI lesson override failed for %s (fall back to adapter): %s", code, exc
        )
        return None


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
    # AI-extracted spotlight (ai-lesson-extract) takes precedence when present.
    ai = _try_ai_lesson(story)
    if ai is not None:
        return ai
    spot = story.get("spotlight_v2")
    if not isinstance(spot, dict) or not spot:
        return None
    try:
        adapter = _get_adapter()
        # ── CONTENT-source identity (張冠李戴 fix — content-mapping-integrity 鐵律) ────────
        # `lesson_code` (the page/exercise identity) stays the spotlight's own display code —
        # that is resolved inside assemble_lesson via resolve_identity(spot). But the
        # keypoints/title CONTENT source (the _parsed twin) must be resolved through the
        # PLATFORM AUTHORITY catalog_to_parsed_code(display_code), NOT the adapter's bare-first
        # load_parsed(spot["lesson"]). load_layer2_lessons already binds this story's
        # story_structure_table + title through catalog_to_parsed_code; the adapter's bare-first
        # bypasses it and mis-binds the G8 catalog↔Layer-2 +1 numbering offset onto a NEIGHBOUR
        # lesson's keypoints/title (e.g. display G8-L4 玻璃娃娃 wrongly pulled G8-L4.yml 植物肉;
        # authority maps G8-L4→G8-L5=玻璃娃娃). Fix the mapping once, at the authority.
        display_code = story.get("grade_code")
        spot_code = adapter.normalize_manifest_code(str(spot.get("lesson") or display_code))
        parsed_code = (
            catalog_to_parsed_code(str(display_code)) if display_code else spot_code
        )
        parsed, parsed_kind = adapter.load_parsed(parsed_code)
        lesson_dict = adapter.assemble_lesson(
            spot,
            parsed,
            adapter.GapLog(),
            with_keypoints=True,
            parsed_source_kind=parsed_kind,
        )
        # Title authority: the display lesson's own title is what the student sees. Prefer it
        # over whatever the spotlight/parsed carried (defensive against a spotlight that
        # declared a neighbour's title); fall back to the assembled title when absent.
        display_title = story.get("title")
        if display_title:
            lesson_dict["title"] = display_title

        # ── Honesty guard: never a silent 張冠李戴 green ──────────────────────────────────
        # If the spotlight's OWN declared identity (spot["lesson"]) resolves to a DIFFERENT
        # _parsed file than the display lesson's authoritative twin, the spotlight SOURCE (its
        # passages + exercise) was authored against a different lesson than the one displayed —
        # its BODY may be a neighbour's (a pre-existing spotlight_v2 mis-map this refactor does
        # NOT silently paper over). Flag every exercise block needs_review so the renderer shows
        # 「需人工檢核」 instead of a clean green. Content-verified corpus-wide: fires on EXACTLY
        # the G8 catalog↔Layer-2 offset lessons, 0 false positives on aligned ones.
        spot_parsed_path, _ = adapter.resolve_parsed_source(spot_code)
        auth_parsed_path, _ = adapter.resolve_parsed_source(parsed_code)
        if (
            spot_parsed_path is not None
            and auth_parsed_path is not None
            and spot_parsed_path != auth_parsed_path
        ):
            for blk in lesson_dict.get("blocks", []):
                if isinstance(blk, dict) and blk.get("type") == "exercise":
                    blk["needs_review"] = True

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
