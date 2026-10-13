"""#3513 — a parent can sign up as a parent.

Before: /auth/register always created a teacher and put them in the school of
their email domain, so a parent landed on the teacher home (and could create
classes). Now role="parent" gives only the parent role — no teacher role, no
school — and only while the parent portal is enabled.
"""
import os
import sys
import uuid

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.database import get_db
from app.models import Base
from app.models.user import Role, User, UserRole
from app.models.school import School
from app.config import settings

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
Session = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def _db():
    db = Session()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(scope="module", autouse=True)
def setup():
    Base.metadata.create_all(bind=engine)
    s = Session()
    for name, scope in [("teacher", "school"), ("student", "school"), ("parent", "platform")]:
        s.add(Role(name=name, display_name=name, scope_level=scope))
    s.commit()
    s.close()
    app.dependency_overrides[get_db] = _db
    yield
    app.dependency_overrides.pop(get_db, None)
    Base.metadata.drop_all(bind=engine)


@pytest.fixture()
def client():
    with TestClient(app) as c:
        yield c


def _roles(email):
    s = Session()
    u = s.query(User).filter(User.email == email).one()
    names = [s.query(Role).get(ur.role_id).name for ur in s.query(UserRole).filter(UserRole.user_id == u.id)]
    s.close()
    return names


def _register(client, role, domain):
    email = f"p_{uuid.uuid4().hex[:8]}@{domain}"
    r = client.post("/api/auth/register", json={"email": email, "password": "SecurePass123!", "name": "家長", "role": role},
                    headers={"X-Forwarded-For": f"10.0.{uuid.uuid4().int % 250}.{uuid.uuid4().int % 250}"})
    return email, r


def test_parent_signup_gets_only_the_parent_role_and_no_school(client, monkeypatch):
    monkeypatch.setattr(settings, "parent_portal_enabled", True)
    domain = f"family{uuid.uuid4().hex[:6]}.example.com"
    email, r = _register(client, "parent", domain)
    assert r.status_code == 201, r.text
    assert _roles(email) == ["parent"]
    s = Session()
    assert s.query(School).filter(School.domain == domain).count() == 0
    s.close()


def test_parent_signup_is_refused_while_the_portal_is_off(client, monkeypatch):
    monkeypatch.setattr(settings, "parent_portal_enabled", False)
    _, r = _register(client, "parent", "example.org")
    assert r.status_code == 403


def test_teacher_signup_is_unchanged(client, monkeypatch):
    # Positive control: the default path still makes a teacher in a school.
    monkeypatch.setattr(settings, "parent_portal_enabled", True)
    domain = f"school{uuid.uuid4().hex[:6]}.edu.tw"
    email, r = _register(client, None, domain)
    assert r.status_code == 201, r.text
    assert _roles(email) == ["teacher"]
    s = Session()
    assert s.query(School).filter(School.domain == domain).count() == 1
    s.close()
