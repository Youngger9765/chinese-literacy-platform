"""Student Progress routes.

Handles stuck-point detection and per-text completion progress tracking.
"""
import logging
from datetime import datetime
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload

from ...auth.dependencies import get_current_user
from ...database import get_db
from ...models.session import LearningSession
from ...models.user import User
from ...services.learning_stats_service import get_completed_story_count
from ...services.stuck_detection_service import detect_stuck_points
from ._helpers import verify_student_access

router = APIRouter()
logger = logging.getLogger(__name__)


# ── Step names / labels ───────────────────────────────────────────────────────

STEP_NAMES = {
    1: "intro",
    2: "live_tutor",
    3: "comprehension",
    4: "vocab",
    5: "full_reading",
    6: "report",
}

_MAX_STEP_NUM = max(STEP_NAMES.keys())

STEP_LABELS = {
    1: "簡介",
    2: "逐段朗讀",
    3: "課文理解",
    4: "生字練習",
    5: "全文朗讀",
    6: "學習報告",
}

# Frontend step IDs may differ from backend STEP_NAMES values.
# This mapping normalizes frontend keys → backend keys (#1073).
_FRONTEND_STEP_ALIAS: dict[str, str] = {
    "tutor": "live_tutor",
    "full-reading": "full_reading",
    "reading-annotation": "intro",
}


def _normalize_step_key(key: str) -> str:
    """Map a frontend step ID to the canonical backend STEP_NAMES key."""
    return _FRONTEND_STEP_ALIAS.get(key, key)


# ── Helper functions ──────────────────────────────────────────────────────────

def _compute_step_completion(session: LearningSession) -> dict[str, str]:
    """Derive per-step status from a LearningSession record.

    Returns a dict mapping step key -> 'completed' | 'in_progress' | 'not_started'.

    Priority: use step_progress.steps_completed[] (string array) as the source
    of truth when available, since the frontend writes this field directly.
    Falls back to current_step (integer) for older sessions without step_progress.
    (#1073)
    """
    # Try to read steps_completed from step_progress JSONB first
    sp = session.step_progress
    sp_completed: list[str] | None = None
    if isinstance(sp, dict):
        raw = sp.get("steps_completed")
        if isinstance(raw, list):
            sp_completed = [s for s in raw if isinstance(s, str)]

    statuses: dict[str, str] = {}

    if sp_completed is not None:
        # Source of truth: step_progress.steps_completed[] (#1073)
        # Normalize frontend step IDs to backend keys for comparison
        completed_set = {_normalize_step_key(s) for s in sp_completed}
        sp_current = sp.get("current_step") if isinstance(sp, dict) else None
        normalized_current = _normalize_step_key(sp_current) if sp_current else None
        for _step_num, key in STEP_NAMES.items():
            if key in completed_set:
                statuses[key] = "completed"
            elif key == normalized_current and session.status == "in_progress":
                statuses[key] = "in_progress"
            elif session.status == "completed":
                # Completed session: treat all steps as completed even if
                # steps_completed[] is incomplete (#1073 review)
                statuses[key] = "completed"
            else:
                statuses[key] = "not_started"
    else:
        # Fallback: derive from integer current_step (legacy sessions)
        completed_step = session.current_step if session.status == "completed" else session.current_step - 1
        for step_num, key in STEP_NAMES.items():
            if step_num <= completed_step:
                statuses[key] = "completed"
            elif step_num == session.current_step and session.status == "in_progress":
                statuses[key] = "in_progress"
            else:
                statuses[key] = "not_started"

    return statuses


def _recommend_next_step(session: LearningSession) -> dict:
    """Apply rule-based logic to suggest the student's next action.

    Rules (priority order):
    1. Session complete -> suggest a new text
    2. Full reading score < 70 -> re-do full reading
    3. >= 3 character errors -> do vocab practice first
    4. LiveTutor accuracy < 70 -> re-read paragraphs
    5. Default -> continue from current step
    """
    if session.status == "completed":
        return {"action": "new_text", "step": None, "reason": "本課已完成！挑戰新課文吧。"}

    error_count = 0
    if session.reading_result and isinstance(session.reading_result, dict):
        errors = session.reading_result.get("error_chars", [])
        error_count = len(errors) if isinstance(errors, list) else 0

    accuracy = session.accuracy or 0.0

    if session.current_step >= 5 and session.full_reading_result:
        full_score = 0.0
        if isinstance(session.full_reading_result, dict):
            full_score = session.full_reading_result.get("match_rate", 0) or 0.0
        if full_score < 70:
            return {
                "action": "retry_step",
                "step": "full_reading",
                "step_label": STEP_LABELS[5],
                "reason": f"全文朗讀正確率 {full_score:.0f}%，建議再練習一次。",
            }

    if error_count >= 3 and session.current_step < 4:
        return {
            "action": "retry_step",
            "step": "vocab",
            "step_label": STEP_LABELS[4],
            "reason": f"發現 {error_count} 個錯字，建議先做生字練習。",
        }

    if accuracy > 0 and accuracy < 70 and session.current_step <= 2:
        return {
            "action": "retry_step",
            "step": "live_tutor",
            "step_label": STEP_LABELS[2],
            "reason": f"朗讀正確率 {accuracy:.0f}%，建議重練逐段朗讀。",
        }

    current_key = STEP_NAMES.get(session.current_step, "intro")
    return {
        "action": "continue",
        "step": current_key,
        "step_label": STEP_LABELS.get(session.current_step, ""),
        "reason": "繼續未完成的學習步驟。",
    }


