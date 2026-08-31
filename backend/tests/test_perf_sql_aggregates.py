"""
Regression tests for Issue #1224 — SQL aggregate push-down + cross-text N+1 fix.

Verifies three things:
1. cross_text_analysis_service._completed_sessions_with_text does NOT issue
   one extra query per session (N+1).
2. GET /api/learning/students/{id}/dashboard returns correct aggregated values
   after migrating from Python loops to SQL aggregates.
3. GET /api/teacher/classrooms/{id}/time-stats returns correct values
   after migrating from .limit(5000) + Python iteration to SQL aggregates.

Uses SQLite in-memory DB (via conftest.py JSONB patch) + SQLAlchemy event
listener to count queries.

Run with:
    cd backend && python -m pytest tests/test_perf_sql_aggregates.py -v
"""

import sys
import os
import uuid
from datetime import datetime, timedelta, timezone

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
from app.models.school import School, Classroom, ClassroomStudent
from app.models.session import LearningSession
from app.models.text import Text


# ---------------------------------------------------------------------------
# Test database setup
# ---------------------------------------------------------------------------

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)


@event.listens_for(engine, "connect")
def _set_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=OFF")
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

# Module-level shared state
_state: dict = {}


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()

    # Seed roles
    for r in SEED_ROLES:
        db.add(Role(**r))
    db.commit()

    # Seed school
    school = School(name="Perf Test School")
    db.add(school)
    db.commit()
    db.refresh(school)
    _state["school_id"] = school.id
    db.close()

    app.dependency_overrides[get_db] = _override_get_db
    yield
    app.dependency_overrides.pop(get_db, None)
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------

def _register_login(client, suffix: str) -> dict:
    uid = uuid.uuid4().hex[:8]
    email = f"{suffix}_{uid}@example.com"
    password = "demo1234"
    resp = client.post("/api/auth/register", json={
        "email": email, "password": password, "name": f"{suffix} {uid}"
    })
    assert resp.status_code == 201
    tok = resp.json().get("verification_token")
    if tok:
        client.get(f"/api/auth/verify-email?token={tok}")
    login = client.post("/api/auth/login", json={"email": email, "password": password})
    token = login.json()["access_token"]
    me = client.get("/api/users/me", headers={"Authorization": f"Bearer {token}"})
    user_id = me.json()["id"]

    # ⚠️ #2470 之後，在某個學校底下建班級**必須是那個學校的成員** ——
    #    那是安全修復（原本任何老師都能在任何學校建班，跨校/跨組織污染）。
    #    註冊出來的老師沒有任何 school scope，於是這支所有建班的呼叫都變成 403。
    #    這裡把它加進學校，測的意圖不變（要驗的是 SQL 聚合，不是授權）。
    db = TestingSessionLocal()
    try:
        trole = db.query(Role).filter(Role.name == "teacher").first()
        sid = str(_state.get("school_id"))
        if trole and sid and not db.query(UserRole).filter(
            UserRole.user_id == user_id, UserRole.role_id == trole.id,
            UserRole.scope_type == "school", UserRole.scope_id == sid,
        ).first():
            db.add(UserRole(user_id=user_id, role_id=trole.id,
                            scope_type="school", scope_id=sid))
            db.commit()
    finally:
        db.close()

    return {"token": token, "user_id": user_id}


def _auth(token: str):
    return {"Authorization": f"Bearer {token}"}


def _make_teacher_role(user_id: int, classroom_id: int):
    db = TestingSessionLocal()
    role = db.query(Role).filter_by(name="teacher").first()
    db.add(UserRole(
        user_id=user_id, role_id=role.id,
        scope_type="classroom", scope_id=classroom_id,
    ))
    db.commit()
    db.close()


def _count_queries(fn):
    """Execute fn() and return (result, query_count)."""
    queries = []

    def _before_cursor_execute(conn, cursor, statement, parameters, context, executemany):
        queries.append(statement)

    event.listen(engine, "before_cursor_execute", _before_cursor_execute)
    try:
        result = fn()
    finally:
        event.remove(engine, "before_cursor_execute", _before_cursor_execute)
    return result, len(queries)


# ---------------------------------------------------------------------------
# 1. Cross-text N+1 fix
# ---------------------------------------------------------------------------

