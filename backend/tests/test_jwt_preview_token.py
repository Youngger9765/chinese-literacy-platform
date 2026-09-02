"""Preview-mode JWT helper (Issue #3027).

create_preview_access_token() must mint a token whose `sub` claim resolves to
the STUDENT being previewed (so every existing current_user.id-scoped read
path — e.g. GET /learning/recommendations/{student_id} — works unmodified),
while carrying `preview=True` + `preview_by=<teacher_id>` claims that
PreviewModeWriteGuardMiddleware (app/main.py) uses to block writes.

See docs/prd/2026-09-hans-feedback-teacher-visibility.md §1.2.
"""
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

os.environ.setdefault("JWT_SECRET_KEY", "ci-test-secret-key-not-for-production")

from app.auth.jwt import create_access_token, create_preview_access_token, decode_token


def test_preview_token_sub_is_the_student_not_the_teacher():
    """sub must be the STUDENT id — this is what lets existing read routes work
    unmodified (they all resolve `current_user` from `sub`)."""
    token = create_preview_access_token(student_id=6, teacher_id=99)
    payload = decode_token(token)
    assert payload["sub"] == "6"


def test_preview_token_carries_preview_claims():
    token = create_preview_access_token(student_id=6, teacher_id=99)
    payload = decode_token(token)
    assert payload["preview"] is True
    assert payload["preview_by"] == 99


def test_preview_token_is_short_lived():
    """Preview tokens must expire much sooner than a normal 8h session token —
    it's a scoped read-only loan, not a login."""
    token = create_preview_access_token(student_id=6, teacher_id=99)
    payload = decode_token(token)
    normal_token = create_access_token(user_id=6)
    normal_payload = decode_token(normal_token)
    assert payload["exp"] < normal_payload["exp"]


def test_normal_access_token_has_no_preview_claim():
    """Regression guard: a normal login token must NOT accidentally carry a
    preview claim (that would make the write-guard block real users)."""
    token = create_access_token(user_id=6)
    payload = decode_token(token)
    assert "preview" not in payload
