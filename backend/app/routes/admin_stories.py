"""
Admin Story CRUD API — create, update, delete, and list stories stored as YAML files.

All endpoints require system_admin role.
"""

from pathlib import Path

import yaml
from fastapi import APIRouter, HTTPException, Depends

from ..auth.dependencies import require_role
from ..schemas.story import (
    StoryCreateRequest,
    StoryUpdateRequest,
    StoryAdminListItem,
    StoryAdminListResponse,
    StoryDetail,
    StoryIntroSchema,
    VocabItemSchema,
)
from ..services import lesson_loader
from ..services.input_sanitizer import sanitize_ai_input

router = APIRouter(tags=["admin-stories"])

_LESSONS_DIR = Path(__file__).parent.parent.parent / "data" / "lessons"

_GENRE_TO_CATEGORY = {
    "記敘文": "Fable",
    "說明文": "Science",
    "説明文": "Science",
    "議論文": "History",
    "文言文": "History",
    "應用文": "Daily",
}


def _lesson_path(lesson_number: int) -> Path:
    """On-disk file for a lesson, inside the uid tree.

    This wrote `data/lessons/L{n}.yml` — the first edition's flat layout, which
    `build_all_lessons()` no longer reads. The admin panel kept returning 201 and
    the story never appeared anywhere, which is the exact silent-success failure
    the re-ink set out to remove, reintroduced from the write side.

    `lesson_number` stays the external handle (it is what the admin URLs carry) and
    maps onto the uid the tree is keyed by. Lessons created here get `v1`: the
    extraction pipeline owns `v2`, and a hand-authored lesson must not look like
    one that came out of a second-edition worksheet.
    """
    uid = _uid_for(lesson_number)
    return _LESSONS_DIR / uid / "v1" / "lesson.yml"


def _tree_id(lesson_number: int) -> int:
    """lesson_number → the id the tree assigns (`20000 + n`), idempotent."""
    return lesson_number if lesson_number > 20000 else 20000 + lesson_number


#: A uid is `L` + exactly four digits — `lesson_uid_loader._is_uid_dir` checks the
#: name length, so `L19999` is not a uid, it is an unrecognised directory. That caps
#: the lesson_number this route can address.
MAX_LESSON_NUMBER = 9999


def _uid_for(lesson_number: int) -> str:
    """lesson_number → lesson_uid. The tree's ids are `20000 + int(uid[1:])`."""
    n = lesson_number - 20000 if lesson_number > 20000 else lesson_number
    return f"L{n:04d}"


def _require_addressable(lesson_number: int) -> None:
    """Reject a lesson_number the uid tree cannot represent.

    `f"L{n:04d}"` pads to four digits but does not truncate, so n=19999 produced
    `L19999` — five digits, which the loader's `len(name) == 5` check rejects as
    not-a-uid. The story was written to disk, the route returned 201, and it never
    appeared anywhere. Fail loudly at the boundary instead.
    """
    n = lesson_number - 20000 if lesson_number > 20000 else lesson_number
    if not (1 <= n <= MAX_LESSON_NUMBER):
        raise HTTPException(
            status_code=422,
            detail=(
                f"lesson_number {lesson_number} maps to L{n:04d}, which is outside the "
                f"uid format (L0001–L{MAX_LESSON_NUMBER:04d}); the lesson would be "
                "written but never loaded"
            ),
        )


