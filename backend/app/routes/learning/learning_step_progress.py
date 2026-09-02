"""Step Progress routes (Issue #660).

Provides two endpoints to persist and retrieve per-step learning progress
from the `step_progress` JSONB column on LearningSession.

    PUT  /api/learning/sessions/{session_id}/progress  — save
    GET  /api/learning/sessions/{session_id}/progress  — load
"""
import logging
from datetime import datetime, timezone
from typing import Any
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ...auth.dependencies import get_current_user
from ._helpers import get_owned_session
from ...database import get_db
from ...models.session import LearningSession
from ...models.user import User
from ...schemas.session import StepProgressResponse, StepProgressSaveRequest, parse_step_progress
# DEPRECATED (#1182): _STEP_KEY_TO_NUM / _MAX_STEP_NUM / _normalize_step_key were used
# to sync the integer current_step column. Sync removed; imports no longer needed here.

router = APIRouter()
logger = logging.getLogger(__name__)


@router.put(
    "/learning/sessions/{session_id}/progress",
    response_model=StepProgressResponse,
    summary="Save step progress for a learning session (Issue #660)",
)
def save_step_progress(
    session_id: int,
    payload: StepProgressSaveRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Persist the frontend step-progress object to the DB.

    The payload mirrors the localStorage schema:
    - current_step: active step path key
    - steps_completed: list of completed step path keys
    - step_data: dict keyed by step path containing serialised progress

    Overwrites any previously stored step_progress for this session.
    Non-completed sessions only — completed sessions are read-only.
    """
    session = get_owned_session(session_id, current_user, db)

    # parse_step_progress logs a WARNING when the stored value is malformed
    # instead of silently discarding it (Issue #1180).
    existing_sp = parse_step_progress(
        session.step_progress,
        session_id=session_id,
        context="learning_step_progress.save_step_progress",
    )
    existing_meta: dict = dict(existing_sp.meta) if existing_sp is not None else {}
    stored_version: int | None = existing_sp.version if existing_sp is not None else None

    # Optimistic concurrency check (#1187): reject stale writes.
    # Prevents overwriting newer progress when a previous save failed and the
    # client retries with an older snapshot.
    if payload.version is not None and stored_version is not None:
        if payload.version < stored_version:
            raise HTTPException(
                status_code=409,
                detail={
                    "error": "stale_version",
                    "stored_version": stored_version,
                    "incoming_version": payload.version,
                    "message": "Incoming progress is older than stored version; refresh and retry.",
                },
            )

    # Bump version: max(stored, incoming) + 1, or start at 1 if none.
    next_version = max(
        stored_version or 0,
        payload.version or 0,
    ) + 1
    existing_meta["last_synced_at"] = datetime.now(tz=timezone.utc).isoformat()

    # Version is stored at the top level so the frontend can read it directly
    # from StepProgressData.version. __meta keeps other metadata (source, etc.).
    session.step_progress = {
        "current_step": payload.current_step,
        "steps_completed": payload.steps_completed,
        "step_data": payload.step_data,
        "version": next_version,
        "__meta": existing_meta,
    }

    # DEPRECATED (#1182): integer current_step sync removed.
    # step_progress.steps_completed is now the single source of truth;
    # session.current_step_derived computes the step number on the fly.
    # Do NOT add writes to session.current_step here.

    # Bug C fix (#1378): Append full-reading attempt to full_reading_attempts array.
    # When step_data contains 'full-reading'.result, extract it and append as a new
    # attempt snapshot (capped at 4).  Also update full_reading_result for backward compat.
    _maybe_append_full_reading_attempt(session, payload.step_data)

    # Issue #3024 — award step_complete XP (+ check badges) for any step that
    # is newly present in steps_completed vs. what was already stored. This is
    # the ONE place every step completion already flows through, so no new
    # endpoint or DB migration is needed. Runs in the SAME transaction as the
    # step_progress save (award_xp/check_and_award_badges only flush; the
    # db.commit() below covers both).
    previously_completed = existing_sp.steps_completed if existing_sp is not None else []
    xp_awarded, badges_unlocked = _award_step_complete_xp(
        db,
        student_id=current_user.id,
        session_id=session_id,
        previously_completed=previously_completed,
        newly_reported=payload.steps_completed,
    )

    db.commit()
    db.refresh(session)
    logger.info(
        "Saved step_progress for session %d (user %d): current=%s completed=%d xp_awarded=%d badges=%s",
        session_id, current_user.id, payload.current_step, len(payload.steps_completed),
        xp_awarded, badges_unlocked,
    )
    return StepProgressResponse(
        session_id=session.id,
        step_progress=session.step_progress,
        xp_awarded=xp_awarded,
        badges_unlocked=badges_unlocked,
    )


# ── Mid-session step-complete XP + badge check (Issue #3024) ──────────────────

#: 'report' is the results page itself (ReportPage marks it complete on mount
#: for teacher-dashboard visibility), not a step the student practiced. It
#: must never earn step_complete XP — that would double-count against the
#: session_complete settlement (POST /gamification/session-complete) that
#: fires at essentially the same moment.
_STEP_COMPLETE_XP_EXCLUDED_STEP_IDS = frozenset({"report"})


def _award_step_complete_xp(
    db: Session,
    *,
    student_id: int,
    session_id: int,
    previously_completed: list[str],
    newly_reported: list[str],
) -> tuple[int, list[str]]:
    """Award step_complete XP for steps newly present in `newly_reported`.

    Idempotent per (session_id, step_id): a step already present in
    `previously_completed` is skipped, so re-saving the same list (component
    remount, debounced re-sync) never double-awards. Returns (total XP
    awarded by this call, badge keys newly unlocked by this call) so the
    caller can surface both to the frontend for immediate feedback.
    """
    from ...services.gamification_service import award_xp, check_and_award_badges

    already = set(previously_completed)
    newly_completed = [
        step_id for step_id in newly_reported
        if step_id not in already and step_id not in _STEP_COMPLETE_XP_EXCLUDED_STEP_IDS
    ]
    if not newly_completed:
        return 0, []

    xp_awarded = 0
    for step_id in newly_completed:
        award_xp(
            db,
            student_id=student_id,
            event_type="step_complete",
            session_id=session_id,
            note=f"完成大題：{step_id}",
        )
        xp_awarded += 3  # XP_REWARDS["step_complete"]

    # Badges that can genuinely be judged from data available mid-session
    # (XP totals, level, distinct-event-type count) are checked here too —
    # this is what makes "達成目標的當下就跑出來" (issue #3024) literally true
    # for those badges. Badges that need full-session data (accuracy/streak/
    # story counts) simply won't satisfy their condition yet and are left for
    # the real session-complete settlement, which is unaffected by this call
    # (see the (session_id, event_type="session_complete") idempotency fix in
    # gamification_service.py).
    newly_unlocked = check_and_award_badges(db, student_id, session_id=session_id)
    return xp_awarded, newly_unlocked


# ── Bug C fix helpers ─────────────────────────────────────────────────────────

_MAX_FULL_READING_ATTEMPTS = 4


def _maybe_append_full_reading_attempt(
    session: "LearningSession",  # type: ignore[name-defined]
    step_data: dict[str, Any] | None,
) -> None:
    """If step_data includes a full-reading result, append it to full_reading_attempts.

    Rules:
    - Extract from step_data['full-reading']['result']
    - Build attempt snapshot with attempt_index, timestamp, cpm, accuracy, match_rate,
      duration_ms, audio_url
    - Append to session.full_reading_attempts (capped at _MAX_FULL_READING_ATTEMPTS)
    - Also update full_reading_result (scalar, backward compat) = latest attempt result
    - If the incoming result is identical to the last stored attempt (same cpm + duration_ms),
      skip to avoid duplicates from page reloads
    """
    if not step_data:
        return

    full_reading_data = step_data.get("full-reading")
    if not isinstance(full_reading_data, dict):
        return

    result = full_reading_data.get("result")
    if not isinstance(result, dict):
        return

    # Read current attempts (default to [] if missing/None/malformed)
    existing: list = session.full_reading_attempts  # type: ignore[assignment]
    if not isinstance(existing, list):
        existing = []

    # Deduplicate: skip if identical to the last attempt (prevent page-reload duplicates)
    if existing:
        last = existing[-1]
        if (
            last.get("cpm") == result.get("cpm")
            and last.get("duration_ms") == result.get("durationMs")
        ):
            return  # same attempt — no-op

    attempt_index = len(existing) + 1
    now_iso = datetime.now(tz=timezone.utc).isoformat()

    snapshot: dict[str, Any] = {
        "attempt_index": attempt_index,
        "timestamp": now_iso,
        "cpm": result.get("cpm"),
        "accuracy": result.get("accuracy"),
        "match_rate": result.get("matchRate"),
        "duration_ms": result.get("durationMs"),
        "audio_url": result.get("audioUrl") or result.get("audio_url"),
    }

    updated = existing + [snapshot]

    # Cap at 4 (per learning design: 超過 4 次只是背起來)
    if len(updated) > _MAX_FULL_READING_ATTEMPTS:
        updated = updated[-_MAX_FULL_READING_ATTEMPTS:]
        # Re-index attempt_index fields
        for i, attempt in enumerate(updated, start=1):
            attempt["attempt_index"] = i

    session.full_reading_attempts = updated

    # Backward compat: keep full_reading_result as the latest attempt's raw result
    session.full_reading_result = result


@router.get(
    "/learning/sessions/{session_id}/progress",
    response_model=StepProgressResponse,
    summary="Load step progress for a learning session (Issue #660)",
)
def get_step_progress(
    session_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return the stored step_progress for a session.

    Returns step_progress: null when no progress has been saved yet
    (frontend should fall back to localStorage in that case).
    """
    session = get_owned_session(session_id, current_user, db)
    return StepProgressResponse(session_id=session.id, step_progress=session.step_progress)
