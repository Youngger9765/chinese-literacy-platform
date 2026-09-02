"""PreviewModeWriteGuardMiddleware (Issue #3027).

A teacher "previewing as a student" holds a token whose `sub` resolves to
the real student (see app/auth/jwt.py::create_preview_access_token) so every
existing current_user.id-scoped read path keeps working unmodified. This
file is what actually enforces the "唯讀，不寫入" half of that design: a
single middleware, not 26 individually-patched endpoints (see
docs/prd/2026-09-hans-feedback-teacher-visibility.md §1.2/§1.3 for why).

Discipline followed here (per the mandate — see PR description):
  - Every write-block assertion uses the LOWEST-privilege identity available:
    the previewed student's own account. A preview token's `sub` IS that
    student, so testing with it is already testing at the floor — there is
    no lower-privilege caller for a student-owned write endpoint.
  - Every fail-closed assertion is paired with a positive control: the exact
    same identity, same endpoint, same payload, MINUS the preview claim,
    must still succeed. Isolates the preview claim as the only variable —
    otherwise "blocked" could just mean "the endpoint itself is broken".
  - The one known GET-with-a-side-effect path found while researching this
    feature (GET /learning/students/{id}/dashboard calling
    gamification_service._get_or_create_streak) gets its own dedicated test
    rather than being trusted to the HTTP-method heuristic alone.
"""
import sys
import os
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.database import get_db
from app.models import Base
from app.models.school import School, Classroom, ClassroomStudent
from app.models.session import LearningSession
from app.models.gamification import StudentStreak
from app.models.user import User
from app.auth.password import hash_password
from app.auth.jwt import create_access_token, create_preview_access_token

# ---------------------------------------------------------------------------
# SQLite in-memory DB (pattern copied from test_dashboard_assignment_completion.py)
# ---------------------------------------------------------------------------

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)

TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

_state: dict = {}


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    from sqlalchemy.dialects.postgresql import JSONB
    from sqlalchemy import JSON

    for table in Base.metadata.sorted_tables:
        for col in table.columns:
            if isinstance(col.type, JSONB):
                col.type = JSON()

    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()

    school = School(name="Guard Test School")
    db.add(school)
    db.commit()
    db.refresh(school)

    teacher = User(
        email="guard_teacher@example.com",
        username="guard_teacher",
        password_hash=hash_password("Password1!"),
        name="老師",
        is_active=True,
        email_verified=True,
    )
    db.add(teacher)
    db.commit()
    db.refresh(teacher)

    student = User(
        email="guard_student@example.com",
        username="guard_student",
        password_hash=hash_password("Password1!"),
        name="小美",
        is_active=True,
        email_verified=True,
    )
    db.add(student)
    db.commit()
    db.refresh(student)

    classroom = Classroom(
        name="Guard Test Class",
        school_id=school.id,
        teacher_id=teacher.id,
        join_code="GUARDTEST",
    )
    db.add(classroom)
    db.commit()
    db.refresh(classroom)

    db.add(ClassroomStudent(classroom_id=classroom.id, student_id=student.id))
    db.commit()

    now = datetime.now(timezone.utc)
    session = LearningSession(
        student_id=student.id,
        story_slug="1",
        status="in_progress",
        started_at=now,
    )
    db.add(session)
    db.commit()
    db.refresh(session)

    _state["teacher_id"] = teacher.id
    _state["student_id"] = student.id
    _state["session_id"] = session.id
    _state["preview_token"] = create_preview_access_token(
        student_id=student.id, teacher_id=teacher.id
    )
    _state["student_own_token"] = create_access_token(user_id=student.id)

    app.dependency_overrides[get_db] = _override_get_db

    try:
        from app.routes.auth import rate_limiter
        rate_limiter.reset()
    except Exception:
        pass

    yield

    app.dependency_overrides.pop(get_db, None)
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# Positive control: the SAME identity (the student), WITHOUT the preview
# claim, must still be able to write. This isolates the preview claim as
# the only variable in every "blocked" assertion below.
# ---------------------------------------------------------------------------

class TestPositiveControlNormalTokenStillWrites:
    def test_normal_student_token_can_post_mcq_attempt(self, client):
        resp = client.post(
            "/api/learning/mcq-attempt",
            json={
                "lesson_id": "1",
                "question_id": "q1",
                "choice": "A",
                "is_correct": True,
            },
            headers=auth_header(_state["student_own_token"]),
        )
        assert resp.status_code == 200, resp.text

    def test_normal_student_token_can_patch_own_session(self, client):
        resp = client.patch(
            f"/api/learning/sessions/{_state['session_id']}",
            json={"accuracy": 88.0},
            headers=auth_header(_state["student_own_token"]),
        )
        assert resp.status_code == 200, resp.text

    def test_normal_student_token_can_put_step_progress(self, client):
        resp = client.put(
            f"/api/learning/sessions/{_state['session_id']}/progress",
            json={"current_step": "vocab-definition", "steps_completed": [], "step_data": {}},
            headers=auth_header(_state["student_own_token"]),
        )
        assert resp.status_code == 200, resp.text


# ---------------------------------------------------------------------------
# The actual security boundary: preview token, lowest-privilege identity
# (the previewed student's own resolved identity), every write blocked.
# ---------------------------------------------------------------------------