def _build_yaml_dict(data: StoryCreateRequest, user_id: str | None = None) -> dict:
    """Convert a StoryCreateRequest to the YAML dict format used on disk."""
    # Sanitize text fields — story content is used in AI prompts
    safe_title, _ = sanitize_ai_input(data.title, user_id=user_id)
    safe_paragraphs = [sanitize_ai_input(p, user_id=user_id)[0] for p in data.paragraphs]
    full_text = "\n".join(safe_paragraphs)
    char_count = len(full_text.replace("\n", "").replace(" ", ""))

    # `lesson_uid` / `version_id` are what the tree loader keys on; without them it
    # treats the directory as half-written and skips it (fail-closed), so a created
    # story would be on disk and invisible — the failure this route just stopped having.
    doc: dict = {
        "lesson_uid": _uid_for(data.lesson_number),
        "version_id": "v1",
        "catalog_slot": data.grade_code,
        "lesson_number": data.lesson_number,
        "grade": data.grade,
        "grade_code": data.grade_code,
        "title": safe_title,
        "genre": data.genre,
        "text_type": data.text_type,
        "reading_strategy": data.reading_strategy or "無",
        "story_text": full_text,
        "paragraphs": safe_paragraphs,
        "paragraph_count": len(safe_paragraphs),
        "char_count": char_count,
    }
    if data.vocabulary:
        doc["vocabulary"] = [v.model_dump(exclude_none=True) for v in data.vocabulary]
        doc["vocabulary_count"] = len(data.vocabulary)
    if data.fill_in_blank:
        doc["fill_in_blank"] = data.fill_in_blank
    if data.multiple_choice:
        doc["multiple_choice"] = data.multiple_choice
        doc["multiple_choice_count"] = len(data.multiple_choice)
    if data.reading_benchmark:
        doc["reading_benchmark"] = data.reading_benchmark.model_dump()
    if data.source_file:
        doc["source_file"] = data.source_file
    doc["flags"] = []
    return doc


def _reload_lessons() -> None:
    """Reload in-memory lesson caches after a write operation.

    Two caches, not one. `lesson_loader` holds the built lesson list, but the uid
    loader underneath it memoises the directory scan and each parsed lesson with
    `lru_cache` — rebuilding the list without clearing those just re-reads the same
    memoised answer, so a newly written lesson stayed invisible until the process
    restarted.
    """
    from app.services import lesson_uid_loader

    lesson_uid_loader.reset_cache()
    lesson_loader._ALL_LESSONS = lesson_loader._load_lessons()
    lesson_loader._LESSONS_BY_ID = {l["id"]: l for l in lesson_loader._ALL_LESSONS}
    _g = {l["grade"] for l in lesson_loader._ALL_LESSONS if l.get("grade")}
    lesson_loader._AVAILABLE_GRADES = (
        sorted((x for x in _g if str(x).isdigit()), key=int)
        + sorted(x for x in _g if not str(x).isdigit())
    )


def _lesson_to_admin_item(lesson: dict) -> StoryAdminListItem:
    return StoryAdminListItem(
        lesson_number=lesson["lesson_number"],
        title=lesson["title"],
        grade=lesson["grade"],
        grade_code=lesson["grade_code"],
        genre=lesson["genre"],
        text_type=lesson.get("text_type", "單"),
        paragraph_count=len(lesson.get("paragraphs", [])),
        char_count=lesson.get("char_count", 0),
        reading_strategy=lesson.get("reading_strategy"),
        source_file=lesson.get("source_file"),
    )


def _lesson_to_story_detail(lesson: dict) -> StoryDetail:
    intro_data = lesson.get("intro", {"author": "", "background": ""})
    vocab_raw = lesson.get("vocabulary") or []
    vocab = [VocabItemSchema(**v) for v in vocab_raw] if vocab_raw else None

    from ..schemas.story import ReadingBenchmarkSchema, ReadingBenchmarkLevel
    rb_raw = lesson.get("reading_benchmark")
    reading_benchmark = None
    if rb_raw and isinstance(rb_raw, dict) and "levels" in rb_raw:
        levels = [ReadingBenchmarkLevel(**lv) for lv in rb_raw["levels"]]
        reading_benchmark = ReadingBenchmarkSchema(levels=levels)

    return StoryDetail(
        id=lesson["lesson_number"],
        lesson_number=lesson["lesson_number"],
        title=lesson["title"],
        grade=lesson["grade"],
        grade_code=lesson["grade_code"],
        genre=lesson["genre"],
        category=lesson.get("category", _GENRE_TO_CATEGORY.get(lesson["genre"], "Daily")),
        char_count=lesson.get("char_count", 0),
        thumbnail_url=lesson.get("thumbnail_url"),
        reading_strategy=lesson.get("reading_strategy"),
        intro=StoryIntroSchema(**intro_data) if intro_data else None,
        paragraphs=lesson.get("paragraphs", []),
        vocabulary=vocab,
        fill_in_blank=lesson.get("fill_in_blank"),
        multiple_choice=lesson.get("multiple_choice"),
        reading_benchmark=reading_benchmark,
        text_type=lesson.get("text_type", "單"),
        source_file=lesson.get("source_file"),
    )


