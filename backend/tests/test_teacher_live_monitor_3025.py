"""Teacher live classroom monitor (Issue #3025).

GET /api/teacher/classrooms/{classroom_id}/live-monitor

Why
---
Teacher feedback from three on-site 課後學習扶助 demos: while students work
simultaneously, the teacher has no way to see, in real time, which student
is on which 大題 and who is stuck. Decided design (see issue #3025 comment):

  - Liveness: the frontend polls this endpoint every 5-10s while the page is
    open. This endpoint itself is a plain synchronous GET — no push
    infrastructure.
  - "Stuck" signal: the SAME question answered wrong >= 3 times. This is the
    only signal computable today because `mcq_attempt` has no session_id and
    only 3 of 40+ exercise components write to it — see
    app/models/mcq_attempt.py's module docstring.

Because most 大題 produce no mcq_attempt rows at all, a student with zero
rows MUST show up as `has_data: False` (an explicit "no data" state), never
silently rendered the same as a student who is doing fine. That is the
specific false-negative this feature exists to avoid.

Least-privilege discipline (matches test_teacher_preview_token.py): the
"must be rejected" test uses a real, authenticated teacher who simply does
not own this classroom — not an unauthenticated caller — because that is
the actual attack surface. Paired with a positive control (the owning
teacher, same classroom) so the negative test cannot pass by accident (e.g.
the whole endpoint 500ing for everyone).
"""
import sys
import os
from datetime import datetime, timedelta, timezone

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
from app.models.user import User
from app.models.mcq_attempt import McqAttempt
from app.auth.password import hash_password

# ---------------------------------------------------------------------------
# SQLite in-memory DB (pattern copied from test_teacher_preview_token.py)
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

    school = School(name="Live Monitor Test School")
    db.add(school)
    db.commit()
    db.refresh(school)

    teacher_a = User(
        email="live_monitor_teacher_a@example.com",
        username="live_monitor_teacher_a",
        password_hash=hash_password("Password1!"),
        name="老師 A",
        is_active=True,
        email_verified=True,
    )
    teacher_b = User(
        email="live_monitor_teacher_b@example.com",
        username="live_monitor_teacher_b",
        password_hash=hash_password("Password1!"),
        name="老師 B",
        is_active=True,
        email_verified=True,
    )
    db.add_all([teacher_a, teacher_b])
    db.commit()
    db.refresh(teacher_a)
    db.refresh(teacher_b)

    # Four students exercising the four states this endpoint must distinguish.
    no_data_student = User(
        email="lm_no_data@example.com", username="lm_no_data",
        password_hash=hash_password("Password1!"), name="小安",
        is_active=True, email_verified=True,
    )
    almost_stuck_student = User(
        email="lm_almost_stuck@example.com", username="lm_almost_stuck",
        password_hash=hash_password("Password1!"), name="小美",
        is_active=True, email_verified=True,
    )
    stuck_student = User(
        email="lm_stuck@example.com", username="lm_stuck",
        password_hash=hash_password("Password1!"), name="小華",
        is_active=True, email_verified=True,
    )
    recovered_student = User(
        email="lm_recovered@example.com", username="lm_recovered",
        password_hash=hash_password("Password1!"), name="小強",
        is_active=True, email_verified=True,
    )
    db.add_all([no_data_student, almost_stuck_student, stuck_student, recovered_student])
    db.commit()
    for s in (no_data_student, almost_stuck_student, stuck_student, recovered_student):
        db.refresh(s)

    classroom = Classroom(
        name="Live Monitor Test Class",
        school_id=school.id,
        teacher_id=teacher_a.id,
        join_code="LIVEMONTEST",
    )
    db.add(classroom)
    db.commit()
    db.refresh(classroom)

    for s in (no_data_student, almost_stuck_student, stuck_student, recovered_student):
        db.add(ClassroomStudent(classroom_id=classroom.id, student_id=s.id))
    db.commit()

    now = datetime.now(timezone.utc)

    # 小美: 2 wrong attempts on the same question — not stuck yet (threshold is 3).
    for i in range(2):
        db.add(McqAttempt(
            user_id=almost_stuck_student.id,
            lesson_id="L0001",
            question_id="L0001-q2",
            choice="A",
            is_correct=False,
            created_at=now - timedelta(seconds=(2 - i) * 10),
        ))

    # 小華: 3 wrong attempts on the same question, latest is still wrong — stuck.
    for i in range(3):
        db.add(McqAttempt(
            user_id=stuck_student.id,
            lesson_id="L0002",
            question_id="L0002-spotlight-guided-1",
            choice="B",
            is_correct=False,
            created_at=now - timedelta(seconds=(3 - i) * 10),
        ))

    # 小強: 3 wrong then 1 correct on the SAME question — got there in the end,
    # must NOT be flagged stuck even though the historical wrong count is >= 3.
    for i in range(3):
        db.add(McqAttempt(
            user_id=recovered_student.id,
            lesson_id="L0003",
            question_id="L0003-q0",
            choice="C",
            is_correct=False,
            created_at=now - timedelta(seconds=(5 - i) * 10),
        ))
    db.add(McqAttempt(
        user_id=recovered_student.id,
        lesson_id="L0003",
        question_id="L0003-q0",
        choice="A",
        is_correct=True,
        created_at=now - timedelta(seconds=1),
    ))
    db.commit()

    _state["teacher_a_email"] = teacher_a.email
    _state["teacher_b_email"] = teacher_b.email
    _state["classroom_id"] = classroom.id
    _state["no_data_student_id"] = no_data_student.id
    _state["almost_stuck_student_id"] = almost_stuck_student.id
    _state["stuck_student_id"] = stuck_student.id
    _state["recovered_student_id"] = recovered_student.id

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


