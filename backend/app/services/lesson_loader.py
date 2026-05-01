"""
Platform lesson loader — reads YAML files at import time into memory.

Two data layers (as of 2026-05-01):
  Layer 1 (production): backend/data/lessons/L*.yml  — 57 lessons, integer lesson_number
  Layer 2 (new):        backend/data/lessons/_parsed_2026-05-01/*.yml — 151 lessons, lesson_code only
  Metadata overlay:     backend/data/curriculum/manifest.yml — 158 lessons, display_order + strategy

Layer-2 lessons get synthetic integer IDs: curriculum display_order + 1000
  (e.g. display_order=1 → id=1001)

Layer-1 lessons with an existing L*.yml are loaded as-is and take precedence
over Layer-2 when both cover the same curriculum slot.

Multi-lesson YAML edge cases (one YAML covers multiple curriculum slots):
  G4-L20-22.yml → covers G4-L20, G4-L21, G4-L22 (expose as G4-L20 only)
  G5-L24-25.yml → covers G5-L24, G5-L25 (expose as G5-L24 only)
  G9-L15-16.yml → covers G9-L15, G9-L16 (expose as G9-L15 only)
  G9-L17-19.yml → covers G9-L17, G9-L18, G9-L19 (expose as G9-L17 only)

a/b suffix YAML edge cases (one YAML covers two curriculum a/b slots):
  G8-L3.yml → covers G8-L3a + G8-L3b (expose as G8-L3a only)
  G8-L6.yml → covers G8-L6a + G8-L6b (expose as G8-L6a only)
  G8-L9.yml → covers G8-L9a + G8-L9b (expose as G8-L9a only)
  G8-L12.yml → covers G8-L12a + G8-L12b (expose as G8-L12a only)

Usage:
    from app.services.lesson_loader import get_all_lessons, get_lessons_by_grade, get_lesson_by_id
"""

import re
from pathlib import Path

import yaml


_LESSONS_DIR = Path(__file__).parent.parent.parent / "data" / "lessons"
_PARSED_DIR = _LESSONS_DIR / "_parsed_2026-05-01"
_CURRICULUM_MANIFEST = Path(__file__).parent.parent.parent / "data" / "curriculum" / "manifest.yml"

# Offset added to curriculum display_order to generate synthetic integer IDs
# for Layer-2 lessons (avoids collision with Layer-1 ids 1–57).
_LAYER2_ID_OFFSET = 1000


def _halfwidth(code: str) -> str:
    """Convert fullwidth ASCII letters (Ａ-Ｚ, ａ-ｚ) to halfwidth (A-Z, a-z).

    YAML fill_in_blank answers are sometimes typed as fullwidth (Ａ, Ｂ…)
    while vocab_bank keys are always halfwidth (A, B…), causing mismatches.
    """
    return "".join(
        chr(ord(c) - 0xFEE0) if 0xFF01 <= ord(c) <= 0xFF5E else c
        for c in (code or "")
    )


_GENRE_TO_CATEGORY = {
    "記敘文": "Fable",
    "說明文": "Science",
    "説明文": "Science",
    "議論文": "History",
    "文言文": "History",
    "應用文": "Daily",
}


def _build_intro(lesson: dict) -> dict:
    """Replicate frontend lessonLoader.ts intro construction."""
    genre = lesson.get("genre", "")
    strategy = lesson.get("reading_strategy")

    author = genre
    if strategy and strategy != "無":
        author = f"{genre} · {strategy}"

    paragraphs = lesson.get("paragraphs", [])
    background = ""
    if paragraphs:
        p = paragraphs[0]
        background = p[:100] + "..." if len(p) > 100 else p

    return {"author": author, "background": background}


def _normalize_manifest_code(code: str) -> str:
    """Normalize curriculum manifest lesson_code to match _parsed/*.yml lesson_code format.

    Examples:
        G4-L01  -> G4-L1
        G4-L03a -> G4-L3a
        WW-L01  -> 文-L1
    """
    if code.startswith("WW-"):
        m = re.search(r"L(\d+)", code)
        if m:
            return f"文-L{int(m.group(1))}"
        return code
    m = re.match(r"(G\d+)-L(\d+)(.*)", code)
    if m:
        grade_part = m.group(1)
        num = int(m.group(2))
        suffix = m.group(3)  # '', 'a', 'b'
        return f"{grade_part}-L{num}{suffix}"
    return code


