"""OMO lesson catalog: dataclass, cache loading, story-id resolution, hint path.

Extracted from omo_identifier.py (#1886) — handles all catalog I/O and the
lesson hint path that bypasses AI identification.
"""

import logging
from dataclasses import dataclass, field
from pathlib import Path

import yaml

logger = logging.getLogger(__name__)

# Lesson metadata cache (loaded once at import)
_LESSON_CACHE: list[dict] = []

# Full curriculum title cache: {lesson_code -> {title, grade_code}} for all 158 lessons
# Used by fuzzy-match fallback (stdlib difflib, no extra deps)
_CURRICULUM_TITLE_CACHE: dict[str, dict] = {}


@dataclass
class LessonCandidate:
    lesson_id: int
    grade_code: str
    title: str
    confidence: float
    reasoning: str = field(default="")
    # #1775: canonical Story.id resolved at service boundary — None when grade_code
    # is not in lesson_loader (e.g. fallback content-only lessons without a DB row).
    story_id: int | None = field(default=None)


def _resolve_story_id(grade_code: str) -> int | None:
    """Resolve canonical Story.id from grade_code via lesson_loader.

    Called once per candidate at identifier output construction so callers
    receive story_id without needing to do a second lookup (#1775).
    Returns None when grade_code has no matching DB-loaded lesson.
    """
    try:
        from .lesson_loader import get_lesson_by_code
        story = get_lesson_by_code(grade_code)
        if story and story.get("id"):
            return int(story["id"])
    except Exception as exc:
        logger.debug("_resolve_story_id: grade_code=%r lookup failed: %s", grade_code, exc)
    return None


def _load_omo_lessons() -> list[dict]:
    """Load metadata for ALL lessons in the full curriculum catalog.

    Source priority:
    1. backend/data/curriculum/lessons/G*-L*.yml — 158 catalog entries (lesson_code, title, vocab, strategy_name)
    2. Fallback: backend/data/lessons/L*.yml — 57 content lessons with story_text (for any lessons not in catalog)

    Catalog entries provide title + vocab only (no story_text). Content lessons additionally provide story snippet.
    """
    global _LESSON_CACHE
    if _LESSON_CACHE:
        return _LESSON_CACHE

    base_dir = Path(__file__).parent.parent.parent / "data"
    catalog_dir = base_dir / "curriculum" / "lessons"
    content_dir = base_dir / "lessons"

    # Build content lookup by title (to enrich catalog entries with story_text)
    content_by_title = {}
    for yml_path in content_dir.glob("L*.yml"):
        try:
            with open(yml_path, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f) or {}
            title = (data.get("title", "") or "").lstrip("-").strip()
            if title:
                content_by_title[title] = data
        except Exception:
            continue

    result = []
    # 1) Catalog scan (preferred — 158 lessons)
    for yml_path in sorted(catalog_dir.glob("G*-L*.yml")):
        try:
            with open(yml_path, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f) or {}
            title = (data.get("title", "") or "").strip()
            if not title:
                continue
            lesson_code = data.get("lesson_code", yml_path.stem)
            # Use lesson_code hash for lesson_id (stable int per lesson_code)
            # Or parse from order field
            lesson_id = data.get("display_order") or data.get("original_order") or 0
            vocab_list = data.get("vocab") or []
            # Enrich with story snippet if content YAML exists
            story_snippet = ""
            content_data = content_by_title.get(title)
            if content_data:
                story_snippet = (content_data.get("story_text", "") or "")[:120]
            result.append({
                "lesson_id": int(lesson_id) if lesson_id else 0,
                "lesson_code": lesson_code,
                "grade_code": lesson_code,
                "title": title,
                "story_snippet": story_snippet,
                "vocabulary": [str(v) for v in vocab_list[:5]],
            })
        except Exception as exc:
            logger.warning("Failed to load OMO catalog %s: %s", yml_path.name, exc)

    # 2) Add any content-only lessons not in catalog (rare)
    catalog_titles = {r["title"] for r in result}
    for yml_path in content_dir.glob("L*.yml"):
        try:
            with open(yml_path, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f) or {}
            title = (data.get("title", "") or "").lstrip("-").strip()
            if not title or title in catalog_titles:
                continue
            stem = yml_path.stem
            try:
                lesson_id = int(stem[1:])
            except ValueError:
                continue
            result.append({
                "lesson_id": lesson_id,
                "lesson_code": data.get("grade_code", f"L{lesson_id}"),
                "grade_code": data.get("grade_code", f"L{lesson_id}"),
                "title": title,
                "story_snippet": (data.get("story_text", "") or "")[:120],
                "vocabulary": [
                    v.get("word", "") for v in (data.get("vocabulary") or [])[:5]
                ],
            })
        except Exception as exc:
            logger.warning("Failed to load fallback content lesson %s: %s", yml_path.name, exc)

    _LESSON_CACHE = result
    logger.info("Loaded %d OMO lesson entries (curriculum catalog + content fallback)", len(result))
    return result