def _login(client, email: str) -> str:
    resp = client.post("/api/auth/login", json={"email": email, "password": "Password1!"})
    assert resp.status_code == 200, f"Login failed: {resp.json()}"
    return resp.json()["access_token"]


def auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


class TestAuthorization:
    def test_requires_authentication(self, client):
        resp = client.get(f"/api/teacher/classrooms/{_state['classroom_id']}/live-monitor")
        assert resp.status_code == 401

    def test_unrelated_teacher_forbidden(self, client):
        """Least-privilege rejection: a real, authenticated teacher who does
        not own this classroom must be refused."""
        token = _login(client, _state["teacher_b_email"])
        resp = client.get(
            f"/api/teacher/classrooms/{_state['classroom_id']}/live-monitor",
            headers=auth_header(token),
        )
        assert resp.status_code == 403

    def test_owning_teacher_can_view(self, client):
        """Positive control paired with the rejection above — proves the 403
        is a real access-control decision, not the whole endpoint failing."""
        token = _login(client, _state["teacher_a_email"])
        resp = client.get(
            f"/api/teacher/classrooms/{_state['classroom_id']}/live-monitor",
            headers=auth_header(token),
        )
        assert resp.status_code == 200, resp.text

    def test_nonexistent_classroom_404s(self, client):
        token = _login(client, _state["teacher_a_email"])
        resp = client.get(
            "/api/teacher/classrooms/999999/live-monitor",
            headers=auth_header(token),
        )
        assert resp.status_code == 404


class TestLiveMonitorSignal:
    def _get(self, client):
        token = _login(client, _state["teacher_a_email"])
        resp = client.get(
            f"/api/teacher/classrooms/{_state['classroom_id']}/live-monitor",
            headers=auth_header(token),
        )
        assert resp.status_code == 200, resp.text
        return resp.json()

    def _entry(self, body, student_id):
        matches = [s for s in body["students"] if s["student_id"] == student_id]
        assert len(matches) == 1, f"expected exactly one entry for {student_id}, got {matches}"
        return matches[0]

    def test_all_four_students_present(self, client):
        body = self._get(client)
        assert len(body["students"]) == 4

    def test_student_with_no_attempts_is_explicit_no_data(self, client):
        """The false-negative this feature exists to avoid: a student with
        zero trackable attempts must NOT look like a fine/idle student."""
        body = self._get(client)
        entry = self._entry(body, _state["no_data_student_id"])
        assert entry["has_data"] is False
        assert entry["is_stuck"] is False
        assert entry["lesson_id"] is None
        assert entry["question_label"] is None

    def test_two_wrong_attempts_not_yet_stuck(self, client):
        body = self._get(client)
        entry = self._entry(body, _state["almost_stuck_student_id"])
        assert entry["has_data"] is True
        assert entry["wrong_count"] == 2
        assert entry["is_stuck"] is False

    def test_three_wrong_attempts_on_same_question_is_stuck(self, client):
        body = self._get(client)
        entry = self._entry(body, _state["stuck_student_id"])
        assert entry["has_data"] is True
        assert entry["wrong_count"] == 3
        assert entry["is_stuck"] is True
        assert entry["lesson_id"] == "L0002"

    def test_eventually_correct_is_not_stuck_despite_past_wrong_streak(self, client):
        """3 wrong + a final correct on the exact same question must clear
        the stuck flag — the student solved it, even though the historical
        wrong-count on that question is still >= 3."""
        body = self._get(client)
        entry = self._entry(body, _state["recovered_student_id"])
        assert entry["has_data"] is True
        assert entry["is_stuck"] is False

    def test_question_label_is_human_readable_for_known_shapes(self, client):
        body = self._get(client)
        stuck_entry = self._entry(body, _state["stuck_student_id"])
        # L0002-spotlight-guided-1 must not be shown as a raw internal id.
        assert "L0002-spotlight-guided-1" not in stuck_entry["question_label"]
        assert stuck_entry["question_label"]

    def test_tracked_exercise_types_disclosed(self, client):
        """Honesty requirement: the response must disclose which exercise
        types can even produce a signal, since most cannot (Issue #3025)."""
        body = self._get(client)
        assert isinstance(body["tracked_exercise_types"], list)
        assert len(body["tracked_exercise_types"]) > 0

    def test_last_activity_at_present_only_when_has_data(self, client):
        body = self._get(client)
        no_data_entry = self._entry(body, _state["no_data_student_id"])
        stuck_entry = self._entry(body, _state["stuck_student_id"])
        assert no_data_entry["last_activity_at"] is None
        assert stuck_entry["last_activity_at"] is not None


class TestDescribeQuestionIdUnit:
    """Pure-function unit tests for the label mapping — no DB needed."""

    def test_comprehension_mcq_pattern(self):
        from app.services.live_monitor_service import describe_question_id
        label = describe_question_id("L0001-q0")
        assert "1" in label  # 0-indexed -> displayed as 第 1 題

    def test_spotlight_guided_pattern(self):
        from app.services.live_monitor_service import describe_question_id
        label = describe_question_id("L0001-spotlight-guided-2")
        assert "引導" in label

    def test_spotlight_trait_pattern(self):
        from app.services.live_monitor_service import describe_question_id
        label = describe_question_id("L0001-spotlight-trait")
        assert "情意" in label

    def test_unknown_shape_falls_back_without_crashing(self):
        from app.services.live_monitor_service import describe_question_id
        label = describe_question_id("some-opaque-content-block-id-99")
        assert label
        assert "some-opaque-content-block-id-99" not in label
