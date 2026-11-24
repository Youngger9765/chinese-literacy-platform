"""學習批閱 (#4104) — shared logic for the teacher and student review endpoints.

Terms
-----
started  A lesson counts as started when any of the student's sessions for it
         has real step work: a ``step_activity`` stamp, any ``step_data``, or
         any completed step. Merely opening a lesson creates a session
         (bootstrap), so "has a session" is not enough.
redone   A returned step is redone when the student's data for that step
         changed (or it was completed again) after ``returned_at``. Any change
         counts, including correcting wrong answers only (#4104 decision 3).
         Read from ``step_progress.__meta.step_activity``, which only the
         server writes (``learning_step_progress._stamp_step_activity``).
"""

from __future__ import annotations

from datetime import datetime
from typing import Iterable

from sqlalchemy.orm import Session

from ..models.lesson_review import LessonReview, LessonReviewStep
from ..models.session import LearningSession

SCORE_MIN = 0
SCORE_MAX = 100
COMMENT_MAX = 500


def _sp(session: LearningSession) -> dict:
    return session.step_progress if isinstance(session.step_progress, dict) else {}


def _parse(ts: str | None) -> datetime | None:
    if not ts or not isinstance(ts, str):
        return None
    try:
        return datetime.fromisoformat(ts)
    except ValueError:
        return None


def step_activity(sessions: Iterable[LearningSession]) -> dict[str, datetime]:
    """Latest server-stamped activity per step key across the given sessions."""
    out: dict[str, datetime] = {}
    for s in sessions:
        meta = _sp(s).get("__meta")
        acts = meta.get("step_activity") if isinstance(meta, dict) else None
        if not isinstance(acts, dict):
            continue
        for key, ts in acts.items():
            t = _parse(ts)
            if t and (key not in out or t > out[key]):
                out[key] = t
    return out


def session_started(session: LearningSession) -> bool:
    sp = _sp(session)
    meta = sp.get("__meta")
    if isinstance(meta, dict) and meta.get("step_activity"):
        return True
    return bool(sp.get("step_data")) or bool(sp.get("steps_completed"))


def sessions_by_lesson(db: Session, student_id: int) -> dict[str, list[LearningSession]]:
    """The student's sessions grouped by lesson (newest first), started lessons only."""
    rows = (
        db.query(LearningSession)
        .filter(LearningSession.student_id == student_id, LearningSession.story_slug.isnot(None))
        .order_by(LearningSession.id.desc())
        .all()
    )
    grouped: dict[str, list[LearningSession]] = {}
    for s in rows:
        grouped.setdefault(s.story_slug, []).append(s)
    return {slug: ss for slug, ss in grouped.items() if any(session_started(s) for s in ss)}


def latest_started_session(sessions: list[LearningSession]) -> LearningSession | None:
    """The session the student's scorecard shows: newest one with real work.

    #2889 carries progress into each new session, so the newest started session
    holds the whole lesson.
    """
    for s in sessions:  # newest first
        if session_started(s):
            return s
    return sessions[0] if sessions else None


def last_activity_at(sessions: list[LearningSession]) -> datetime | None:
    acts = step_activity(sessions)
    if acts:
        return max(acts.values())
    times = [s.completed_at or s.started_at for s in sessions if (s.completed_at or s.started_at)]
    return max(times) if times else None


def is_redone(step: LessonReviewStep, activity: dict[str, datetime]) -> bool:
    if not step.returned or step.returned_at is None:
        return False
    t = activity.get(step.step_key)
    if t is None:
        return False
    returned_at = step.returned_at
    # SQLite (tests) returns naive datetimes; stamps are always UTC-aware.
    if returned_at.tzinfo is None and t.tzinfo is not None:
        t = t.replace(tzinfo=None)
    return t > returned_at


def sent_steps_view(review: LessonReview | None, activity: dict[str, datetime]) -> dict[str, dict]:
    """What the student was sent, per step key, with the redone flag resolved."""
    if review is None or review.sent_at is None:
        return {}
    out: dict[str, dict] = {}
    for st in review.steps:
        redone = is_redone(st, activity)
        out[st.step_key] = {
            # Still waiting for the student = returned and not yet redone.
            "returned": bool(st.returned) and not redone,
            "redone": redone,
            "returned_at": st.returned_at.isoformat() if st.returned_at else None,
            "comment": st.comment,
            "score": st.score,
        }
    return out


def returned_count(steps: dict[str, dict]) -> int:
    return sum(1 for v in steps.values() if v["returned"])


def redone_count(steps: dict[str, dict]) -> int:
    return sum(1 for v in steps.values() if v["redone"])


def get_review(db: Session, student_id: int, story_slug: str) -> LessonReview | None:
    return (
        db.query(LessonReview)
        .filter(LessonReview.student_id == student_id, LessonReview.story_slug == story_slug)
        .first()
    )


def clean_score(value: int | None) -> int | None:
    if value is None:
        return None
    return max(SCORE_MIN, min(SCORE_MAX, int(value)))


def clean_comment(value: str | None) -> str | None:
    if value is None:
        return None
    text = value.strip()[:COMMENT_MAX]
    return text or None