# ── Stuck-Point Detection (Issue #91) ─────────────────────────────────────────

class StoryStuckItem(BaseModel):
    story_slug: str
    attempt_count: int
    best_accuracy: float
    last_attempt: str


class CharacterStuckItem(BaseModel):
    character: str
    error_count: int
    last_error_date: str | None


class StuckPointsResponse(BaseModel):
    story_stuck: list[StoryStuckItem]
    character_stuck: list[CharacterStuckItem]
    is_declining: bool
    accuracy_trend: list[float]


@router.get(
    "/learning/students/{student_id}/stuck-points",
    response_model=StuckPointsResponse,
)
def get_stuck_points(
    student_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Detect learning stuck-points for a student.

    Accessible by the student themselves or their teacher.

    Returns:
    - story_stuck: stories attempted 3+ times without >=5% accuracy improvement
    - character_stuck: characters with 3+ errors across sessions (last 30 days)
    - is_declining: True if last 3 sessions show strictly declining accuracy
    - accuracy_trend: list of accuracy values (oldest to newest, last 10 sessions)
    """
    verify_student_access(student_id, current_user, db)
    data = detect_stuck_points(student_id, db)
    logger.info(
        "Stuck-point detection for student %d: %d story stuck, %d char stuck, declining=%s",
        student_id,
        len(data["story_stuck"]),
        len(data["character_stuck"]),
        data["is_declining"],
    )
    return StuckPointsResponse(**data)


# ── Student Progress ──────────────────────────────────────────────────────────

class StepStatusItem(BaseModel):
    step_key: str
    step_label: str
    status: str  # not_started | in_progress | completed


class TextProgressItem(BaseModel):
    story_slug: str
    story_title: str | None  # human-readable title, e.g. "第六課 牛頓的故事"
    latest_session_id: int
    status: str  # in_progress | completed | abandoned
    steps: list[StepStatusItem]
    completion_pct: int  # 0-100
    overall_score: float | None
    accuracy: float | None
    started_at: datetime
    completed_at: datetime | None
    next_step: dict


class StudentProgressResponse(BaseModel):
    student_id: int
    texts_attempted: int
    texts_completed: int
    average_score: float | None
    texts: list[TextProgressItem]


@router.get(
    "/learning/students/{student_id}/progress",
    response_model=StudentProgressResponse,
)
def get_student_progress(
    student_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return per-text completion progress for a student.

    Aggregates all learning sessions grouped by story_slug, keeping the
    most-recent session per text to compute step completion status and
    a rule-based next-step recommendation.

    Access: student themselves, or a teacher of their classroom.
    """
    verify_student_access(student_id, current_user, db)

    sessions = (
        db.query(LearningSession)
        .options(joinedload(LearningSession.text))
        .filter(LearningSession.student_id == student_id)
        .order_by(LearningSession.started_at.desc(), LearningSession.id.desc())
        .all()
    )

    # Keep only the most recent session per story_slug
    seen: set[str] = set()
    latest_per_text: list[LearningSession] = []
    for s in sessions:
        slug = s.story_slug or f"session-{s.id}"
        if slug not in seen:
            seen.add(slug)
            latest_per_text.append(s)

    texts: list[TextProgressItem] = []
    scores: list[float] = []

    for s in latest_per_text:
        slug = s.story_slug or f"session-{s.id}"
        step_statuses = _compute_step_completion(s)
        completed_count = sum(1 for v in step_statuses.values() if v == "completed")
        completion_pct = round(completed_count / 6 * 100)

        step_items = [
            StepStatusItem(
                step_key=key,
                step_label=STEP_LABELS[num],
                status=step_statuses[key],
            )
            for num, key in STEP_NAMES.items()
        ]

        next_step = _recommend_next_step(s)

        if s.overall_score is not None:
            scores.append(s.overall_score)

        # Resolve human-readable title from the related Text record if available
        story_title: str | None = None
        if s.text is not None:
            story_title = s.text.title

        texts.append(TextProgressItem(
            story_slug=slug,
            story_title=story_title,
            latest_session_id=s.id,
            status=s.status,
            steps=step_items,
            completion_pct=completion_pct,
            overall_score=s.overall_score,
            accuracy=s.accuracy,
            started_at=s.started_at,
            completed_at=s.completed_at,
            next_step=next_step,
        ))

    # Use canonical query for the aggregate count (Issue #981)
    texts_completed = get_completed_story_count(db, student_id)
    average_score = round(sum(scores) / len(scores), 1) if scores else None

    logger.info(
        "Progress for student %d: %d texts, %d completed",
        student_id, len(texts), texts_completed,
    )

    return StudentProgressResponse(
        student_id=student_id,
        texts_attempted=len(texts),
        texts_completed=texts_completed,
        average_score=average_score,
        texts=texts,
    )
