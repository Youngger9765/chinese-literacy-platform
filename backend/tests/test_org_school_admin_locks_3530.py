"""#3530 — two admin routes with no test at all:

* DELETE /organizations/{id}: system_admin only, refuses while schools remain.
* GET /schools/{id}/classrooms: system_admin, or an org_admin of *that school's* org.
  A teacher of the school and an org_admin of another org must be refused.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi import Depends
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth.dependencies import get_current_user
from app.database import get_db
from app.main import app
from app.models import Base
from app.models.organization import Organization
from app.models.school import Classroom, School
from app.models.user import Role, User, UserRole

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
Session = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture
def w():
    Base.metadata.create_all(bind=engine)
    db = Session()
    roles = {n: Role(name=n, display_name=n, scope_level="platform") for n in ("system_admin", "org_admin", "teacher")}
    db.add_all(roles.values())
    org_a, org_b, org_empty = Organization(name="A"), Organization(name="B"), Organization(name="Empty")
    db.add_all([org_a, org_b, org_empty])
    db.flush()
    school = School(name="S-A", organization_id=org_a.id)
    db.add(school)
    db.flush()

    def user(name, role, scope_type, scope_id):
        u = User(email=f"{name}@example.com", name=name, password_hash="x", is_active=True)
        db.add(u)
        db.flush()
        db.add(UserRole(user_id=u.id, role_id=roles[role].id, scope_type=scope_type, scope_id=scope_id))
        return u

    admin = user("admin", "system_admin", "platform", None)
    oa = user("org_a_admin", "org_admin", "organization", str(org_a.id))
    ob = user("org_b_admin", "org_admin", "organization", str(org_b.id))
    teacher = user("teacher", "teacher", "school", str(school.id))
    db.add(Classroom(name="c", school_id=school.id, teacher_id=teacher.id, grade=4, is_active=True))
    db.commit()

    def _get_db():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_db] = _get_db
    client = TestClient(app)

    def call(u, method, path):
        uid = u.id
        app.dependency_overrides[get_current_user] = lambda db=Depends(get_db): db.get(User, uid)
        return client.request(method, path)

    def org_exists(oid):
        s = Session()
        try:
            return s.get(Organization, oid) is not None
        finally:
            s.close()

    yield {"call": call, "admin": admin, "oa": oa, "ob": ob, "teacher": teacher, "school": school.id,
           "org_a": org_a.id, "org_empty": org_empty.id, "org_exists": org_exists}
    app.dependency_overrides.clear()
    db.close()
    Base.metadata.drop_all(bind=engine)


@pytest.mark.parametrize("who", ["teacher", "oa"])
def test_only_system_admin_deletes_an_organization(w, who):
    r = w["call"](w[who], "DELETE", f"/api/organizations/{w['org_empty']}")
    assert r.status_code == 403, (who, r.status_code)
    assert w["org_exists"](w["org_empty"])


def test_system_admin_deletes_empty_org_but_not_one_with_schools(w):
    assert w["call"](w["admin"], "DELETE", f"/api/organizations/{w['org_a']}").status_code == 409
    assert w["org_exists"](w["org_a"])
    assert w["call"](w["admin"], "DELETE", f"/api/organizations/{w['org_empty']}").status_code == 204
    assert not w["org_exists"](w["org_empty"])


@pytest.mark.parametrize("who,ok", [("admin", True), ("oa", True), ("ob", False), ("teacher", False)])
def test_school_classroom_list_is_scoped_to_the_schools_org(w, who, ok):
    r = w["call"](w[who], "GET", f"/api/schools/{w['school']}/classrooms")
    if ok:
        assert r.status_code == 200 and [c["name"] for c in r.json()] == ["c"], r.text
    else:
        assert r.status_code == 403, (who, r.status_code)
