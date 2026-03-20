"""
Platform lesson loader — reads YAML files at import time into memory.

Usage:
    from app.services.lesson_loader import get_all_lessons, get_lessons_by_grade, get_lesson_by_id
"""

from pathlib import Path
from typing import Any

import yaml


_LESSONS_DIR = Path(__file__).parent.parent.parent / "data" / "lessons"

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


def _load_lessons() -> list[dict]:
    """Load all YAML lesson files, sorted by lesson_number."""
    lessons = []

    if not _LESSONS_DIR.exists():
        return lessons

    for yml_path in sorted(_LESSONS_DIR.glob("*.yml")):
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
            "thumbnail_url": f"https://storage.googleapis.com/lingoleap-assets/stories/thumbnails/lesson-{data['lesson_number']}.webp",
            "vocabulary": data.get("vocabulary"),
            "fill_in_blank": data.get("fill_in_blank"),
            "multiple_choice": data.get("multiple_choice"),
            "vocab_bank": data.get("vocab_bank"),
            "reading_benchmark": data.get("reading_benchmark"),
            "source_file": data.get("source_file"),
            "intro": _build_intro(data),
        }
        lessons.append(lesson)

    lessons.sort(key=lambda x: x["lesson_number"])
    return lessons


# Load once at import time
_ALL_LESSONS: list[dict] = _load_lessons()
_LESSONS_BY_ID: dict[int, dict] = {l["id"]: l for l in _ALL_LESSONS}
_AVAILABLE_GRADES: list[int] = sorted({l["grade"] for l in _ALL_LESSONS})


def get_all_lessons() -> list[dict]:
    return _ALL_LESSONS


def get_lessons_by_grade(grade: int) -> list[dict]:
    return [l for l in _ALL_LESSONS if l["grade"] == grade]


def get_lesson_by_id(lesson_id: int) -> dict | None:
    return _LESSONS_BY_ID.get(lesson_id)


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
