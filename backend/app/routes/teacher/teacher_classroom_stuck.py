"""Teacher classroom stuck-point overview endpoint."""
import logging

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session, joinedload

from ...auth.dependencies import get_current_user
from ...database import get_db
from ...dependencies.tenant import _check_classroom_access
from ...models.school import ClassroomStudent
from ...models.user import User
from ...services.stuck_detection_service import build_recommendations, detect_stuck_points
from .teacher_schemas import ClassroomStuckResponse, StudentStuckSummary

router = APIRouter(tags=["teacher"])
logger = logging.getLogger(__name__)


@router.get(
    "/teacher/classrooms/{classroom_id}/stuck-overview",
    response_model=ClassroomStuckResponse,
)
def get_classroom_stuck_overview(
    classroom_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return a stuck-point overview for all students in a classroom.

    Only teachers with access to the classroom can call this.
    Returns students who have at least one stuck-point indicator.
    """
    _check_classroom_access(current_user, classroom_id, db)

    enrollments = (
        db.query(ClassroomStudent)
        .options(joinedload(ClassroomStudent.student))
        .filter(ClassroomStudent.classroom_id == classroom_id)
        .all()
    )

    summaries: list[StudentStuckSummary] = []
    for enrollment in enrollments:
        student = enrollment.student
        stuck_data = detect_stuck_points(student.id, db)

        has_stuck = (
            bool(stuck_data["story_stuck"])
            or bool(stuck_data["character_stuck"])
            or stuck_data["is_declining"]
        )
        if not has_stuck:
            continue

        recs = build_recommendations(stuck_data)
        top_rec_titles = [r["title"] for r in recs if r["type"] != "encouragement"][:2]
        top_chars = [c["character"] for c in stuck_data["character_stuck"][:3]]

        summaries.append(
            StudentStuckSummary(
                student_id=student.id,
                student_name=student.name,
                story_stuck_count=len(stuck_data["story_stuck"]),
                character_stuck_count=len(stuck_data["character_stuck"]),
                is_declining=stuck_data["is_declining"],
                top_stuck_characters=top_chars,
                top_recommendations=top_rec_titles,
            )
        )

    logger.info(
        "Stuck overview for classroom %d: %d students with stuck points",
        classroom_id,
        len(summaries),
    )
    return ClassroomStuckResponse(
        students=summaries,
        total_stuck=len(summaries),
    )