# ── GET /api/admin/stories ───────────────────────────────────────────────────

@router.get(
    "/admin/stories",
    response_model=StoryAdminListResponse,
    dependencies=[require_role("system_admin")],
)
def list_admin_stories(
    search: str | None = None,
    grade: str | None = None,
):
    """List all stories with admin metadata. Supports search and grade filter.

    `grade` is a string: "4".."9" plus 文言文 and 品格教育. It was typed `int`, so
    the comparison against a string grade never matched — the filter returned an
    empty list for every year, and the two collections could not be filtered at all.
    """
    lessons = lesson_loader.get_all_lessons()
    if grade is not None:
        lessons = [l for l in lessons if str(l["grade"]) == str(grade)]
    if search:
        q = search.lower()
        lessons = [l for l in lessons if q in l["title"].lower()]
    return StoryAdminListResponse(
        stories=[_lesson_to_admin_item(l) for l in lessons],
        total=len(lessons),
    )


# ── GET /api/admin/stories/{lesson_number} ───────────────────────────────────

@router.get(
    "/admin/stories/{lesson_number}",
    response_model=StoryDetail,
    dependencies=[require_role("system_admin")],
)
def get_admin_story(lesson_number: int):
    """Get full story detail by lesson_number."""
    lesson = lesson_loader.get_lesson_by_id(_tree_id(lesson_number))
    if not lesson:
        raise HTTPException(status_code=404, detail="Story not found")
    return _lesson_to_story_detail(lesson)


# ── POST /api/admin/stories ──────────────────────────────────────────────────

@router.post(
    "/admin/stories",
    response_model=StoryAdminListItem,
    status_code=201,
    dependencies=[require_role("system_admin")],
)
def create_story(body: StoryCreateRequest):
    """Create a new story and write it to a YAML file.

    Validation:
    - lesson_number must be unique
    - title required (enforced by Pydantic min_length=1)
    - paragraphs must have at least 1 item (enforced by Pydantic min_length=1)
    """
    _require_addressable(body.lesson_number)
    yaml_path = _lesson_path(body.lesson_number)
    yaml_path.parent.mkdir(parents=True, exist_ok=True)
    if yaml_path.exists():
        raise HTTPException(
            status_code=409,
            detail=f"Story with lesson_number {body.lesson_number} already exists",
        )

    doc = _build_yaml_dict(body, user_id=None)
    with open(yaml_path, "w", encoding="utf-8") as f:
        yaml.dump(doc, f, allow_unicode=True, default_flow_style=False, sort_keys=False)

    _reload_lessons()

    lesson = lesson_loader.get_lesson_by_id(_tree_id(body.lesson_number))
    if lesson is None:
        # Written but not loadable — surface it instead of 500ing on the None below.
        raise HTTPException(
            status_code=500,
            detail=f"Story written to {yaml_path} but the loader did not pick it up",
        )
    return _lesson_to_admin_item(lesson)


# ── PUT /api/admin/stories/{lesson_number} ───────────────────────────────────

