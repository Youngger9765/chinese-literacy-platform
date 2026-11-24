"""學習批閱 (#4104) — teacher endpoints.

班級 → 學生名片 → 學生有開始的課 → 成績單 + 單關退回 / 評語 / 每關分數 / 總分 → 送出給學生.

Reads need classroom membership (owner / accepted co-teacher / system admin);
writes need editor rights (owner / editor co-teacher — #4104 decision 4).
The student must be enrolled in the classroom in the URL.
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ...auth.dependencies import get_current_user
from ...auth.policies import require_classroom_editor, require_classroom_member
from ...database import get_db
from ...models.lesson_review import LessonReview, LessonReviewStep
from ...models.school import Classroom, ClassroomStudent
from ...models.session import LearningSession
from ...models.user import User
from ...services import lesson_review_service as svc
from .teacher_student_helpers import resolve_story_title

router = APIRouter(tags=["teacher"])


# ── schemas ────────────────────────────────────────────────────────────────


class ReviewStepIn(BaseModel):
    step_key: str = Field(min_length=1, max_length=100)
    returned: bool = False
    comment: str | None = Field(default=None, max_length=svc.COMMENT_MAX)
    score: int | None = Field(default=None, ge=svc.SCORE_MIN, le=svc.SCORE_MAX)


class ReviewIn(BaseModel):
    total_score: int | None = Field(default=None, ge=svc.SCORE_MIN, le=svc.SCORE_MAX)
    steps: list[ReviewStepIn] = Field(default_factory=list, max_length=60)


class ReviewStudentCard(BaseModel):
    student_id: int
    name: str
    seat_number: int | None
    started_count: int
    unreviewed_count: int  # started lessons never sent
    returned_count: int  # steps still waiting for the student
    redone_count: int  # returned steps the student has redone — teacher should look


class ReviewLessonRow(BaseModel):
    story_slug: str
    title: str | None
    session_id: int
    steps_completed: int
    last_activity_at: datetime | None
    sent_at: datetime | None
    total_score: int | None
    returned_count: int
    redone_count: int
    has_draft: bool


class ReviewStepOut(BaseModel):
    returned: bool
    redone: bool
    returned_at: str | None
    comment: str | None
    score: int | None


class ReviewOut(BaseModel):
    sent_at: datetime | None
    total_score: int | None
    teacher_name: str | None
    steps: dict[str, ReviewStepOut]


class ReviewDetail(BaseModel):
    student_id: int
    student_name: str
    story_slug: str
    story_title: str | None
    session_id: int | None
    step_progress: dict | None
    review: ReviewOut
    draft: ReviewIn | None


# ── helpers ────────────────────────────────────────────────────────────────


def _classroom(classroom_id: int, db: Session) -> Classroom:
    c = db.query(Classroom).filter(Classroom.id == classroom_id).first()
    if c is None:
        raise HTTPException(status_code=404, detail="Classroom not found")
    return c


def _require_enrolled(classroom_id: int, student_id: int, db: Session) -> User:
    enrolled = (
        db.query(ClassroomStudent)
        .filter(ClassroomStudent.classroom_id == classroom_id, ClassroomStudent.student_id == student_id)
        .first()
    )
    if enrolled is None:
        raise HTTPException(status_code=404, detail="Student not in this classroom")
    student = db.query(User).filter(User.id == student_id).first()
    if student is None:
        raise HTTPException(status_code=404, detail="Student not found")
    return student


def _review_out(review: LessonReview | None, steps: dict[str, dict], db: Session) -> ReviewOut:
    teacher_name = None
    if review is not None and review.teacher_id:
        t = db.query(User).filter(User.id == review.teacher_id).first()
        teacher_name = t.name if t else None
    sent = review is not None and review.sent_at is not None
    return ReviewOut(
        sent_at=review.sent_at if sent else None,
        total_score=review.total_score if sent else None,
        teacher_name=teacher_name if sent else None,
        steps={k: ReviewStepOut(**v) for k, v in steps.items()},
    )


# ── endpoints ──────────────────────────────────────────────────────────────


@router.get(
    "/teacher/classrooms/{classroom_id}/review/students",
    response_model=list[ReviewStudentCard],
)
def list_review_students(
    classroom_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    classroom = _classroom(classroom_id, db)
    require_classroom_member(classroom, current_user, db)

    enrolled = (
        db.query(ClassroomStudent, User)
        .join(User, User.id == ClassroomStudent.student_id)
        .filter(ClassroomStudent.classroom_id == classroom_id)
        .all()
    )
    ids = [u.id for _, u in enrolled]
    sessions: dict[int, dict[str, list[LearningSession]]] = {i: {} for i in ids}
    if ids:
        rows = (
            db.query(LearningSession)
            .filter(LearningSession.student_id.in_(ids), LearningSession.story_slug.isnot(None))
            .order_by(LearningSession.id.desc())
            .all()
        )
        for s in rows:
            sessions[s.student_id].setdefault(s.story_slug, []).append(s)
    reviews: dict[tuple[int, str], LessonReview] = {}
    if ids:
        for r in db.query(LessonReview).filter(LessonReview.student_id.in_(ids)).all():
            reviews[(r.student_id, r.story_slug)] = r

    cards: list[ReviewStudentCard] = []
    for cs, user in enrolled:
        started = {
            slug: ss for slug, ss in sessions[user.id].items() if any(svc.session_started(s) for s in ss)
        }
        unreviewed = returned = redone = 0
        for slug, ss in started.items():
            review = reviews.get((user.id, slug))
            if review is None or review.sent_at is None:
                unreviewed += 1
                continue
            view = svc.sent_steps_view(review, svc.step_activity(ss))
            returned += svc.returned_count(view)
            redone += svc.redone_count(view)
        cards.append(
            ReviewStudentCard(
                student_id=user.id,
                name=user.name,
                seat_number=cs.seat_number,
                started_count=len(started),
                unreviewed_count=unreviewed,
                returned_count=returned,
                redone_count=redone,
            )
        )
    cards.sort(key=lambda c: (c.seat_number is None, c.seat_number or 0, c.name))
    return cards


@router.get(
    "/teacher/classrooms/{classroom_id}/review/students/{student_id}/lessons",
    response_model=list[ReviewLessonRow],
)
def list_review_lessons(
    classroom_id: int,
    student_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    classroom = _classroom(classroom_id, db)
    require_classroom_member(classroom, current_user, db)
    _require_enrolled(classroom_id, student_id, db)

    rows: list[ReviewLessonRow] = []
    for slug, ss in svc.sessions_by_lesson(db, student_id).items():
        latest = svc.latest_started_session(ss)
        review = svc.get_review(db, student_id, slug)
        view = svc.sent_steps_view(review, svc.step_activity(ss))
        sp = latest.step_progress if latest and isinstance(latest.step_progress, dict) else {}
        rows.append(
            ReviewLessonRow(
                story_slug=slug,
                title=resolve_story_title(slug),
                session_id=latest.id,
                steps_completed=len(sp.get("steps_completed") or []),
                last_activity_at=svc.last_activity_at(ss),
                sent_at=review.sent_at if review else None,
                total_score=review.total_score if review and review.sent_at else None,
                returned_count=svc.returned_count(view),
                redone_count=svc.redone_count(view),
                has_draft=bool(review and review.draft),
            )
        )
    epoch = datetime.min.replace(tzinfo=timezone.utc)

    def _key(r: ReviewLessonRow) -> datetime:
        t = r.last_activity_at
        if t is None:
            return epoch
        return t if t.tzinfo else t.replace(tzinfo=timezone.utc)

    rows.sort(key=_key, reverse=True)
    return rows


def _detail(classroom_id: int, student: User, story_slug: str, db: Session) -> ReviewDetail:
    ss = svc.sessions_by_lesson(db, student.id).get(story_slug)
    if not ss:
        raise HTTPException(status_code=404, detail="Student has not started this lesson")
    latest = svc.latest_started_session(ss)
    review = svc.get_review(db, student.id, story_slug)
    view = svc.sent_steps_view(review, svc.step_activity(ss))
    draft = ReviewIn(**review.draft) if review is not None and review.draft else None
    return ReviewDetail(
        student_id=student.id,
        student_name=student.name,
        story_slug=story_slug,
        story_title=resolve_story_title(story_slug),
        session_id=latest.id if latest else None,
        step_progress=latest.step_progress if latest else None,
        review=_review_out(review, view, db),
        draft=draft,
    )


@router.get(
    "/teacher/classrooms/{classroom_id}/review/students/{student_id}/lessons/{story_slug}",
    response_model=ReviewDetail,
)
def get_review_detail(
    classroom_id: int,
    student_id: int,
    story_slug: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    classroom = _classroom(classroom_id, db)
    require_classroom_member(classroom, current_user, db)
    student = _require_enrolled(classroom_id, student_id, db)
    return _detail(classroom_id, student, story_slug, db)


def _get_or_create(db: Session, classroom_id: int, student_id: int, story_slug: str) -> LessonReview:
    review = svc.get_review(db, student_id, story_slug)
    if review is None:
        review = LessonReview(student_id=student_id, story_slug=story_slug, classroom_id=classroom_id)
        db.add(review)
        db.flush()
    return review


def _writable(classroom_id: int, student_id: int, story_slug: str, user: User, db: Session) -> User:
    classroom = _classroom(classroom_id, db)
    require_classroom_editor(classroom, user, db)
    student = _require_enrolled(classroom_id, student_id, db)
    if story_slug not in svc.sessions_by_lesson(db, student_id):
        raise HTTPException(status_code=404, detail="Student has not started this lesson")
    return student


@router.put(
    "/teacher/classrooms/{classroom_id}/review/students/{student_id}/lessons/{story_slug}/draft",
    response_model=ReviewDetail,
)
def save_review_draft(
    classroom_id: int,
    student_id: int,
    story_slug: str,
    body: ReviewIn,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Save the teacher's unsent edits. The student sees nothing until 送出."""
    student = _writable(classroom_id, student_id, story_slug, current_user, db)
    review = _get_or_create(db, classroom_id, student_id, story_slug)
    review.draft = body.model_dump()
    db.commit()
    return _detail(classroom_id, student, story_slug, db)


