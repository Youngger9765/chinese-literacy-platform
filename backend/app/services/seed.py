"""
Seed data for demo / staging environments.

Extracted from main.py to keep the app entry point thin.
Functions:
  - seed_default_data()          — full demo data (org, schools, users, sessions, etc.)
  - _patch_seed_assignments(db)  — idempotent patch for assignment seed data (#528)
  - _sync_yaml_lessons_to_texts(db) — sync YAML lessons → texts table
"""

import logging
import secrets
import string
from datetime import datetime, timezone, timedelta

from ..database import SessionLocal
from ..models.school import School, Classroom, ClassroomStudent
from ..models.organization import Organization
from ..models.user import User, Role, UserRole
from ..models.session import LearningSession
from ..models.gamification import StudentStreak, StudentXPLog
from ..models.assignment import Assignment, AssignmentSubmission
from ..auth.password import hash_password

logger = logging.getLogger(__name__)


def _patch_seed_assignments(db) -> None:
    """Idempotent patch: create assignment seed data if teacher@test.com has none.

    Safe to call on both fresh DBs (before users are seeded) and existing DBs.
    Introduced in #528 to fix staging QA environments missing assignment data.
    """
    teacher = db.query(User).filter(User.email == "teacher@test.com").first()
    if teacher is None:
        return  # Users not seeded yet; full seed path will handle it

    student = db.query(User).filter(User.email == "student@test.com").first()
    if student is None:
        return

    classroom = (
        db.query(Classroom)
        .filter(Classroom.name == "三年甲班", Classroom.teacher_id == teacher.id)
        .first()
    )
    if classroom is None:
        return

    # Already has assignments — nothing to do
    existing = (
        db.query(Assignment)
        .filter(Assignment.classroom_id == classroom.id, Assignment.teacher_id == teacher.id)
        .count()
    )
    if existing > 0:
        return

    now_utc = datetime.now(tz=timezone.utc)

    # Assignment 1: pending (due date in the future)
    assign_pending = Assignment(
        classroom_id=classroom.id,
        teacher_id=teacher.id,
        story_id="L06",
        title="第六課朗讀練習",
        description="請完成第六課的朗讀與理解練習，注意發音準確度。",
        assignment_type="reading",
        due_date=now_utc + timedelta(days=7),
        is_active=True,
    )
    db.add(assign_pending)
    db.flush()

    # Submission for pending assignment: student has not submitted yet
    db.add(AssignmentSubmission(
        assignment_id=assign_pending.id,
        student_id=student.id,
        status="pending",
    ))

    # Assignment 2: completed (due date in the past, student submitted)
    assign_done = Assignment(
        classroom_id=classroom.id,
        teacher_id=teacher.id,
        story_id="L04",
        title="第四課閱讀理解",
        description="完成第四課的蘇格拉底對話，達到 70 分以上為通過。",
        assignment_type="comprehension",
        due_date=now_utc - timedelta(days=3),
        is_active=True,
    )
    db.add(assign_done)
    db.flush()

    # Link to an existing completed learning session for student1 (story L04)
    completed_session = (
        db.query(LearningSession)
        .filter(
            LearningSession.student_id == student.id,
            LearningSession.story_slug == "L04",
            LearningSession.status == "completed",
        )
        .first()
    )
    sub_done = AssignmentSubmission(
        assignment_id=assign_done.id,
        student_id=student.id,
        status="submitted",
        submitted_at=now_utc - timedelta(days=2),
        score=78.0,
    )
    if completed_session:
        sub_done.session_id = completed_session.id
    db.add(sub_done)

    db.commit()
    logger.info(
        "seed_default_data (#528): patched assignment seed data — "
        "2 assignments + 2 submissions for 三年甲班"
    )


