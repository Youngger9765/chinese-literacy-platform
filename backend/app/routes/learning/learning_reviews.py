"""學習批閱 (#4104) — what the student sees of their teacher's reviews.

Only sent reviews are visible; the teacher's draft never leaves the teacher side.

GET /learning/reviews              → {story_slug: {total_score, returned_count, sent_at}}
                                     for the library lesson cards
GET /learning/reviews/{story_slug} → the full sent review for the scorecard and
                                     the step dots
"""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ...auth.dependencies import get_current_user
from ...database import get_db
from ...models.lesson_review import LessonReview
from ...models.user import User
from ...services import lesson_review_service as svc

router = APIRouter(tags=["learning"])


class MyReviewSummary(BaseModel):
    total_score: int | None
    returned_count: int
    sent_at: datetime


class MyReviewStep(BaseModel):
    returned: bool
    redone: bool
    comment: str | None
    score: int | None


class MyReview(BaseModel):
    story_slug: str
    sent_at: datetime | None
    total_score: int | None
    teacher_name: str | None
    steps: dict[str, MyReviewStep]


@router.get("/learning/reviews", response_model=dict[str, MyReviewSummary])
def list_my_reviews(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    reviews = (
        db.query(LessonReview)
        .filter(LessonReview.student_id == current_user.id, LessonReview.sent_at.isnot(None))
        .all()
    )
    if not reviews:
        return {}
    lessons = svc.sessions_by_lesson(db, current_user.id)
    out: dict[str, MyReviewSummary] = {}
    for r in reviews:
        view = svc.sent_steps_view(r, svc.step_activity(lessons.get(r.story_slug, [])))
        out[r.story_slug] = MyReviewSummary(
            total_score=r.total_score, returned_count=svc.returned_count(view), sent_at=r.sent_at
        )
    return out


@router.get("/learning/reviews/{story_slug}", response_model=MyReview)
def get_my_review(
    story_slug: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    review = svc.get_review(db, current_user.id, story_slug)
    if review is None or review.sent_at is None:
        return MyReview(story_slug=story_slug, sent_at=None, total_score=None, teacher_name=None, steps={})
    ss = svc.sessions_by_lesson(db, current_user.id).get(story_slug, [])
    view = svc.sent_steps_view(review, svc.step_activity(ss))
    teacher = db.query(User).filter(User.id == review.teacher_id).first() if review.teacher_id else None
    return MyReview(
        story_slug=story_slug,
        sent_at=review.sent_at,
        total_score=review.total_score,
        teacher_name=teacher.name if teacher else None,
        steps={
            k: MyReviewStep(returned=v["returned"], redone=v["redone"], comment=v["comment"], score=v["score"])
            for k, v in view.items()
        },
    )
