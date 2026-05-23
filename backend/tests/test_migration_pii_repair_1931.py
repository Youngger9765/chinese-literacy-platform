"""Tests for Issue #1931: Alembic migration to repair existing PII rows in staging DB.

Bug A: jay.tzeng@gmail.com and kuanweilu@gmail.com email fields still hold real PII
       even though is_active=False (PR #1930 only deactivated, did not anonymize).
Bug B: 王管理員 (admin@test.com) still has a UserRole row with role='teacher'.
Bug C: 小明 (student@test.com) may still have a ClassroomStudent row for a grade-7 class.

Strategy: use SQLite in-memory DB, manually seed the "broken" state, apply the
           same SQL logic as the migration, then assert the repaired state.
           Avoids real Alembic runner (needs live PG); tests the SQL logic directly.

TDD phases:
  RED  → Tests fail before migration SQL is applied (broken state seeded).
  GREEN→ Tests pass after the repair SQL runs.

Run with:
    cd backend && python -m pytest tests/test_migration_pii_repair_1931.py -v
"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models import Base
from app.models.user import User, Role, UserRole
from app.models.school import School, Classroom, ClassroomStudent
from app.models.organization import Organization
from app.auth.password import hash_password


# ---------------------------------------------------------------------------
# SQLite in-memory DB setup
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


# ---------------------------------------------------------------------------
# Roles (match production seed)
# ---------------------------------------------------------------------------

SEED_ROLES = [
    {"name": "system_admin", "display_name": "System Admin", "scope_level": "platform"},
    {"name": "org_admin",    "display_name": "Org Admin",    "scope_level": "organization"},
    {"name": "teacher",      "display_name": "Teacher",      "scope_level": "school"},
    {"name": "student",      "display_name": "Student",      "scope_level": "school"},
]


def _seed_roles(session):
    for r in SEED_ROLES:
        session.add(Role(name=r["name"], display_name=r["display_name"], scope_level=r["scope_level"]))
    session.commit()


# ---------------------------------------------------------------------------
# Helper: build the "broken" staging state
# ---------------------------------------------------------------------------

def _seed_broken_state(session) -> dict:
    """Seed the exact broken rows that exist in staging after PR #1930.

    Returns a dict of seeded object IDs for assertions.
    """
    # Org + school needed for FK chains
    org = Organization(name="測試機構", is_active=True)
    session.add(org)
    session.flush()

    school = School(name="測試學校", organization_id=org.id, is_active=True)
    session.add(school)
    session.flush()

    # Bug A: gmail users (is_active=False from #1930, but email still PII)
    jay = User(
        email="jay.tzeng@gmail.com",
        password_hash=hash_password("test1234"),
        name="Jay Tzeng",
        is_active=False,
        email_verified=True,
    )
    kuan = User(
        email="kuanweilu@gmail.com",
        password_hash=hash_password("test1234"),
        name="Kuanweilu",
        is_active=False,
        email_verified=True,
    )
    # Bug B: admin@test.com with teacher role
    admin = User(
        email="admin@test.com",
        password_hash=hash_password("admin1234"),
        name="王管理員",
        is_active=True,
        email_verified=True,
    )
    # student for Bug C
    student = User(
        email="student@test.com",
        password_hash=hash_password("student1234"),
        name="小明",
        is_active=True,
        email_verified=True,
    )
    session.add_all([jay, kuan, admin, student])
    session.flush()

    # Bug B: admin gets teacher role (the bad row)
    role_system_admin = session.query(Role).filter(Role.name == "system_admin").first()
    role_org_admin    = session.query(Role).filter(Role.name == "org_admin").first()
    role_teacher      = session.query(Role).filter(Role.name == "teacher").first()

    session.add(UserRole(user_id=admin.id, role_id=role_system_admin.id, scope_type="platform"))
    session.add(UserRole(user_id=admin.id, role_id=role_org_admin.id,    scope_type="organization", scope_id=str(org.id)))
    session.add(UserRole(user_id=admin.id, role_id=role_teacher.id,      scope_type="school",       scope_id=str(school.id)))

    # Bug C: 小明 enrolled in a grade-7 classroom
    class_7a = Classroom(
        school_id=school.id,
        teacher_id=admin.id,  # reusing admin as a placeholder teacher FK
        name="七年甲班",
        grade=7,
        is_active=True,
    )
    class_3a = Classroom(
        school_id=school.id,
        teacher_id=admin.id,
        name="三年甲班",
        grade=3,
        is_active=True,
    )
    session.add_all([class_7a, class_3a])
    session.flush()

    # Enroll 小明 in BOTH classrooms (the bad row is class_7a)
    session.add(ClassroomStudent(classroom_id=class_7a.id, student_id=student.id))
    session.add(ClassroomStudent(classroom_id=class_3a.id, student_id=student.id))
    session.commit()

    return {
        "jay_id":     jay.id,
        "kuan_id":    kuan.id,
        "admin_id":   admin.id,
        "student_id": student.id,
        "school_id":  school.id,
        "class_7a_id": class_7a.id,
        "class_3a_id": class_3a.id,
        "role_teacher_id": role_teacher.id,
    }


# ---------------------------------------------------------------------------
# The repair SQL — mirrors exactly what the Alembic migration does
# (SQLite-compatible: no CONCAT, use '||')
# ---------------------------------------------------------------------------

def _apply_repair_sql(session, ids: dict) -> None:
    """Apply the same idempotent repair logic as the Alembic migration.

    Uses SQLite-compatible SQL (|| instead of CONCAT).
    The Alembic migration uses PostgreSQL CONCAT() — same semantics.
    """
    conn = session.connection()

    # Bug A: rewrite gmail email to inactive_{id}@test.com
    # SQLite: use || for string concatenation; Postgres uses CONCAT()
    conn.execute(text(
        "UPDATE users SET email = 'inactive_' || CAST(id AS TEXT) || '@test.com' "
        "WHERE email LIKE '%@gmail.com'"
    ))

    # Bug B: delete teacher role from admin@test.com
    # (admin@test.com email is NOT gmail so not affected by Bug A query)
    conn.execute(text(
        "DELETE FROM user_roles "
        "WHERE user_id = (SELECT id FROM users WHERE email = 'admin@test.com') "
        "  AND role_id = (SELECT id FROM roles WHERE name = 'teacher')"
    ))

    # Bug C: delete 小明's enrollment in any 七年 grade classroom
    conn.execute(text(
        "DELETE FROM classroom_students "
        "WHERE student_id = (SELECT id FROM users WHERE email = 'student@test.com') "
        "  AND classroom_id IN (SELECT id FROM classrooms WHERE name LIKE '%七年%')"
    ))

    session.commit()


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module", autouse=True)
def setup_tables():
    Base.metadata.create_all(bind=engine)
    s = TestingSessionLocal()
    _seed_roles(s)
    s.close()
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture()
def db_session():
    """Fresh session per test; rolls back after each test."""
    s = TestingSessionLocal()
    yield s
    s.rollback()
    s.close()


@pytest.fixture()
def broken_state(db_session):
    """Seed the broken state and return IDs; tear down after test."""
    ids = _seed_broken_state(db_session)
    yield ids
    # Cleanup: delete seeded rows in FK-safe order
    db_session.query(ClassroomStudent).delete()
    db_session.query(Classroom).delete()
    db_session.query(UserRole).delete()
    db_session.query(User).filter(
        User.email.in_([
            "jay.tzeng@gmail.com",
            "kuanweilu@gmail.com",
            "admin@test.com",
            "student@test.com",
            f"inactive_{ids['jay_id']}@test.com",
            f"inactive_{ids['kuan_id']}@test.com",
        ])
    ).delete(synchronize_session=False)
    db_session.query(School).delete()
    db_session.query(Organization).delete()
    db_session.commit()


# ---------------------------------------------------------------------------
# RED Phase: Assert broken state is actually broken (before migration)
# ---------------------------------------------------------------------------

class TestBrokenStateExists:
    """Verify the seeded broken state actually represents the pre-migration DB."""

    def test_gmail_emails_exist_before_repair(self, broken_state, db_session):
        """Bug A: gmail addresses are still present in the users table."""
        gmail_users = db_session.query(User).filter(
            User.email.like("%@gmail.com")
        ).all()
        assert len(gmail_users) == 2, (
            f"Expected 2 gmail users in broken state, got {len(gmail_users)}"
        )

    def test_admin_has_teacher_role_before_repair(self, broken_state, db_session):
        """Bug B: admin@test.com has a teacher UserRole row."""
        admin = db_session.query(User).filter(User.email == "admin@test.com").first()
        role_teacher = db_session.query(Role).filter(Role.name == "teacher").first()
        teacher_role_row = (
            db_session.query(UserRole)
            .filter(UserRole.user_id == admin.id, UserRole.role_id == role_teacher.id)
            .first()
        )
        assert teacher_role_row is not None, (
            "Bug B pre-condition: admin@test.com must have teacher role before repair"
        )

    def test_xiaoming_enrolled_in_grade7_before_repair(self, broken_state, db_session):
        """Bug C: 小明 is enrolled in 七年甲班 before repair."""
        student = db_session.query(User).filter(User.email == "student@test.com").first()
        class_7a_id = broken_state["class_7a_id"]
        enrollment = (
            db_session.query(ClassroomStudent)
            .filter(
                ClassroomStudent.student_id == student.id,
                ClassroomStudent.classroom_id == class_7a_id,
            )
            .first()
        )
        assert enrollment is not None, (
            "Bug C pre-condition: 小明 must be in 七年甲班 before repair"
        )


# ---------------------------------------------------------------------------
# GREEN Phase: After migration SQL runs, state is clean
# ---------------------------------------------------------------------------

class TestAfterRepairMigration:
    """After applying repair SQL, all three bugs are resolved."""

    def test_no_gmail_emails_after_repair(self, broken_state, db_session):
        """Bug A: no user.email contains '@gmail.com' after migration."""
        _apply_repair_sql(db_session, broken_state)

        gmail_users = db_session.query(User).filter(
            User.email.like("%@gmail.com")
        ).all()
        assert gmail_users == [], (
            f"Bug A: found gmail emails after repair: {[u.email for u in gmail_users]}"
        )

    def test_gmail_emails_renamed_to_inactive_pattern(self, broken_state, db_session):
        """Bug A: renamed emails follow inactive_{id}@test.com pattern."""
        _apply_repair_sql(db_session, broken_state)

        jay_id = broken_state["jay_id"]
        kuan_id = broken_state["kuan_id"]

        jay = db_session.query(User).filter(User.id == jay_id).first()
        kuan = db_session.query(User).filter(User.id == kuan_id).first()

        assert jay.email == f"inactive_{jay_id}@test.com", (
            f"Bug A: Jay email not anonymized. Got: {jay.email}"
        )
        assert kuan.email == f"inactive_{kuan_id}@test.com", (
            f"Bug A: Kuanweilu email not anonymized. Got: {kuan.email}"
        )

    def test_admin_has_exactly_2_roles_after_repair(self, broken_state, db_session):
        """Bug B: admin@test.com has exactly 2 roles (system_admin + org_admin)."""
        _apply_repair_sql(db_session, broken_state)

        admin = db_session.query(User).filter(User.email == "admin@test.com").first()
        role_rows = db_session.query(UserRole).filter(UserRole.user_id == admin.id).all()
        role_names = {
            db_session.query(Role).filter(Role.id == r.role_id).first().name
            for r in role_rows
        }
        assert "teacher" not in role_names, (
            f"Bug B: admin still has teacher role after repair. Roles: {role_names}"
        )
        assert len(role_rows) == 2, (
            f"Bug B: admin should have exactly 2 roles after repair, got {len(role_rows)}: {role_names}"
        )

    def test_xiaoming_not_in_grade7_after_repair(self, broken_state, db_session):
        """Bug C: 小明 not enrolled in 七年甲班 after migration."""
        _apply_repair_sql(db_session, broken_state)

        student = db_session.query(User).filter(User.email == "student@test.com").first()
        class_7a_id = broken_state["class_7a_id"]
        enrollment = (
            db_session.query(ClassroomStudent)
            .filter(
                ClassroomStudent.student_id == student.id,
                ClassroomStudent.classroom_id == class_7a_id,
            )
            .first()
        )
        assert enrollment is None, (
            "Bug C: 小明 still enrolled in 七年甲班 after repair"
        )

    def test_xiaoming_still_in_grade3_after_repair(self, broken_state, db_session):
        """Bug C collateral: 小明's grade-3 enrollment must be preserved."""
        _apply_repair_sql(db_session, broken_state)

        student = db_session.query(User).filter(User.email == "student@test.com").first()
        class_3a_id = broken_state["class_3a_id"]
        enrollment = (
            db_session.query(ClassroomStudent)
            .filter(
                ClassroomStudent.student_id == student.id,
                ClassroomStudent.classroom_id == class_3a_id,
            )
            .first()
        )
        assert enrollment is not None, (
            "Bug C collateral: 小明's grade-3 enrollment was deleted (should be preserved)"
        )


