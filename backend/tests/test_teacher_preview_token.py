"""Teacher preview-token issuance endpoint (Issue #3027).

POST /api/teacher/students/{student_id}/preview-token lets a teacher who
teaches student_id mint a short-lived, read-only "preview as this student"
token. This is deliberately NARROWER than the existing
`verify_student_access` helper (backend/app/routes/learning/_helpers.py),
which also allows the student themselves and linked parents — self-preview
and parent-preview are out of scope here (see
docs/prd/2026-09-hans-feedback-teacher-visibility.md §1.2).

Least-privilege discipline: the "must be rejected" tests below use a teacher
who is real and authenticated but simply does not teach the target student —
not an unauthenticated caller — because that is the actual attack surface
(a curious/malicious teacher, not a stranger).
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
from app.models.user import User
from app.auth.password import hash_password
from app.auth.jwt import decode_token

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

    school = School(name="Preview Test School")
    db.add(school)
    db.commit()
    db.refresh(school)

    # Teacher A teaches the student we'll preview.
    teacher_a = User(
        email="preview_teacher_a@example.com",
        username="preview_teacher_a",
        password_hash=hash_password("Password1!"),
        name="老師 A",
        is_active=True,
        email_verified=True,
    )
    db.add(teacher_a)
    db.commit()
    db.refresh(teacher_a)

    # Teacher B teaches nobody relevant — used for the least-privilege
    # rejection test (a real, authenticated, but unrelated teacher).
    teacher_b = User(
        email="preview_teacher_b@example.com",
        username="preview_teacher_b",
        password_hash=hash_password("Password1!"),
        name="老師 B",
        is_active=True,
        email_verified=True,
    )
    db.add(teacher_b)
    db.commit()
    db.refresh(teacher_b)

    student = User(
        email="preview_student@example.com",
        username="preview_student",
        password_hash=hash_password("Password1!"),
        name="小美",
        is_active=True,
        email_verified=True,
    )
    db.add(student)
    db.commit()
    db.refresh(student)

    classroom = Classroom(
        name="Preview Test Class",
        school_id=school.id,
        teacher_id=teacher_a.id,
        join_code="PREVIEWTEST",
    )
    db.add(classroom)
    db.commit()
    db.refresh(classroom)

    db.add(ClassroomStudent(classroom_id=classroom.id, student_id=student.id))
    db.commit()

    _state["teacher_a_email"] = teacher_a.email
    _state["teacher_b_email"] = teacher_b.email
    _state["student_id"] = student.id
    _state["student_name"] = student.name

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


class TestMintPreviewToken:
    def test_teacher_of_student_can_mint_preview_token(self, client):
        token = _login(client, _state["teacher_a_email"])
        resp = client.post(
            f"/api/teacher/students/{_state['student_id']}/preview-token",
            headers=auth_header(token),
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["student_id"] == _state["student_id"]
        assert body["student_name"] == _state["student_name"]
        assert "preview_token" in body and body["preview_token"]

        payload = decode_token(body["preview_token"])
        assert payload["sub"] == str(_state["student_id"])
        assert payload["preview"] is True

    def test_unrelated_teacher_cannot_mint_preview_token(self, client):
        """Least-privilege rejection: a real teacher who does not teach this
        student must be refused — not just an unauthenticated caller."""
        token = _login(client, _state["teacher_b_email"])
        resp = client.post(
            f"/api/teacher/students/{_state['student_id']}/preview-token",
            headers=auth_header(token),
        )
        assert resp.status_code == 403, resp.text

    def test_mint_requires_authentication(self, client):
        resp = client.post(f"/api/teacher/students/{_state['student_id']}/preview-token")
        assert resp.status_code == 401

    def test_mint_rejects_nonexistent_student_without_leaking_existence(self, client):
        """A nonexistent student can, by definition, never be in any teacher's
        classroom — the access check runs first and returns 403, the same
        response an unrelated-but-real student would get. This is
        deliberate: it does not let a caller distinguish "wrong student id"
        from "not your student" (fail-closed, no id-enumeration signal)."""
        token = _login(client, _state["teacher_a_email"])
        resp = client.post(
            "/api/teacher/students/999999/preview-token",
            headers=auth_header(token),
        )
        assert resp.status_code == 403
