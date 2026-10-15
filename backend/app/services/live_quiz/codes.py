"""6-digit join code generator — same retry-on-collision shape as
``app.routes.classrooms.helpers.generate_join_code``, but "unique" means
unique among ACTIVE games only (PRD §9 CTO review #1 / §5 技術選擇: a
game's code is freed up once it ends).

UI/UX review 2026-10-15 #1: NUMERIC ONLY (not the 6-char alnum alphabet
classroom join codes use) — a mixed-alphabet live-quiz code sitting next to
a classroom join code on the same screen was confusable; digits-only makes
the two visually distinct at a glance.
"""
from __future__ import annotations

import secrets
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from ...models.live_quiz import LiveQuizGame

_CODE_LENGTH = 6
_CODE_CHARS = "0123456789"
_MAX_RETRIES = 10


def generate_live_quiz_code(db: Session) -> str:
    now = datetime.now(timezone.utc)
    for _ in range(_MAX_RETRIES):
        code = "".join(secrets.choice(_CODE_CHARS) for _ in range(_CODE_LENGTH))
        clash = (
            db.query(LiveQuizGame.id)
            .filter(
                LiveQuizGame.code == code,
                LiveQuizGame.status != "ended",
                LiveQuizGame.expires_at > now,
            )
            .first()
        )
        if clash is None:
            return code
    raise RuntimeError("Failed to generate a unique live-quiz code after multiple retries")
