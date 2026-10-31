"""
Tests for the student learning progress API (Issue #257).

Covers:
- GET /api/learning/students/{id}/progress
  - Returns empty list for new student
  - Returns per-text progress grouped by story_slug
  - Step completion derived correctly from current_step + status
  - Rule-based next-step recommendation
  - Teacher can access their student's progress
  - Another student cannot access (403)

Run with:
    cd backend && python -m pytest tests/test_student_progress.py -v
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
from app.models.user import Role
from app.models.session import LearningSession
from app.models.school import Classroom, ClassroomStudent, School

# ---------------------------------------------------------------------------
# Test database (SQLite in-memory)
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
        session.add(Role(
            name=role_data["name"],
            display_name=role_data["display_name"],
            scope_level=role_data["scope_level"],
        ))
    session.commit()


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    session = TestingSessionLocal()
    _seed_roles(session)
    session.close()
    app.dependency_overrides[get_db] = _override_get_db
    yield
    app.dependency_overrides.pop(get_db, None)
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def _register_user(client, suffix=None):
    """Register user, return dict with token and id."""
    unique = suffix or uuid.uuid4().hex[:8]
    email = f"prog_{unique}@example.com"
    password = "SecurePass123!"
    resp = client.post("/api/auth/register", json={
        "email": email,
        "password": password,
        "name": f"Prog User {unique}",
        "copyright_confirmed": True,
    })
    assert resp.status_code == 201, resp.text
    verification_token = resp.json().get("verification_token")
    if verification_token:
        client.get(f"/api/auth/verify-email?token={verification_token}")
    login_resp = client.post("/api/auth/login", json={"email": email, "password": password})
    token = login_resp.json()["access_token"]
    me = client.get("/api/users/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    return {"token": token, "id": me.json()["id"], "email": email}


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestStudentProgressEmpty:
    """Student with no sessions gets an empty progress response."""

    def test_empty_progress(self, client):
        student = _register_user(client, "empty")
        resp = client.get(
            f"/api/learning/students/{student['id']}/progress",
            headers={"Authorization": f"Bearer {student['token']}"},
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["student_id"] == student["id"]
        assert data["texts_attempted"] == 0
        assert data["texts_completed"] == 0
        assert data["average_score"] is None
        assert data["texts"] == []


class TestStudentProgressWithSessions:
    """Progress aggregates sessions correctly."""

    def test_in_progress_session(self, client):
        """One in-progress session at step 2 → 1 text, 0 completed, 1 step done."""
        student = _register_user(client, "inprog")
        db = TestingSessionLocal()
        # ⚠️ 原本只寫 `current_step=2`。那個整數欄位在 #1182 就被明文廢棄了
        #    （`current_step_derived` 的 docstring：do NOT read the deprecated
        #    integer current_step column），真相是 `step_progress.steps_completed`。
        #    只寫廢棄欄位 = 在測一條沒有人在走的路。
        session = LearningSession(
            student_id=student["id"],
            story_slug="lesson-01",
            status="in_progress",
            current_step=2,
            step_progress={"steps_completed": ["intro"], "current_step": "live_tutor"},
        )
        db.add(session)
        db.commit()
        db.close()

        resp = client.get(
            f"/api/learning/students/{student['id']}/progress",
            headers={"Authorization": f"Bearer {student['token']}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["texts_attempted"] == 1
        assert data["texts_completed"] == 0
        text = data["texts"][0]
        assert text["story_slug"] == "lesson-01"
        assert text["status"] == "in_progress"
        # step 1 (intro) should be completed, step 2 in_progress
        steps = {s["step_key"]: s["status"] for s in text["steps"]}
        assert steps["intro"] == "completed"
        assert steps["live_tutor"] == "in_progress"
        assert steps["comprehension"] == "not_started"
        assert text["completion_pct"] > 0

    def test_completed_session(self, client):
        """A completed session → texts_completed=1, all steps completed."""
        student = _register_user(client, "done")
        db = TestingSessionLocal()
        session = LearningSession(
            student_id=student["id"],
            story_slug="lesson-02",
            status="completed",
            current_step=6,
            overall_score=85.0,
        )
        db.add(session)
        db.commit()
        db.close()

        resp = client.get(
            f"/api/learning/students/{student['id']}/progress",
            headers={"Authorization": f"Bearer {student['token']}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["texts_completed"] == 1
        assert data["average_score"] == 85.0
        text = data["texts"][0]
        assert text["completion_pct"] == 100
        steps = {s["step_key"]: s["status"] for s in text["steps"]}
        for key in ["intro", "live_tutor", "comprehension", "vocab", "full_reading", "report"]:
            assert steps[key] == "completed", f"{key} should be completed"

    def test_multiple_sessions_same_story_deduped(self, client):
        """Two sessions for same story → only the latest is returned."""
        student = _register_user(client, "dedup")
        db = TestingSessionLocal()
        # Older session (step 1)
        db.add(LearningSession(
            student_id=student["id"],
            story_slug="lesson-03",
            status="abandoned",
            current_step=1,
        ))
        # Newer session (step 3)
        db.add(LearningSession(
            student_id=student["id"],
            story_slug="lesson-03",
            status="in_progress",
            current_step=3,
        ))
        db.commit()
        db.close()

        resp = client.get(
            f"/api/learning/students/{student['id']}/progress",
            headers={"Authorization": f"Bearer {student['token']}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        # Only 1 text card despite 2 sessions
        assert data["texts_attempted"] == 1
        text = data["texts"][0]
        assert text["status"] == "in_progress"

    def test_next_step_recommendation_low_accuracy(self, client):
        """Low accuracy session → recommends retry of live_tutor."""
        student = _register_user(client, "lowaccu")
        db = TestingSessionLocal()
        db.add(LearningSession(
            student_id=student["id"],
            story_slug="lesson-04",
            status="in_progress",
            current_step=2,
            accuracy=50.0,
        ))
        db.commit()
        db.close()

        resp = client.get(
            f"/api/learning/students/{student['id']}/progress",
            headers={"Authorization": f"Bearer {student['token']}"},
        )
        data = resp.json()
        next_step = data["texts"][0]["next_step"]
        # Accuracy 50% < 70% and step <= 2 → retry live_tutor
        assert next_step["action"] == "retry_step"
        assert next_step["step"] == "live_tutor"

    def test_next_step_completed_suggests_new_text(self, client):
        """Completed session → new_text recommendation."""
        student = _register_user(client, "newtext")
        db = TestingSessionLocal()
        db.add(LearningSession(
            student_id=student["id"],
            story_slug="lesson-05",
            status="completed",
            current_step=6,
        ))
        db.commit()
        db.close()

        resp = client.get(
            f"/api/learning/students/{student['id']}/progress",
            headers={"Authorization": f"Bearer {student['token']}"},
        )
        data = resp.json()
        next_step = data["texts"][0]["next_step"]
        assert next_step["action"] == "new_text"


class TestStudentProgressAccess:
    """Access control: own data OK, other student's data 403."""

    def test_own_progress_accessible(self, client):
        student = _register_user(client, "acc_own")
        resp = client.get(
            f"/api/learning/students/{student['id']}/progress",
            headers={"Authorization": f"Bearer {student['token']}"},
        )
        assert resp.status_code == 200

    def test_other_students_progress_forbidden(self, client):
        student_a = _register_user(client, "acc_a")
        student_b = _register_user(client, "acc_b")
        resp = client.get(
            f"/api/learning/students/{student_b['id']}/progress",
            headers={"Authorization": f"Bearer {student_a['token']}"},
        )
        assert resp.status_code == 403

    def test_unauthenticated_request_rejected(self, client):
        student = _register_user(client, "acc_unauth")
        resp = client.get(f"/api/learning/students/{student['id']}/progress")
        assert resp.status_code == 401


