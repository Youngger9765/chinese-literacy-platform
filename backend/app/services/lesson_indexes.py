"""
Lesson in-memory indexes: build and expose the singleton lesson collections.

Extracted from lesson_loader.py (Issue #1889).

Public API:
    build_all_lessons()  — load + merge + sort all lessons from both layers
    build_indexes()      — construct all lookup dicts from a lesson list

These are called once at module load time by lesson_loader.py (and directly
by tests that need to verify index construction in isolation).
"""

import os
import re

from app.services.lesson_layer_loaders import (
    ENRICHMENT_FIELDS,
    load_curriculum_manifest,
    load_layer1_lessons,
    load_layer2_lessons,
    build_layer2_enrichment_index,
)
from app.services.spotlight_figure_images import merge_spotlight_images
from app.services.spotlight_v2_loader import (
    load_spotlight_v2,
    should_suppress_legacy_strategy_exercise,
)


def _reapply_spotlight_images(lesson: dict) -> None:
    """Layer-2 enrichment overwrites images[] — re-merge spotlight figure assets."""
    code = lesson.get("lesson_code") or lesson.get("grade_code") or ""
    spotlight_v2 = lesson.get("spotlight_v2") or load_spotlight_v2(code, lesson.get("title"))
    if not spotlight_v2:
        return
    lesson["spotlight_v2"] = spotlight_v2
    lesson["images"] = merge_spotlight_images(lesson.get("images") or [], spotlight_v2)


def _thumbnail_name(uid: str, version_id: str | None) -> str | None:
    """The cover file for a lesson, or None.

    All covers are 400×300 WebP — the first edition's spec, kept because it is the
    size the library card actually renders. Newly generated art arrives as ~1.4 MB
    PNG from the model and is converted on the way in: 69 of those would have put
    99 MB of images into the repository for pictures displayed at 400 px wide.
    """
    from pathlib import Path

    root = Path(__file__).resolve().parent.parent.parent / "data" / "lessons" / uid
    if not version_id:
        vs = sorted((c.name for c in root.iterdir()
                     if c.is_dir() and c.name.startswith("v"))) if root.is_dir() else []
        version_id = vs[-1] if vs else None
    if not version_id:
        return None
    return "thumbnail.webp" if (root / version_id / "assets" / "thumbnail.webp").is_file() else None


