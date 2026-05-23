"""Tests for Issue #1920: Seed data PII cleanup.

Bug A: Real gmail PII addresses (jay.tzeng@gmail.com, kuanweilu@gmail.com) in staging DB
Bug B: 王管理員 (admin@test.com) incorrectly assigned teacher role (should have 2 roles only)
Bug C: 小明 (student@test.com, grade-3 persona) enrolled in 七年甲班 (grade-7 class)

Strategy: static source analysis avoids SQLite JSON RETURNING issues with JSONB columns.
"""
import re
from pathlib import Path

import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

SEED_PY = Path(__file__).parent.parent / "app" / "services" / "seed.py"


@pytest.fixture(scope="module")
def seed_source() -> str:
    return SEED_PY.read_text(encoding="utf-8")


# ---------------------------------------------------------------------------
# Bug A: No real gmail addresses in seed source
# ---------------------------------------------------------------------------

class TestBugA_NoGmailInSeedSource:
    """Bug A: seed.py must not *seed* real PII gmail addresses into the DB.

    jay.tzeng@gmail.com and kuanweilu@gmail.com exist only in the live staging
    DB from early dogfood sessions.  seed.py is allowed to reference them in a
    repair constant (_PII_GMAIL_ACCOUNTS) to deactivate them, but must NEVER
    use them in email= keyword arguments that would re-create those accounts.
    """

    def test_no_gmail_seeded_via_user_email_kwarg(self, seed_source: str) -> None:
        """gmail addresses must not appear in User(email=...) or email= assignments."""
        # Match patterns like:  email="jay.tzeng@gmail.com"
        # or:                   User(email="jay.tzeng@gmail.com", ...)
        seeding_pattern = re.compile(r'email\s*=\s*"[^"]*@gmail\.com"')
        matches = seeding_pattern.findall(seed_source)
        assert matches == [], (
            f"Found gmail address in email= assignment (would re-create PII account): {matches}"
        )

    def test_seed_user_emails_are_test_domain_only(self, seed_source: str) -> None:
        """email= keyword arguments in seed.py use @test.com or @testdata.lingoleap.dev."""
        # Only look at email="..." keyword argument patterns (not list/constant definitions)
        email_kwargs = re.findall(r'email\s*=\s*"([^"]+@[^"]+)"', seed_source)
        allowed_domains = {"test.com", "testdata.lingoleap.dev"}
        bad = [e for e in email_kwargs if e.split("@")[-1] not in allowed_domains]
        assert bad == [], (
            f"Non-test email in email= kwarg: {bad}. "
            "Only @test.com and @testdata.lingoleap.dev are allowed as seeded accounts."
        )

    def test_repair_function_exists_in_seed_source(self, seed_source: str) -> None:
        """Bug A repair: an idempotent cleanup function for live-DB gmail rows must exist."""
        assert "repair_pii_accounts" in seed_source or "cleanup_pii" in seed_source or "deactivate_pii" in seed_source, (
            "No PII repair function found in seed.py. "
            "Expected a function like repair_pii_accounts() that deactivates/anonymizes "
            "jay.tzeng@gmail.com and kuanweilu@gmail.com in the live staging DB."
        )

    def test_pii_gmail_list_defined_for_repair_only(self, seed_source: str) -> None:
        """The _PII_GMAIL_ACCOUNTS constant must exist and list both gmail addresses."""
        assert "_PII_GMAIL_ACCOUNTS" in seed_source, (
            "_PII_GMAIL_ACCOUNTS constant not found in seed.py — needed for repair function"
        )
        assert "jay.tzeng@gmail.com" in seed_source, (
            "jay.tzeng@gmail.com not in _PII_GMAIL_ACCOUNTS — repair function can't target it"
        )
        assert "kuanweilu@gmail.com" in seed_source, (
            "kuanweilu@gmail.com not in _PII_GMAIL_ACCOUNTS — repair function can't target it"
        )


# ---------------------------------------------------------------------------
# Bug B: admin must NOT have teacher role in seed source
# ---------------------------------------------------------------------------

class TestBugB_AdminRoles:
    """Bug B: 王管理員 should only have system_admin + org_admin (2 roles).
    Teacher role was wrongly appended to admin.
    """

    def test_admin_teacher_role_not_assigned_in_seed(self, seed_source: str) -> None:
        """RED: the faulty admin-teacher assignment must be removed from seed.py."""
        assert "user_id=admin.id, role_id=role_teacher.id" not in seed_source, (
            "admin.id is being assigned role_teacher — this is Bug B. "
            "Remove the line that gives admin the teacher role."
        )

    def test_admin_only_gets_system_admin_and_org_admin(self, seed_source: str) -> None:
        """After fix: admin only appears in system_admin and org_admin assignments."""
        # Count how many role_assignments use admin.id
        assignments_with_admin = re.findall(
            r"UserRole\([^)]*user_id=admin\.id[^)]*\)", seed_source
        )
        assert len(assignments_with_admin) == 2, (
            f"Expected exactly 2 role assignments for admin (system_admin + org_admin), "
            f"found {len(assignments_with_admin)}: {assignments_with_admin}"
        )

    def test_teacher1_still_gets_teacher_role(self, seed_source: str) -> None:
        """teacher1 must still receive the teacher role (collateral check)."""
        assert "user_id=teacher1.id, role_id=role_teacher.id" in seed_source, (
            "teacher1 should still be assigned the teacher role"
        )


# ---------------------------------------------------------------------------
# Bug C: student1 (小明) must not be in grade-7 class
# ---------------------------------------------------------------------------

class TestBugC_StudentEnrollment:
    """Bug C: student1 (小明, grade-3 student) must not be enrolled in class_7a (七年甲班)."""

    def test_xiaoming_not_enrolled_in_class_7a(self, seed_source: str) -> None:
        """RED: the faulty student1→class_7a enrollment must be removed."""
        assert "classroom_id=class_7a.id, student_id=student1.id" not in seed_source, (
            "student1 (小明) is enrolled in class_7a (七年甲班) — this is Bug C. "
            "Remove ClassroomStudent(classroom_id=class_7a.id, student_id=student1.id)."
        )

    def test_xiaoming_still_enrolled_in_class_3a(self, seed_source: str) -> None:
        """After fix: student1 must still be enrolled in class_3a (三年甲班)."""
        assert "classroom_id=class_3a.id, student_id=student1.id" in seed_source, (
            "student1 (小明) should be enrolled in class_3a (三年甲班)"
        )

    def test_student3_enrolled_in_class_5b(self, seed_source: str) -> None:
        """Collateral: student3 enrollment in class_5b must be preserved."""
        assert "classroom_id=class_5b.id, student_id=student3.id" in seed_source, (
            "student3 (小美) should still be enrolled in class_5b (五年乙班)"
        )

    def test_student1_total_enrollments_is_one(self, seed_source: str) -> None:
        """student1 should appear in exactly one ClassroomStudent entry."""
        enrollments = re.findall(
            r"ClassroomStudent\([^)]*student_id=student1\.id[^)]*\)", seed_source
        )
        assert len(enrollments) == 1, (
            f"Expected student1 in exactly 1 classroom, found {len(enrollments)}: {enrollments}"
        )
