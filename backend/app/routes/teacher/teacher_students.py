"""Teacher student routes — compatibility shim.

Issue #1882: Split from monolithic 567-line module into focused sub-modules.
This shim preserves the `router` export that __init__.py imports as `students_router`.

Sub-modules:
  teacher_student_sessions.py   — sessions list, dialogue, learning curve
  teacher_student_tags.py       — CRUD for student tags
  teacher_student_reports.py    — session report, teacher comment, AI comment
  teacher_classroom_stuck.py    — classroom stuck-point overview
  teacher_student_helpers.py    — shared helpers (_require_teacher_owns_student,
                                   _get_session_for_teacher, resolve_story_title)
"""
from fastapi import APIRouter

from .teacher_student_sessions import router as _sessions_router
from .teacher_student_tags import router as _tags_router
from .teacher_student_reports import router as _reports_router
from .teacher_classroom_stuck import router as _stuck_router

router = APIRouter(tags=["teacher"])
router.include_router(_sessions_router)
router.include_router(_tags_router)
router.include_router(_reports_router)
router.include_router(_stuck_router)
