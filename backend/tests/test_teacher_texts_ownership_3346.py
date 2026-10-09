"""Ownership tests for the teacher custom-text library (Issue #3346, batch 6).

Covers backend/app/routes/teacher/teacher_texts.py:

    GET    /api/teacher/my-texts
    GET    /api/teacher/my-texts/{text_id}
    POST   /api/teacher/my-texts
    PUT    /api/teacher/my-texts/{text_id}
    DELETE /api/teacher/my-texts/{text_id}

Every read/write is scoped by `Text.teacher_id == current_user.id` (list query
and `_get_text_or_404`). Before this file nothing asserted that scoping, so
dropping it would let any logged-in user read, edit or delete another teacher's
texts by id.

Least-privilege discipline (rules/testing-strategy.md): the "other user" in
the rejection cases is the least-privileged account that can log in — a
student — plus another teacher; never admin. Each rejection is paired with the
owner succeeding on the same row, and writes are re-read from the DB rather
than trusting the response.

Run with:
    cd backend
    python -m pytest tests/test_teacher_texts_ownership_3346.py -v
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
from app.models.text import Text, TextStatus, VisibilityLevel
from app.models.user import User

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

PASSWORD = "Password1!"

U: dict[str, int] = {}
T: dict[str, int] = {}

OTHERS = ["teacher_b", "student"]


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


def _user(db, key: str) -> User:
    user = User(
        email=f"txt3346_{key}@example.com",
        username=f"txt3346_{key}",
        password_hash=hash_password(PASSWORD),
        name=key,
        is_active=True,
        email_verified=True,
    )
    db.add(user)
    db.flush()
    U[key] = user.id
    return user


def _text(db, key: str, owner: int | None, title: str) -> None:
    t = Text(
        title=title,
        paragraphs=["第一段。"],
        full_text="第一段。",
        char_count=4,
        grade=5,
        grade_code="G5",
        genre="記敘文",
        text_type="單",
        category="Fable",
        visibility=VisibilityLevel.private if owner else VisibilityLevel.platform,
        status=TextStatus.draft if owner else TextStatus.published,
        teacher_id=owner,
        created_by_id=owner,
    )
    db.add(t)
    db.flush()
    T[key] = t.id


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    teacher_a = _user(db, "teacher_a")
    teacher_b = _user(db, "teacher_b")
    _user(db, "student")
    _text(db, "a_main", teacher_a.id, "A 的課文")
    _text(db, "a_to_delete", teacher_a.id, "A 要刪的課文")
    _text(db, "b_main", teacher_b.id, "B 的課文")
    _text(db, "platform", None, "平台課文")  # teacher_id NULL — nobody's "my text"
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
            json={"email": f"txt3346_{key}@example.com", "password": PASSWORD},
        )
        assert resp.status_code == 200, resp.text
        _TOKENS[key] = {"Authorization": f"Bearer {resp.json()['access_token']}"}
    return _TOKENS[key]


def _row(text_id: int) -> Text | None:
    db = TestingSessionLocal()
    try:
        return db.get(Text, text_id)
    finally:
        db.close()


# ---------------------------------------------------------------------------
# List
# ---------------------------------------------------------------------------


class TestList:
    def test_owner_lists_only_own_texts(self, client):
        r = client.get("/api/teacher/my-texts", headers=_auth(client, "teacher_a"))
        assert r.status_code == 200, r.text
        assert {t["id"] for t in r.json()["texts"]} >= {T["a_main"]}
        assert {t["id"] for t in r.json()["texts"]}.isdisjoint({T["b_main"], T["platform"]})

    def test_other_teacher_lists_only_their_own(self, client):
        # positive control: the filter is per-owner, not "return nothing"
        r = client.get("/api/teacher/my-texts", headers=_auth(client, "teacher_b"))
        assert [t["id"] for t in r.json()["texts"]] == [T["b_main"]]

    def test_student_lists_nothing(self, client):
        r = client.get("/api/teacher/my-texts", headers=_auth(client, "student"))
        assert r.status_code == 200, r.text
        assert r.json() == {"texts": [], "total": 0}

    def test_unauthenticated_is_401(self, client):
        assert client.get("/api/teacher/my-texts").status_code == 401


# ---------------------------------------------------------------------------
# Read one
# ---------------------------------------------------------------------------


class TestGetOne:
    def test_owner_gets_detail(self, client):
        r = client.get(f"/api/teacher/my-texts/{T['a_main']}", headers=_auth(client, "teacher_a"))
        assert r.status_code == 200, r.text
        assert r.json()["paragraphs"] == ["第一段。"]

    @pytest.mark.parametrize("as_key", OTHERS)
    def test_non_owner_gets_404(self, client, as_key):
        # 404, not 403: the route must not confirm the id exists.
        r = client.get(f"/api/teacher/my-texts/{T['a_main']}", headers=_auth(client, as_key))
        assert r.status_code == 404, r.text
        assert "paragraphs" not in r.json()

    def test_platform_text_is_not_anyones_my_text(self, client):
        r = client.get(f"/api/teacher/my-texts/{T['platform']}", headers=_auth(client, "teacher_a"))
        assert r.status_code == 404


# ---------------------------------------------------------------------------
# Update
# ---------------------------------------------------------------------------


class TestUpdate:
    @pytest.mark.parametrize("as_key", OTHERS)
    def test_non_owner_cannot_edit(self, client, as_key):
        r = client.put(
            f"/api/teacher/my-texts/{T['a_main']}",
            headers=_auth(client, as_key),
            json={"title": "被改掉了", "paragraphs": ["惡意內容"]},
        )
        assert r.status_code == 404, r.text
        row = _row(T["a_main"])
        assert row.title == "A 的課文"
        assert row.paragraphs == ["第一段。"]

    def test_owner_can_edit(self, client):
        r = client.put(
            f"/api/teacher/my-texts/{T['a_main']}",
            headers=_auth(client, "teacher_a"),
            json={"title": "A 改過的標題", "genre": "說明文"},
        )
        assert r.status_code == 200, r.text
        row = _row(T["a_main"])
        assert (row.title, row.genre, row.category) == ("A 改過的標題", "說明文", "Science")
        assert row.teacher_id == U["teacher_a"]


# ---------------------------------------------------------------------------
# Delete
# ---------------------------------------------------------------------------


class TestDelete:
    @pytest.mark.parametrize("as_key", OTHERS)
    def test_non_owner_cannot_delete(self, client, as_key):
        r = client.delete(f"/api/teacher/my-texts/{T['a_to_delete']}", headers=_auth(client, as_key))
        assert r.status_code == 404, r.text
        assert _row(T["a_to_delete"]) is not None

    def test_non_owner_cannot_delete_platform_text(self, client):
        r = client.delete(f"/api/teacher/my-texts/{T['platform']}", headers=_auth(client, "teacher_a"))
        assert r.status_code == 404
        assert _row(T["platform"]) is not None

    def test_owner_can_delete(self, client):
        # runs after the non-owner attempts above (file order)
        r = client.delete(f"/api/teacher/my-texts/{T['a_to_delete']}", headers=_auth(client, "teacher_a"))
        assert r.status_code == 204, r.text
        assert _row(T["a_to_delete"]) is None


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------


class TestCreate:
    def test_created_text_is_owned_by_caller_and_private_draft(self, client):
        # Body tries to set owner/visibility/status — all must be ignored.
        r = client.post(
            "/api/teacher/my-texts",
            headers=_auth(client, "teacher_b"),
            json={
                "title": "B 新課文",
                "grade": 6,
                "genre": "議論文",
                "paragraphs": ["甲。", "乙 丙"],
                "teacher_id": U["teacher_a"],
                "created_by_id": U["teacher_a"],
                "visibility": "platform",
                "status": "published",
            },
        )
        assert r.status_code == 201, r.text
        row = _row(r.json()["id"])
        assert (row.teacher_id, row.created_by_id) == (U["teacher_b"], U["teacher_b"])
        assert (row.visibility, row.status) == (VisibilityLevel.private, TextStatus.draft)
        assert (row.grade_code, row.category, row.char_count) == ("G6", "History", 4)

    def test_new_text_does_not_appear_in_other_teachers_list(self, client):
        r = client.get("/api/teacher/my-texts", headers=_auth(client, "teacher_a"))
        assert "B 新課文" not in {t["title"] for t in r.json()["texts"]}
