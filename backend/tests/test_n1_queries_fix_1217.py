"""
TDD regression tests for Issue #1217 — Fix 6 N+1 query issues in backend routes.

Tests verify:
1. Response payload is unchanged (contract test)
2. Query count is bounded (not N-proportional)

Routes covered:
- GET /api/assignments/my                   (2N+1 → 3 queries)
- GET /api/classrooms/{id}/assignments       (N+1 → 2 queries)
- GET /api/teacher/classrooms/{id}/heatmap   (lazy student → 1 eager query)
- GET /api/teacher/classrooms/{id}/error-heatmap (lazy student → 1 eager query)
- GET /api/organizations/{id}/students/export (3N lazy → 1 joinedload query)
- GET /api/gamification/leaderboard/{id}     (UserRole.role N+1 → joinedload)
- GET /api/gamification/summary/{id}         (_assert_can_view UserRole.role N+1)
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
from app.models.user import Role, UserRole, User
from app.models.school import School, Classroom, ClassroomStudent
from app.models.assignment import Assignment, AssignmentSubmission
from app.models.session import LearningSession
from app.models.text import Text
from app.auth.password import hash_password


# ---------------------------------------------------------------------------
# In-memory SQLite DB
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

_SEED_ROLES = [
    {"name": "system_admin", "display_name": "System Admin", "scope_level": "platform"},
    {"name": "org_admin", "display_name": "Org Admin", "scope_level": "organization"},
    {"name": "teacher", "display_name": "Teacher", "scope_level": "school"},
    {"name": "student", "display_name": "Student", "scope_level": "school"},
]

NUM_ASSIGNMENTS = 6   # enough to detect N+1 clearly

_state: dict = {}


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    """Create tables, seed data, override DB dependency."""
    from sqlalchemy.dialects.postgresql import JSONB
    from sqlalchemy import JSON

    for table in Base.metadata.sorted_tables:
        for col in table.columns:
            if isinstance(col.type, JSONB):
                col.type = JSON()

    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()

    # Roles
    role_map = {}
    for r in _SEED_ROLES:
        role = Role(**r)
        db.add(role)
        db.commit()
        db.refresh(role)
        role_map[r["name"]] = role

    # School
    school = School(name="N+1 Fix Test School")
    db.add(school)
    db.commit()
    db.refresh(school)

    # Teacher
    teacher = User(
        email="n1fix_teacher@example.com",
        username="n1fix_teacher",
        password_hash=hash_password("Password1!"),
        name="Fix Teacher",
        is_active=True,
        email_verified=True,
    )
    db.add(teacher)
    db.commit()
    db.refresh(teacher)

    # Give teacher the teacher role
    db.add(UserRole(
        user_id=teacher.id,
        role_id=role_map["teacher"].id,
        scope_type="school",
        scope_id=str(school.id),
        is_active=True,
    ))
    db.commit()

    # Classroom
    classroom = Classroom(
        name="N+1 Fix Class",
        school_id=school.id,
        teacher_id=teacher.id,
        join_code="N1FIX",
    )
    db.add(classroom)
    db.commit()
    db.refresh(classroom)

    # Admin user (for gamification access tests)
    admin_user = User(
        email="n1fix_admin@example.com",
        username="n1fix_admin",
        password_hash=hash_password("Password1!"),
        name="Fix Admin",
        is_active=True,
        email_verified=True,
    )
    db.add(admin_user)
    db.commit()
    db.refresh(admin_user)

    # Give admin the org_admin role (multiple UserRoles to trigger N+1)
    for role_name in ["system_admin", "org_admin"]:
        db.add(UserRole(
            user_id=admin_user.id,
            role_id=role_map[role_name].id,
            scope_type="platform",
            scope_id=None,
            is_active=True,
        ))
    db.commit()

    # Student user
    student = User(
        email="n1fix_student@example.com",
        username="n1fix_student",
        password_hash=hash_password("Password1!"),
        name="Fix Student",
        is_active=True,
        email_verified=True,
    )
    db.add(student)
    db.commit()
    db.refresh(student)

    db.add(ClassroomStudent(classroom_id=classroom.id, student_id=student.id))
    db.commit()

    # Additional students for leaderboard N+1 test
    other_student_ids = []
    for i in range(NUM_ASSIGNMENTS - 1):
        u = User(
            email=f"n1fix_other{i}@example.com",
            username=f"n1fix_other{i}",
            password_hash=hash_password("Password1!"),
            name=f"Other {i}",
            is_active=True,
            email_verified=True,
        )
        db.add(u)
        db.commit()
        db.refresh(u)
        db.add(ClassroomStudent(classroom_id=classroom.id, student_id=u.id))
        other_student_ids.append(u.id)
    db.commit()

    # Assignments (story_id based — no Text query needed for story_id)
    assignment_ids = []
    for i in range(NUM_ASSIGNMENTS):
        asn = Assignment(
            classroom_id=classroom.id,
            teacher_id=teacher.id,
            story_id=str(i + 1),
            assignment_type="reading",
            is_active=True,
        )
        db.add(asn)
        db.commit()
        db.refresh(asn)
        assignment_ids.append(asn.id)

    # Submissions for student (one per assignment, with a linked session)
    for asn_id in assignment_ids:
        sess = LearningSession(
            student_id=student.id,
            story_slug=str(assignment_ids.index(asn_id) + 1),
            status="in_progress",
            classroom_id=classroom.id,
        )
        db.add(sess)
        db.commit()
        db.refresh(sess)

        sub = AssignmentSubmission(
            assignment_id=asn_id,
            student_id=student.id,
            status="pending",
            session_id=sess.id,
        )
        db.add(sub)
    db.commit()

    # DB-text assignment (text_id based) to verify Text batch-load
    text_obj = Text(
        title="Test DB Text",
        paragraphs=["Some content"],
        grade=5,
        grade_code="G5-1",
        genre="記敘文",
        text_type="單",
        category="Fable",
        teacher_id=teacher.id,
        visibility="platform",
    )
    db.add(text_obj)
    db.commit()
    db.refresh(text_obj)

    db_text_asn = Assignment(
        classroom_id=classroom.id,
        teacher_id=teacher.id,
        text_id=text_obj.id,
        assignment_type="reading",
        is_active=True,
    )
    db.add(db_text_asn)
    db.commit()
    db.refresh(db_text_asn)

    db_text_sub = AssignmentSubmission(
        assignment_id=db_text_asn.id,
        student_id=student.id,
        status="pending",
    )
    db.add(db_text_sub)
    db.commit()

    # Capture IDs before closing session (avoid DetachedInstanceError)
    _classroom_id = classroom.id
    _school_id = school.id

    db.close()

    _state["teacher_email"] = "n1fix_teacher@example.com"
    _state["student_email"] = "n1fix_student@example.com"
    _state["admin_email"] = "n1fix_admin@example.com"
    _state["classroom_id"] = _classroom_id
    _state["school_id"] = _school_id

    app.dependency_overrides[get_db] = _override_get_db

    try:
        from app.routes.auth import rate_limiter
        rate_limiter.reset()
    except Exception:
        pass

    yield

    app.dependency_overrides.pop(get_db, None)
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def _login(client, email: str) -> str:
    resp = client.post("/api/auth/login", json={"email": email, "password": "Password1!"})
    assert resp.status_code == 200, f"Login failed for {email}: {resp.json()}"
    return resp.json()["access_token"]


@pytest.fixture(scope="module")
def teacher_token(client):
    return _login(client, _state["teacher_email"])


@pytest.fixture(scope="module")
def student_token(client):
    return _login(client, _state["student_email"])


@pytest.fixture(scope="module")
def admin_token(client):
    return _login(client, _state["admin_email"])


def auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def count_queries(fn) -> int:
    """Count SQL statements emitted while fn() executes."""
    count = 0

    def _before(conn, cursor, statement, parameters, context, executemany):
        nonlocal count
        count += 1

    event.listen(engine, "before_cursor_execute", _before)
    try:
        fn()
    finally:
        event.remove(engine, "before_cursor_execute", _before)
    return count


# ===========================================================================
# 1. GET /api/assignments/my  — student homepage (2N+1 issue)
# ===========================================================================


class TestStudentMyAssignmentsN1:
    """GET /api/assignments/my must not issue N queries proportional to assignment count."""

    def test_returns_200_and_items(self, client, student_token):
        resp = client.get("/api/assignments/my", headers=auth_header(student_token))
        assert resp.status_code == 200
        items = resp.json()
        # At least NUM_ASSIGNMENTS items (story_id ones) + 1 text_id one
        assert len(items) >= NUM_ASSIGNMENTS

    def test_response_shape(self, client, student_token):
        resp = client.get("/api/assignments/my", headers=auth_header(student_token))
        assert resp.status_code == 200
        for item in resp.json():
            assert "assignment_id" in item
            assert "story_title" in item
            assert "status" in item

    def test_query_count_is_bounded(self, client, student_token):
        """2N+1 worst case = 2*7+1 = 15. Fixed version should be < N (7)."""
        n = NUM_ASSIGNMENTS + 1  # total assignments for this student

        def call():
            client.get("/api/assignments/my", headers=auth_header(student_token))

        q = count_queries(call)
        assert q < n * 2, (
            f"/assignments/my issued {q} queries for {n} assignments. "
            f"2N+1 worst case = {2 * n + 1}. Expected < {n * 2} after fix."
        )


# ===========================================================================
# 2. GET /api/classrooms/{id}/assignments  — teacher assignment list (N+1 issue)
# ===========================================================================


class TestTeacherAssignmentListN1:
    """GET /api/classrooms/{id}/assignments must not issue N queries proportional to assignment count."""

    def test_returns_200_and_items(self, client, teacher_token):
        cid = _state["classroom_id"]
        resp = client.get(
            f"/api/classrooms/{cid}/assignments",
            headers=auth_header(teacher_token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "items" in data
        assert len(data["items"]) >= NUM_ASSIGNMENTS

    def test_response_shape(self, client, teacher_token):
        cid = _state["classroom_id"]
        resp = client.get(
            f"/api/classrooms/{cid}/assignments",
            headers=auth_header(teacher_token),
        )
        assert resp.status_code == 200
        for item in resp.json()["items"]:
            assert "id" in item
            assert "story_title" in item
            assert "submission_count" in item

    def test_query_count_is_bounded(self, client, teacher_token):
        """N+1 worst case = N text queries + overhead. Fixed: constant queries."""
        n = NUM_ASSIGNMENTS + 1  # total assignments including db-text one
        cid = _state["classroom_id"]

        def call():
            client.get(
                f"/api/classrooms/{cid}/assignments",
                headers=auth_header(teacher_token),
            )

        q = count_queries(call)
        # Original: 1 auth + 1 classroom + 1 list + N*resolve_title + N*sub_count + N*completed_count
        # = ~3N+3. Fixed: auth + classroom + assignments_with_texts + sub_counts = ~5 constant
        assert q < n * 3, (
            f"/classrooms/{cid}/assignments issued {q} queries for {n} assignments. "
            f"N+1 worst case ≈ {3 * n + 3}. Expected < {n * 3} after fix."
        )


# ===========================================================================
# 3. GET /api/teacher/classrooms/{id}/heatmap  — ClassroomStudent.student N+1
# ===========================================================================


class TestHeatmapStudentN1:
    """Heatmap endpoint: ClassroomStudent.student must be eagerly loaded."""

    def test_returns_200(self, client, teacher_token):
        cid = _state["classroom_id"]
        resp = client.get(
            f"/api/teacher/classrooms/{cid}/heatmap",
            headers=auth_header(teacher_token),
        )
        assert resp.status_code == 200

    def test_response_has_students(self, client, teacher_token):
        cid = _state["classroom_id"]
        resp = client.get(
            f"/api/teacher/classrooms/{cid}/heatmap",
            headers=auth_header(teacher_token),
        )
        data = resp.json()
        assert "students" in data
        # Should have all enrolled students (student + NUM_ASSIGNMENTS-1 others)
        assert len(data["students"]) == NUM_ASSIGNMENTS

    def test_query_count_is_bounded(self, client, teacher_token):
        """N+1 worst case: auth + enrollments + N*student.name = N+3 lazy loads.
        Fixed: enrollments joinedloads students in 1 query → total is constant regardless of N.
        """
        n = NUM_ASSIGNMENTS  # students enrolled
        cid = _state["classroom_id"]

        def call():
            client.get(
                f"/api/teacher/classrooms/{cid}/heatmap",
                headers=auth_header(teacher_token),
            )

        q = count_queries(call)
        # Original: auth + classroom_access + enrollments + N*student.name = N+3
        # Fixed: constant queries (auth + access + enrollments_joinedload + sessions = ~5)
        # Must be strictly less than the N+1 worst case (N+3)
        assert q < n + 3, (
            f"Heatmap endpoint issued {q} queries for {n} students. "
            f"N+1 worst case = {n + 3}. Expected < {n + 3} after fix."
        )
        # ⚠️ 2026-08-28（#2964）改寫。原本是 `assert q <= n` —— 那**不是**
        #    「常數」的判準：實作若是穩定的 8 個查詢，在 n=6 時必然失敗，
        #    而那跟 O(N) 一點關係也沒有。把「不隨 N 成長」誤寫成「小於 N」。
        #
        #    真正的判準是**加倍 N 再量一次，數字不能跟著漲**。
        from app.models.user import User  # noqa: PLC0415
        from app.models.school import ClassroomStudent  # noqa: PLC0415

        db = TestingSessionLocal()
        added = []
        try:
            for i in range(n):                      # 學生數加倍
                u = User(email=f"n1extra{i}_{cid}@example.com",
                         password_hash="x", name=f"N1Extra{i}", is_active=True)
                db.add(u)
                db.flush()
                db.add(ClassroomStudent(classroom_id=cid, student_id=u.id))
                added.append(u.id)
            db.commit()
        finally:
            db.close()

        try:
            q2 = count_queries(call)
        finally:
            # ⛔ 共享班級不是沙箱：多出來的學生會讓別條
            #    （TestErrorHeatmapStudentN1::test_response_has_students）
            #    的 `len(students) == NUM_ASSIGNMENTS` 變紅。
            #    只刪**自己剛建的那幾個 id**，不做條件式一網打盡。
            db = TestingSessionLocal()
            try:
                db.query(ClassroomStudent).filter(
                    ClassroomStudent.student_id.in_(added)).delete(synchronize_session=False)
                db.query(User).filter(User.id.in_(added)).delete(synchronize_session=False)
                db.commit()
            finally:
                db.close()

        assert q2 <= q, (
            f"學生從 {n} 加到 {n * 2} 時查詢數從 {q} 漲到 {q2} —— 還是 O(N)。\n"
            "常數的判準是「加倍 N 之後數字不變」，不是「小於 N」。")


# ===========================================================================
# 4. GET /api/teacher/classrooms/{id}/error-heatmap  — same ClassroomStudent.student N+1
# ===========================================================================


class TestErrorHeatmapStudentN1:
    """Error-heatmap endpoint: ClassroomStudent.student must be eagerly loaded."""

    def test_returns_200(self, client, teacher_token):
        cid = _state["classroom_id"]
        resp = client.get(
            f"/api/teacher/classrooms/{cid}/error-heatmap",
            headers=auth_header(teacher_token),
        )
        assert resp.status_code == 200

    def test_response_has_students(self, client, teacher_token):
        cid = _state["classroom_id"]
        resp = client.get(
            f"/api/teacher/classrooms/{cid}/error-heatmap",
            headers=auth_header(teacher_token),
        )
        data = resp.json()
        assert "students" in data
        assert len(data["students"]) == NUM_ASSIGNMENTS

    def test_query_count_is_bounded(self, client, teacher_token):
        """Error-heatmap N+1: auth + enrollments + N*student.name = N+3 lazy loads.
        Fixed: enrollments joinedloads students in 1 query → total is constant.
        """
        n = NUM_ASSIGNMENTS
        cid = _state["classroom_id"]

        def call():
            client.get(
                f"/api/teacher/classrooms/{cid}/error-heatmap",
                headers=auth_header(teacher_token),
            )

        q = count_queries(call)
        # Must be strictly less than the N+1 worst case (N+3)
        assert q < n + 3, (
            f"Error-heatmap issued {q} queries for {n} students. "
            f"N+1 worst case = {n + 3}. Expected < {n + 3} after fix."
        )
        # Verify constant (not O(N)) behavior
        assert q <= n, (
            f"Error-heatmap queries ({q}) exceeded student count ({n}). "
            f"After joinedload fix queries should be constant, not O(N)."
        )


# ===========================================================================
# 5. Gamification leaderboard — UserRole.role N+1
# ===========================================================================


class TestGamificationLeaderboardN1:
    """GET /api/gamification/leaderboard/{classroom_id} — admin access check N+1."""

    def test_admin_gets_leaderboard(self, client, admin_token):
        cid = _state["classroom_id"]
        resp = client.get(
            f"/api/gamification/leaderboard/{cid}",
            headers=auth_header(admin_token),
        )
        # Admin should be allowed (via role check)
        assert resp.status_code == 200

    def test_leaderboard_query_count_bounded(self, client, admin_token):
        """UserRole.role lazy load: admin has 2 roles → 2 queries. Fixed: 1 joinedload."""
        cid = _state["classroom_id"]

        def call():
            client.get(
                f"/api/gamification/leaderboard/{cid}",
                headers=auth_header(admin_token),
            )

        q = count_queries(call)
        # Original: auth + classroom + ClassroomStudent + UserRole rows + N*role.name
        # With 2 admin roles and N enrolled students that's N+5 queries
        # Fixed: roles are joinedloaded = constant regardless of role count
        n_students = NUM_ASSIGNMENTS
        assert q < n_students * 2, (
            f"Leaderboard issued {q} queries. N+1 with {n_students} students "
            f"and role lazy-loads would be much higher. Expected < {n_students * 2}."
        )


# ===========================================================================
# 6. Gamification _assert_can_view — UserRole.role N+1 (medium priority)
# ===========================================================================


class TestGamificationAssertCanViewN1:
    """GET /api/gamification/summary/{student_id} — _assert_can_view role N+1."""

    def test_admin_can_view_summary(self, client, admin_token, student_token):
        # First get student id
        me = client.get("/api/users/me", headers=auth_header(student_token))
        assert me.status_code == 200
        student_id = me.json()["id"]
        _state["student_id"] = student_id

        resp = client.get(
            f"/api/gamification/summary/{student_id}",
            headers=auth_header(admin_token),
        )
        assert resp.status_code == 200

    def test_summary_response_shape(self, client, admin_token):
        student_id = _state["student_id"]
        resp = client.get(
            f"/api/gamification/summary/{student_id}",
            headers=auth_header(admin_token),
        )
        data = resp.json()
        assert "total_xp" in data
        assert "level_info" in data

    def test_assert_can_view_query_count_bounded(self, client, admin_token):
        """_assert_can_view: admin has 2 roles. Without fix = 2 lazy queries. With fix = 1.

        Tightened bound (was < 20): route cost is dominated by auth + gamification queries.
        If role-lookup N+1 regresses, even 2 roles will push us over 12.
        """
        student_id = _state["student_id"]

        def call():
            client.get(
                f"/api/gamification/summary/{student_id}",
                headers=auth_header(admin_token),
            )

        # Warm up: first call may trigger lazy import / one-time caching
        call()
        q = count_queries(call)
        # Observed after fix: ~6-8 queries. Regression to role N+1 would add >= n_roles extra.
        assert q < 12, (
            f"summary/{student_id} issued {q} queries. Expected < 12 after role joinedload fix "
            f"(observed ~6-8 baseline)."
        )

    def test_assert_can_view_constant_in_role_count(self, client, admin_token):
        """Regression test: query count must NOT grow with number of admin UserRole rows.

        Seeds a second admin with MORE roles (4 vs existing 2) and verifies the delta is
        bounded by a constant, not role_count. This is the sharpest N+1 regression signal.
        """
        # Seed a fat admin with 4 active roles (reuses TestingSessionLocal)
        db = TestingSessionLocal()
        try:
            role_by_name = {r.name: r for r in db.query(Role).all()}
            fat_admin = User(
                email="n1fix_fat_admin@example.com",
                username="n1fix_fat_admin",
                password_hash=hash_password("Password1!"),
                name="Fat Admin",
                is_active=True,
                email_verified=True,
            )
            db.add(fat_admin)
            db.commit()
            db.refresh(fat_admin)
            for role_name in ["system_admin", "org_admin", "teacher", "student"]:
                db.add(UserRole(
                    user_id=fat_admin.id,
                    role_id=role_by_name[role_name].id,
                    scope_type="platform",
                    scope_id=None,
                    is_active=True,
                ))
            db.commit()
        finally:
            db.close()

        fat_token = _login(client, "n1fix_fat_admin@example.com")
        student_id = _state["student_id"]

        def call_fat():
            client.get(
                f"/api/gamification/summary/{student_id}",
                headers=auth_header(fat_token),
            )

        def call_thin():
            client.get(
                f"/api/gamification/summary/{student_id}",
                headers=auth_header(admin_token),
            )

        # Warm up both paths
        call_fat()
        call_thin()

        q_fat = count_queries(call_fat)
        q_thin = count_queries(call_thin)

        # Delta of added roles (4-2=2). If role.name is lazy-loaded, delta >= 2.
        # With joinedload, delta should be 0 (or at most 1 for extra row iteration overhead).
        delta = q_fat - q_thin
        assert delta <= 1, (
            f"Query count grew with UserRole count: thin_admin(2 roles)={q_thin}, "
            f"fat_admin(4 roles)={q_fat} (delta={delta}). Regression to role lazy-load suspected."
        )


# ===========================================================================
# 7. GET /admin/reports/export — CSV export (3-layer lazy load fix)
# ===========================================================================


class TestAdminReportExportN1:
    """GET /admin/reports/export — joinedload student + classroom + classroom.school."""

    def test_returns_200_csv(self, client, admin_token):
        resp = client.get("/api/admin/reports/export", headers=auth_header(admin_token))
        assert resp.status_code == 200, f"expected 200, got {resp.status_code}: {resp.text[:200]}"
        body = resp.content.decode("utf-8-sig")
        first_line = body.split("\n")[0]
        assert "學校名稱" in first_line
        assert "學生姓名" in first_line

    def test_csv_contains_student_rows(self, client, admin_token):
        """Each enrolled student appears as a row with non-empty school/classroom/name."""
        resp = client.get("/api/admin/reports/export", headers=auth_header(admin_token))
        body = resp.content.decode("utf-8-sig")
        rows = [r for r in body.split("\r\n") if r.strip()]
        if len(rows) <= 1:
            # Some writers use \n only
            rows = [r for r in body.split("\n") if r.strip()]
        # Seed: 1 main student + (NUM_ASSIGNMENTS - 1) others = NUM_ASSIGNMENTS rows
        assert len(rows) >= 1 + NUM_ASSIGNMENTS, (
            f"Expected header + >= {NUM_ASSIGNMENTS} student rows, got {len(rows)} total"
        )
        # Each data row must have school name filled (first CSV column)
        for data_row in rows[1:]:
            cells = data_row.split(",")
            assert cells[0].strip() != "", f"empty school in row: {data_row!r}"
            assert cells[1].strip() != "", f"empty classroom in row: {data_row!r}"

    def test_query_count_is_bounded(self, client, admin_token):
        """3-layer lazy chain (student + classroom + school) must be eager-loaded.

        Without fix: ~1 + 3N queries (per enrollment: lazy student, classroom, school).
        With fix: enrollments (1 joinedload) + sessions (1 batch) + auth + admin checks.
        """

        def call():
            client.get("/api/admin/reports/export", headers=auth_header(admin_token))

        # Warm up one-time caching
        call()
        q = count_queries(call)
        n = NUM_ASSIGNMENTS  # 6 enrollments
        # 3N lazy regression would produce >= 18 queries from the lazy chain alone.
        # Post-fix baseline: enrollments + sessions + auth ≈ 6-10 queries.
        assert q < n + 8, (
            f"/admin/reports/export issued {q} queries for {n} enrollments. "
            f"Expected < {n + 8} after 3-layer joinedload fix."
        )
