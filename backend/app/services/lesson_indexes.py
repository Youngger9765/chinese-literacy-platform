"""
Lesson in-memory indexes: build and expose the singleton lesson collections.

Extracted from lesson_loader.py (Issue #1889).

Public API:
    build_all_lessons()  — load + merge + sort all lessons from both layers
    build_indexes()      — construct all lookup dicts from a lesson list

These are called once at module load time by lesson_loader.py (and directly
by tests that need to verify index construction in isolation).
"""

from app.services.lesson_layer_loaders import (
    ENRICHMENT_FIELDS,
    load_curriculum_manifest,
    load_layer1_lessons,
    load_layer2_lessons,
    build_layer2_enrichment_index,
)
from app.services.content_mapping_registry import get_story_structure_override
from app.services.spotlight_figure_images import merge_spotlight_images
from app.services.spotlight_v2_loader import load_spotlight_v2


def _reapply_spotlight_images(lesson: dict) -> None:
    """Layer-2 enrichment overwrites images[] — re-merge spotlight figure assets."""
    code = lesson.get("lesson_code") or lesson.get("grade_code") or ""
    spotlight_v2 = lesson.get("spotlight_v2") or load_spotlight_v2(code, lesson.get("title"))
    if not spotlight_v2:
        return
    lesson["spotlight_v2"] = spotlight_v2
    lesson["images"] = merge_spotlight_images(lesson.get("images") or [], spotlight_v2)


def build_all_lessons() -> list[dict]:
    """Load all lessons from both layers and return sorted by display_order / lesson_number.

    Merge strategy:
      1. Load Layer-1 (L*.yml, 57 lessons with integer IDs 1-57)
      2. Load Layer-2 (_parsed_2026-05-01/*.yml, deduped by title)
      3. Enrich Layer-1 entries with truthy fields from matching Layer-2 parsed files
      4. Sort: Layer-1 by lesson_number, Layer-2 by display_order
    """
    manifest_index = load_curriculum_manifest()

    # Layer 1: existing production L*.yml
    layer1 = load_layer1_lessons()
    layer1_titles = {lesson["title"] for lesson in layer1}

    # Layer 2: new parsed lessons (title-deduped against Layer-1)
    layer2 = load_layer2_lessons(manifest_index, layer1_titles)

    # Merge Layer-2 enrichment into Layer-1 entries with matching title (#1666).
    #
    # Problem: when a curriculum slot has BOTH a Layer-1 L*.yml (legacy, no
    # step_sequence) AND a Layer-2 _parsed_/G*-L*.yml (new SOT with
    # step_sequence + worksheet_* + lesson_intro + layout_mode), load_layer2_lessons()
    # skips the Layer-2 entry on title match to avoid duplicate cards. Result:
    # /api/stories/G6-L10 resolves to Layer-1 entry with step_sequence=null.
    #
    # Fix: build a title→Layer-2 lookup from _parsed_ files (regardless of
    # whether the Layer-2 entry was kept after dedup), then copy the enrichment
    # fields onto matching Layer-1 entries. Layer-1 keeps its id/lesson_number
    # /title/paragraphs (preserves DB Text FK + session.story_slug back-compat).
    layer2_by_title = build_layer2_enrichment_index()

    for lesson in layer1:
        l2_data = layer2_by_title.get(lesson["title"])
        if not l2_data:
            continue
        for field in ENRICHMENT_FIELDS:
            l2_value = l2_data.get(field)
            # strategy_exercise: Layer-2 may use plural key (legacy G7 圖文整合)
            if field == "strategy_exercise" and l2_value is None:
                l2_value = l2_data.get("strategy_exercises")
            if l2_value:  # only override when Layer-2 has a truthy value
                lesson[field] = l2_value

        structure_override = get_story_structure_override(
            lesson.get("lesson_code") or lesson.get("grade_code") or "",
            lesson.get("title"),
        )
        if structure_override:
            lesson["story_structure_table"] = None
            lesson["story_structure_rows"] = structure_override.get("rows")

        _reapply_spotlight_images(lesson)

    all_lessons = layer1 + layer2

    # Sort: Layer-1 by lesson_number, Layer-2 by display_order, then mix.
    # Use display_order from manifest for Layer-2; for Layer-1 use lesson_number as proxy.
    def sort_key(lesson: dict) -> tuple[int, int]:
        if lesson["_layer"] == 1:
            # Layer-1 lessons map to curriculum display_order via manifest.
            # For simplicity, sort them by lesson_number (1-57) at the front.
            return (0, lesson["lesson_number"])
        else:
            return (1, lesson.get("display_order", 9999))

    all_lessons.sort(key=sort_key)
    return all_lessons


def build_indexes(all_lessons: list[dict]) -> tuple[
    dict[int, dict],
    dict[str, dict],
    dict[str, dict],
    list[int],
]:
    """Build all lookup indexes from the full lesson list.

    Returns:
        lessons_by_id    — {id: lesson}
        lessons_by_code  — {lesson_code: lesson}
        lessons_by_title — {title: lesson}
        available_grades — sorted list of unique grade ints
    """
    lessons_by_id: dict[int, dict] = {l["id"]: l for l in all_lessons}
    lessons_by_code: dict[str, dict] = {
        l["lesson_code"]: l for l in all_lessons if l.get("lesson_code")
    }
    lessons_by_title: dict[str, dict] = {l["title"]: l for l in all_lessons}
    available_grades: list[int] = sorted({l["grade"] for l in all_lessons})
    return lessons_by_id, lessons_by_code, lessons_by_title, available_grades