class TestStudentProgressIslandFields:
    """#3780 D2 — additive fields for the reading-island archipelago page.

    `GET /learning/students/{id}/progress` gets two new fields per `texts[]`
    entry (`steps_completed`, `has_session`); every existing field keeps its
    exact prior value. See PRD §5.6 (docs/prd/2026-10-26-reading-island-3d-prd.md):
    既有端點新增欄位，不建新 API，`verify_student_access` 不變。
    """

    def test_steps_completed_is_the_raw_dynamic_list_not_normalized(self, client):
        """範本模式課文的動態 step id 長 `type#anchor`（例如
        `full-text-annotate#dcavv`），不是舊 6 步模型認得的 key。
        `steps_completed` 要原封不動回傳 raw 值，給前端用
        `.split('#')[0]` 自己比對（跟 `stepFor()` 同一套邏輯）——
        不能被舊模型正規化掉或吃不到。"""
        student = _register_user(client, "island_raw")
        db = TestingSessionLocal()
        db.add(LearningSession(
            student_id=student["id"],
            story_slug="lesson-island-raw",
            status="in_progress",
            step_progress={
                "steps_completed": ["full-text-annotate#dcavv", "vocab-definition#jryea"],
                "current_step": "keypoints-table#wtm6h",
            },
        ))
        db.commit()
        db.close()

        resp = client.get(
            f"/api/learning/students/{student['id']}/progress",
            headers={"Authorization": f"Bearer {student['token']}"},
        )
        assert resp.status_code == 200, resp.text
        text = resp.json()["texts"][0]
        assert text["steps_completed"] == ["full-text-annotate#dcavv", "vocab-definition#jryea"]

    def test_has_session_true_when_a_session_exists(self, client):
        student = _register_user(client, "island_has_session")
        db = TestingSessionLocal()
        db.add(LearningSession(
            student_id=student["id"],
            story_slug="lesson-island-has-session",
            status="in_progress",
        ))
        db.commit()
        db.close()

        resp = client.get(
            f"/api/learning/students/{student['id']}/progress",
            headers={"Authorization": f"Bearer {student['token']}"},
        )
        assert resp.status_code == 200
        assert resp.json()["texts"][0]["has_session"] is True

    def test_new_fields_do_not_change_existing_fields(self, client):
        """回歸鎖：新增欄位不能動到舊欄位（completion_pct／6 步模型）的計算
        ——這是加欄位，不是重寫。"""
        student = _register_user(client, "island_regress")
        db = TestingSessionLocal()
        db.add(LearningSession(
            student_id=student["id"],
            story_slug="lesson-island-regress",
            status="completed",
            current_step=6,
            overall_score=90.0,
        ))
        db.commit()
        db.close()

        resp = client.get(
            f"/api/learning/students/{student['id']}/progress",
            headers={"Authorization": f"Bearer {student['token']}"},
        )
        assert resp.status_code == 200
        text = resp.json()["texts"][0]
        assert text["completion_pct"] == 100
        steps = {s["step_key"]: s["status"] for s in text["steps"]}
        for key in ["intro", "live_tutor", "comprehension", "vocab", "full_reading", "report"]:
            assert steps[key] == "completed", f"{key} should be completed"
        # 新欄位也要在——這條鎖只保證「舊的沒被動到」，不是「什麼都沒加」。
        assert "steps_completed" in text
        assert "has_session" in text

    def test_own_progress_with_new_fields_accessible(self, client):
        """200 正向對照——跟下面那條 403（另一人讀這個學生的資料）成對：
        這個學生用自己的 token 讀自己的資料，確認新欄位沒有把「自己讀
        自己」也連帶擋掉，而且新欄位真的回得來。"""
        student = _register_user(client, "island_self_200")
        db = TestingSessionLocal()
        db.add(LearningSession(
            student_id=student["id"],
            story_slug="lesson-island-pair",
            status="in_progress",
        ))
        db.commit()
        db.close()

        resp = client.get(
            f"/api/learning/students/{student['id']}/progress",
            headers={"Authorization": f"Bearer {student['token']}"},
        )
        assert resp.status_code == 200, resp.text
        text = resp.json()["texts"][0]
        assert text["has_session"] is True
        assert "steps_completed" in text

    def test_other_student_still_forbidden_with_new_fields_present(self, client):
        """403 這條規則延續——新欄位沒有打開一個新的權限破口（負向對照，
        跟上面那條「自己讀自己 200」成對：這裡是另一個學生讀他的資料）。"""
        student_a = _register_user(client, "island_acc_a")
        student_b = _register_user(client, "island_acc_b")
        db = TestingSessionLocal()
        db.add(LearningSession(
            student_id=student_b["id"],
            story_slug="lesson-island-acc-b",
            status="in_progress",
        ))
        db.commit()
        db.close()

        resp = client.get(
            f"/api/learning/students/{student_b['id']}/progress",
            headers={"Authorization": f"Bearer {student_a['token']}"},
        )
        assert resp.status_code == 403

    def test_teacher_of_classroom_can_access_with_new_fields(self, client):
        """老師能讀自己班上學生的新欄位——`verify_student_access` 本身沒改，
        這條只是在這支端點上重新確認它還是接著這個既有規則（接線測試，
        不是重測 `verify_student_access` 本身邏輯，那支在
        test_verify_student_access_3346.py 已經單元測過）。"""
        teacher = _register_user(client, "island_teacher_a")
        student = _register_user(client, "island_teacher_student")
        db = TestingSessionLocal()
        school = School(name="Island Test School A")
        db.add(school)
        db.flush()
        classroom = Classroom(name="Island Class A", school_id=school.id, teacher_id=teacher["id"], join_code="ISLA001")
        db.add(classroom)
        db.flush()
        db.add(ClassroomStudent(classroom_id=classroom.id, student_id=student["id"]))
        db.add(LearningSession(
            student_id=student["id"],
            story_slug="lesson-island-teacher",
            status="in_progress",
        ))
        db.commit()
        db.close()

        resp = client.get(
            f"/api/learning/students/{student['id']}/progress",
            headers={"Authorization": f"Bearer {teacher['token']}"},
        )
        assert resp.status_code == 200, resp.text
        assert "steps_completed" in resp.json()["texts"][0]

    def test_teacher_of_another_classroom_still_forbidden_with_new_fields(self, client):
        """老師只能讀自己班上的學生——跨班級一樣 403（負向對照，跟上面那條
        成對：同一個學生，換成不相干班級的老師）。"""
        teacher_a = _register_user(client, "island_teacher_b1")
        teacher_b = _register_user(client, "island_teacher_b2")
        student = _register_user(client, "island_teacher_other_student")
        db = TestingSessionLocal()
        school = School(name="Island Test School B")
        db.add(school)
        db.flush()
        classroom_a = Classroom(name="Island Class B1", school_id=school.id, teacher_id=teacher_a["id"], join_code="ISLB001")
        db.add(classroom_a)
        db.flush()
        db.add(ClassroomStudent(classroom_id=classroom_a.id, student_id=student["id"]))
        db.commit()
        db.close()

        # teacher_b 沒有教過這個學生所在的任何班級
        resp = client.get(
            f"/api/learning/students/{student['id']}/progress",
            headers={"Authorization": f"Bearer {teacher_b['token']}"},
        )
        assert resp.status_code == 403

    def test_nonexistent_student_id_returns_403_not_a_leak(self, client):
        """輸入驗證：不存在的 student_id 要 fail-closed 回 403，不是 500
        （炸錯）也不是 200 回空資料（洩漏『這個 id 存在但沒有資料』跟
        『這個 id 根本不存在』的差別，兩者對呼叫者應該看起來一樣）。"""
        requester = _register_user(client, "island_nonexistent_caller")
        resp = client.get(
            "/api/learning/students/999999999/progress",
            headers={"Authorization": f"Bearer {requester['token']}"},
        )
        assert resp.status_code == 403


