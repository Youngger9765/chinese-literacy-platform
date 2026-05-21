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
