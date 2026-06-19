"""Teacher routes package.

Composes sub-module routers into a single router importable as:
    from backend.app.routes.teacher import router
"""
from fastapi import APIRouter

from .teacher_alerts import router as alerts_router
from .teacher_analytics import router as analytics_router
from .teacher_cross_text import router as cross_text_router
from .teacher_dashboard import router as dashboard_router
from .teacher_instructions import router as instructions_router
from .teacher_notifications import router as notifications_router
from .teacher_reports import router as reports_router
from .teacher_story_tags import router as story_tags_router
from .teacher_students import router as students_router
from .teacher_texts import router as texts_router
from .teacher_audio_replay import router as audio_replay_router
from .teacher_reading_progress import router as reading_progress_router

router = APIRouter()

router.include_router(dashboard_router)
router.include_router(analytics_router)
router.include_router(cross_text_router)
router.include_router(students_router)
router.include_router(alerts_router)
router.include_router(notifications_router)
router.include_router(reports_router)
router.include_router(instructions_router)
router.include_router(texts_router)
router.include_router(story_tags_router)
router.include_router(reading_progress_router)
router.include_router(audio_replay_router)

__all__ = ["router"]