def _uid_tree_lessons() -> list[dict]:
    """Second-edition lessons from the uid tree (#2687/#2692).

    Returns [] when the tree is absent, so this is a no-op on any checkout that
    has not run the extraction yet. Shaped to look like the existing lesson
    dicts so downstream code needs no change during the dual-path window.
    """
    try:
        from app.services.keypoints_to_structure import keypoints_to_structure_table
        from app.services.lesson_uid_loader import load_all as _load_uid_all
    except Exception:
        return []
    out = []
    for i, l in enumerate(_load_uid_all(), start=1):
        uid = l["lesson_uid"]
        code = l.get("catalog_slot") or ""
        # `grade` is the single classification axis the library filters on, and
        # it is a STRING, not a year number: "4".."9" plus 文言文 and 品格教育.
        #
        # 文-L2 / 體-L6 carry no year in their filename because they are not a
        # year — they are standalone collections. Modelling them as a separate
        # `track` field forced every caller to handle two axes; modelling them as
        # a fake grade number (90/91) would have been inventing data. Making the
        # axis a string lets one filter cover all eight categories.
        m = re.match(r"^G(\d+)-", code or "")
        if m:
            grade = m.group(1)
        elif code.startswith("文"):
            grade = "文言文"
        elif code.startswith("體"):
            grade = "品格教育"      # 檔名寫的是「品格力」，非「品德」
        else:
            grade = ""
        # Fields the extraction pipeline does not produce, so they default empty —
        # but a lesson.yml may carry them (the admin editor writes a full record, and
        # future pipeline versions will too). Anything present on disk wins over the
        # default: hardcoding these meant an admin could save a story and get back a
        # row with its genre and paragraphs blanked, with no error anywhere.
        row = {
            # 20000+ keeps these clear of Layer-1 (1-57) and Layer-2 (1000+)
            # during the dual-path window; Phase 5 drops the other two and the
            # uid becomes the only identity.
            "id": 20000 + int(uid[1:]),
            "lesson_uid": uid,
            "version_id": l.get("version_id"),
            "lesson_number": 20000 + int(uid[1:]),
            "grade_code": code,
            # `build_indexes` keys the by-code lookup on `lesson_code`, and the tree
            # rows only carried `grade_code` — so `_LESSONS_BY_CODE` built empty and
            # `get_lesson_by_code` returned None for every code in the catalogue,
            # silently. The two names are the same value; the older loaders set both.
            "lesson_code": code,
            "grade": grade,
            "title": l.get("title"),
            # fields the API schema expects; the uid tree has no genre/category
            # taxonomy yet, so they stay empty rather than being invented.
            "genre": "",
            "category": "",
            "char_count": (l.get("body") or {}).get("char_count") or 0,
            # Served from the uid tree, so the image is addressed by the lesson's
            # identity rather than its catalogue position. Under the first edition
            # covers were keyed by code; the renumber pointed every one of them at a
            # different story (verified: G4-L10's bus interior against 《十秒的背後》).
            "thumbnail_url": (
                f"/assets/lesson/{uid}/{_thumbnail_name(uid, l.get('version_id'))}"
                if _thumbnail_name(uid, l.get("version_id")) else None
            ),
            "reading_strategy": None,
            "has_key_reading": False,
            "intro": None,
            # 課文本體, extracted from the DOCX section the worksheet calls
            # 讀全文-做記號 (#2683). It was absent for all 175 lessons because the
            # pipeline read paragraphs back out of the layer the re-ink deleted —
            # which left 朗讀 / 閱讀理解 / 生字 / 造句 with no text to work on and
            # 「參考課文」 blank beside the keypoints table.
            "paragraphs": (l.get("body") or {}).get("paragraphs") or [],
            # StoryDetail indexes these directly. The second-edition extraction
            # produces spotlight + keypoints; the remaining practice modules are
            # not yet extracted, so they are present-but-empty rather than absent
            # (absent would 500 the detail route, empty renders as "no exercise").
            "vocabulary": None,
            "fill_in_blank": None,
            "multiple_choice": None,
            "reading_benchmark": None,
            "text_type": "單",
            "source_file": None,
            "spotlight_v2": (l.get("spotlight") or {}).get("spotlight"),
            "keypoints": (l.get("keypoints") or {}).get("keypoints"),
            # The 重點表 step reads `story_structure_table` off the story and asks an
            # LLM to invent one when it is absent. The second-edition pipeline emits
            # the same table already structured, so convert rather than regenerate —
            # an AI-written table is not the one the teacher authored.
            "story_structure_table": keypoints_to_structure_table(l.get("keypoints")),
            "assets": l.get("assets") or [],
            "source": "uid_tree",
        }
        # Overlay what lesson.yml actually carries. Identity stays computed — a
        # lesson must never be able to rename its own uid or id from its payload.
        _IDENTITY = {"id", "lesson_uid", "version_id", "grade", "assets", "source",
                     "spotlight_v2", "keypoints", "story_structure_table"}
        for k, v in l.items():
            if k in _IDENTITY or v in (None, "", [], {}):
                continue
            if k in row:
                row[k] = v
        out.append(row)
    return out


def build_all_lessons() -> list[dict]:
    """All lessons, from the uid tree.

    The two historical layers (`L*.yml` hand-built 2026-02 and
    `_parsed_2026-05-01/` batch-parsed 2026-05) were deleted in the second-edition
    re-ink. They were merged on *title*, which silently produced empty shells
    whenever a title drifted by one punctuation mark, and duplicated 26 lessons
    across the two layers. Identity is now the directory name under
    `backend/data/lessons/<lesson_uid>/<version_id>/` and nothing else.
    """
    return _uid_tree_lessons()

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
    # Years first in numeric order, then the named collections.
    _g = {l["grade"] for l in all_lessons if l.get("grade")}
    available_grades: list[str] = (
        sorted((x for x in _g if x.isdigit()), key=int) + sorted(x for x in _g if not x.isdigit())
    )
    return lessons_by_id, lessons_by_code, lessons_by_title, available_grades
