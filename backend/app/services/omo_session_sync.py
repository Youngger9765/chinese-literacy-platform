"""Sync OMO paper-grading results into the student's LearningSession.

#2027 Phase 2 / #2089 item 3. Goal: 把紙本作答平移到線上，邏輯跟線上作答完全一樣。

When a paper worksheet finishes grading we merge the result into the SAME
`step_progress` JSONB store that online answers use, so:
  - the 關卡 (step) dots the worksheet covered light up green (steps_completed)
  - each step can show the paper作答 + 對錯 (step_data[step]["omo"])

Writing into step_progress (not a new assessment_outcomes column) means no
migration and the data lands exactly where the learning UI already reads it.

The sync is best-effort: the grading result is already persisted on OmoUpload
before this runs, so a failure here never loses the grade — it only means the
dots don't light up, which a re-grade can fix.
"""
import logging
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.exc import IntegrityError

from ..models.session import LearningSession
from ..models.text import Text

logger = logging.getLogger(__name__)


# Fallback step inference from question_id prefix, used only when a GradedAnswer
# carries no `step` (older grader output). Mirrors QUESTION_TYPE_TO_STEP.
_QID_PREFIX_TO_STEP = {
    "fb_": "vocab-application",
    "mc_": "comprehension",
    "se_": "reading-strategy",
}


def _step_for(graded) -> str:
    """Resolve the UI step for a graded answer, falling back to qid prefix."""
    step = (getattr(graded, "step", "") or "").strip()
    if step:
        return step
    qid = str(getattr(graded, "question_id", ""))
    for prefix, sid in _QID_PREFIX_TO_STEP.items():
        if qid.startswith(prefix):
            return sid
    return ""


def _get_or_create_session(db, student_id: int, story_slug: str) -> LearningSession:
    """Find the student's in_progress self-study session for this lesson, or
    create one. Mirrors the get-or-create in sessions_bootstrap.py (same unique
    index uq_session_student_story_inprogress guards against races)."""
    def _find():
        return (
            db.query(LearningSession)
            .filter(
                LearningSession.student_id == student_id,
                LearningSession.story_slug == story_slug,
                LearningSession.status == "in_progress",
            )
            .order_by(LearningSession.started_at.desc())
            .first()
        )

    existing = _find()
    if existing:
        return existing

    text_id = None
    try:
        text = db.query(Text).filter(Text.lesson_number == int(story_slug)).first()
        if text:
            text_id = text.id
    except (ValueError, TypeError):
        pass

    session = LearningSession(
        student_id=student_id,
        story_slug=story_slug,
        text_id=text_id,
        status="in_progress",
        classroom_id=None,
        session_mode="self_study",
    )
    db.add(session)
    try:
        db.commit()
        db.refresh(session)
        return session
    except IntegrityError:
        # Concurrent create (unique index) — fall back to the row that won.
        db.rollback()
        won = _find()
        if won is None:
            raise
        return won


def build_step_progress_update(existing: Optional[dict], graded: list) -> Optional[dict]:
    """Pure: merge graded answers into an existing step_progress dict.

    Returns the new step_progress dict, or None when there is nothing to write.
    - steps_completed: union of existing + steps the worksheet covered (green dots)
    - step_data[step]["omo"]: paper assessment record (preserves any online data)
    - version: bumped so the frontend's optimistic-concurrency check accepts it
    Online progress already in step_data / steps_completed is preserved.
    """
    sp = existing if isinstance(existing, dict) else {}
    steps_completed = list(sp.get("steps_completed") or [])
    step_data = dict(sp.get("step_data") or {})

    by_step: dict[str, list] = {}
    for g in graded:
        step = _step_for(g)
        if step:
            by_step.setdefault(step, []).append(g)
    if not by_step:
        return None

    graded_at = datetime.now(tz=timezone.utc).isoformat()
    for step, items in by_step.items():
        omo_record = {
            "graded_at": graded_at,
            "source": "omo",
            "answers": [
                {
                    "question_id": g.question_id,
                    "student_answer": g.student_answer,
                    "correct_answer": g.correct_answer,
                    "score": g.score,
                    "ai_confidence": g.ai_confidence,
                    "context": g.context,
                }
                for g in items
            ],
        }
        merged_step = dict(step_data.get(step) or {})
        merged_step["omo"] = omo_record
        step_data[step] = merged_step
        if step not in steps_completed:
            steps_completed.append(step)

    meta = dict(sp.get("__meta") or {})
    meta["last_synced_at"] = graded_at
    meta["omo_synced_at"] = graded_at

    return {
        "current_step": sp.get("current_step"),  # leave navigation as-is
        "steps_completed": steps_completed,
        "step_data": step_data,
        "version": int(sp.get("version") or 0) + 1,
        "__meta": meta,
    }


def sync_omo_grading_to_session(
    student_id: int, lesson_number: int, graded: list
) -> Optional[int]:
    """Find-or-create the student's session for this lesson and merge the OMO
    grading into its step_progress. Returns the session id, or None if nothing
    was written (no gradeable steps) or on failure (best-effort)."""
    if not graded:
        return None
    story_slug = str(lesson_number)
    from ..database import SessionLocal
    db = SessionLocal()
    try:
        session = _get_or_create_session(db, student_id, story_slug)
        new_sp = build_step_progress_update(session.step_progress, graded)
        if new_sp is None:
            return None
        session.step_progress = new_sp
        db.commit()
        logger.info(
            "OMO→session sync: session %d student %d lesson %s, steps=%s",
            session.id, student_id, story_slug, new_sp["steps_completed"],
        )
        return session.id
    except Exception as exc:
        logger.error(
            "OMO→session sync failed (student %d lesson %s): %s",
            student_id, lesson_number, exc, exc_info=True,
        )
        db.rollback()
        return None
    finally:
        db.close()
