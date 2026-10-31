"""TDD：閱讀寶貝 API（#3780 第一階段）。

學生端：
    GET /api/learning/students/{id}/reading-babies
    GET /api/learning/students/{id}/reading-babies/{lesson_uid}

老師端：
    GET /api/teacher/classrooms/{id}/reading-baby-indicators
    GET /api/teacher/classrooms/{id}/reading-baby-indicators/{student_id}/{indicator_code}

權限測試用最低權限角色寫（`rules/testing-strategy.md`：高權限角色會讓檢查短路），
每條負向測試都配一條同帳號打自己資源的正向對照。
"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.database import get_db
from app.models import Base
from app.models.user import User, Role
from app.models.school import School, Classroom, ClassroomStudent
from app.auth.dependencies import get_current_user
from app.services import reading_baby_config, reading_baby_service

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)


@event.listens_for(engine, "connect")
def _set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

SEED_ROLES = [
    {"name": "system_admin", "display_name": "System Admin", "scope_level": "platform"},
    {"name": "teacher", "display_name": "Teacher", "scope_level": "school"},
    {"name": "student", "display_name": "Student", "scope_level": "school"},
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
    with TestingSessionLocal() as db:
        for role_data in SEED_ROLES:
            db.add(Role(**role_data))
        db.commit()
    app.dependency_overrides[get_db] = _override_get_db
    yield
    app.dependency_overrides.pop(get_db, None)
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def _make_user(db, *, email: str, name: str = "U") -> User:
    user = User(email=email, name=name, password_hash="x", is_active=True)
    db.add(user)
    db.flush()
    return user


def _as_user(user: User):
    app.dependency_overrides[get_current_user] = lambda: user


def _clear_user_override():
    app.dependency_overrides.pop(get_current_user, None)


_SAMPLE_LESSON_UID = reading_baby_config.all_lesson_uids()[0]
_SAMPLE_LESSON_META = reading_baby_config.get_lesson_indicator(_SAMPLE_LESSON_UID)


@pytest.fixture()
def world(request):
    """每個測試自己的一組 student/other_student/teacher/other_teacher/classroom。"""
    import uuid

    unique = uuid.uuid4().hex[:8]
    db = TestingSessionLocal()
    school = School(name=f"School {unique}")
    db.add(school)
    db.flush()
    student = _make_user(db, email=f"student-{unique}@example.com", name="Student")
    other_student = _make_user(db, email=f"other-student-{unique}@example.com", name="Other Student")
    teacher = _make_user(db, email=f"teacher-{unique}@example.com", name="Teacher")
    other_teacher = _make_user(db, email=f"other-teacher-{unique}@example.com", name="Other Teacher")
    classroom = Classroom(name="Class", teacher_id=teacher.id, school_id=school.id)
    db.add(classroom)
    db.flush()
    db.add(ClassroomStudent(classroom_id=classroom.id, student_id=student.id))
    db.commit()
    data = {
        "db": db,
        "student": student,
        "other_student": other_student,
        "teacher": teacher,
        "other_teacher": other_teacher,
        "classroom": classroom,
    }

    def _cleanup():
        _clear_user_override()
        db.close()

    request.addfinalizer(_cleanup)
    return data


class TestStudentAtlasAccess:
    def test_student_can_read_own_atlas(self, client, world):
        _as_user(world["student"])
        resp = client.get(f"/api/learning/students/{world['student'].id}/reading-babies")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["total_lessons"] == 179

    def test_teacher_of_the_student_can_read_atlas(self, client, world):
        _as_user(world["teacher"])
        resp = client.get(f"/api/learning/students/{world['student'].id}/reading-babies")
        assert resp.status_code == 200, resp.text

    def test_unrelated_student_cannot_read_someone_elses_atlas(self, client, world):
        _as_user(world["other_student"])
        resp = client.get(f"/api/learning/students/{world['student'].id}/reading-babies")
        assert resp.status_code == 403

    def test_unrelated_student_can_still_read_their_own_atlas(self, client, world):
        # 正向對照：同一個「沒有關係」的帳號打自己的資源要成功
        _as_user(world["other_student"])
        resp = client.get(f"/api/learning/students/{world['other_student'].id}/reading-babies")
        assert resp.status_code == 200, resp.text


class TestStudentCard:
    def test_card_for_unknown_lesson_is_404(self, client, world):
        _as_user(world["student"])
        resp = client.get(f"/api/learning/students/{world['student'].id}/reading-babies/NOT-REAL")
        assert resp.status_code == 404

    def test_card_for_known_lesson_before_any_evidence_is_not_encountered(self, client, world):
        _as_user(world["student"])
        resp = client.get(
            f"/api/learning/students/{world['student'].id}/reading-babies/{_SAMPLE_LESSON_UID}"
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["stage"] == "not_encountered"

    def test_card_reflects_recorded_passing_evidence(self, client, world):
        reading_baby_service.record_station_evidence(
            world["db"],
            student_id=world["student"].id,
            lesson_uid=_SAMPLE_LESSON_UID,
            station="spotlight",
            step_payload={"firstTryResults": {"score": 5, "total": 5}},
        )
        world["db"].commit()

        _as_user(world["student"])
        resp = client.get(
            f"/api/learning/students/{world['student'].id}/reading-babies/{_SAMPLE_LESSON_UID}"
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["assessable_passed"] >= 1
        assert body["stage"] in ("basic", "intermediate", "advanced")


class TestTeacherHeatmapPermission:
    """mutation 測試對象②：`reading_baby_service.teacher_owns_classroom`。"""

    def test_owner_teacher_can_read_heatmap(self, client, world):
        _as_user(world["teacher"])
        resp = client.get(f"/api/teacher/classrooms/{world['classroom'].id}/reading-baby-indicators")
        assert resp.status_code == 200, resp.text

    def test_non_owner_teacher_is_denied(self, client, world):
        _as_user(world["other_teacher"])
        resp = client.get(f"/api/teacher/classrooms/{world['classroom'].id}/reading-baby-indicators")
        assert resp.status_code == 403

    def test_heatmap_response_includes_the_review_status_note(self, client, world):
        _as_user(world["teacher"])
        resp = client.get(f"/api/teacher/classrooms/{world['classroom'].id}/reading-baby-indicators")
        assert "待老師審核" in resp.json()["note"]


class TestTeacherDrilldown:
    def test_owner_teacher_can_drill_into_a_students_indicator(self, client, world):
        indicator_code = _SAMPLE_LESSON_META["stations"]["spotlight"]["indicator_code"]
        reading_baby_service.record_station_evidence(
            world["db"],
            student_id=world["student"].id,
            lesson_uid=_SAMPLE_LESSON_UID,
            station="spotlight",
            classroom_id=world["classroom"].id,
            step_payload={"firstTryResults": {"score": 5, "total": 5}},
        )
        world["db"].commit()

        _as_user(world["teacher"])
        resp = client.get(
            f"/api/teacher/classrooms/{world['classroom'].id}/reading-baby-indicators/"
            f"{world['student'].id}/{indicator_code}"
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert len(body["evidence"]) == 1
        assert body["evidence"][0]["lesson_uid"] == _SAMPLE_LESSON_UID

    def test_student_not_in_this_classroom_is_404(self, client, world):
        indicator_code = _SAMPLE_LESSON_META["stations"]["spotlight"]["indicator_code"]
        _as_user(world["teacher"])
        resp = client.get(
            f"/api/teacher/classrooms/{world['classroom'].id}/reading-baby-indicators/"
            f"{world['other_student'].id}/{indicator_code}"
        )
        assert resp.status_code == 404

    def test_non_owner_teacher_cannot_drill_down_either(self, client, world):
        indicator_code = _SAMPLE_LESSON_META["stations"]["spotlight"]["indicator_code"]
        _as_user(world["other_teacher"])
        resp = client.get(
            f"/api/teacher/classrooms/{world['classroom'].id}/reading-baby-indicators/"
            f"{world['student'].id}/{indicator_code}"
        )
        assert resp.status_code == 403