class TestStudentProgressIsOccupied:
    """#3780 D（PRD §5.6）—— `is_occupied`：這堂課在喝采島上是不是「佔領」了
    （§5.3：所有站都完成）。用真實課文 20011 測，它的 step_sequence 是：
    ['lesson-intro', 'full-text-annotate#dcavv', 'key-passage-reading#arfe7',
     'vocab-definition#jryea', 'vocab-application#jp34n', 'keypoints-table#wtm6h',
     'comprehension#4axkq', 'vocab-review#rdcd7', 'knowledge-station#uxwy3', 'report']
    （10 站，`lesson-intro` 無錨點、其餘 8 站有錨點、`report` 無錨點）。"""

    ALL_20011_STEPS_EXCEPT_INTRO = [
        "full-text-annotate#dcavv", "key-passage-reading#arfe7", "vocab-definition#jryea",
        "vocab-application#jp34n", "keypoints-table#wtm6h", "comprehension#4axkq",
        "vocab-review#rdcd7", "knowledge-station#uxwy3", "report",
    ]

    def test_false_when_not_all_stations_done(self, client):
        """少一站（report）沒做——不該是 true。"""
        student = _register_user(client, "island_occ_partial")
        db = TestingSessionLocal()
        db.add(LearningSession(
            student_id=student["id"],
            story_slug="20011",
            status="in_progress",
            step_progress={"steps_completed": self.ALL_20011_STEPS_EXCEPT_INTRO[:-1]},
        ))
        db.commit()
        db.close()

        resp = client.get(
            f"/api/learning/students/{student['id']}/progress",
            headers={"Authorization": f"Bearer {student['token']}"},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["texts"][0]["is_occupied"] is False

    def test_true_when_all_stations_done_including_intro_via_has_session(self, client):
        """其餘 9 站都做完、`lesson-intro` 本身永遠不會進 steps_completed
        （PRD §5.2）——只要這個 session 存在（`has_session`）就該算
        `lesson-intro` 完成，整堂課變成 `is_occupied: true`。"""
        student = _register_user(client, "island_occ_full")
        db = TestingSessionLocal()
        db.add(LearningSession(
            student_id=student["id"],
            story_slug="20011",
            status="in_progress",
            step_progress={"steps_completed": self.ALL_20011_STEPS_EXCEPT_INTRO},
        ))
        db.commit()
        db.close()

        resp = client.get(
            f"/api/learning/students/{student['id']}/progress",
            headers={"Authorization": f"Bearer {student['token']}"},
        )
        assert resp.status_code == 200, resp.text
        text = resp.json()["texts"][0]
        assert text["has_session"] is True
        assert text["is_occupied"] is True

    def test_false_for_unknown_lesson_no_crash(self, client):
        """`story_slug` 不是純數字（`int(slug)` 丟 `ValueError`）——
        fail-closed 回 `is_occupied=False`／`stations_done=0`／
        `stations_total=0`，不是炸錯整支 API、也不是誤判成 true。"""
        student = _register_user(client, "island_occ_unknown")
        db = TestingSessionLocal()
        db.add(LearningSession(
            student_id=student["id"],
            story_slug="this-slug-does-not-exist-999",
            status="in_progress",
        ))
        db.commit()
        db.close()

        resp = client.get(
            f"/api/learning/students/{student['id']}/progress",
            headers={"Authorization": f"Bearer {student['token']}"},
        )
        assert resp.status_code == 200, resp.text
        text = resp.json()["texts"][0]
        assert text["is_occupied"] is False
        assert text["stations_done"] == 0
        assert text["stations_total"] == 0

    def test_bad_slug_does_not_poison_other_courses_in_same_response(self, client):
        """一筆壞資料（非數字 `story_slug`）不該讓**同一個回應裡其他課**的
        `is_occupied`／`stations_done`／`stations_total` 也跟著壞掉或讓
        整支 API 500——每一筆 `texts[]` 各自獨立計算。"""
        student = _register_user(client, "island_occ_mixed")
        db = TestingSessionLocal()
        db.add(LearningSession(
            student_id=student["id"],
            story_slug="not-a-number",
            status="in_progress",
        ))
        db.add(LearningSession(
            student_id=student["id"],
            story_slug="20011",
            status="in_progress",
            step_progress={"steps_completed": ["full-text-annotate#dcavv"]},
        ))
        db.commit()
        db.close()

        resp = client.get(
            f"/api/learning/students/{student['id']}/progress",
            headers={"Authorization": f"Bearer {student['token']}"},
        )
        assert resp.status_code == 200, resp.text
        by_slug = {t["story_slug"]: t for t in resp.json()["texts"]}
        assert by_slug["not-a-number"]["is_occupied"] is False
        assert by_slug["not-a-number"]["stations_total"] == 0
        # 20011 真實有 10 站，這筆資料完全沒受「壞資料」那筆影響。
        # lesson-intro 靠 has_session 自動算一站 + full-text-annotate#dcavv
        # 命中一站 = 2 站。
        assert by_slug["20011"]["stations_total"] == 10
        assert by_slug["20011"]["stations_done"] == 2