@router.post(
    "/teacher/classrooms/{classroom_id}/review/students/{student_id}/lessons/{story_slug}/send",
    response_model=ReviewDetail,
)
def send_review(
    classroom_id: int,
    student_id: int,
    story_slug: str,
    body: ReviewIn,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """送出給學生 — returns, comments, step scores and the total in one go.

    ``body.steps`` is the full set: steps left out are removed. A step sent as
    returned gets a fresh ``returned_at`` unless it is still waiting for the
    student from an earlier send (then the original time is kept, so the
    student's redo is not reset by an unrelated edit).
    """
    student = _writable(classroom_id, student_id, story_slug, current_user, db)
    ss = svc.sessions_by_lesson(db, student_id)[story_slug]
    activity = svc.step_activity(ss)
    review = _get_or_create(db, classroom_id, student_id, story_slug)
    now = datetime.now(timezone.utc)

    existing = {st.step_key: st for st in review.steps}
    incoming: dict[str, ReviewStepIn] = {}
    for st in body.steps:
        incoming[st.step_key] = st  # last one wins on duplicates

    for key, old in list(existing.items()):
        if key not in incoming:
            review.steps.remove(old)

    for key, st in incoming.items():
        comment = svc.clean_comment(st.comment)
        score = svc.clean_score(st.score)
        row = existing.get(key)
        if not st.returned and comment is None and score is None:
            if row is not None:
                review.steps.remove(row)
            continue
        if row is None:
            row = LessonReviewStep(step_key=key)
            review.steps.append(row)
        if st.returned:
            still_waiting = (
                row.returned and row.returned_at is not None and not svc.is_redone(row, activity)
            )
            if not still_waiting:
                row.returned_at = now
            row.returned = True
        else:
            row.returned = False
            row.returned_at = None
        row.comment = comment
        row.score = score

    review.total_score = svc.clean_score(body.total_score)
    review.teacher_id = current_user.id
    review.classroom_id = classroom_id
    review.sent_at = now
    review.draft = None
    db.commit()
    db.refresh(review)
    return _detail(classroom_id, student, story_slug, db)