@router.put(
    "/admin/stories/{lesson_number}",
    response_model=StoryAdminListItem,
    dependencies=[require_role("system_admin")],
)
def update_story(lesson_number: int, body: StoryUpdateRequest):
    """Update an existing story's YAML file. Partial update — only provided fields overwrite."""
    yaml_path = _lesson_path(lesson_number)
    if not yaml_path.exists():
        raise HTTPException(status_code=404, detail="Story not found")

    with open(yaml_path, "r", encoding="utf-8") as f:
        doc = yaml.safe_load(f)

    # Apply partial updates (sanitize text fields that feed into AI prompts)
    if body.title is not None:
        safe_title, _ = sanitize_ai_input(body.title)
        doc["title"] = safe_title
    if body.grade is not None:
        doc["grade"] = body.grade
    if body.grade_code is not None:
        doc["grade_code"] = body.grade_code
    if body.genre is not None:
        doc["genre"] = body.genre
    if body.text_type is not None:
        doc["text_type"] = body.text_type
    if body.reading_strategy is not None:
        doc["reading_strategy"] = body.reading_strategy
    if body.source_file is not None:
        doc["source_file"] = body.source_file
    if body.paragraphs is not None:
        safe_paragraphs = [sanitize_ai_input(p)[0] for p in body.paragraphs]
        doc["paragraphs"] = safe_paragraphs
        doc["paragraph_count"] = len(safe_paragraphs)
        full_text = "\n".join(safe_paragraphs)
        doc["story_text"] = full_text
        doc["char_count"] = len(full_text.replace("\n", "").replace(" ", ""))
    if body.vocabulary is not None:
        doc["vocabulary"] = [v.model_dump(exclude_none=True) for v in body.vocabulary]
        doc["vocabulary_count"] = len(body.vocabulary)
    if body.fill_in_blank is not None:
        doc["fill_in_blank"] = body.fill_in_blank
    if body.multiple_choice is not None:
        doc["multiple_choice"] = body.multiple_choice
        doc["multiple_choice_count"] = len(body.multiple_choice)
    if body.reading_benchmark is not None:
        doc["reading_benchmark"] = body.reading_benchmark.model_dump()

    with open(yaml_path, "w", encoding="utf-8") as f:
        yaml.dump(doc, f, allow_unicode=True, default_flow_style=False, sort_keys=False)

    _reload_lessons()

    lesson = lesson_loader.get_lesson_by_id(_tree_id(lesson_number))
    return _lesson_to_admin_item(lesson)


# ── DELETE /api/admin/stories/{lesson_number} ────────────────────────────────

@router.delete(
    "/admin/stories/{lesson_number}",
    status_code=204,
    dependencies=[require_role("system_admin")],
)
def delete_story(lesson_number: int):
    """Archive (soft-delete) a story by moving its YAML file to data/lessons/archive/.

    The file is NOT permanently deleted — it is moved to an archive directory
    so it can be recovered if needed.
    """
    yaml_path = _lesson_path(lesson_number)
    if not yaml_path.exists():
        raise HTTPException(status_code=404, detail="Story not found")

    # Archive the whole uid directory, not the single YAML inside it. Under the flat
    # layout every lesson had a distinct filename (`L12.yml`); in the tree they are
    # all `<uid>/<version>/lesson.yml`, so moving the file alone put every deleted
    # lesson at `archive/lesson.yml` — the second delete would silently overwrite the
    # first one's only copy, and its spotlight/keypoints/assets would be left behind.
    uid_dir = _LESSONS_DIR / _uid_for(lesson_number)
    archive_dir = _LESSONS_DIR / "archive"
    archive_dir.mkdir(exist_ok=True)
    archive_path = archive_dir / uid_dir.name
    if archive_path.exists():
        raise HTTPException(
            status_code=409,
            detail=f"An archived copy of {uid_dir.name} already exists; "
                   "remove or rename it before archiving again",
        )
    uid_dir.rename(archive_path)

    _reload_lessons()
