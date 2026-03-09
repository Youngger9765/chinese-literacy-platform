"""
副本策略 (Copy Strategy) for the Assignment System.

When a teacher assigns a text to a classroom the following rules apply:

1. **Platform texts** (stored as YAML, referenced by story_id string):
   These are managed by the platform and never modified by teachers.
   No copy is needed — assignments simply store the story_id string.
   Strategy: DIRECT_REFERENCE

2. **DB texts with platform visibility** (texts.visibility == "platform"):
   Same guarantee as YAML texts — platform-curated, not editable by
   individual teachers. No copy needed.
   Strategy: DIRECT_REFERENCE

3. **DB texts with non-platform visibility**
   (organization / school / class / private):
   These are teacher- or school-owned and may be edited at any time.
   To prevent edits to the original from affecting an in-flight assignment,
   we create a frozen fork at assignment-creation time using the existing
   `forked_from_id` FK on the Text model.
   Strategy: FORK_ON_ASSIGN
"""
import logging
from datetime import datetime

from sqlalchemy.orm import Session

from ..models.text import Text, VisibilityLevel

logger = logging.getLogger(__name__)


# Visibility levels that require a fork when assigned.
_MUTABLE_VISIBILITIES = {
    VisibilityLevel.organization,
    VisibilityLevel.school,
    VisibilityLevel.class_,
    VisibilityLevel.private,
}


def needs_fork(text: Text) -> bool:
    """Return True if this DB text must be forked before assignment.

    Platform-curated texts are stable; all other texts may be edited by
    their owners, so we fork them.
    """
    return text.visibility in _MUTABLE_VISIBILITIES


def fork_text_for_assignment(text: Text, teacher_id: int, classroom_id: int, db: Session) -> Text:
    """Create a frozen snapshot fork of `text` for use in an assignment.

    The fork is given:
    - the same content as the original (title, paragraphs, full_text, char_count, etc.)
    - visibility = "class" (scoped to the classroom)
    - class_id = classroom_id
    - teacher_id = teacher_id
    - forked_from_id = text.id  (tracks provenance)
    - status = "published"      (immediately usable)

    The original text is NOT modified.

    Returns the newly created fork (already added to the session, not yet committed).
    """
    fork = Text(
        title=text.title,
        paragraphs=text.paragraphs,
        full_text=text.full_text,
        char_count=text.char_count,
        grade=text.grade,
        grade_code=text.grade_code,
        genre=text.genre,
        text_type=text.text_type,
        category=text.category,
        visibility=VisibilityLevel.class_,
        class_id=classroom_id,
        teacher_id=teacher_id,
        created_by_id=teacher_id,
        forked_from_id=text.id,
        status=text.status,
        lesson_number=None,         # forks are not platform texts
        source_file=None,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db.add(fork)
    logger.info(
        "Forked text id=%d (visibility=%s) for classroom_id=%d → new fork pending commit",
        text.id, text.visibility, classroom_id,
    )
    return fork


def resolve_text_for_assignment(
    text: Text,
    teacher_id: int,
    classroom_id: int,
    db: Session,
) -> Text:
    """Return the Text object that should be stored as assignment.text_id.

    For mutable texts this creates a fork; for stable texts the original is
    returned unchanged.  The caller must commit the session after calling this.
    """
    if needs_fork(text):
        return fork_text_for_assignment(text, teacher_id, classroom_id, db)
    return text
