import os
import sys
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.database import get_db
from app.main import app
from app.models import Base
from app.models.school import School
from app.models.user import Role, UserRole


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


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    session = TestingSessionLocal()
    for role_data in SEED_ROLES:
        session.add(Role(**role_data))
    school = School(name="Join Preview Rate Limit School")
    session.add(school)
    session.commit()
    session.refresh(school)
    school_id = school.id
    session.close()

    app.dependency_overrides[get_db] = _override_get_db
    yield school_id
    app.dependency_overrides.pop(get_db, None)
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def school_id(setup_db):
    return setup_db


def auth_header(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _register_user(client: TestClient, suffix: str, school_id: int, *, teacher: bool = False) -> dict:
    unique = uuid.uuid4().hex[:8]
    email = f"{suffix}_{unique}@example.com"
    password = "demo1234"
    resp = client.post(
        "/api/auth/register",
        json={"email": email, "password": password, "name": f"{suffix} {unique}"},
    )
    assert resp.status_code == 201
    verification_token = resp.json().get("verification_token")
    if verification_token:
        client.get(f"/api/auth/verify-email?token={verification_token}")

    login_resp = client.post("/api/auth/login", json={"email": email, "password": password})
    assert login_resp.status_code == 200
    token = login_resp.json()["access_token"]

    me_resp = client.get("/api/users/me", headers=auth_header(token))
    assert me_resp.status_code == 200
    user_id = me_resp.json()["id"]

    if teacher:
        db = TestingSessionLocal()
        try:
            teacher_role = db.query(Role).filter(Role.name == "teacher").first()
            db.add(
                UserRole(
                    user_id=user_id,
                    role_id=teacher_role.id,
                    scope_type="school",
                    scope_id=str(school_id),
                )
            )
            db.commit()
        finally:
            db.close()

    return {"token": token, "user_id": user_id}


def test_join_preview_rate_limits_repeated_authenticated_code_probes(client, school_id):
    teacher = _register_user(client, "jp_rl_teacher", school_id, teacher=True)
    viewer = _register_user(client, "jp_rl_viewer", school_id)

    create_resp = client.post(
        "/api/classrooms",
        json={"name": "Join Preview RL Target", "school_id": school_id},
        headers=auth_header(teacher["token"]),
    )
    assert create_resp.status_code == 201
    join_code = create_resp.json()["join_code"]

    for i in range(10):
        resp = client.get(
            "/api/classrooms/join-preview",
            params={"code": f"MISS{i:02d}"},
            headers=auth_header(viewer["token"]),
        )
        assert resp.status_code == 404

    blocked_resp = client.get(
        "/api/classrooms/join-preview",
        params={"code": join_code},
        headers=auth_header(viewer["token"]),
    )
    assert blocked_resp.status_code == 429
    assert "rate limit" in blocked_resp.json()["detail"].lower()

    other_viewer = _register_user(client, "jp_rl_other_viewer", school_id)
    allowed_resp = client.get(
        "/api/classrooms/join-preview",
        params={"code": join_code},
        headers=auth_header(other_viewer["token"]),
    )
    assert allowed_resp.status_code == 200
    assert allowed_resp.json()["name"] == "Join Preview RL Target"
