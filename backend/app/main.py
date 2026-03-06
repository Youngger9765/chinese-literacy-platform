import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .config import settings
from .routes import stories, learning, users, auth, classrooms, schools, organizations, roles

logger = logging.getLogger(__name__)

app = FastAPI(
    title="LingoLeap AI Reading Tutor API",
    description="Backend API for the LingoLeap AI Reading Tutor platform",
    version="0.3.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(stories.router, prefix="/api")
app.include_router(learning.router, prefix="/api")
app.include_router(users.router, prefix="/api")
app.include_router(auth.router, prefix="/api")
app.include_router(classrooms.router, prefix="/api")
app.include_router(schools.router, prefix="/api")
app.include_router(organizations.router, prefix="/api")
app.include_router(roles.router, prefix="/api")


@app.on_event("startup")
def seed_default_data():
    """Seed complete demo data: org → school → teacher → classroom → students.

    Only runs when users table is empty (fresh DB).
    Wrapped in try/except so it doesn't crash during tests.
    """
    from .database import SessionLocal
    from .models.school import School, Classroom, ClassroomStudent
    from .models.organization import Organization
    from .models.user import User, Role, UserRole
    from .auth.password import hash_password
    try:
        db = SessionLocal()
        try:
            if db.query(User).count() > 0:
                return  # Already seeded

            # ── 1. Organization ──
            org = Organization(name="朗朗教育基金會", display_name="朗朗教育基金會", is_active=True)
            db.add(org)
            db.flush()

            # ── 2. Schools ──
            school1 = School(name="台北市大安國小", organization_id=org.id, is_active=True, address="台北市大安區信義路四段1號")
            school2 = School(name="新北市板橋國小", organization_id=org.id, is_active=True, address="新北市板橋區文化路一段23號")
            db.add_all([school1, school2])
            db.flush()

            # ── 3. Users ──
            admin = User(email="admin@test.com", password_hash=hash_password("admin1234"), name="王管理員", is_active=True)
            teacher1 = User(email="teacher@test.com", password_hash=hash_password("teacher1234"), name="李老師", is_active=True)
            teacher2 = User(email="teacher2@test.com", password_hash=hash_password("teacher1234"), name="陳老師", is_active=True)
            student1 = User(email="student@test.com", password_hash=hash_password("student1234"), name="小明", is_active=True)
            student2 = User(email="student2@test.com", password_hash=hash_password("student1234"), name="小華", is_active=True)
            student3 = User(email="student3@test.com", password_hash=hash_password("student1234"), name="小美", is_active=True)
            db.add_all([admin, teacher1, teacher2, student1, student2, student3])
            db.flush()

            # ── 4. Role assignments ──
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

            # ── 5. Classrooms ──
            class_3a = Classroom(school_id=school1.id, teacher_id=teacher1.id, name="三年甲班", grade=3, is_active=True)
            class_5b = Classroom(school_id=school1.id, teacher_id=teacher1.id, name="五年乙班", grade=5, is_active=True)
            class_7a = Classroom(school_id=school2.id, teacher_id=teacher2.id, name="七年甲班", grade=7, is_active=True)
            db.add_all([class_3a, class_5b, class_7a])
            db.flush()

            # ── 6. Enroll students ──
            db.add_all([
                ClassroomStudent(classroom_id=class_3a.id, student_id=student1.id),
                ClassroomStudent(classroom_id=class_3a.id, student_id=student2.id),
                ClassroomStudent(classroom_id=class_5b.id, student_id=student3.id),
                ClassroomStudent(classroom_id=class_7a.id, student_id=student1.id),
            ])

            db.commit()
            logger.info(
                "Seeded demo data: 1 org, 2 schools, 3 classrooms, "
                "6 users (admin/teacher1/teacher2/student1-3)"
            )
        finally:
            db.close()
    except Exception as e:
        logger.debug("Skipping seed_default_data: %s", e)


@app.get("/")
def root():
    return {"status": "ok", "service": "lingoleap-api"}