class TestPreviewModeBlocksWrites:
    def test_preview_token_blocked_on_mcq_attempt(self, client):
        resp = client.post(
            "/api/learning/mcq-attempt",
            json={
                "lesson_id": "1",
                "question_id": "q1",
                "choice": "A",
                "is_correct": True,
            },
            headers=auth_header(_state["preview_token"]),
        )
        assert resp.status_code == 403, resp.text
        assert "唯讀" in resp.json()["detail"]

    def test_preview_token_blocked_on_session_patch(self, client):
        resp = client.patch(
            f"/api/learning/sessions/{_state['session_id']}",
            json={"accuracy": 12.0},
            headers=auth_header(_state["preview_token"]),
        )
        assert resp.status_code == 403, resp.text
        assert "唯讀" in resp.json()["detail"]

    def test_preview_token_blocked_on_step_progress_put(self, client):
        resp = client.put(
            f"/api/learning/sessions/{_state['session_id']}/progress",
            json={"current_step": "hacked", "steps_completed": [], "step_data": {}},
            headers=auth_header(_state["preview_token"]),
        )
        assert resp.status_code == 403, resp.text
        assert "唯讀" in resp.json()["detail"]

    def test_preview_token_blocked_write_did_not_actually_persist(self, client):
        """Belt-and-suspenders: not just the HTTP status, but confirm the
        session's accuracy from the earlier (still-green) positive-control
        test was not clobbered by the blocked preview write's payload."""
        resp = client.get(
            f"/api/learning/sessions/{_state['session_id']}",
            headers=auth_header(_state["student_own_token"]),
        )
        assert resp.status_code == 200
        assert resp.json()["accuracy"] == 88.0  # set by the positive control, not 12.0


class TestPreviewModeAllowsReads:
    def test_preview_token_allowed_on_recommendations_get(self, client):
        resp = client.get(
            f"/api/learning/recommendations/{_state['student_id']}?limit=5",
            headers=auth_header(_state["preview_token"]),
        )
        assert resp.status_code == 200, resp.text

    def test_preview_token_dashboard_get_does_not_create_streak_row(self, client):
        """Known risk (PRD §1.2/§1.3): GET .../dashboard calls
        gamification_service._get_or_create_streak(), which does db.add() +
        db.flush() without an explicit commit in this handler. This test
        settles empirically whether that write persists — it must not, in
        preview mode or otherwise, since this is nominally a GET."""
        db = TestingSessionLocal()
        try:
            before = db.query(StudentStreak).filter(
                StudentStreak.student_id == _state["student_id"]
            ).count()
        finally:
            db.close()

        resp = client.get(
            f"/api/learning/students/{_state['student_id']}/dashboard",
            headers=auth_header(_state["preview_token"]),
        )
        assert resp.status_code == 200, resp.text

        db = TestingSessionLocal()
        try:
            after = db.query(StudentStreak).filter(
                StudentStreak.student_id == _state["student_id"]
            ).count()
        finally:
            db.close()

        assert after == before, (
            "GET dashboard must not persist a new StudentStreak row — "
            f"before={before} after={after}"
        )


class TestBlockedResponseStillPassesThroughOtherMiddleware:
    """Registration-order regression (adversarial review finding, #3027).

    An earlier version registered PreviewModeWriteGuardMiddleware LAST,
    which — per Starlette's insert(0, ...) semantics — made it the
    OUTERMOST middleware. An outermost middleware that returns a response
    directly (without calling call_next) short-circuits every middleware
    registered before it: their dispatch() bodies never run at all. A real
    adversarial review caught this empirically (blocked response had none
    of SecurityHeadersMiddleware's headers). This test locks the fix: the
    guard must be registered innermost (first), so a blocked response still
    gets dressed by every middleware that wraps it on the way back out.
    """

    def test_blocked_write_response_still_carries_security_headers(self, client):
        resp = client.post(
            "/api/learning/mcq-attempt",
            json={
                "lesson_id": "1",
                "question_id": "q1",
                "choice": "A",
                "is_correct": True,
            },
            headers=auth_header(_state["preview_token"]),
        )
        assert resp.status_code == 403
        # These are set by SecurityHeadersMiddleware's dispatch(), which only
        # runs if the guard actually calls call_next() into it. If the guard
        # were outermost, these headers would be entirely absent.
        assert resp.headers.get("x-content-type-options") == "nosniff"
        assert resp.headers.get("x-frame-options") == "DENY"


class TestInvalidTokenIsNotTreatedAsPreview:
    def test_garbage_token_falls_through_to_normal_401_not_preview_403(self, client):
        """A malformed/undecodable bearer must NOT be swallowed by the
        preview guard's own error message — it should fail exactly like it
        always did (401 from get_current_user), so this middleware never
        masks a real auth failure as a preview-mode block."""
        resp = client.post(
            "/api/learning/mcq-attempt",
            json={
                "lesson_id": "1",
                "question_id": "q1",
                "choice": "A",
                "is_correct": True,
            },
            headers=auth_header("not-a-real-jwt"),
        )
        assert resp.status_code == 401
        assert "唯讀" not in resp.json().get("detail", "")