# Curriculum slots that are covered by a multi-lesson YAML.
#
# Primary slots: curriculum code → compound lesson_code in parsed YAML
#   (these are loaded and exposed under the primary curriculum code)
# Secondary slots: curriculum code → compound lesson_code in parsed YAML
#   (these are skipped — content is accessible via the primary slot)
_MULTI_LESSON_PRIMARY: dict[str, str] = {
    "G4-L20": "G4-L20-22",
    "G5-L24": "G5-L24-25",
    "G9-L15": "G9-L15-16",
    "G9-L17": "G9-L17-19",
}

_MULTI_LESSON_MAP: dict[str, str] = {
    "G4-L21": "G4-L20-22",
    "G4-L22": "G4-L20-22",
    "G5-L25": "G5-L24-25",
    "G9-L16": "G9-L15-16",
    "G9-L18": "G9-L17-19",
    "G9-L19": "G9-L17-19",
}

# Curriculum a/b slots that share a single parsed YAML (without the suffix).
# Key: normalized curriculum code (e.g. "G8-L3b")
# Value: parsed lesson_code (e.g. "G8-L3a") that is the primary exposed lesson
_AB_SECONDARY_MAP: dict[str, str] = {
    "G8-L3b": "G8-L3a",
    "G8-L6b": "G8-L6a",
    "G8-L9b": "G8-L9a",
    "G8-L12b": "G8-L12a",
}


def _load_curriculum_manifest() -> dict[str, dict]:
    """Load curriculum/manifest.yml and return a dict keyed by normalized lesson_code.

    Returns {} if the manifest file does not exist.
    """
    if not _CURRICULUM_MANIFEST.exists():
        return {}

    with open(_CURRICULUM_MANIFEST, "r", encoding="utf-8") as f:
        manifest = yaml.safe_load(f)

    index: dict[str, dict] = {}
    for entry in manifest.get("lessons", []):
        norm_code = _normalize_manifest_code(entry["lesson_code"])
        index[norm_code] = entry
    return index


def _load_layer1_lessons() -> list[dict]:
    """Load existing production lessons: backend/data/lessons/L*.yml

    These have integer lesson_number fields and form the original 57-lesson set.
    """
    lessons: list[dict] = []

    if not _LESSONS_DIR.exists():
        return lessons

    for yml_path in sorted(_LESSONS_DIR.glob("L*.yml")):
        with open(yml_path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)

        if not data or "lesson_number" not in data:
            continue

        genre = data.get("genre", "")
        strategy = data.get("reading_strategy")
        if strategy == "無":
            strategy = None

        lesson = {
            "id": data["lesson_number"],
            "lesson_number": data["lesson_number"],
            "lesson_code": data.get("grade_code", ""),  # e.g. "G4-1"
            "title": data["title"],
            "grade": data["grade"],
            "grade_code": data.get("grade_code", ""),
            "genre": genre,
            "text_type": data.get("text_type", "單"),
            "category": _GENRE_TO_CATEGORY.get(genre, "Daily"),
            "reading_strategy": strategy,
            "paragraphs": data.get("paragraphs", []),
            "full_text": data.get("story_text"),
            "char_count": data.get("char_count", 0),
            "thumbnail_url": (
                f"https://storage.googleapis.com/lingoleap-assets/stories/"
                f"thumbnails/lesson-{data['lesson_number']}.webp"
            ),
            "vocabulary": data.get("vocabulary") or [],
            "fill_in_blank": [
                {**item, "answer": _halfwidth(item.get("answer", ""))}
                for item in (data.get("fill_in_blank") or [])
            ] or None,
            "multiple_choice": data.get("multiple_choice"),
            "vocab_bank": data.get("vocab_bank"),
            "knowledge_video_url": data.get("knowledge_video_url"),
            "reading_benchmark": data.get("reading_benchmark"),
            "source_file": data.get("source_file"),
            "strategy_exercise": data.get("strategy_exercise"),
            # Schema-driven step composition (#1374): pass through if present in YAML.
            # None (absent) means frontend uses DEFAULT_STEP_SEQUENCE.
            "step_sequence": data.get("step_sequence") or None,
            "story_structure_table": data.get("story_structure_table"),
            "story_structure_rows": data.get("story_structure_rows"),
            "intro": _build_intro(data),
            "_layer": 1,
        }
        lessons.append(lesson)

    return lessons