def _sync_yaml_lessons_to_texts(db) -> None:
    """Upsert all YAML lessons into the texts table (idempotent).

    Uses lesson_number as the unique key. New lessons are inserted;
    existing ones are skipped. Runs on every startup so newly added
    YAML files are automatically available as Text records.
    """
    from .lesson_loader import get_all_lessons
    from ..models.text import Text, VisibilityLevel, TextStatus

    lessons = get_all_lessons()
    synced = 0
    for lesson in lessons:
        ln = lesson.get("lesson_number")
        if ln is None:
            continue
        existing = db.query(Text).filter(Text.lesson_number == ln).first()
        if existing:
            continue
        text = Text(
            title=lesson["title"],
            paragraphs=lesson.get("paragraphs", []),
            full_text=lesson.get("full_text"),
            char_count=lesson.get("char_count", 0),
            grade=lesson.get("grade", 4),
            grade_code=lesson.get("grade_code", ""),
            genre=lesson.get("genre", "記敘文"),
            text_type=lesson.get("text_type", "單"),
            category=lesson.get("category", ""),
            reading_strategy=lesson.get("reading_strategy"),
            vocabulary=lesson.get("vocabulary"),
            fill_in_blank=lesson.get("fill_in_blank"),
            multiple_choice=lesson.get("multiple_choice"),
            reading_benchmark=lesson.get("reading_benchmark"),
            source_file=lesson.get("source_file"),
            lesson_number=ln,
            visibility=VisibilityLevel.platform,
            status=TextStatus.published,
        )
        db.add(text)
        synced += 1
    if synced:
        db.commit()
        logger.info("_sync_yaml_lessons_to_texts: synced %d lessons → texts table", synced)


def _gen_code(k: int) -> str:
    return "".join(secrets.choice(string.ascii_uppercase + string.digits) for _ in range(k))


