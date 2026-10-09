"""Ownership + write-scope tests for reading-annotation persistence (Issue #3346, batch 7).

Covers backend/app/routes/learning/learning_annotations.py:

    PUT /api/learning/sessions/{session_id}/annotations  — delete-then-insert
    GET /api/learning/sessions/{session_id}/annotations

PUT is a destructive full replace. Before this file neither route had an
endpoint test, so dropping `get_owned_session` (letting anyone wipe another
student's marks) or the `session_id` filter on the DELETE (wiping the caller's
*other* sessions) would not turn anything red. batch 1 (#3347) covered
`get_owned_session` at helper level; this file checks it is wired into both
routes and that writes stay inside one session.

Least-privilege discipline (rules/testing-strategy.md): the rejected caller is
a classmate (a plain student), plus the class teacher to show the helper is
strict; never admin. Each rejection is paired with the owner succeeding, and
every write assertion re-reads the DB instead of trusting the response.

Run with:
    cd backend
    python -m pytest tests/test_annotations_ownership_3346.py -v
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth.password import hash_password
from app.database import get_db
from app.main import app
from app.models import Base
from app.models.annotation import AnnotationEntry
from app.models.school import Classroom, ClassroomStudent, School
from app.models.session import LearningSession
from app.models.user import User

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

PASSWORD = "Password1!"

U: dict[str, int] = {}
S: dict[str, int] = {}


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


def _user(db, key: str) -> User:
    user = User(
        email=f"ann3346_{key}@example.com",
        username=f"ann3346_{key}",
        password_hash=hash_password(PASSWORD),
        name=key,
        is_active=True,
        email_verified=True,
    )
    db.add(user)
    db.flush()
    U[key] = user.id
    return user


def _session(db, key: str, student_id: int) -> None:
    s = LearningSession(student_id=student_id, status="in_progress")
    db.add(s)
    db.flush()
    S[key] = s.id


def _mark(session_id: int, p: int, start: int, end: int, kind: str = "important") -> AnnotationEntry:
    return AnnotationEntry(session_id=session_id, paragraph_index=p, char_start=start,
                           char_end=end, annotation_type=kind, client_id=None)


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()

    school = School(name="ANN 3346 School")
    db.add(school)
    db.flush()
    teacher = _user(db, "teacher")
    student = _user(db, "student")
    classmate = _user(db, "classmate")
    classroom = Classroom(name="ANN", school_id=school.id, teacher_id=teacher.id, join_code="ANN3346A")
    db.add(classroom)
    db.flush()
    db.add_all([
        ClassroomStudent(classroom_id=classroom.id, student_id=student.id),
        ClassroomStudent(classroom_id=classroom.id, student_id=classmate.id),
    ])

    _session(db, "victim", student.id)        # target of the denial tests
    _session(db, "work", student.id)          # owner writes here
    _session(db, "sibling", student.id)       # owner's other session — must survive
    _session(db, "classmate_own", classmate.id)
    db.add_all([
        _mark(S["victim"], 0, 0, 2),
        _mark(S["victim"], 1, 3, 5, "unknown"),
        _mark(S["sibling"], 2, 0, 1),
    ])
    db.commit()
    db.close()

    app.dependency_overrides[get_db] = _override_get_db
    yield
    app.dependency_overrides.pop(get_db, None)
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


_TOKENS: dict[str, dict] = {}


def _auth(client, key: str) -> dict:
    if key not in _TOKENS:
        resp = client.post(
            "/api/auth/login",
            json={"email": f"ann3346_{key}@example.com", "password": PASSWORD},
        )
        assert resp.status_code == 200, resp.text
        _TOKENS[key] = {"Authorization": f"Bearer {resp.json()['access_token']}"}
    return _TOKENS[key]


def _url(key: str) -> str:
    return f"/api/learning/sessions/{S[key]}/annotations"


def _db_marks(session_key: str) -> list[tuple]:
    db = TestingSessionLocal()
    try:
        rows = (
            db.query(AnnotationEntry)
            .filter(AnnotationEntry.session_id == S[session_key])
            .order_by(AnnotationEntry.paragraph_index, AnnotationEntry.char_start)
            .all()
        )
        return [(r.paragraph_index, r.char_start, r.char_end, r.annotation_type) for r in rows]
    finally:
        db.close()


VICTIM_MARKS = [(0, 0, 2, "important"), (1, 3, 5, "unknown")]
ONE_MARK = {"annotations": [{"paragraph_index": 0, "char_start": 0, "char_end": 1, "annotation_type": "unknown"}]}


# ---------------------------------------------------------------------------
# Access
# ---------------------------------------------------------------------------


class TestAccess:
    def test_owner_can_load(self, client):
        r = client.get(_url("victim"), headers=_auth(client, "student"))
        assert r.status_code == 200, r.text
        got = [(a["paragraph_index"], a["char_start"], a["char_end"], a["annotation_type"])
               for a in r.json()["annotations"]]
        assert got == VICTIM_MARKS

    @pytest.mark.parametrize("as_key", ["classmate", "teacher"])
    def test_non_owner_cannot_load(self, client, as_key):
        r = client.get(_url("victim"), headers=_auth(client, as_key))
        assert r.status_code == 403, r.text
        assert "annotations" not in r.json()

    @pytest.mark.parametrize("as_key", ["classmate", "teacher"])
    def test_non_owner_cannot_overwrite(self, client, as_key):
        r = client.put(_url("victim"), headers=_auth(client, as_key), json=ONE_MARK)
        assert r.status_code == 403, r.text
        assert _db_marks("victim") == VICTIM_MARKS

    @pytest.mark.parametrize("as_key", ["classmate", "teacher"])
    def test_non_owner_cannot_wipe_with_empty_list(self, client, as_key):
        r = client.put(_url("victim"), headers=_auth(client, as_key), json={"annotations": []})
        assert r.status_code == 403, r.text
        assert _db_marks("victim") == VICTIM_MARKS

    def test_classmate_can_write_own_session(self, client):
        # positive control for the classmate denials
        r = client.put(_url("classmate_own"), headers=_auth(client, "classmate"), json=ONE_MARK)
        assert r.status_code == 200, r.text
        assert _db_marks("classmate_own") == [(0, 0, 1, "unknown")]

    def test_unauthenticated(self, client):
        assert client.get(_url("victim")).status_code == 401
        assert client.put(_url("victim"), json=ONE_MARK).status_code == 401
        assert _db_marks("victim") == VICTIM_MARKS

    def test_missing_session_is_404(self, client):
        r = client.put("/api/learning/sessions/999999/annotations",
                       headers=_auth(client, "student"), json=ONE_MARK)
        assert r.status_code == 404


# ---------------------------------------------------------------------------
# Write scope (owner)
# ---------------------------------------------------------------------------


class TestReplaceScope:
    def test_replace_writes_only_this_session(self, client):
        body = {"annotations": [
            {"paragraph_index": 1, "char_start": 4, "char_end": 6, "annotation_type": "important", "client_id": "c2"},
            {"paragraph_index": 0, "char_start": 2, "char_end": 3, "annotation_type": "unknown", "client_id": "c1"},
        ]}
        r = client.put(_url("work"), headers=_auth(client, "student"), json=body)
        assert r.status_code == 200, r.text
        # response is sorted by (paragraph, char_start) and carries server ids
        assert [a["client_id"] for a in r.json()["annotations"]] == ["c1", "c2"]
        assert all(isinstance(a["id"], int) for a in r.json()["annotations"])
        assert _db_marks("work") == [(0, 2, 3, "unknown"), (1, 4, 6, "important")]

    def test_replace_does_not_touch_owners_other_sessions(self, client):
        client.put(_url("work"), headers=_auth(client, "student"), json=ONE_MARK)
        assert _db_marks("sibling") == [(2, 0, 1, "important")]
        assert _db_marks("victim") == VICTIM_MARKS

    def test_second_put_replaces_not_appends(self, client):
        client.put(_url("work"), headers=_auth(client, "student"), json=ONE_MARK)
        client.put(_url("work"), headers=_auth(client, "student"), json=ONE_MARK)
        assert _db_marks("work") == [(0, 0, 1, "unknown")]

    def test_empty_list_clears_own_session_only(self, client):
        r = client.put(_url("work"), headers=_auth(client, "student"), json={"annotations": []})
        assert r.status_code == 200, r.text
        assert _db_marks("work") == []
        assert _db_marks("sibling") == [(2, 0, 1, "important")]


# ---------------------------------------------------------------------------
# Input validation / size cap (fail-closed: rejected input changes nothing)
# ---------------------------------------------------------------------------


def _n_marks(n: int) -> dict:
    return {"annotations": [
        {"paragraph_index": i, "char_start": 0, "char_end": 1, "annotation_type": "important"}
        for i in range(n)
    ]}


class TestValidation:
    def test_500_is_accepted(self, client):
        r = client.put(_url("work"), headers=_auth(client, "student"), json=_n_marks(500))
        assert r.status_code == 200, r.text
        assert len(_db_marks("work")) == 500

    def test_501_is_rejected_and_keeps_existing(self, client):
        # runs after test_500 (file order): the 500 rows must survive the rejected write
        r = client.put(_url("work"), headers=_auth(client, "student"), json=_n_marks(501))
        assert r.status_code == 422
        assert len(_db_marks("work")) == 500

    @pytest.mark.parametrize("bad", [
        {"paragraph_index": 0, "char_start": 0, "char_end": 1, "annotation_type": "highlight"},
        {"paragraph_index": 0, "char_start": 3, "char_end": 3, "annotation_type": "unknown"},
        {"paragraph_index": -1, "char_start": 0, "char_end": 1, "annotation_type": "unknown"},
    ])
    def test_invalid_mark_is_422(self, client, bad):
        r = client.put(_url("sibling"), headers=_auth(client, "student"), json={"annotations": [bad]})
        assert r.status_code == 422
        assert _db_marks("sibling") == [(2, 0, 1, "important")]