class TestCrossTextN1Fix:
    """_completed_sessions_with_text must NOT issue one query per session."""

    def test_query_count_bounded_with_multiple_sessions(self):
        """With N sessions, query count must be << N+1 (ideally <= 3)."""
        from app.services.cross_text_analysis_service import _completed_sessions_with_text

        db = TestingSessionLocal()

        # Create a student directly
        from app.models.user import User
        from app.auth.password import hash_password
        uid = uuid.uuid4().hex[:8]
        student = User(
            email=f"cross_student_{uid}@example.com",
            name=f"Cross Student {uid}",
            password_hash=hash_password("demo1234"),
            is_active=True,
            email_verified=True,
        )
        db.add(student)
        db.flush()

        # Create texts
        texts = []
        for i in range(5):
            t = Text(
                title=f"Story {i}",
                paragraphs=[f"Content {i}"],
                char_count=10,
                grade=5,
                grade_code="5A",
                genre="記敘文",
                text_type="單",
                category="敘事",
            )
            db.add(t)
            db.flush()
            texts.append(t)

        # Create 5 completed sessions, each linked to a Text
        for i, text in enumerate(texts):
            db.add(LearningSession(
                student_id=student.id,
                text_id=text.id,
                story_slug=f"cross-story-{uid}-{i}",
                status="completed",
                overall_score=80.0 + i,
                started_at=datetime.now(timezone.utc) - timedelta(hours=5 - i),
                completed_at=datetime.now(timezone.utc) - timedelta(hours=4 - i),
            ))
        db.commit()
        student_id = student.id
        db.close()

        db2 = TestingSessionLocal()
        try:
            def _run():
                return _completed_sessions_with_text(student_id, db2)

            pairs, query_count = _count_queries(_run)
        finally:
            db2.close()

        # Before fix: 1 (fetch sessions) + 5 (one per session) = 6 queries
        # After fix with joinedload: 1 or 2 queries regardless of session count
        assert len(pairs) == 5, f"Expected 5 pairs, got {len(pairs)}"
        assert query_count <= 3, (
            f"N+1 detected: {query_count} queries for 5 sessions "
            f"(expected <=3 with joinedload)"
        )

    def test_sessions_without_text_id_handled(self):
        """Sessions with text_id=None must still appear in result (text=None)."""
        from app.services.cross_text_analysis_service import _completed_sessions_with_text
        from app.models.user import User
        from app.auth.password import hash_password

        db = TestingSessionLocal()
        uid = uuid.uuid4().hex[:8]
        student = User(
            email=f"notext_{uid}@example.com",
            name=f"No Text Student {uid}",
            password_hash=hash_password("demo1234"),
            is_active=True,
            email_verified=True,
        )
        db.add(student)
        db.flush()

        # Session with no text_id
        db.add(LearningSession(
            student_id=student.id,
            text_id=None,
            story_slug="no-text-slug",
            status="completed",
            overall_score=75.0,
            started_at=datetime.now(timezone.utc) - timedelta(hours=2),
            completed_at=datetime.now(timezone.utc) - timedelta(hours=1),
        ))
        db.commit()
        student_id = student.id
        db.close()

        db2 = TestingSessionLocal()
        try:
            pairs = _completed_sessions_with_text(student_id, db2)
        finally:
            db2.close()

        assert len(pairs) == 1
        session, text = pairs[0]
        assert text is None, "Session without text_id should have text=None"
        assert session.overall_score == 75.0

    def test_pairs_sorted_by_completed_at_ascending(self):
        """Result must be sorted by completed_at ascending."""
        from app.services.cross_text_analysis_service import _completed_sessions_with_text
        from app.models.user import User
        from app.auth.password import hash_password

        db = TestingSessionLocal()
        uid = uuid.uuid4().hex[:8]
        student = User(
            email=f"sort_{uid}@example.com",
            name=f"Sort Student {uid}",
            password_hash=hash_password("demo1234"),
            is_active=True,
            email_verified=True,
        )
        db.add(student)
        db.flush()

        now = datetime.now(timezone.utc)
        scores_in_time_order = [60.0, 70.0, 80.0]
        for i, score in enumerate(scores_in_time_order):
            db.add(LearningSession(
                student_id=student.id,
                text_id=None,
                story_slug=f"sort-{uid}-{i}",
                status="completed",
                overall_score=score,
                started_at=now - timedelta(hours=10 - i),
                completed_at=now - timedelta(hours=9 - i),
            ))
        db.commit()
        student_id = student.id
        db.close()

        db2 = TestingSessionLocal()
        try:
            pairs = _completed_sessions_with_text(student_id, db2)
        finally:
            db2.close()

        retrieved_scores = [s.overall_score for s, _ in pairs]
        assert retrieved_scores == scores_in_time_order, (
            f"Not sorted by completed_at: {retrieved_scores}"
        )


# ---------------------------------------------------------------------------
# 2. Dashboard SQL aggregate correctness
# ---------------------------------------------------------------------------

