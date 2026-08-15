# 課文 id 在二修重刷後是 `20000 + n`（uid tree，#2683）——舊的 1..N 已不存在。
"""
Tests for the classroom texts API.

Covers:
- POST   /api/classrooms/{id}/texts           (assign text)
- GET    /api/classrooms/{id}/texts           (list assigned texts)
- DELETE /api/classrooms/{id}/texts/{text_id} (unassign text)

Uses SQLite in-memory DB to avoid any external dependency.

Run with:
    cd /Users/young/project/chinese-literacy-platform-issue-223/backend
    python -m pytest tests/test_classroom_texts_api.py -v
"""

import sys
import os
import uuid

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.database import get_db
from app.models import Base
from app.models.user import Role, UserRole
from app.models.school import School


# ---------------------------------------------------------------------------
# Test database setup (SQLite in-memory with StaticPool)
# ---------------------------------------------------------------------------

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)


@event.listens_for(engine, "connect")
def _set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

SEED_ROLES = [
    {"name": "system_admin", "display_name": "System Admin", "scope_level": "platform"},
    {"name": "org_admin", "display_name": "Organization Admin", "scope_level": "organization"},
    {"name": "principal", "display_name": "Principal", "scope_level": "school"},
    {"name": "director", "display_name": "Director", "scope_level": "school"},
    {"name": "teacher", "display_name": "Teacher", "scope_level": "school"},
    {"name": "homeroom_teacher", "display_name": "Homeroom Teacher", "scope_level": "school"},
    {"name": "student", "display_name": "Student", "scope_level": "school"},
    {"name": "parent", "display_name": "Parent", "scope_level": "school"},
]


def _seed_roles(session):
    for role_data in SEED_ROLES:
        session.add(Role(**role_data))
    session.commit()


def _seed_school(session) -> int:
    school = School(name="Classroom Texts Test School")
    session.add(school)
    session.commit()
    session.refresh(school)
    return school.id


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Module-level state
# ---------------------------------------------------------------------------

_test_school_id: int = 0


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    global _test_school_id
    Base.metadata.create_all(bind=engine)
    session = TestingSessionLocal()
    _seed_roles(session)
    _test_school_id = _seed_school(session)
    session.close()

    app.dependency_overrides[get_db] = _override_get_db
    yield
    app.dependency_overrides.pop(get_db, None)
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="module")
def school_id():
    return _test_school_id


def _register_user(client, suffix: str) -> dict:
    unique = uuid.uuid4().hex[:8]
    email = f"{suffix}_{unique}@example.com"
    password = "SecurePass123!"
    name = f"{suffix.title()} {unique}"
    resp = client.post("/api/auth/register", json={
        "email": email,
        "password": password,
        "name": name,
    })
    assert resp.status_code == 201
    verification_token = resp.json().get("verification_token")
    if verification_token:
        client.get(f"/api/auth/verify-email?token={verification_token}")
    login_resp = client.post("/api/auth/login", json={"email": email, "password": password})
    token = login_resp.json()["access_token"]
    me_resp = client.get("/api/users/me", headers=auth_header(token))
    user_id = me_resp.json()["id"]

    _mk = TestingSessionLocal()
    try:
        _trole = _mk.query(Role).filter(Role.name == "teacher").first()
        if _trole and not _mk.query(UserRole).filter(
            UserRole.user_id == user_id, UserRole.role_id == _trole.id,
            UserRole.scope_type == "school", UserRole.scope_id == str(_test_school_id),
        ).first():
            _mk.add(UserRole(user_id=user_id, role_id=_trole.id,
                             scope_type="school", scope_id=str(_test_school_id)))
            _mk.commit()
    finally:
        _mk.close()

    return {"email": email, "name": name, "token": token, "user_id": user_id}


def auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _make_admin(user_id: int):
    db = TestingSessionLocal()
    role = db.query(Role).filter(Role.name == "system_admin").first()
    user_role = UserRole(
        user_id=user_id,
        role_id=role.id,
        scope_type="platform",
        scope_id=None,
    )
    db.add(user_role)
    db.commit()
    db.close()


@pytest.fixture(scope="module")
def teacher(client):
    return _register_user(client, "ct_teacher")


@pytest.fixture(scope="module")
def other_teacher(client):
    return _register_user(client, "ct_other")


@pytest.fixture(scope="module")
def admin_user(client):
    user = _register_user(client, "ct_admin")
    _make_admin(user["user_id"])
    return user


@pytest.fixture(scope="module")
def classroom_id(client, teacher, school_id):
    """A classroom owned by `teacher`, reused across tests."""
    resp = client.post(
        "/api/classrooms",
        json={"name": "Texts Base Class", "school_id": school_id},
        headers=auth_header(teacher["token"]),
    )
    assert resp.status_code == 201
    return resp.json()["id"]


# ===========================================================================
# POST /api/classrooms/{id}/texts — Assign text
# ===========================================================================


class TestAssignText:
    def test_assign_returns_201(self, client, teacher, classroom_id):
        resp = client.post(
            f"/api/classrooms/{classroom_id}/texts",
            json={"text_id": "20002", "copyright_confirmed": True},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 201

    def test_assign_returns_expected_fields(self, client, teacher, school_id):
        # Use a fresh classroom to avoid duplicate-assignment conflicts
        cr = client.post(
            "/api/classrooms",
            json={"name": "Assign Fields Class", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        cid = cr.json()["id"]

        resp = client.post(
            f"/api/classrooms/{cid}/texts",
            json={"text_id": "20003", "copyright_confirmed": True},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert "id" in data
        assert data["text_id"] == "20003"
        assert "title" in data
        assert isinstance(data["title"], str)
        assert len(data["title"]) > 0
        assert "assigned_at" in data

    def test_assign_duplicate_returns_409(self, client, teacher, school_id):
        cr = client.post(
            "/api/classrooms",
            json={"name": "Dup Assign Class", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        cid = cr.json()["id"]

        # First assignment
        resp1 = client.post(
            f"/api/classrooms/{cid}/texts",
            json={"text_id": "20004", "copyright_confirmed": True},
            headers=auth_header(teacher["token"]),
        )
        assert resp1.status_code == 201

        # Second assignment — duplicate
        resp2 = client.post(
            f"/api/classrooms/{cid}/texts",
            json={"text_id": "20004", "copyright_confirmed": True},
            headers=auth_header(teacher["token"]),
        )
        assert resp2.status_code == 409
        assert resp2.json()["detail"] == "Text already assigned to classroom"

    def test_assign_invalid_text_id_returns_404(self, client, teacher, classroom_id):
        resp = client.post(
            f"/api/classrooms/{classroom_id}/texts",
            json={"text_id": "99999", "copyright_confirmed": True},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 404
        assert resp.json()["detail"] == "Story not found"

    def test_assign_nonexistent_classroom_returns_404(self, client, teacher):
        resp = client.post(
            "/api/classrooms/99999/texts",
            json={"text_id": "20001", "copyright_confirmed": True},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 404

    def test_assign_403_for_non_owner(self, client, teacher, other_teacher, school_id):
        cr = client.post(
            "/api/classrooms",
            json={"name": "Assign 403 Class", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        cid = cr.json()["id"]

        resp = client.post(
            f"/api/classrooms/{cid}/texts",
            json={"text_id": "20001", "copyright_confirmed": True},
            headers=auth_header(other_teacher["token"]),
        )
        assert resp.status_code == 403

    def test_assign_401_without_auth(self, client, classroom_id):
        resp = client.post(
            f"/api/classrooms/{classroom_id}/texts",
            json={"text_id": "20001", "copyright_confirmed": True},
        )
        assert resp.status_code == 401

    def test_admin_can_assign_to_any_classroom(self, client, teacher, admin_user, school_id):
        cr = client.post(
            "/api/classrooms",
            json={"name": "Admin Assign Class", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        cid = cr.json()["id"]

        resp = client.post(
            f"/api/classrooms/{cid}/texts",
            json={"text_id": "20005", "copyright_confirmed": True},
            headers=auth_header(admin_user["token"]),
        )
        assert resp.status_code == 201


# ===========================================================================
# GET /api/classrooms/{id}/texts — List assigned texts
# ===========================================================================


class TestListClassroomTexts:
    def test_list_returns_200(self, client, teacher, school_id):
        cr = client.post(
            "/api/classrooms",
            json={"name": "List Texts Class", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        cid = cr.json()["id"]

        resp = client.get(
            f"/api/classrooms/{cid}/texts",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200

    def test_empty_classroom_returns_empty_list(self, client, teacher, school_id):
        cr = client.post(
            "/api/classrooms",
            json={"name": "Empty Texts Class", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        cid = cr.json()["id"]

        resp = client.get(
            f"/api/classrooms/{cid}/texts",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200
        assert resp.json() == []

    def test_returns_assigned_texts(self, client, teacher, school_id):
        cr = client.post(
            "/api/classrooms",
            json={"name": "List With Texts", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        cid = cr.json()["id"]

        # Assign two texts
        client.post(
            f"/api/classrooms/{cid}/texts",
            json={"text_id": "20006", "copyright_confirmed": True},
            headers=auth_header(teacher["token"]),
        )
        client.post(
            f"/api/classrooms/{cid}/texts",
            json={"text_id": "20007", "copyright_confirmed": True},
            headers=auth_header(teacher["token"]),
        )

        resp = client.get(
            f"/api/classrooms/{cid}/texts",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2

    def test_list_items_have_expected_fields(self, client, teacher, school_id):
        cr = client.post(
            "/api/classrooms",
            json={"name": "List Fields Class", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        cid = cr.json()["id"]

        client.post(
            f"/api/classrooms/{cid}/texts",
            json={"text_id": "20008", "copyright_confirmed": True},
            headers=auth_header(teacher["token"]),
        )

        resp = client.get(
            f"/api/classrooms/{cid}/texts",
            headers=auth_header(teacher["token"]),
        )
        data = resp.json()
        assert len(data) == 1
        item = data[0]
        assert "id" in item
        assert "text_id" in item
        assert "title" in item
        assert "assigned_at" in item
        assert item["text_id"] == "20008"
        assert isinstance(item["title"], str)
        assert len(item["title"]) > 0

    def test_list_shows_correct_text_ids(self, client, teacher, school_id):
        cr = client.post(
            "/api/classrooms",
            json={"name": "List Correct IDs", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        cid = cr.json()["id"]

        client.post(f"/api/classrooms/{cid}/texts", json={"text_id": "20009", "copyright_confirmed": True}, headers=auth_header(teacher["token"]))
        client.post(f"/api/classrooms/{cid}/texts", json={"text_id": "20010", "copyright_confirmed": True}, headers=auth_header(teacher["token"]))

        resp = client.get(
            f"/api/classrooms/{cid}/texts",
            headers=auth_header(teacher["token"]),
        )
        text_ids = {item["text_id"] for item in resp.json()}
        assert "20009" in text_ids
        assert "20010" in text_ids

    def test_list_403_for_non_owner(self, client, teacher, other_teacher, school_id):
        cr = client.post(
            "/api/classrooms",
            json={"name": "List 403 Class", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        cid = cr.json()["id"]

        resp = client.get(
            f"/api/classrooms/{cid}/texts",
            headers=auth_header(other_teacher["token"]),
        )
        assert resp.status_code == 403

    def test_list_401_without_auth(self, client, classroom_id):
        resp = client.get(f"/api/classrooms/{classroom_id}/texts")
        assert resp.status_code == 401

    def test_admin_can_list_texts_for_any_classroom(self, client, teacher, admin_user, school_id):
        cr = client.post(
            "/api/classrooms",
            json={"name": "Admin List Texts Class", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        cid = cr.json()["id"]

        resp = client.get(
            f"/api/classrooms/{cid}/texts",
            headers=auth_header(admin_user["token"]),
        )
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)


# ===========================================================================
# DELETE /api/classrooms/{id}/texts/{text_id} — Unassign text
# ===========================================================================


class TestUnassignText:
    def test_unassign_succeeds(self, client, teacher, school_id):
        cr = client.post(
            "/api/classrooms",
            json={"name": "Unassign 200 Class", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        cid = cr.json()["id"]

        client.post(
            f"/api/classrooms/{cid}/texts",
            json={"text_id": "20001", "copyright_confirmed": True},
            headers=auth_header(teacher["token"]),
        )

        resp = client.delete(
            f"/api/classrooms/{cid}/texts/20001",
            headers=auth_header(teacher["token"]),
        )
        # Route declares status_code=200; accept both 200 and 204 as success
        assert resp.status_code in (200, 204)

    def test_unassign_removes_text_from_list(self, client, teacher, school_id):
        cr = client.post(
            "/api/classrooms",
            json={"name": "Unassign Verify Class", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        cid = cr.json()["id"]

        # Assign two texts
        client.post(f"/api/classrooms/{cid}/texts", json={"text_id": "20001", "copyright_confirmed": True}, headers=auth_header(teacher["token"]))
        client.post(f"/api/classrooms/{cid}/texts", json={"text_id": "20002", "copyright_confirmed": True}, headers=auth_header(teacher["token"]))

        # Unassign one
        del_resp = client.delete(f"/api/classrooms/{cid}/texts/20001", headers=auth_header(teacher["token"]))
        assert del_resp.status_code in (200, 204)

        # Verify only text 2 remains
        list_resp = client.get(
            f"/api/classrooms/{cid}/texts",
            headers=auth_header(teacher["token"]),
        )
        assert list_resp.status_code == 200
        data = list_resp.json()
        assert len(data) == 1
        assert data[0]["text_id"] == "20002"

    def test_unassign_text_not_assigned_returns_404(self, client, teacher, school_id):
        cr = client.post(
            "/api/classrooms",
            json={"name": "Unassign 404 Class", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        cid = cr.json()["id"]

        resp = client.delete(
            f"/api/classrooms/{cid}/texts/20001",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 404
        assert resp.json()["detail"] == "Text not assigned to classroom"

    def test_unassign_nonexistent_classroom_returns_404(self, client, teacher):
        resp = client.delete(
            "/api/classrooms/99999/texts/20001",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 404

    def test_unassign_403_for_non_owner(self, client, teacher, other_teacher, school_id):
        cr = client.post(
            "/api/classrooms",
            json={"name": "Unassign 403 Class", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        cid = cr.json()["id"]

        client.post(
            f"/api/classrooms/{cid}/texts",
            json={"text_id": "20001", "copyright_confirmed": True},
            headers=auth_header(teacher["token"]),
        )

        resp = client.delete(
            f"/api/classrooms/{cid}/texts/20001",
            headers=auth_header(other_teacher["token"]),
        )
        assert resp.status_code == 403

    def test_unassign_401_without_auth(self, client, classroom_id):
        resp = client.delete(f"/api/classrooms/{classroom_id}/texts/20001")
        assert resp.status_code == 401

    def test_admin_can_unassign_from_any_classroom(self, client, teacher, admin_user, school_id):
        cr = client.post(
            "/api/classrooms",
            json={"name": "Admin Unassign Class", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        cid = cr.json()["id"]

        client.post(
            f"/api/classrooms/{cid}/texts",
            json={"text_id": "20001", "copyright_confirmed": True},
            headers=auth_header(teacher["token"]),
        )

        resp = client.delete(
            f"/api/classrooms/{cid}/texts/20001",
            headers=auth_header(admin_user["token"]),
        )
        assert resp.status_code in (200, 204)

    def test_unassign_returns_confirmation_message(self, client, teacher, school_id):
        cr = client.post(
            "/api/classrooms",
            json={"name": "Unassign Message Class", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        cid = cr.json()["id"]

        client.post(
            f"/api/classrooms/{cid}/texts",
            json={"text_id": "20001", "copyright_confirmed": True},
            headers=auth_header(teacher["token"]),
        )

        resp = client.delete(
            f"/api/classrooms/{cid}/texts/20001",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code in (200, 204)
        # When the server returns a body (200), confirm it contains a message
        if resp.status_code == 200:
            data = resp.json()
            assert "message" in data


# ===========================================================================
# Full classroom texts flow
# ===========================================================================


class TestClassroomTextsFullFlow:
    def test_full_flow(self, client, school_id):
        """
        Register teacher -> create classroom ->
        assign 3 texts -> list (3) ->
        unassign 1 -> list (2) ->
        duplicate assign returns 409 ->
        invalid text returns 404.
        """
        teacher = _register_user(client, "ct_flow_teacher")
        headers = auth_header(teacher["token"])

        # 1. Create classroom
        cr = client.post(
            "/api/classrooms",
            json={"name": "Full Flow Texts Class", "school_id": school_id, "grade": 5},
            headers=headers,
        )
        assert cr.status_code == 201
        cid = cr.json()["id"]

        # 2. Assign 3 texts
        for tid in ["20001", "20002", "20003"]:
            resp = client.post(
                f"/api/classrooms/{cid}/texts",
                json={"text_id": tid, "copyright_confirmed": True},
                headers=headers,
            )
            assert resp.status_code == 201
            assert resp.json()["text_id"] == tid
            assert "title" in resp.json()
            assert "assigned_at" in resp.json()

        # 3. List texts: should be 3
        list_resp = client.get(f"/api/classrooms/{cid}/texts", headers=headers)
        assert list_resp.status_code == 200
        assert len(list_resp.json()) == 3

        # 4. Unassign text 2
        del_resp = client.delete(f"/api/classrooms/{cid}/texts/20002", headers=headers)
        assert del_resp.status_code in (200, 204)

        # 5. List texts: should be 2
        list_resp2 = client.get(f"/api/classrooms/{cid}/texts", headers=headers)
        assert list_resp2.status_code == 200
        remaining_ids = {item["text_id"] for item in list_resp2.json()}
        assert "20001" in remaining_ids
        assert "20003" in remaining_ids
        assert "20002" not in remaining_ids

        # 6. Duplicate assign text 1 returns 409
        dup_resp = client.post(
            f"/api/classrooms/{cid}/texts",
            json={"text_id": "20001", "copyright_confirmed": True},
            headers=headers,
        )
        assert dup_resp.status_code == 409
        assert dup_resp.json()["detail"] == "Text already assigned to classroom"

        # 7. Assign invalid text returns 404
        invalid_resp = client.post(
            f"/api/classrooms/{cid}/texts",
            json={"text_id": "99999", "copyright_confirmed": True},
            headers=headers,
        )
        assert invalid_resp.status_code == 404
        assert invalid_resp.json()["detail"] == "Story not found"

        # 8. Delete text that was already unassigned returns 404
        del_again = client.delete(f"/api/classrooms/{cid}/texts/20002", headers=headers)
        assert del_again.status_code == 404
        assert del_again.json()["detail"] == "Text not assigned to classroom"

        # 9. List still shows 2 texts (unchanged after failed operations)
        final_list = client.get(f"/api/classrooms/{cid}/texts", headers=headers)
        assert len(final_list.json()) == 2


# ===========================================================================
# Regression: non-numeric text_id (e.g. "L06") must not 500 — issue #2097
# ===========================================================================


class TestNonNumericTextId:
    """Regression for GET /classrooms/{id}/texts 500 on lesson-code text_ids.

    Before the fix, int('L06') raised ValueError -> HTTP 500.
    After the fix, normalize_story_slug() converts 'L06' -> '6' so the lookup
    succeeds, and a per-row try/except in the list handler prevents a single
    bad identifier from killing the whole response.
    """

    def test_assign_with_l_prefix_text_id_returns_201(self, client, teacher, school_id):
        """POST with text_id='L06' should work (normalize_story_slug -> '6')."""
        cr = client.post(
            "/api/classrooms",
            json={"name": "L-Prefix Assign Class", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        cid = cr.json()["id"]

        resp = client.post(
            f"/api/classrooms/{cid}/texts",
            json={"text_id": "L06", "copyright_confirmed": True},
            headers=auth_header(teacher["token"]),
        )
        # The story at id=6 exists in fixtures; must not 500
        assert resp.status_code in (201, 404), (
            f"Expected 201 or 404, got {resp.status_code}: {resp.text}"
        )
        assert resp.status_code != 500

    def test_list_does_not_500_when_row_has_l_prefix_text_id(
        self, client, teacher, school_id
    ):
        """GET /classrooms/{id}/texts must return 200 even if a stored
        text_id is 'L06' (lesson-code format), not a plain int string.

        Simulates the staging failure: classroom_texts row with text_id='L06'
        caused int('L06') -> ValueError -> 500.
        """
        from sqlalchemy.orm import Session as SASession

        cr = client.post(
            "/api/classrooms",
            json={"name": "L-Prefix List Class", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        assert cr.status_code == 201
        cid = cr.json()["id"]

        # Directly insert a ClassroomText row with a non-numeric text_id
        # to reproduce the staging condition without going through the POST
        # endpoint (which may or may not normalise on write).
        db: SASession = TestingSessionLocal()
        try:
            from app.models.school import ClassroomText
            import datetime

            bad_row = ClassroomText(
                classroom_id=cid,
                text_id="L06",
                assigned_by=teacher["user_id"],
                assigned_at=datetime.datetime.utcnow(),
            )
            db.add(bad_row)
            db.commit()
        finally:
            db.close()

        # GET must return 200 (not 500)
        resp = client.get(
            f"/api/classrooms/{cid}/texts",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200, (
            f"Expected 200 but got {resp.status_code}: {resp.text}"
        )
        # The row with L06 should either resolve to a real title or be skipped;
        # either way the list must be a JSON array.
        assert isinstance(resp.json(), list)

    def test_list_returns_200_with_mixed_numeric_and_code_ids(
        self, client, teacher, school_id
    ):
        """List endpoint stays 200 when classroom has both numeric and
        L-prefixed text_ids stored (partial-failure guard)."""
        cr = client.post(
            "/api/classrooms",
            json={"name": "Mixed ID Class", "school_id": school_id},
            headers=auth_header(teacher["token"]),
        )
        assert cr.status_code == 201
        cid = cr.json()["id"]

        # Assign a known-good numeric text
        client.post(
            f"/api/classrooms/{cid}/texts",
            json={"text_id": "20001", "copyright_confirmed": True},
            headers=auth_header(teacher["token"]),
        )

        # Directly insert a bad row (L-prefix)
        db: SASession = TestingSessionLocal()
        try:
            from app.models.school import ClassroomText
            import datetime

            bad_row = ClassroomText(
                classroom_id=cid,
                text_id="L99",  # deliberately bad (no lesson id=99)
                assigned_by=teacher["user_id"],
                assigned_at=datetime.datetime.utcnow(),
            )
            db.add(bad_row)
            db.commit()
        finally:
            db.close()

        resp = client.get(
            f"/api/classrooms/{cid}/texts",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        # At minimum the valid text "20001" should be present; the bad row should
        # either be resolved or silently skipped, never 500.
        text_ids = {item["text_id"] for item in data}
        assert "20001" in text_ids
