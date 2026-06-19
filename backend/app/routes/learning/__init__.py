"""Learning routes package.

Splits the original monolithic learning.py (1,881 lines) into focused sub-modules:

- _helpers.py                      — Shared helpers (verify_student_access, ConversationTurn)
- learning_sessions.py             — Session CRUD (create/list/get/update)
- learning_reading.py              — AI reading analysis (Step 6)
- learning_comprehension.py        — Socratic Q&A + chat (Step 3)
- learning_comprehension_score.py  — Dialogue history + comprehension scoring (Issues #242/#243)
- learning_errors.py               — Error patterns, recommended vocab, corrections, alerts
- learning_progress.py             — Stuck points + per-text progress tracking
- learning_step_progress.py        — Step progress persistence (Issue #660)
- learning_recommendations.py      — Rule-based + AI story recommendations
- learning_dashboard.py            — Student progress dashboard (Issue #25)
- learning_vocab.py                — Sentence practice + listening comprehension
- learning_exit_ticket.py          — Exit ticket generate + submit (Issue #463)
- mcq_rescue.py                    — MCQ rescue AI tutor endpoints (Issue #1387)
- mcq_attempt.py                   — MCQ attempt telemetry endpoint (Issue #1507)
- toolbox.py                       — Practice toolbox session endpoints (Issue #1463 / #1460)
- learning_audio_replay.py         — Student reading audio signed-URL replay (Issue #2266)

The composed router is re-exported as `router` so that main.py's existing
`app.include_router(learning.router, prefix="/api")` continues to work unchanged.
"""
from fastapi import APIRouter

from .learning_sessions import router as sessions_router
from .learning_reading import router as reading_router
from .learning_comprehension import router as comprehension_router
from .learning_comprehension_score import router as comprehension_score_router
from .learning_errors import router as errors_router
from .learning_progress import router as progress_router
from .learning_step_progress import router as step_progress_router
from .learning_recommendations import router as recommendations_router
from .learning_dashboard import router as dashboard_router
# Re-export symbols that parents.py imports by name
from .learning_dashboard import DashboardResponse, get_student_dashboard  # noqa: F401
from .learning_vocab import router as vocab_router
from .learning_strategy import router as strategy_router
from .learning_exit_ticket import router as exit_ticket_router
from .learning_reading_history import router as reading_history_router
from .mcq_rescue import router as mcq_rescue_router
from .mcq_attempt import router as mcq_attempt_router
from .toolbox import router as toolbox_router
from .learning_annotations import router as annotations_router
from .learning_audio_replay import router as audio_replay_router

router = APIRouter(tags=["learning"])

router.include_router(sessions_router)
router.include_router(reading_router)
router.include_router(comprehension_router)
router.include_router(comprehension_score_router)
router.include_router(errors_router)
router.include_router(progress_router)
router.include_router(step_progress_router)
router.include_router(recommendations_router)
router.include_router(dashboard_router)
router.include_router(vocab_router)
router.include_router(strategy_router)
router.include_router(exit_ticket_router)
router.include_router(reading_history_router)
router.include_router(mcq_rescue_router)
router.include_router(mcq_attempt_router)
router.include_router(toolbox_router)
router.include_router(annotations_router)
router.include_router(audio_replay_router)

__all__ = ["router"]