def _load_layer2_lessons(
    manifest_index: dict[str, dict],
    layer1_titles: set[str],
) -> list[dict]:
    """Load new parsed lessons from _parsed_2026-05-01/*.yml.

    Assigns synthetic integer IDs using curriculum display_order + _LAYER2_ID_OFFSET.
    Skips lessons whose title already appears in Layer-1 (dedup).
    Skips secondary multi-lesson and a/b slots (only the primary is exposed).
    """
    if not _PARSED_DIR.exists():
        return []

    # Build index: parsed lesson_code -> (data, path)
    parsed_index: dict[str, tuple[dict, Path]] = {}
    for yml_path in _PARSED_DIR.glob("*.yml"):
        with open(yml_path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)
        if data and data.get("lesson_code"):
            parsed_index[data["lesson_code"]] = (data, yml_path)

    lessons: list[dict] = []

    for norm_code, meta in manifest_index.items():
        # Skip secondary multi-lesson slots (covered by the primary)
        if norm_code in _MULTI_LESSON_MAP:
            continue
        # Skip secondary a/b slots (covered by the primary a-slot)
        if norm_code in _AB_SECONDARY_MAP:
            continue

        # Resolve which parsed YAML handles this curriculum slot
        parsed_code = norm_code

        # Multi-lesson primary: curriculum code → compound parsed YAML code
        if norm_code in _MULTI_LESSON_PRIMARY:
            parsed_code = _MULTI_LESSON_PRIMARY[norm_code]

        if parsed_code not in parsed_index:
            # For a/b primary slots (e.g. G8-L3a), the parsed file is G8-L3 (no suffix)
            # Try stripping trailing 'a' suffix → base code (e.g. G8-L3a → G8-L3)
            base_code = re.sub(r"a$", "", parsed_code)
            if base_code != parsed_code and base_code in parsed_index:
                parsed_code = base_code
            else:
                # No parsed YAML available (e.g. G7-L31)
                continue

        data, _ = parsed_index[parsed_code]

        # Deduplicate: if title already in Layer-1, skip
        title = data.get("title", "")
        if title in layer1_titles:
            continue

        display_order = meta.get("display_order", 0)
        lesson_id = _LAYER2_ID_OFFSET + display_order

        genre = data.get("genre", "")
        strategy = data.get("reading_strategy") or meta.get("strategy_name")
        if strategy in ("", "無", "general"):
            strategy = None

        # Grade: use manifest grade (authoritative). Parsed grade=0 for 文言文 → map to 8
        grade = meta.get("grade") or data.get("grade") or 0
        if grade == 0:
            grade = 8  # 文言文 is pitched at G8 per curriculum

        # Vocabulary: parsed YAML may have empty list for 文言文/graphic-text → keep as empty list
        vocabulary = data.get("vocabulary") or []

        # Video links: prefer manifest (has cleaned URLs), fall back to parsed
        video_links = meta.get("video_links") or data.get("video_links")

        lesson = {
            "id": lesson_id,
            "lesson_number": lesson_id,  # kept for backward compat with schemas
            "lesson_code": norm_code,
            "title": title,
            "grade": grade,
            "grade_code": norm_code,
            "genre": genre,
            "text_type": data.get("text_type") or meta.get("text_type") or "單",
            "category": _GENRE_TO_CATEGORY.get(genre, "Daily"),
            "reading_strategy": strategy,
            "paragraphs": data.get("paragraphs", []),
            "full_text": data.get("story_text"),
            "char_count": data.get("char_count", 0),
            "thumbnail_url": (
                f"https://storage.googleapis.com/lingoleap-assets/stories/"
                f"thumbnails/{norm_code}.webp"
            ),
            "vocabulary": vocabulary,
            "fill_in_blank": [
                {**item, "answer": _halfwidth(item.get("answer", ""))}
                for item in (data.get("fill_in_blank") or [])
            ] or None,
            "multiple_choice": data.get("multiple_choice"),
            "vocab_bank": data.get("vocab_bank"),
            "knowledge_video_url": (
                video_links[0].get("url") if video_links else None
            ),
            "reading_benchmark": data.get("reading_benchmark"),
            "source_file": data.get("source_file"),
            "strategy_exercise": data.get("strategy_exercises"),  # note: parsed key differs
            "story_structure_table": data.get("story_structure_table"),
            "story_structure_rows": data.get("story_structure_rows"),
            "display_order": display_order,
            # Schema-driven step composition (#1374): pass through if present in YAML.
            # None (absent) means frontend uses DEFAULT_STEP_SEQUENCE.
            "step_sequence": data.get("step_sequence") or None,
            "intro": _build_intro({**data, "reading_strategy": strategy}),
            "_layer": 2,
        }
        lessons.append(lesson)

    return lessons


