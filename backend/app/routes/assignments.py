"""
Assignment System API — teachers create assignments, students complete them.
"""
import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..auth.dependencies import get_current_user
from ..database import get_db
from ..models.assignment import Assignment, AssignmentSubmission
from ..models.school import Classroom, ClassroomStudent
from ..models.session import LearningSession
from ..models.user import User, UserRole, Role
from ..schemas.assignment import (
    AssignmentCreateRequest,
    AssignmentDetailResponse,
    AssignmentListResponse,
    AssignmentResponse,
    AssignmentUpdateRequest,
    StartAssignmentResponse,
    StudentAssignmentResponse,
    SubmissionResponse,
)
from ..services.lesson_loader import get_lesson_by_id
from .classrooms import _get_classroom_or_404, _require_owner_or_admin

router = APIRouter(tags=["assignments"])
logger = logging.getLogger(__name__)


# ── Helpers ──────────────────────────────────────────────────────────────────


def _resolve_story_title(story_id: str) -> str | None:
    """Resolve a story_id (lesson_number) to its title."""
    try:
        story = get_lesson_by_id(int(story_id))
        if story:
            return story["title"]
    except (ValueError, TypeError):
        pass
    return None


def _assignment_to_response(assignment: Assignment, db: Session) -> AssignmentResponse:
    """Convert an Assignment ORM object to an AssignmentResponse."""
    story_title = _resolve_story_title(assignment.story_id) or assignment.story_id

    submission_count = (
        db.query(func.count(AssignmentSubmission.id))
        .filter(AssignmentSubmission.assignment_id == assignment.id)
        .scalar()
    )
    completed_count = (
        db.query(func.count(AssignmentSubmission.id))
        .filter(
            AssignmentSubmission.assignment_id == assignment.id,
            AssignmentSubmission.status.in_(["submitted", "graded"]),
        )
        .scalar()
    )

    return AssignmentResponse(
        id=assignment.id,
        classroom_id=assignment.classroom_id,
        teacher_id=assignment.teacher_id,
        story_id=assignment.story_id,
        story_title=story_title,
        title=assignment.title,
        description=assignment.description,
        assignment_type=assignment.assignment_type,
        due_date=assignment.due_date,
        is_active=assignment.is_active,
        created_at=assignment.created_at,
        submission_count=submission_count,
        completed_count=completed_count,
    )


def _require_assignment_owner_or_admin(
    assignment: Assignment, current_user: User, db: Session
) -> None:
    """Check that current_user owns the assignment's classroom, or is admin."""
    classroom = (
        db.query(Classroom).filter(Classroom.id == assignment.classroom_id).first()
    )
    if classroom is None:
        raise HTTPException(status_code=404, detail="Classroom not found")
    _require_owner_or_admin(classroom, current_user, db)


def _has_role(user_id: int, role_name: str, db: Session) -> bool:
    """Check if a user has a specific role."""
    return (
        db.query(UserRole)
        .join(Role)
        .filter(
            UserRole.user_id == user_id,
            UserRole.is_active == True,  # noqa: E712
            Role.name == role_name,
        )
        .first()
    ) is not None


# ── Student Endpoints (registered first to avoid path parameter conflicts) ───
# /assignments/my must be registered before /assignments/{assignment_id}
# so FastAPI doesn't try to parse "my" as an integer assignment_id.


