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

# Same bound as the heatmap (teacher_analytics._HEATMAP_SESSION_LIMIT): refuse
# rather than silently truncate or load an unbounded table into memory.
_MATRIX_ROW_LIMIT = 5_000
# Cells are built in memory from rows already fetched, so they can go higher;
# this only stops a pathological class (e.g. a 1,445-student test class × many
# assignments) from building an unbounded response.
_MATRIX_CELL_LIMIT = 50_000


def _too_many(what: str) -> HTTPException:
    return HTTPException(status_code=400, detail=f"此班級的{what}數量超過上限，請聯絡管理員")


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
    assigned_count: int
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


def _submission_score(sub: AssignmentSubmission | None) -> float | None:
    """The submission's score, or — for submissions that lost the submit/score
    race before #3373 was fixed — the linked session's overall_score."""
    if sub is None:
        return None
    if sub.score is not None:
        return sub.score
    return sub.session.overall_score if sub.session is not None else None


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
        .limit(_MATRIX_ROW_LIMIT + 1)
        .all()
    )
    assignment_ids = [a.id for a in assignments]

    subs = (
        db.query(AssignmentSubmission)
        .options(joinedload(AssignmentSubmission.session))
        .filter(AssignmentSubmission.assignment_id.in_(assignment_ids))
        .limit(_MATRIX_ROW_LIMIT + 1)
        .all()
        if assignment_ids
        else []
    )
    if len(subs) > _MATRIX_ROW_LIMIT or len(students) * len(assignments) > _MATRIX_CELL_LIMIT:
        raise _too_many("作業紀錄")
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
                score=_submission_score(sub) if state == "completed" else None,
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
    value = _num(vocab_result.get("accuracy"))
    if value is None:
        return None
    # Older sessions store 0-1, newer ones 0-100 (same rule as gamification_service).
    return float(value) * 100 if value <= 1 else float(value)


