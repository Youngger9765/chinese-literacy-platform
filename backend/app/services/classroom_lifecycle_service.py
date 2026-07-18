"""Lifecycle operations for classrooms."""
import logging

from sqlalchemy.orm import Session

from ..models.assignment import Assignment, AssignmentSubmission
from ..models.school import Classroom, ClassroomStudent, ClassroomTeacher, ClassroomText
from ..models.session import LearningSession
from ..models.teacher_instruction import TeacherInstruction
from ..models.text import Text

logger = logging.getLogger(__name__)


def delete_classroom_with_cleanup(classroom: Classroom, db: Session) -> dict[str, int]:
    """Delete a classroom and its owned rows in dependency order.

    Commits on success. Raises on failure so the caller can roll back and return
    the appropriate API error.
    """
    classroom_id = classroom.id
    assignment_ids = [
        assignment_id
        for (assignment_id,) in (
            db.query(Assignment.id)
            .filter(Assignment.classroom_id == classroom_id)
            .all()
        )
    ]

    counts = {
        "assignment_submissions": 0,
        "assignments": 0,
        "classroom_students": 0,
        "classroom_texts": 0,
        "classroom_teachers": 0,
        "teacher_instructions": 0,
        "learning_sessions_detached": 0,
        "texts_detached": 0,
    }

    if assignment_ids:
        counts["assignment_submissions"] = (
            db.query(AssignmentSubmission)
            .filter(AssignmentSubmission.assignment_id.in_(assignment_ids))
            .delete(synchronize_session=False)
        )
        counts["assignments"] = (
            db.query(Assignment)
            .filter(Assignment.id.in_(assignment_ids))
            .delete(synchronize_session=False)
        )

    counts["teacher_instructions"] = (
        db.query(TeacherInstruction)
        .filter(TeacherInstruction.classroom_id == classroom_id)
        .delete(synchronize_session=False)
    )
    counts["classroom_students"] = (
        db.query(ClassroomStudent)
        .filter(ClassroomStudent.classroom_id == classroom_id)
        .delete(synchronize_session=False)
    )
    counts["classroom_texts"] = (
        db.query(ClassroomText)
        .filter(ClassroomText.classroom_id == classroom_id)
        .delete(synchronize_session=False)
    )
    counts["classroom_teachers"] = (
        db.query(ClassroomTeacher)
        .filter(ClassroomTeacher.classroom_id == classroom_id)
        .delete(synchronize_session=False)
    )
    counts["learning_sessions_detached"] = (
        db.query(LearningSession)
        .filter(LearningSession.classroom_id == classroom_id)
        .update({LearningSession.classroom_id: None}, synchronize_session=False)
    )
    counts["texts_detached"] = (
        db.query(Text)
        .filter(Text.class_id == classroom_id)
        .update({Text.class_id: None}, synchronize_session=False)
    )

    db.delete(classroom)
    db.commit()
    logger.info("Deleted classroom %d with cleanup counts: %s", classroom_id, counts)
    return counts