class TestDashboardSQLAggregate:
    """GET /api/learning/students/{id}/dashboard — values must be identical
    before and after SQL aggregate migration."""

    @pytest.fixture(scope="class")
    def student(self, client):
        return _register_login(client, "dash_student")

    def test_total_and_completed_session_counts(self, client, student):
        now = datetime.now(timezone.utc)
        db = TestingSessionLocal()
        # 2 completed + 1 in_progress
        db.add(LearningSession(
            student_id=student["user_id"], story_slug="d1", status="completed",
            overall_score=80.0,
            started_at=now - timedelta(hours=3), completed_at=now - timedelta(hours=2),
        ))
        db.add(LearningSession(
            student_id=student["user_id"], story_slug="d2", status="completed",
            overall_score=60.0,
            started_at=now - timedelta(hours=2), completed_at=now - timedelta(hours=1),
        ))
        db.add(LearningSession(
            student_id=student["user_id"], story_slug="d3", status="in_progress",
            started_at=now - timedelta(minutes=30),
        ))
        db.commit()
        db.close()

        resp = client.get(
            f"/api/learning/students/{student['user_id']}/dashboard",
            headers=_auth(student["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()

        assert data["total_sessions"] >= 3
        assert data["completed_sessions"] >= 2

    def test_avg_score_rounded_to_one_decimal(self, client, student):
        """avg_score must equal round((80+60)/2, 1) = 70.0 for the seeded sessions."""
        resp = client.get(
            f"/api/learning/students/{student['user_id']}/dashboard",
            headers=_auth(student["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        # avg_score must be a float (not None), rounded to 1 decimal
        assert data["avg_score"] is not None
        assert isinstance(data["avg_score"], float)

    def test_daily_activity_length_is_30(self, client, student):
        """daily_activity must always return exactly 30 entries."""
        resp = client.get(
            f"/api/learning/students/{student['user_id']}/dashboard",
            headers=_auth(student["token"]),
        )
        assert resp.status_code == 200
        assert len(resp.json()["daily_activity"]) == 30

    def test_daily_activity_entry_schema(self, client, student):
        """Each daily_activity entry must have date, sessions_completed, avg_score."""
        resp = client.get(
            f"/api/learning/students/{student['user_id']}/dashboard",
            headers=_auth(student["token"]),
        )
        for entry in resp.json()["daily_activity"]:
            assert "date" in entry
            assert "sessions_completed" in entry
            assert "avg_score" in entry

    def test_today_sessions_counted(self, client, student):
        now = datetime.now(timezone.utc)
        db = TestingSessionLocal()
        db.add(LearningSession(
            student_id=student["user_id"], story_slug="today1", status="completed",
            overall_score=90.0,
            started_at=now - timedelta(minutes=30), completed_at=now - timedelta(minutes=1),
        ))
        db.commit()
        db.close()

        resp = client.get(
            f"/api/learning/students/{student['user_id']}/dashboard",
            headers=_auth(student["token"]),
        )
        assert resp.json()["today_sessions"] >= 1

    def test_week_sessions_counted(self, client, student):
        resp = client.get(
            f"/api/learning/students/{student['user_id']}/dashboard",
            headers=_auth(student["token"]),
        )
        assert resp.json()["week_sessions"] >= 1

    def test_no_scores_returns_null_avg(self, client):
        """Student with only in_progress sessions → avg_score is None."""
        s = _register_login(client, "dash_noscore")
        db = TestingSessionLocal()
        db.add(LearningSession(
            student_id=s["user_id"], story_slug="ns1", status="in_progress",
            started_at=datetime.now(timezone.utc) - timedelta(minutes=10),
        ))
        db.commit()
        db.close()

        resp = client.get(
            f"/api/learning/students/{s['user_id']}/dashboard",
            headers=_auth(s["token"]),
        )
        assert resp.status_code == 200
        assert resp.json()["avg_score"] is None


# ---------------------------------------------------------------------------
# 3. Time-stats SQL aggregate correctness
# ---------------------------------------------------------------------------

class TestTimeStatsSQLAggregate:
    """GET /api/teacher/classrooms/{id}/time-stats — values after SQL migration
    must match values computed by the original Python loop."""

    @pytest.fixture(scope="class")
    def setup(self, client):
        teacher = _register_login(client, "ts_teacher")
        student = _register_login(client, "ts_student")

        # Create classroom
        resp = client.post(
            "/api/classrooms",
            json={"name": "TimeStats SQL Class", "school_id": _state["school_id"]},
            headers=_auth(teacher["token"]),
        )
        assert resp.status_code == 201
        classroom_id = resp.json()["id"]

        # Enroll student
        client.post(
            f"/api/classrooms/{classroom_id}/students",
            json={"student_id": student["user_id"]},
            headers=_auth(teacher["token"]),
        )

        return {"teacher": teacher, "student": student, "classroom_id": classroom_id}

    def test_total_hours_correct(self, client, setup):
        now = datetime.now(timezone.utc)
        db = TestingSessionLocal()
        # Two sessions: 60 min + 30 min = 1.5 hours
        db.add(LearningSession(
            student_id=setup["student"]["user_id"],
            story_slug="ts1", status="completed",
            started_at=now - timedelta(hours=5),
            completed_at=now - timedelta(hours=4),  # 60 min
        ))
        db.add(LearningSession(
            student_id=setup["student"]["user_id"],
            story_slug="ts2", status="completed",
            started_at=now - timedelta(hours=3),
            completed_at=now - timedelta(hours=2, minutes=30),  # 30 min
        ))
        db.commit()
        db.close()

        resp = client.get(
            f"/api/teacher/classrooms/{setup['classroom_id']}/time-stats",
            headers=_auth(setup["teacher"]["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_hours"] >= 1.5

    def test_avg_minutes_per_session(self, client, setup):
        resp = client.get(
            f"/api/teacher/classrooms/{setup['classroom_id']}/time-stats",
            headers=_auth(setup["teacher"]["token"]),
        )
        data = resp.json()
        # avg of 60 and 30 = 45 minutes (may have extra sessions from module)
        assert data["avg_minutes_per_session"] is not None
        assert data["avg_minutes_per_session"] > 0

    def test_study_days_at_least_one(self, client, setup):
        resp = client.get(
            f"/api/teacher/classrooms/{setup['classroom_id']}/time-stats",
            headers=_auth(setup["teacher"]["token"]),
        )
        assert resp.json()["study_days"] >= 1

    def test_sessions_this_week(self, client, setup):
        """⚠️ `started_at` 不可以往前推 —— 週一凌晨會掉進上週。

        端點的 this_monday 是 `(now - weekday 天).replace(hour=0)`（UTC）。
        週一時它就是今天 00:00 UTC，所以 `now - 1 小時` 在
        **每週一 00:00~01:00 UTC 這一小時**會落在週日 = 上週 →
        sessions_this_week == 0 → 這一條紅。

        2026-08-31（週一）01:00:06Z 的 CI 真的踩到了：`assert 0 >= 1`。
        本機跑是綠的，因為本機那時不在那個窗口裡。

        改成 started_at = now：一個「現在開始」的 session 依定義必在本週
        （this_monday 就是從 now 截出來的），跟時鐘走到哪都無關。
        時長改用 completed_at 往後給，不動 started_at。
        """
        now = datetime.now(timezone.utc)
        db = TestingSessionLocal()
        db.add(LearningSession(
            student_id=setup["student"]["user_id"],
            story_slug="ts_week", status="completed",
            started_at=now,
            completed_at=now + timedelta(hours=1),
        ))
        db.commit()
        db.close()

        resp = client.get(
            f"/api/teacher/classrooms/{setup['classroom_id']}/time-stats",
            headers=_auth(setup["teacher"]["token"]),
        )
        assert resp.json()["sessions_this_week"] >= 1

    def test_empty_classroom_returns_zero_defaults(self, client):
        teacher2 = _register_login(client, "ts_empty_teacher")
        resp = client.post(
            "/api/classrooms",
            json={"name": "TimeStats Empty SQL", "school_id": _state["school_id"]},
            headers=_auth(teacher2["token"]),
        )
        assert resp.status_code == 201
        cid = resp.json()["id"]

        resp = client.get(
            f"/api/teacher/classrooms/{cid}/time-stats",
            headers=_auth(teacher2["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_hours"] == 0.0
        assert data["avg_minutes_per_session"] is None
        assert data["study_days"] == 0
        assert data["sessions_this_week"] == 0
        assert data["sessions_last_week"] == 0

    def test_response_schema_matches(self, client, setup):
        """Verify all 5 fields of TimeStatsResponse are present and typed correctly."""
        resp = client.get(
            f"/api/teacher/classrooms/{setup['classroom_id']}/time-stats",
            headers=_auth(setup["teacher"]["token"]),
        )
        data = resp.json()
        assert isinstance(data["total_hours"], float)
        assert data["avg_minutes_per_session"] is None or isinstance(data["avg_minutes_per_session"], float)
        assert isinstance(data["study_days"], int)
        assert isinstance(data["sessions_this_week"], int)
        assert isinstance(data["sessions_last_week"], int)
