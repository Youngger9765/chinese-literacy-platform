"""Shared dev/test classroom filter (#1985 + #1999).

Some seed/test classrooms (e.g. "PM Dogfood R2 班", "Bulk驗證 2026-05-16",
"PM R3 verify") were created during PM dogfooding and remain in production
data. They show up in real teachers' classroom lists and confuse the UX.

This helper provides a single source of truth for the dev-pattern regex so
both /api/teacher/classrooms (teacher_dashboard.py) and /api/classrooms
(classrooms/classroom_crud.py) apply identical filtering.

Filter is regex-based (no DB migration). Patterns are case-insensitive.
"""

import re

_DEV_CLASSROOM_PATTERN = re.compile(
    r"(?i)(PM\s*R\d|Bulk驗證|dogfood)",
)


def is_dev_classroom(name: str) -> bool:
    """Return True if the classroom name matches a dev/test pattern."""
    return bool(_DEV_CLASSROOM_PATTERN.search(name))