def _load_lessons() -> list[dict]:
    """Load all lessons from both layers and return sorted by display_order / lesson_number."""
    manifest_index = _load_curriculum_manifest()

    # Layer 1: existing production L*.yml
    layer1 = _load_layer1_lessons()
    layer1_titles = {l["title"] for l in layer1}

    # Layer 2: new parsed lessons
    layer2 = _load_layer2_lessons(manifest_index, layer1_titles)

    all_lessons = layer1 + layer2

    # Sort: Layer-1 by lesson_number, Layer-2 by display_order, then mix
    # Use display_order from manifest for Layer-2; for Layer-1 use lesson_number as proxy.
    def sort_key(lesson: dict) -> tuple[int, int]:
        if lesson["_layer"] == 1:
            # Layer-1 lessons map to curriculum display_order via manifest
            # For simplicity, sort them by lesson_number (1-57) at the front
            return (0, lesson["lesson_number"])
        else:
            return (1, lesson.get("display_order", 9999))

    all_lessons.sort(key=sort_key)
    return all_lessons


# Load once at import time
_ALL_LESSONS: list[dict] = _load_lessons()
_LESSONS_BY_ID: dict[int, dict] = {l["id"]: l for l in _ALL_LESSONS}
_LESSONS_BY_CODE: dict[str, dict] = {
    l["lesson_code"]: l for l in _ALL_LESSONS if l.get("lesson_code")
}
_LESSONS_BY_TITLE: dict[str, dict] = {l["title"]: l for l in _ALL_LESSONS}
_AVAILABLE_GRADES: list[int] = sorted({l["grade"] for l in _ALL_LESSONS})


def get_all_lessons() -> list[dict]:
    return _ALL_LESSONS


def get_lessons_by_grade(grade: int) -> list[dict]:
    return [l for l in _ALL_LESSONS if l["grade"] == grade]


def get_lesson_by_id(lesson_id: int) -> dict | None:
    return _LESSONS_BY_ID.get(lesson_id)


def get_lesson_by_title(title: str) -> dict | None:
    """Exact match lookup by lesson title. O(1) from pre-built index."""
    return _LESSONS_BY_TITLE.get(title)


def get_lesson_by_code(lesson_code: str) -> dict | None:
    """Lookup by lesson_code (e.g. 'G4-L1', 'G4-L01', '文-L3').

    Accepts both zero-padded (G4-L01) and non-zero-padded (G4-L1) forms.
    """
    lesson = _LESSONS_BY_CODE.get(lesson_code)
    if lesson:
        return lesson
    # Normalize zero-padded variant: G4-L01 → G4-L1
    normalized = _normalize_manifest_code(lesson_code)
    return _LESSONS_BY_CODE.get(normalized)


def get_available_grades() -> list[int]:
    return _AVAILABLE_GRADES


def search_lessons(
    grade: int | None = None,
    genre: str | None = None,
    category: str | None = None,
    search: str | None = None,
) -> list[dict]:
    """Filter lessons by criteria. All in-memory, no DB."""
    results = _ALL_LESSONS

    if grade is not None:
        results = [l for l in results if l["grade"] == grade]
    if genre:
        results = [l for l in results if l["genre"] == genre]
    if category:
        results = [l for l in results if l["category"] == category]
    if search:
        q = search.lower()
        results = [l for l in results if q in l["title"].lower()]

    return results