# ---------------------------------------------------------------------------
# Idempotency: running repair SQL twice must not error
# ---------------------------------------------------------------------------

class TestRepairIdempotency:
    """Running the migration SQL twice must be safe (no errors, same end state)."""

    def test_double_apply_no_error(self, broken_state, db_session):
        """Running repair SQL twice should not raise any exception."""
        _apply_repair_sql(db_session, broken_state)
        # Second run: emails are already @test.com, rows already deleted
        try:
            _apply_repair_sql(db_session, broken_state)
        except Exception as exc:
            pytest.fail(f"Second run of repair SQL raised: {exc}")

    def test_end_state_after_double_apply(self, broken_state, db_session):
        """After two applications: still no gmail, still 2 admin roles."""
        _apply_repair_sql(db_session, broken_state)
        _apply_repair_sql(db_session, broken_state)

        gmail_users = db_session.query(User).filter(
            User.email.like("%@gmail.com")
        ).all()
        assert gmail_users == [], "Should have no gmail emails after double apply"

        admin = db_session.query(User).filter(User.email == "admin@test.com").first()
        role_rows = db_session.query(UserRole).filter(UserRole.user_id == admin.id).all()
        assert len(role_rows) == 2, (
            f"Should still have 2 admin roles after double apply, got {len(role_rows)}"
        )
