import time
import logging

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from .models import SessionState

logger = logging.getLogger(__name__)


class SessionStore:
    """DB-backed session store with in-memory hot cache and 30-minute TTL cleanup.

    Persistence strategy (Issue #961):
    - save(state, db, db_session_id): writes serialized SessionState to
      LearningSession.dialogue_state JSONB column AND the in-memory cache.
    - get(session_id, db, db_session_id): reads from in-memory cache first
      (fast path); falls back to DB on cache miss (survives Cloud Run restarts).
    - save(state) without db: writes to in-memory cache only (backwards compatible).
    - get(session_id) without db: returns None on cache miss (backwards compatible).
    """

    TTL_SECONDS = 30 * 60
    RATE_LIMIT = 30  # max requests per minute per session
    RATE_WINDOW = 60  # seconds

    def __init__(self):
        self._sessions: dict[str, SessionState] = {}
        self._rate_counts: dict[str, list[float]] = {}  # session_id -> [timestamps]

    def get(
        self,
        session_id: str,
        db: "Session | None" = None,
        db_session_id: int | None = None,
    ) -> SessionState | None:
        """Return SessionState from in-memory cache, or restore from DB on miss."""
        self._cleanup()
        if session_id in self._sessions:
            return self._sessions[session_id]

        # Cache miss — attempt DB restore if context provided
        if db is not None and db_session_id is not None:
            return self._restore_from_db(session_id, db, db_session_id)

        return None

    def save(
        self,
        state: SessionState,
        db: "Session | None" = None,
        db_session_id: int | None = None,
    ) -> None:
        """Persist SessionState to in-memory cache, and optionally to DB."""
        self._sessions[state.session_id] = state

        if db is not None and db_session_id is not None:
            self._persist_to_db(state, db, db_session_id)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _serialize(self, state: SessionState) -> dict:
        """Convert SessionState dataclass to a JSON-serializable dict."""
        import dataclasses
        return dataclasses.asdict(state)

    def _deserialize(self, data: dict) -> SessionState:
        """Reconstruct SessionState from a dict (e.g., loaded from JSONB)."""
        return SessionState(
            session_id=data["session_id"],
            story_title=data.get("story_title", ""),
            story_text=data.get("story_text", ""),
            conversation=data.get("conversation", []),
            understood_count=data.get("understood_count", 0),
            total_attempts=data.get("total_attempts", 0),
            current_phase=data.get("current_phase", "factual"),
            created_at=data.get("created_at", time.time()),
            consecutive_errors=data.get("consecutive_errors", 0),
            mispronounced_words=data.get("mispronounced_words"),
            accuracy=data.get("accuracy"),
            cpm=data.get("cpm"),
            teacher_instructions=data.get("teacher_instructions"),
            genre=data.get("genre"),
            reading_strategy=data.get("reading_strategy"),
        )

    def _persist_to_db(
        self,
        state: SessionState,
        db: "Session",
        db_session_id: int,
    ) -> None:
        """Write serialized state to LearningSession.dialogue_state column."""
        try:
            from ...models.session import LearningSession  # noqa: PLC0415

            ls = db.query(LearningSession).filter_by(id=db_session_id).first()
            if ls is not None:
                ls.dialogue_state = self._serialize(state)
                db.commit()
        except SQLAlchemyError:
            logger.warning(
                "Failed to persist dialogue_state to DB for db_session_id=%s",
                db_session_id,
                exc_info=True,
            )
            try:
                db.rollback()
            except SQLAlchemyError:
                pass

    def _restore_from_db(
        self,
        session_id: str,
        db: "Session",
        db_session_id: int,
    ) -> SessionState | None:
        """Load SessionState from LearningSession.dialogue_state column."""
        try:
            from ...models.session import LearningSession  # noqa: PLC0415

            ls = db.query(LearningSession).filter_by(id=db_session_id).first()
            if ls is None or ls.dialogue_state is None:
                return None

            data = ls.dialogue_state
            # Validate that the stored snapshot belongs to this session
            if data.get("session_id") != session_id:
                logger.warning(
                    "dialogue_state session_id mismatch: stored=%s requested=%s",
                    data.get("session_id"),
                    session_id,
                )
                return None

            state = self._deserialize(data)
            # Warm the in-memory cache so subsequent calls don't hit DB
            self._sessions[session_id] = state
            return state
        except (SQLAlchemyError, AttributeError, KeyError):
            logger.warning(
                "Failed to restore dialogue_state from DB for db_session_id=%s",
                db_session_id,
                exc_info=True,
            )
            return None

    def _cleanup(self) -> None:
        now = time.time()
        expired = [
            sid for sid, s in self._sessions.items()
            if now - s.created_at > self.TTL_SECONDS
        ]
        for sid in expired:
            del self._sessions[sid]

    def check_rate_limit(self, session_id: str) -> bool:
        """Return True if rate limit exceeded."""
        now = time.time()
        timestamps = self._rate_counts.get(session_id, [])
        # Remove old timestamps
        timestamps = [t for t in timestamps if now - t < self.RATE_WINDOW]
        if len(timestamps) >= self.RATE_LIMIT:
            return True
        timestamps.append(now)
        self._rate_counts[session_id] = timestamps
        return False