@router.get(
    "/assignments/my",
    response_model=list[StudentAssignmentResponse],
)
def get_my_assignments(
    status: str | None = Query(None, pattern=r"^(pending|in_progress|submitted|graded)$"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get all assignments for the current student."""
    query = (
        db.query(AssignmentSubmission)
        .join(Assignment, AssignmentSubmission.assignment_id == Assignment.id)
        .filter(
            AssignmentSubmission.student_id == current_user.id,
            Assignment.is_active == True,  # noqa: E712
        )
    )
    if status is not None:
        query = query.filter(AssignmentSubmission.status == status)

    submissions = query.all()

    results = []
    for sub in submissions:
        assignment = sub.assignment
        classroom = (
            db.query(Classroom).filter(Classroom.id == assignment.classroom_id).first()
        )
        story_title = _resolve_story_title(assignment.story_id) or assignment.story_id

        results.append(
            StudentAssignmentResponse(
                assignment_id=assignment.id,
                story_id=assignment.story_id,
                story_title=story_title,
                title=assignment.title,
                description=assignment.description,
                assignment_type=assignment.assignment_type,
                due_date=assignment.due_date,
                classroom_name=classroom.name if classroom else "Unknown",
                status=sub.status,
                submitted_at=sub.submitted_at,
                score=sub.score,
            )
        )

    return results


# ── Teacher Endpoints ────────────────────────────────────────────────────────


@router.post(
    "/classrooms/{classroom_id}/assignments",
    status_code=201,
    response_model=AssignmentResponse,
)
def create_assignment(
    classroom_id: int,
    payload: AssignmentCreateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Create a new assignment for a classroom.

    Validates the story_id exists, creates the assignment, and
    bulk-creates pending submissions for all enrolled students.
    """
    classroom = _get_classroom_or_404(classroom_id, db)
    _require_owner_or_admin(classroom, current_user, db)

    # Validate story_id exists
    try:
        story = get_lesson_by_id(int(payload.story_id))
    except (ValueError, TypeError):
        story = None
    if not story:
        raise HTTPException(status_code=422, detail="Invalid story_id: story not found")

    # Use classroom_id from path, not payload (payload.classroom_id is for schema consistency)
    assignment = Assignment(
        classroom_id=classroom_id,
        teacher_id=current_user.id,
        story_id=payload.story_id,
        title=payload.title,
        description=payload.description,
        assignment_type=payload.assignment_type,
        due_date=payload.due_date,
    )
    db.add(assignment)
    db.flush()  # get assignment.id

    # Bulk-create submissions for all enrolled students
    enrollments = (
        db.query(ClassroomStudent)
        .filter(ClassroomStudent.classroom_id == classroom_id)
        .all()
    )
    for enrollment in enrollments:
        submission = AssignmentSubmission(
            assignment_id=assignment.id,
            student_id=enrollment.student_id,
            status="pending",
        )
        db.add(submission)

    db.commit()
    db.refresh(assignment)

    logger.info(
        "Created assignment %d for classroom %d (story=%s, students=%d)",
        assignment.id, classroom_id, payload.story_id, len(enrollments),
    )
    return _assignment_to_response(assignment, db)


@router.get(
    "/classrooms/{classroom_id}/assignments",
    response_model=AssignmentListResponse,
)
def list_classroom_assignments(
    classroom_id: int,
    is_active: bool | None = Query(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List assignments for a classroom with submission and completion counts."""
    classroom = _get_classroom_or_404(classroom_id, db)
    _require_owner_or_admin(classroom, current_user, db)

    query = db.query(Assignment).filter(Assignment.classroom_id == classroom_id)
    if is_active is not None:
        query = query.filter(Assignment.is_active == is_active)

    assignments = query.order_by(Assignment.created_at.desc()).all()

    return AssignmentListResponse(
        items=[_assignment_to_response(a, db) for a in assignments],
        total=len(assignments),
    )


@router.get(
    "/assignments/{assignment_id}",
    response_model=AssignmentDetailResponse,
)
def get_assignment_detail(
    assignment_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get assignment detail with all submissions."""
    assignment = db.query(Assignment).filter(Assignment.id == assignment_id).first()
    if assignment is None:
        raise HTTPException(status_code=404, detail="Assignment not found")

    _require_assignment_owner_or_admin(assignment, current_user, db)

    # Build base response
    base = _assignment_to_response(assignment, db)

    # Build submissions list
    submissions = (
        db.query(AssignmentSubmission)
        .filter(AssignmentSubmission.assignment_id == assignment_id)
        .all()
    )
    submission_responses = []
    for sub in submissions:
        student = db.query(User).filter(User.id == sub.student_id).first()
        submission_responses.append(
            SubmissionResponse(
                id=sub.id,
                assignment_id=sub.assignment_id,
                student_id=sub.student_id,
                student_name=student.name if student else "Unknown",
                status=sub.status,
                submitted_at=sub.submitted_at,
                score=sub.score,
            )
        )

    return AssignmentDetailResponse(
        **base.model_dump(),
        submissions=submission_responses,
    )


@router.patch(
    "/assignments/{assignment_id}",
    response_model=AssignmentResponse,
)
def update_assignment(
    assignment_id: int,
    payload: AssignmentUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update assignment fields (title, description, due_date, is_active)."""
    assignment = db.query(Assignment).filter(Assignment.id == assignment_id).first()
    if assignment is None:
        raise HTTPException(status_code=404, detail="Assignment not found")

    _require_assignment_owner_or_admin(assignment, current_user, db)

    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(assignment, field, value)

    db.commit()
    db.refresh(assignment)

    logger.info("Updated assignment %d: %s", assignment_id, list(update_data.keys()))
    return _assignment_to_response(assignment, db)


# ── Student Action Endpoints ─────────────────────────────────────────────────


@router.post(
    "/assignments/{assignment_id}/start",
    response_model=StartAssignmentResponse,
)
def start_assignment(
    assignment_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Start working on an assignment. Creates a LearningSession if needed.

    Idempotent: if already in_progress with a session, returns the existing session.
    """
    assignment = db.query(Assignment).filter(Assignment.id == assignment_id).first()
    if assignment is None:
        raise HTTPException(status_code=404, detail="Assignment not found")

    if not assignment.is_active:
        raise HTTPException(status_code=400, detail="Assignment is not active")

    # Find the student's submission
    submission = (
        db.query(AssignmentSubmission)
        .filter(
            AssignmentSubmission.assignment_id == assignment_id,
            AssignmentSubmission.student_id == current_user.id,
        )
        .first()
    )
    if submission is None:
        raise HTTPException(
            status_code=403, detail="You are not enrolled in this assignment"
        )

    if submission.status in ("submitted", "graded"):
        raise HTTPException(
            status_code=400, detail="Assignment already submitted"
        )

    # If already in progress with a session, return it (idempotent)
    if submission.status == "in_progress" and submission.session_id is not None:
        return StartAssignmentResponse(
            session_id=submission.session_id,
            story_id=assignment.story_id,
            status="in_progress",
        )

    # Create a new LearningSession
    learning_session = LearningSession(
        student_id=current_user.id,
        story_slug=assignment.story_id,
        classroom_id=assignment.classroom_id,
        status="in_progress",
        current_step=1,
    )
    db.add(learning_session)
    db.flush()  # get learning_session.id

    # Update submission
    submission.status = "in_progress"
    submission.session_id = learning_session.id

    db.commit()

    logger.info(
        "Student %d started assignment %d (session=%d)",
        current_user.id, assignment_id, learning_session.id,
    )
    return StartAssignmentResponse(
        session_id=learning_session.id,
        story_id=assignment.story_id,
        status="in_progress",
    )
