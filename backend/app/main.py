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
    """Seed default school and test accounts if tables are empty.

    Wrapped in try/except so it doesn't crash during tests where the
    production database is not available.
    """
    from .database import SessionLocal
    from .models.school import School
    from .models.user import User, Role, UserRole
    from .auth.password import hash_password
    try:
        db = SessionLocal()
        try:
            # Seed default school
            if db.query(School).count() == 0:
                db.add(School(name="預設學校", is_active=True))
                db.commit()
                logger.info("Seeded default school: 預設學校")

            # Seed test accounts
            if db.query(User).count() == 0:
                teacher = User(
                    email="teacher@test.com",
                    password_hash=hash_password("teacher1234"),
                    name="測試老師",
                    is_active=True,
                )
                student = User(
                    email="student@test.com",
                    password_hash=hash_password("student1234"),
                    name="測試學生",
                    is_active=True,
                )
                admin = User(
                    email="admin@test.com",
                    password_hash=hash_password("admin1234"),
                    name="系統管理員",
                    is_active=True,
                )
                db.add_all([teacher, student, admin])
                db.flush()

                # Assign roles
                teacher_role = db.query(Role).filter(Role.name == "teacher").first()
                student_role = db.query(Role).filter(Role.name == "student").first()
                admin_role = db.query(Role).filter(Role.name == "system_admin").first()

                if teacher_role:
                    db.add(UserRole(user_id=teacher.id, role_id=teacher_role.id, scope_type="platform"))
                if student_role:
                    db.add(UserRole(user_id=student.id, role_id=student_role.id, scope_type="platform"))
                if admin_role:
                    db.add(UserRole(user_id=admin.id, role_id=admin_role.id, scope_type="platform"))
                    # Admin also gets teacher role
                    if teacher_role:
                        db.add(UserRole(user_id=admin.id, role_id=teacher_role.id, scope_type="platform"))

                db.commit()
                logger.info("Seeded test accounts: teacher@test.com, student@test.com, admin@test.com")
        finally:
            db.close()
    except Exception:
        logger.debug("Skipping seed_default_data (DB not available)")


@app.get("/")
def root():
    return {"status": "ok", "service": "lingoleap-api"}
