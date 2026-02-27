"""
Tests for the authentication system (Issue #82).

Covers:
  - Teacher registration (POST /api/auth/register)
  - Teacher login (POST /api/auth/login)
  - Student login (POST /api/auth/login)
  - Current user endpoint (GET /api/users/me)

Run with:
    cd backend
    python -m pytest tests/test_auth.py -v
"""

import pytest
from sqlalchemy.orm import Session

from app.models.school import School, Teacher, Class, ClassStudent
from app.models.student import Student
from app.services.auth_service import hash_password


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

REGISTER_URL = "/api/auth/register"
LOGIN_URL = "/api/auth/login"
ME_URL = "/api/users/me"

VALID_TEACHER = {
    "name": "王老師",
    "email": "wang@school.edu.tw",
    "password": "Str0ngP@ss",
    "school_name": "台北國小",
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def register_teacher(client, **overrides):
    """Register a teacher and return the response."""
    payload = {**VALID_TEACHER, **overrides}
    return client.post(REGISTER_URL, json=payload)


def login_teacher(client, email=VALID_TEACHER["email"], password=VALID_TEACHER["password"]):
    """Login as teacher and return the response."""
    return client.post(
        LOGIN_URL,
        json={"login_type": "teacher", "email": email, "password": password},
    )


def auth_header(token: str) -> dict:
    """Build Authorization header from a bearer token."""
    return {"Authorization": f"Bearer {token}"}


def create_student_fixtures(db: Session):
    """
    Create the full chain: School -> Teacher -> Class -> Student -> ClassStudent.
    Returns (class_code, seat_number, student_password) for use in login tests.
    """
    school = School(name="測試國小")
    db.add(school)
    db.flush()

    teacher = Teacher(
        school_id=school.id,
        email="teacher@test.tw",
        name="測試老師",
        password_hash=hash_password("TeacherPass1"),
    )
    db.add(teacher)
    db.flush()

    cls = Class(teacher_id=teacher.id, name="六年一班", class_code="ABC123")
    db.add(cls)
    db.flush()

    student_password = "Student88"
    student = Student(
        name="小明",
        password_hash=hash_password(student_password),
    )
    db.add(student)
    db.flush()

    cs = ClassStudent(class_id=cls.id, student_id=student.id, seat_number=5)
    db.add(cs)
    db.commit()

    return cls.class_code, cs.seat_number, student_password


# ===========================================================================
# 1. Teacher Registration
# ===========================================================================


class TestTeacherRegistration:
    def test_register_teacher_success(self, client):
        resp = register_teacher(client)
        assert resp.status_code == 200
        data = resp.json()
        assert "access_token" in data
        assert data["token_type"] == "bearer"
        assert data["user"]["role"] == "teacher"
        assert data["user"]["name"] == VALID_TEACHER["name"]
        assert data["user"]["email"] == VALID_TEACHER["email"]

    def test_register_teacher_duplicate_email(self, client):
        register_teacher(client)
        resp = register_teacher(client)
        assert resp.status_code == 409
        assert "已被註冊" in resp.json()["detail"]

    def test_register_teacher_weak_password(self, client):
        resp = register_teacher(client, password="short")
        assert resp.status_code == 422

    def test_register_teacher_creates_school(self, client, db):
        register_teacher(client, school_name="新學校")
        school = db.query(School).filter(School.name == "新學校").first()
        assert school is not None
        assert school.name == "新學校"

    def test_register_teacher_reuses_existing_school(self, client, db):
        register_teacher(client, email="a@test.tw", school_name="共用學校")
        register_teacher(client, email="b@test.tw", school_name="共用學校")
        count = db.query(School).filter(School.name == "共用學校").count()
        assert count == 1

    def test_register_teacher_missing_name(self, client):
        resp = client.post(
            REGISTER_URL,
            json={
                "email": "x@test.tw",
                "password": "Str0ngP@ss",
                "school_name": "School",
            },
        )
        assert resp.status_code == 422

    def test_register_teacher_invalid_email(self, client):
        resp = register_teacher(client, email="not-an-email")
        assert resp.status_code == 422


# ===========================================================================
# 2. Teacher Login
# ===========================================================================


class TestTeacherLogin:
    def test_login_teacher_success(self, client):
        register_teacher(client)
        resp = login_teacher(client)
        assert resp.status_code == 200
        data = resp.json()
        assert "access_token" in data
        assert data["user"]["role"] == "teacher"
        assert data["user"]["email"] == VALID_TEACHER["email"]

    def test_login_teacher_wrong_password(self, client):
        register_teacher(client)
        resp = login_teacher(client, password="WrongPassword!")
        assert resp.status_code == 401
        assert "密碼錯誤" in resp.json()["detail"]

    def test_login_teacher_nonexistent_email(self, client):
        resp = login_teacher(client, email="nobody@test.tw")
        assert resp.status_code == 401


# ===========================================================================
# 3. Student Login
# ===========================================================================


class TestStudentLogin:
    def test_login_student_success(self, client, db):
        class_code, seat, password = create_student_fixtures(db)
        resp = client.post(
            LOGIN_URL,
            json={
                "login_type": "student",
                "class_code": class_code,
                "seat_number": seat,
                "password": password,
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "access_token" in data
        assert data["user"]["role"] == "student"
        assert data["user"]["name"] == "小明"
        assert data["user"]["seat_number"] == seat
        assert data["user"]["class_code"] == class_code

    def test_login_student_wrong_class_code(self, client, db):
        _code, seat, password = create_student_fixtures(db)
        resp = client.post(
            LOGIN_URL,
            json={
                "login_type": "student",
                "class_code": "ZZZZZZ",
                "seat_number": seat,
                "password": password,
            },
        )
        assert resp.status_code == 401
        assert "班級代碼" in resp.json()["detail"]

    def test_login_student_wrong_seat(self, client, db):
        class_code, _seat, password = create_student_fixtures(db)
        resp = client.post(
            LOGIN_URL,
            json={
                "login_type": "student",
                "class_code": class_code,
                "seat_number": 99,
                "password": password,
            },
        )
        assert resp.status_code == 401
        assert "座號" in resp.json()["detail"]

    def test_login_student_wrong_password(self, client, db):
        class_code, seat, _password = create_student_fixtures(db)
        resp = client.post(
            LOGIN_URL,
            json={
                "login_type": "student",
                "class_code": class_code,
                "seat_number": seat,
                "password": "WrongPass!",
            },
        )
        assert resp.status_code == 401
        assert "密碼錯誤" in resp.json()["detail"]

    def test_login_student_class_code_case_insensitive(self, client, db):
        class_code, seat, password = create_student_fixtures(db)
        resp = client.post(
            LOGIN_URL,
            json={
                "login_type": "student",
                "class_code": class_code.lower(),
                "seat_number": seat,
                "password": password,
            },
        )
        # The route uppercases the class_code, so lowercase should still work
        assert resp.status_code == 200


# ===========================================================================
# 4. Users/Me
# ===========================================================================


class TestUsersMe:
    def test_users_me_teacher(self, client):
        register_teacher(client)
        login_resp = login_teacher(client)
        token = login_resp.json()["access_token"]

        resp = client.get(ME_URL, headers=auth_header(token))
        assert resp.status_code == 200
        data = resp.json()
        assert data["role"] == "teacher"
        assert data["name"] == VALID_TEACHER["name"]
        assert data["email"] == VALID_TEACHER["email"]

    def test_users_me_student(self, client, db):
        class_code, seat, password = create_student_fixtures(db)
        login_resp = client.post(
            LOGIN_URL,
            json={
                "login_type": "student",
                "class_code": class_code,
                "seat_number": seat,
                "password": password,
            },
        )
        token = login_resp.json()["access_token"]

        resp = client.get(ME_URL, headers=auth_header(token))
        assert resp.status_code == 200
        data = resp.json()
        assert data["role"] == "student"
        assert data["name"] == "小明"
        assert data["seat_number"] == seat
        assert data["class_code"] == class_code

    def test_users_me_no_token(self, client):
        resp = client.get(ME_URL)
        assert resp.status_code == 401

    def test_users_me_invalid_token(self, client):
        resp = client.get(ME_URL, headers=auth_header("garbage.token.value"))
        assert resp.status_code == 401
