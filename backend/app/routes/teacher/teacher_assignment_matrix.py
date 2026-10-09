"""Teacher assignment matrix + per-item class stats (#3367).

Two read-only views the redesigned teacher panel needs and no existing endpoint
answers in one call:

* ``/teacher/classrooms/{id}/assignment-matrix`` — every enrolled student ×
  every active assignment the teacher set, with one of four states per cell.
  Self-study practice never appears here (teachers asked for the matrix to show
  only the work they assigned).
* ``/teacher/assignments/{id}/item-stats`` — class-level completion / correct /
  error rate for each part of one assignment (朗讀、理解三層次、生字), so a teacher
  can see which part the whole class got wrong without opening every student.

Both are read-only and use existing columns; no schema change.
"""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload

from ...auth.dependencies import get_current_user
from ...database import get_db
from ...dependencies.tenant import _check_classroom_access
from ...models.assignment import Assignment, AssignmentSubmission
from ...models.school import ClassroomStudent
from ...models.user import User
from ...services.assignment_queries import resolve_title_for_assignment

router = APIRouter(tags=["teacher"])

_COMPLETED = {"submitted", "graded"}


class MatrixStudent(BaseModel):
    id: int
    name: str


class MatrixAssignment(BaseModel):
    id: int
    title: str
    due_date: datetime | None


class MatrixCell(BaseModel):
    student_id: int
    assignment_id: int
    # completed | in_progress | not_started | not_assigned
    state: str
    score: float | None
    current_step: str | None


class AssignmentMatrixResponse(BaseModel):
    students: list[MatrixStudent]
    assignments: list[MatrixAssignment]
    cells: list[MatrixCell]


class ItemStat(BaseModel):
    key: str
    label: str
    completed: int
    total: int
    completion_rate: float | None
    correct_rate: float | None
    error_rate: float | None


class AssignmentItemStatsResponse(BaseModel):
    assignment_id: int
    submitted_count: int
    items: list[ItemStat]


def _latest_per_student(subs: list[AssignmentSubmission]) -> dict[tuple[int, int], AssignmentSubmission]:
    """Latest attempt per (assignment, student) — a retry replaces the earlier result."""
    latest: dict[tuple[int, int], AssignmentSubmission] = {}
    for sub in subs:
        key = (sub.assignment_id, sub.student_id)
        cur = latest.get(key)
        if cur is None or (sub.attempt_number, sub.id) > (cur.attempt_number, cur.id):
            latest[key] = sub
    return latest


def _cell_state(sub: AssignmentSubmission | None) -> str:
    if sub is None:
        return "not_assigned"
    if sub.status in _COMPLETED:
        return "completed"
    if sub.status == "in_progress":
        return "in_progress"
    return "not_started"


@router.get(
    "/teacher/classrooms/{classroom_id}/assignment-matrix",
    response_model=AssignmentMatrixResponse,
)
def get_assignment_matrix(
    classroom_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _check_classroom_access(current_user, classroom_id, db)

    enrollments = (
        db.query(ClassroomStudent)
        .options(joinedload(ClassroomStudent.student))
        .filter(ClassroomStudent.classroom_id == classroom_id)
        .order_by(ClassroomStudent.id)
        .all()
    )
    students = [MatrixStudent(id=e.student_id, name=e.student.name) for e in enrollments]

    assignments = (
        db.query(Assignment)
        .options(joinedload(Assignment.text))
        .filter(Assignment.classroom_id == classroom_id, Assignment.is_active.is_(True))
        .order_by(Assignment.created_at, Assignment.id)
        .all()
    )
    assignment_ids = [a.id for a in assignments]

    subs = (
        db.query(AssignmentSubmission)
        .options(joinedload(AssignmentSubmission.session))
        .filter(AssignmentSubmission.assignment_id.in_(assignment_ids))
        .all()
        if assignment_ids
        else []
    )
    latest = _latest_per_student(subs)

    cells: list[MatrixCell] = []
    for a in assignments:
        for s in students:
            sub = latest.get((a.id, s.id))
            state = _cell_state(sub)
            current_step = None
            if state == "in_progress" and sub is not None and sub.session is not None:
                progress = sub.session.step_progress or {}
                if isinstance(progress, dict):
                    current_step = progress.get("current_step")
            cells.append(MatrixCell(
                student_id=s.id,
                assignment_id=a.id,
                state=state,
                score=sub.score if state == "completed" and sub is not None else None,
                current_step=current_step,
            ))

    return AssignmentMatrixResponse(
        students=students,
        assignments=[
            # Teacher-given title first, the lesson title otherwise (Assignment.title docstring).
            MatrixAssignment(id=a.id, title=a.title or resolve_title_for_assignment(a, db), due_date=a.due_date)
            for a in assignments
        ],
        cells=cells,
    )


def _vocab_percent(vocab_result) -> float | None:
    if not isinstance(vocab_result, dict):
        return None
    value = vocab_result.get("accuracy")
    if not isinstance(value, (int, float)):
        return None
    # Older sessions store 0-1, newer ones 0-100 (same rule as gamification_service).
    return float(value) * 100 if value <= 1 else float(value)


# (key, label, extractor) — order here is only the tie-break order.
_ITEMS = (
    ("reading", "朗讀", lambda s: s.accuracy),
    ("literal", "理解-字面", lambda s: s.literal_score),
    ("inferential", "理解-推論", lambda s: s.inferential_score),
    ("evaluative", "理解-評鑑", lambda s: s.evaluative_score),
    ("vocab", "生字", lambda s: _vocab_percent(s.vocab_result)),
)


def _pct(part: float, whole: int) -> float | None:
    return round(part / whole * 100, 1) if whole else None


@router.get(
    "/teacher/assignments/{assignment_id}/item-stats",
    response_model=AssignmentItemStatsResponse,
)
def get_assignment_item_stats(
    assignment_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    assignment = db.query(Assignment).filter(Assignment.id == assignment_id).first()
    if assignment is None:
        raise HTTPException(status_code=404, detail="Assignment not found")
    _check_classroom_access(current_user, assignment.classroom_id, db)

    subs = (
        db.query(AssignmentSubmission)
        .options(joinedload(AssignmentSubmission.session))
        .filter(AssignmentSubmission.assignment_id == assignment_id)
        .all()
    )
    finished = [
        sub.session for sub in _latest_per_student(subs).values()
        if sub.status in _COMPLETED and sub.session is not None
    ]
    total = len(finished)

    items: list[ItemStat] = []
    for key, label, extract in _ITEMS:
        values = [v for v in (extract(s) for s in finished) if v is not None]
        correct = round(sum(values) / len(values), 1) if values else None
        items.append(ItemStat(
            key=key,
            label=label,
            completed=len(values),
            total=total,
            completion_rate=_pct(len(values), total),
            correct_rate=correct,
            error_rate=round(100 - correct, 1) if correct is not None else None,
        ))

    # Weakest part first; parts nobody has a result for go last.
    items.sort(key=lambda i: (i.correct_rate is None, i.correct_rate or 0))
    return AssignmentItemStatsResponse(assignment_id=assignment_id, submitted_count=total, items=items)
