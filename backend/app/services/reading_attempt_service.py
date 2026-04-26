"""Service helpers for versioned reading_result snapshots.

Issue #1183: reading_result JSONB 無版本紀錄（重練覆蓋歷史）

When a student retries a reading exercise, the previous reading_result must be
snapshotted to ReadingAttemptHistory BEFORE the LearningSession column is
overwritten.  This ensures no attempt is ever silently lost.

Public API
----------
snapshot_reading_result(db, session)
    Call this BEFORE assigning session.reading_result = new_value.
    Snapshots the *current* value (if not None) into ReadingAttemptHistory.

get_reading_history(db, session_id) -> list[dict]
    Return all historical attempts for a session, ordered by attempt_no.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from sqlalchemy.orm import Session as DBSession

from app.models.session import LearningSession, ReadingAttemptHistory

if TYPE_CHECKING:
    pass  # avoid circular imports

logger = logging.getLogger(__name__)


def snapshot_reading_result(db: DBSession, session: LearningSession) -> int | None:
    """Snapshot session.reading_result into ReadingAttemptHistory.

    Must be called BEFORE the caller overwrites session.reading_result.

    Returns
    -------
    int | None
        The attempt_no assigned to the new snapshot, or None if there was
        nothing to snapshot (session.reading_result was already None).
    """
    if session.reading_result is None:
        return None

    # Determine the next attempt_no (current max + 1, 1-based)
    existing_max = (
        db.query(ReadingAttemptHistory.attempt_no)
        .filter(ReadingAttemptHistory.session_id == session.id)
        .order_by(ReadingAttemptHistory.attempt_no.desc())
        .limit(1)
        .scalar()
    )
    next_attempt_no = (existing_max or 0) + 1

    snapshot = ReadingAttemptHistory(
        session_id=session.id,
        attempt_no=next_attempt_no,
        reading_result=session.reading_result,
    )
    db.add(snapshot)
    logger.info(
        "Snapshotted reading_result for session %d → attempt_no=%d",
        session.id,
        next_attempt_no,
    )
    return next_attempt_no


def get_reading_history(db: DBSession, session_id: int) -> list[dict]:
    """Return all snapshotted reading_result attempts for session_id.

    The list is ordered by attempt_no ascending (oldest first).
    The *current* value on LearningSession.reading_result is NOT included —
    callers should append it separately if they want a complete picture.

    Returns
    -------
    list[dict]
        Each entry: {"attempt_no": int, "reading_result": dict, "created_at": str}
    """
    rows = (
        db.query(ReadingAttemptHistory)
        .filter(ReadingAttemptHistory.session_id == session_id)
        .order_by(ReadingAttemptHistory.attempt_no)
        .all()
    )
    return [
        {
            "attempt_no": row.attempt_no,
            "reading_result": row.reading_result,
            "created_at": row.created_at.isoformat(),
        }
        for row in rows
    ]
