"""
Assignment query helpers — title / slug resolution utilities.

Extracted from routes/assignments.py (Issue #1771) as a pure-refactor step.
Zero behavior change; all public names are re-exported from the routes file.
"""
from sqlalchemy.orm import Session

from ..models.text import Text
from ..models.assignment import Assignment
from ..services.lesson_loader import get_lesson_by_id
from ..utils.slug import normalize_story_slug


def resolve_story_title_from_yaml(story_id: str) -> str | None:
    """Resolve a YAML story_id (lesson_number) to its title.

    Accepts both numeric strings ("6") and L-prefixed format ("L06").
    """
    try:
        story = get_lesson_by_id(int(normalize_story_slug(story_id)))
        if story:
            return story["title"]
    except (ValueError, TypeError):
        pass
    return None


def resolve_title_for_assignment(assignment: Assignment, db: Session) -> str:
    """Return the display title for an assignment's text source.

    Uses the already-loaded ``assignment.text`` relationship when available
    (e.g. after a ``joinedload(Assignment.text)`` / ``selectinload(Assignment.text)``
    in the calling query) to avoid an extra SELECT per assignment.  Falls back
    to an explicit DB query only when the relationship attribute is absent or
    unloaded — for example when the assignment was fetched without eager-loading.
    """
    if assignment.story_id is not None:
        return resolve_story_title_from_yaml(assignment.story_id) or assignment.story_id
    if assignment.text_id is not None:
        # Prefer the already-loaded relationship (no extra query).
        text_obj = assignment.text  # type: ignore[attr-defined]
        if text_obj is not None:
            return text_obj.title
        # Fallback: relationship not loaded — hit DB once.
        text_row = db.query(Text).filter(Text.id == assignment.text_id).first()
        if text_row:
            return text_row.title
    return "(Unknown)"


def resolve_story_slug_for_assignment(assignment: Assignment) -> str | None:
    """Return the LearningSession story_slug key used for this assignment."""
    if assignment.story_id is not None:
        return assignment.story_id
    if assignment.text_id is not None:
        return str(assignment.text_id)
    return None


def resolve_step_sequence_for_assignment(assignment: Assignment) -> list[str] | None:
    """Return this assignment's lesson's per-lesson step order, if any (Issue #3682).

    `MyAssignments.tsx` used to compute the assignment-card progress count
    ("學習關卡進度 N/M") against the GLOBAL default step sequence
    (`ACTIVE_STEPS` / `resolveActiveSteps()` called with no argument) instead of
    this specific lesson's own `step_sequence`. Round-keyed step ids for
    multi-part lessons (`key-passage-reading#4uee3`, #2916/#2930) never appear
    in the global default list, so `steps_completed` entries using those ids
    never matched — the UI showed "0/11" or "1/11" for a student who had
    actually finished most or all of the real steps.

    Only platform YAML lessons (`assignment.story_id` set) carry this
    per-lesson `step_sequence` metadata (`lesson_indexes._step_sequence_for`).
    DB-authored/forked texts (`assignment.text_id` set) have none, so this
    returns None for those — same as before this field existed, since the
    frontend already falls back to `DEFAULT_STEP_SEQUENCE` when it gets `None`.
    """
    if assignment.story_id is None:
        return None
    try:
        lesson_number = int(normalize_story_slug(assignment.story_id))
    except (ValueError, TypeError):
        return None
    lesson = get_lesson_by_id(lesson_number)
    if not lesson:
        return None
    seq = lesson.get("step_sequence")
    return list(seq) if isinstance(seq, list) else None