def _load_curriculum_titles() -> dict[str, dict]:
    """Load all curriculum lesson titles for fuzzy-match fallback.

    Returns a dict of {lesson_code: {"title": str, "grade_code": str}} for all
    lessons in backend/data/curriculum/lessons/*.yml.  Cached after first call.
    Uses stdlib only (no extra deps).
    """
    global _CURRICULUM_TITLE_CACHE
    if _CURRICULUM_TITLE_CACHE:
        return _CURRICULUM_TITLE_CACHE

    curriculum_dir = Path(__file__).parent.parent.parent / "data" / "curriculum" / "lessons"
    if not curriculum_dir.exists():
        logger.warning("Curriculum lessons dir not found: %s", curriculum_dir)
        return {}

    result: dict[str, dict] = {}
    for yml_path in curriculum_dir.glob("*.yml"):
        lesson_code = yml_path.stem  # e.g. "G5-L25"
        try:
            with open(yml_path, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f)
            title = (data.get("title") or "").lstrip("-").strip()
            grade_code = data.get("lesson_code") or lesson_code
            if title:
                result[lesson_code] = {"title": title, "grade_code": grade_code}
        except Exception as exc:
            logger.warning("Failed to load curriculum lesson %s: %s", lesson_code, exc)

    _CURRICULUM_TITLE_CACHE = result
    logger.info("Loaded %d curriculum titles for fuzzy-match fallback", len(result))
    return result


def identify_lesson_from_hint(lesson_code: str) -> list[LessonCandidate]:
    """Resolve a lesson by its known lesson_code (hint path — skips AI fuzzy match).

    Used when the student uploads from within a lesson reading page, so the
    system already knows which lesson they're working on.  The upload route
    uses this function when ``lesson_code_hint`` is provided in the request,
    saving ~6-24 s of Vertex AI latency and ~$0.0003 per call.

    Args:
        lesson_code: Canonical lesson code from the YAML catalog (e.g. "G5-L25").

    Returns:
        A single LessonCandidate with confidence=1.0, or [] if the code is not
        found in the curriculum catalog.
    """
    curriculum = _load_curriculum_titles()
    if not curriculum:
        logger.warning("identify_lesson_from_hint: curriculum cache empty")
        return []

    info = curriculum.get(lesson_code)
    if not info:
        logger.warning(
            "identify_lesson_from_hint: lesson_code=%r not found in catalog", lesson_code
        )
        return []

    try:
        lesson_id = int(lesson_code.split("-L")[1])
    except (IndexError, ValueError):
        lesson_id = 0

    logger.info(
        "identify_lesson_from_hint: lesson_code=%r → id=%d title=%r (hint path, no AI call)",
        lesson_code,
        lesson_id,
        info["title"],
    )
    resolved_grade_code = info["grade_code"]
    return [
        LessonCandidate(
            lesson_id=lesson_id,
            grade_code=resolved_grade_code,
            title=info["title"],
            confidence=1.0,
            reasoning="user-provided lesson hint (課文頁面內上傳)",
            story_id=_resolve_story_id(resolved_grade_code),
        )
    ]