def seed_default_data():
    """Seed complete demo data: org -> school -> teacher -> classroom -> students.

    Only runs when users table is empty (fresh DB).
    Wrapped in try/except so it doesn't crash during tests.
    """
    try:
        db = SessionLocal()
        try:
            # Repair: ensure all known seed accounts have email_verified=True.
            # This handles shared preview DBs that were seeded before #475 added
            # email_verified=True to the seed constructor.
            SEED_EMAILS = [
                "admin@test.com", "teacher@test.com", "teacher2@test.com",
                "student@test.com", "student2@test.com", "student3@test.com",
            ]
            unverified = (
                db.query(User)
                .filter(User.email.in_(SEED_EMAILS), User.email_verified.is_(False))
                .all()
            )
            if unverified:
                for u in unverified:
                    u.email_verified = True
                db.commit()
                logger.info("seed_default_data: patched %d seed accounts to email_verified=True", len(unverified))

            # Repair (#528): patch missing assignment seed data on existing DBs.
            # Runs before the early-return so staging DBs get the fix even if
            # users were already seeded before assignments were added.
            _patch_seed_assignments(db)

            # Sync YAML lessons → texts table (idempotent, uses lesson_number unique key).
            # Runs on every startup so new lessons are picked up automatically.
            _sync_yaml_lessons_to_texts(db)

            if db.query(User).count() > 0:
                return  # Already seeded

            # -- 1. Organization --
            org = Organization(name="朗朗教育基金會", display_name="朗朗教育基金會", is_active=True)
            db.add(org)
            db.flush()

            # -- 2. Schools --
            school1 = School(name="台北市大安國小", organization_id=org.id, is_active=True, address="台北市大安區信義路四段1號", join_code=_gen_code(8))
            school2 = School(name="新北市板橋國小", organization_id=org.id, is_active=True, address="新北市板橋區文化路一段23號", join_code=_gen_code(8))
            db.add_all([school1, school2])
            db.flush()

            # -- 3. Users --
            admin = User(email="admin@test.com", password_hash=hash_password("admin1234"), name="王管理員", is_active=True, email_verified=True)
            teacher1 = User(email="teacher@test.com", password_hash=hash_password("teacher1234"), name="李老師", is_active=True, email_verified=True)
            teacher2 = User(email="teacher2@test.com", password_hash=hash_password("teacher1234"), name="陳老師", is_active=True, email_verified=True)
            student1 = User(email="student@test.com", password_hash=hash_password("student1234"), name="小明", is_active=True, username="student1", email_verified=True)
            student2 = User(email="student2@test.com", password_hash=hash_password("student1234"), name="小華", is_active=True, username="student2", email_verified=True)
            student3 = User(email="student3@test.com", password_hash=hash_password("student1234"), name="小美", is_active=True, username="student3", email_verified=True)
            db.add_all([admin, teacher1, teacher2, student1, student2, student3])
            db.flush()

            # -- 4. Role assignments --
            role_admin = db.query(Role).filter(Role.name == "system_admin").first()
            role_teacher = db.query(Role).filter(Role.name == "teacher").first()
            role_student = db.query(Role).filter(Role.name == "student").first()

            role_org_admin = db.query(Role).filter(Role.name == "org_admin").first()

            role_assignments = []
            if role_admin:
                role_assignments.append(UserRole(user_id=admin.id, role_id=role_admin.id, scope_type="platform"))
            if role_org_admin:
                role_assignments.append(UserRole(user_id=admin.id, role_id=role_org_admin.id, scope_type="organization", scope_id=str(org.id)))
            if role_teacher:
                # admin also manages classrooms in school1
                role_assignments.append(UserRole(user_id=admin.id, role_id=role_teacher.id, scope_type="school", scope_id=str(school1.id)))
                role_assignments.append(UserRole(user_id=teacher1.id, role_id=role_teacher.id, scope_type="school", scope_id=str(school1.id)))
                role_assignments.append(UserRole(user_id=teacher2.id, role_id=role_teacher.id, scope_type="school", scope_id=str(school2.id)))
            if role_student:
                role_assignments.append(UserRole(user_id=student1.id, role_id=role_student.id, scope_type="school", scope_id=str(school1.id)))
                role_assignments.append(UserRole(user_id=student2.id, role_id=role_student.id, scope_type="school", scope_id=str(school1.id)))
                role_assignments.append(UserRole(user_id=student3.id, role_id=role_student.id, scope_type="school", scope_id=str(school1.id)))
            db.add_all(role_assignments)
            db.flush()

            # -- 5. Classrooms --
            class_3a = Classroom(school_id=school1.id, teacher_id=teacher1.id, name="三年甲班", grade=3, is_active=True, join_code=_gen_code(6))
            class_5b = Classroom(school_id=school1.id, teacher_id=teacher1.id, name="五年乙班", grade=5, is_active=True, join_code=_gen_code(6))
            class_7a = Classroom(school_id=school2.id, teacher_id=teacher2.id, name="七年甲班", grade=7, is_active=True, join_code=_gen_code(6))
            db.add_all([class_3a, class_5b, class_7a])
            db.flush()

            # -- 6. Enroll students --
            db.add_all([
                ClassroomStudent(classroom_id=class_3a.id, student_id=student1.id),
                ClassroomStudent(classroom_id=class_3a.id, student_id=student2.id),
                ClassroomStudent(classroom_id=class_5b.id, student_id=student3.id),
                ClassroomStudent(classroom_id=class_7a.id, student_id=student1.id),
            ])

            # -- 7. Learning sessions for students (relative dates so dashboard always shows data) --
            now_utc = datetime.now(tz=timezone.utc)

            def _days_ago(n: float) -> datetime:
                return now_utc - timedelta(days=n)

            # student1: 5 completed sessions spread over last 7 days (today + 6 prior days)
            sessions_student1 = [
                LearningSession(
                    student_id=student1.id,
                    classroom_id=class_3a.id,
                    story_slug="L01",
                    status="completed",
                    current_step=7,
                    overall_score=70.0,
                    started_at=_days_ago(6),
                    completed_at=_days_ago(6),
                ),
                LearningSession(
                    student_id=student1.id,
                    classroom_id=class_3a.id,
                    story_slug="L02",
                    status="completed",
                    current_step=7,
                    overall_score=55.0,
                    started_at=_days_ago(5),
                    completed_at=_days_ago(5),
                ),
                LearningSession(
                    student_id=student1.id,
                    classroom_id=class_3a.id,
                    story_slug="L03",
                    status="completed",
                    current_step=7,
                    overall_score=80.0,
                    started_at=_days_ago(3),
                    completed_at=_days_ago(3),
                ),
                LearningSession(
                    student_id=student1.id,
                    classroom_id=class_3a.id,
                    story_slug="L04",
                    status="completed",
                    current_step=7,
                    overall_score=78.0,
                    started_at=_days_ago(1),
                    completed_at=_days_ago(1),
                ),
                LearningSession(
                    student_id=student1.id,
                    classroom_id=class_3a.id,
                    story_slug="L05",
                    status="completed",
                    current_step=7,
                    overall_score=60.0,
                    started_at=_days_ago(0),
                    completed_at=_days_ago(0),
                ),
            ]
            # student2: 3 sessions this week
            sessions_student2 = [
                LearningSession(
                    student_id=student2.id,
                    classroom_id=class_3a.id,
                    story_slug="L01",
                    status="completed",
                    current_step=7,
                    overall_score=85.0,
                    started_at=_days_ago(4),
                    completed_at=_days_ago(4),
                ),
                LearningSession(
                    student_id=student2.id,
                    classroom_id=class_3a.id,
                    story_slug="L02",
                    status="completed",
                    current_step=7,
                    overall_score=90.0,
                    started_at=_days_ago(2),
                    completed_at=_days_ago(2),
                ),
                LearningSession(
                    student_id=student2.id,
                    classroom_id=class_3a.id,
                    story_slug="L03",
                    status="completed",
                    current_step=7,
                    overall_score=75.0,
                    started_at=_days_ago(0),
                    completed_at=_days_ago(0),
                ),
            ]
            # student3: 2 sessions this week
            sessions_student3 = [
                LearningSession(
                    student_id=student3.id,
                    classroom_id=class_5b.id,
                    story_slug="L01",
                    status="completed",
                    current_step=7,
                    overall_score=65.0,
                    started_at=_days_ago(3),
                    completed_at=_days_ago(3),
                ),
                LearningSession(
                    student_id=student3.id,
                    classroom_id=class_5b.id,
                    story_slug="L02",
                    status="completed",
                    current_step=7,
                    overall_score=72.0,
                    started_at=_days_ago(1),
                    completed_at=_days_ago(1),
                ),
            ]
            all_sessions = sessions_student1 + sessions_student2 + sessions_student3
            db.add_all(all_sessions)
            db.flush()

            # -- 8. Streak records matching the seeded sessions --
            streak_student1 = StudentStreak(
                student_id=student1.id,
                current_streak=2,
                longest_streak=5,
                last_activity_date=now_utc,
            )
            streak_student2 = StudentStreak(
                student_id=student2.id,
                current_streak=1,
                longest_streak=3,
                last_activity_date=now_utc,
            )
            streak_student3 = StudentStreak(
                student_id=student3.id,
                current_streak=1,
                longest_streak=2,
                last_activity_date=_days_ago(1),
            )
            db.add_all([streak_student1, streak_student2, streak_student3])
            db.flush()

            # -- 9. XP log entries for student1 (one per completed session) --
            xp_entries = [
                StudentXPLog(
                    student_id=student1.id,
                    event_type="session_complete",
                    xp_earned=20,
                    session_id=sessions_student1[i].id,
                    note=f"Completed {sessions_student1[i].story_slug}",
                    created_at=sessions_student1[i].completed_at,
                )
                for i in range(len(sessions_student1))
            ]
            db.add_all(xp_entries)

            # -- 10. Assignments for 三年甲班 (Issue #528) --
            # Assignment A: pending — due in 7 days, student has not submitted
            assign_pending = Assignment(
                classroom_id=class_3a.id,
                teacher_id=teacher1.id,
                story_id="L06",
                title="第六課朗讀練習",
                description="請完成第六課的朗讀與理解練習，注意發音準確度。",
                assignment_type="reading",
                due_date=now_utc + timedelta(days=7),
                is_active=True,
            )
            db.add(assign_pending)
            db.flush()
            db.add(AssignmentSubmission(
                assignment_id=assign_pending.id,
                student_id=student1.id,
                status="pending",
            ))

            # Assignment B: submitted — due 3 days ago, student submitted with score
            assign_done = Assignment(
                classroom_id=class_3a.id,
                teacher_id=teacher1.id,
                story_id="L04",
                title="第四課閱讀理解",
                description="完成第四課的蘇格拉底對話，達到 70 分以上為通過。",
                assignment_type="comprehension",
                due_date=now_utc - timedelta(days=3),
                is_active=True,
            )
            db.add(assign_done)
            db.flush()
            # Link submission to the L04 learning session seeded above
            l04_session = next(
                (s for s in sessions_student1 if s.story_slug == "L04"), None
            )
            sub_done = AssignmentSubmission(
                assignment_id=assign_done.id,
                student_id=student1.id,
                status="submitted",
                submitted_at=now_utc - timedelta(days=2),
                score=78.0,
            )
            if l04_session:
                sub_done.session_id = l04_session.id
            db.add(sub_done)

            db.commit()
            logger.info(
                "Seeded demo data: 1 org, 2 schools, 3 classrooms, "
                "6 users (admin/teacher1/teacher2/student1-3), "
                "10 learning sessions with relative dates, "
                "2 assignments + 2 submissions for 三年甲班 (#528)"
            )
        finally:
            db.close()
    except Exception as e:
        logger.warning("seed_default_data failed: %s", e)