def _num(value) -> float | None:
    """Stored JSON is client-written: a malformed value must read as missing, not 500."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def _reading_result(session) -> dict:
    """Full-text reading wins over the paragraph result — same order the teacher
    learning curve uses (teacher_student_sessions.get_learning_curve)."""
    fr = session.full_reading_result if isinstance(session.full_reading_result, dict) else {}
    rr = session.reading_result if isinstance(session.reading_result, dict) else {}
    return fr if fr else rr


def _reading_accuracy(session) -> float | None:
    # #3376: the session.accuracy column is mostly empty; the reading step
    # writes its result into reading_result / full_reading_result instead.
    r = _reading_result(session)
    match_rate = _num(r.get("match_rate"))
    if match_rate is not None:
        return round(match_rate * 100, 1)
    accuracy = _num(r.get("accuracy"))
    if accuracy is not None:
        return round(accuracy, 1)
    return session.accuracy


def _error_chars(session) -> list[str]:
    chars = _reading_result(session).get("error_chars")
    if not isinstance(chars, list):
        return []
    return [c for c in chars if isinstance(c, str) and len(c) <= 4][:30]


def _comprehension(session) -> float | None:
    if session.comprehension_score is not None:
        return session.comprehension_score
    levels = [v for v in (session.literal_score, session.inferential_score, session.evaluative_score) if v is not None]
    return round(sum(levels) / len(levels), 1) if levels else None


# Three parts a teacher reads at a glance (Young 2026-10-10: keep it simple).
# (key, label, extractor) — order here is only the tie-break order.
_ITEMS = (
    ("reading", "朗讀", _reading_accuracy),
    ("comprehension", "閱讀理解", _comprehension),
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
    # A missing assignment and someone else's assignment answer the same 404, so
    # the endpoint can't be used to probe which assignment ids exist.
    not_found = HTTPException(status_code=404, detail="Assignment not found")
    assignment = db.query(Assignment).filter(Assignment.id == assignment_id).first()
    if assignment is None:
        raise not_found
    try:
        _check_classroom_access(current_user, assignment.classroom_id, db)
    except HTTPException as exc:
        if exc.status_code == 403:
            raise not_found from exc
        raise

    subs = (
        db.query(AssignmentSubmission)
        .options(joinedload(AssignmentSubmission.session))
        .filter(AssignmentSubmission.assignment_id == assignment_id)
        .limit(_MATRIX_ROW_LIMIT + 1)
        .all()
    )
    if len(subs) > _MATRIX_ROW_LIMIT:
        raise _too_many("作業紀錄")
    latest = list(_latest_per_student(subs).values())
    finished = [sub.session for sub in latest if sub.status in _COMPLETED and sub.session is not None]
    # Completion is over everyone assigned, not just those who submitted — 1 of
    # 10 submitting must read 1/10, not 100% (#3376 audit).
    total = len(latest)

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
    return AssignmentItemStatsResponse(
        assignment_id=assignment_id, submitted_count=len(finished), assigned_count=total, items=items
    )


class StudentAssignmentRow(BaseModel):
    assignment_id: int
    title: str
    due_date: datetime | None
    state: str
    score: float | None
    current_step: str | None
    reading_accuracy: float | None
    comprehension: float | None
    vocab: float | None
    error_chars: list[str]


class StudentAssignmentsResponse(BaseModel):
    student_id: int
    student_name: str
    rows: list[StudentAssignmentRow]


@router.get(
    "/teacher/classrooms/{classroom_id}/students/{student_id}/assignments",
    response_model=StudentAssignmentsResponse,
)
def get_student_assignments(
    classroom_id: int,
    student_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """One student's results for every assignment in this class (#3376):
    state, score, the three parts, and which characters they misread."""
    _check_classroom_access(current_user, classroom_id, db)
    enrollment = (
        db.query(ClassroomStudent)
        .options(joinedload(ClassroomStudent.student))
        .filter(ClassroomStudent.classroom_id == classroom_id, ClassroomStudent.student_id == student_id)
        .first()
    )
    if enrollment is None:
        raise HTTPException(status_code=404, detail="Student not in this classroom")

    assignments = (
        db.query(Assignment)
        .options(joinedload(Assignment.text))
        .filter(Assignment.classroom_id == classroom_id, Assignment.is_active.is_(True))
        .order_by(Assignment.created_at, Assignment.id)
        .limit(_MATRIX_ROW_LIMIT + 1)
        .all()
    )
    subs = (
        db.query(AssignmentSubmission)
        .options(joinedload(AssignmentSubmission.session))
        .filter(
            AssignmentSubmission.assignment_id.in_([a.id for a in assignments]),
            AssignmentSubmission.student_id == student_id,
        )
        .limit(_MATRIX_ROW_LIMIT + 1)
        .all()
        if assignments
        else []
    )
    if len(assignments) > _MATRIX_ROW_LIMIT or len(subs) > _MATRIX_ROW_LIMIT:
        raise _too_many("作業紀錄")
    latest = _latest_per_student(subs)

    rows: list[StudentAssignmentRow] = []
    for a in assignments:
        sub = latest.get((a.id, student_id))
        state = _cell_state(sub)
        sess = sub.session if sub is not None else None
        progress = sess.step_progress if sess is not None and isinstance(sess.step_progress, dict) else {}
        rows.append(StudentAssignmentRow(
            assignment_id=a.id,
            title=a.title or resolve_title_for_assignment(a, db),
            due_date=a.due_date,
            state=state,
            score=_submission_score(sub) if state == "completed" else None,
            current_step=progress.get("current_step") if state == "in_progress" else None,
            reading_accuracy=_reading_accuracy(sess) if sess is not None else None,
            comprehension=_comprehension(sess) if sess is not None else None,
            vocab=_vocab_percent(sess.vocab_result) if sess is not None else None,
            error_chars=_error_chars(sess) if sess is not None else [],
        ))
    return StudentAssignmentsResponse(student_id=student_id, student_name=enrollment.student.name, rows=rows)
