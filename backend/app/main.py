import logging
import os
import time
import uuid
import traceback
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

from .config import settings
from .routes import stories, learning, users, auth, classrooms, schools, organizations, roles
from .routes.classroom_texts import router as classroom_texts_router
from .routes.teacher import router as teacher_router
from .routes.assignments import router as assignments_router
from .routes.admin_stories import router as admin_stories_router
from .middleware.tenant import TenantMiddleware
from .routes.feedback import router as feedback_router
from .routes.jobs import router as jobs_router
from .routes.privacy import router as privacy_router
from .routes.cleanup import router as cleanup_router
from .routes.dictionary import router as dictionary_router
from .routes.parents import router as parents_router
from .utils.logging_config import setup_logging

# Initialise structured logging before anything else
setup_logging()

logger = logging.getLogger(__name__)

_env = os.environ.get("ENVIRONMENT", "development")
_is_dev = _env in ("development", "preview")

if settings.jwt_secret_key == "dev-secret-change-in-production":
    if not _is_dev:
        raise RuntimeError("JWT_SECRET_KEY must be set in production!")
    else:
        import warnings
        warnings.warn("Using default JWT secret key — NOT suitable for production", stacklevel=2)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Add OWASP-recommended security headers to every response."""

    # CSP allows self, Google Fonts, Firebase Auth, and Vertex AI domains.
    # 'unsafe-inline' is included for styles loaded by the React app (e.g. Tailwind
    # inline styles) and may be tightened in a future iteration.
    CSP = (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline' https://apis.google.com; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        "font-src 'self' https://fonts.gstatic.com; "
        "img-src 'self' data: https:; "
        "connect-src 'self' "
        "https://*.googleapis.com "
        "https://*.firebaseapp.com "
        "https://*.cloudfunctions.net "
        "https://us-central1-aiplatform.googleapis.com; "
        "frame-ancestors 'none';"
    )

    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)
        response.headers["Content-Security-Policy"] = self.CSP
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Strict-Transport-Security"] = (
            "max-age=31536000; includeSubDomains"
        )
        return response


# ---------------------------------------------------------------------------
# Logging middleware
# ---------------------------------------------------------------------------

class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """Log every HTTP request with duration and attach a request_id.

    The request_id is a UUID4 generated per request. It is stored in
    request.state so downstream handlers can reference it for correlation.

    Structured fields emitted per request:
      - request_id   : UUID4 string
      - method       : HTTP method (GET, POST, …)
      - path         : URL path (no query string to avoid leaking PII)
      - status_code  : HTTP response status
      - duration_ms  : wall-clock time in milliseconds
      - user_id      : extracted from JWT token if present (may be None)
    """

    async def dispatch(self, request: Request, call_next):
        request_id = str(uuid.uuid4())
        request.state.request_id = request_id
        start = time.perf_counter()

        # Best-effort user_id extraction from Authorization header
        user_id = None
        auth_header = request.headers.get("authorization", "")
        if auth_header.startswith("Bearer "):
            try:
                import jwt as pyjwt
                token = auth_header[7:]
                payload = pyjwt.decode(
                    token,
                    settings.jwt_secret_key,
                    algorithms=["HS256"],
                    options={"verify_exp": False},
                )
                user_id = payload.get("sub")
            except Exception:
                pass  # Not critical — we just won't have user_id

        try:
            response = await call_next(request)
            duration_ms = (time.perf_counter() - start) * 1000

            log_level = logging.WARNING if response.status_code >= 400 else logging.INFO
            logger.log(
                log_level,
                "HTTP %s %s -> %d (%.1fms)",
                request.method,
                request.url.path,
                response.status_code,
                duration_ms,
                extra={
                    "request_id": request_id,
                    "method": request.method,
                    "path": request.url.path,
                    "status_code": response.status_code,
                    "duration_ms": round(duration_ms, 1),
                    "user_id": user_id,
                },
            )
            return response

        except Exception as exc:
            duration_ms = (time.perf_counter() - start) * 1000
            logger.error(
                "Unhandled exception during %s %s after %.1fms: %s",
                request.method,
                request.url.path,
                duration_ms,
                exc,
                extra={
                    "request_id": request_id,
                    "method": request.method,
                    "path": request.url.path,
                    "duration_ms": round(duration_ms, 1),
                    "user_id": user_id,
                    "traceback": traceback.format_exc(),
                },
            )
            return JSONResponse(
                status_code=500,
                content={
                    "detail": "Internal server error",
                    "request_id": request_id,
                },
            )


@asynccontextmanager
async def lifespan(app: FastAPI):
    seed_default_data()
    yield


app = FastAPI(
    title="LingoLeap AI Reading Tutor API",
    description="Backend API for the LingoLeap AI Reading Tutor platform",
    version="0.3.0",
    lifespan=lifespan,
    docs_url="/docs" if _is_dev else None,
    redoc_url="/redoc" if _is_dev else None,
)

# Security headers must be added before CORSMiddleware so they appear on
# every response (including CORS preflight responses).
app.add_middleware(SecurityHeadersMiddleware)

# CORS must be added before the logging middleware so the OPTIONS pre-flight
# is still handled correctly.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
# TenantMiddleware enriches request.state with org context (passive, no blocking)
app.add_middleware(TenantMiddleware)

# Logging middleware wraps everything (added after CORS so it runs outermost)
app.add_middleware(RequestLoggingMiddleware)

app.include_router(stories.router, prefix="/api")
app.include_router(learning.router, prefix="/api")
app.include_router(users.router, prefix="/api")
app.include_router(auth.router, prefix="/api")
app.include_router(classrooms.router, prefix="/api")
app.include_router(schools.router, prefix="/api")
app.include_router(organizations.router, prefix="/api")
app.include_router(roles.router, prefix="/api")
app.include_router(classroom_texts_router, prefix="/api", tags=["classroom-texts"])
app.include_router(teacher_router, prefix="/api", tags=["teacher"])
app.include_router(assignments_router, prefix="/api", tags=["assignments"])
app.include_router(admin_stories_router, prefix="/api", tags=["admin-stories"])
app.include_router(feedback_router, prefix="/api", tags=["feedback"])
app.include_router(jobs_router, prefix="/api", tags=["admin-jobs"])
app.include_router(privacy_router, prefix="/api", tags=["privacy"])
app.include_router(cleanup_router, prefix="/api", tags=["admin-cleanup"])
app.include_router(dictionary_router, prefix="/api", tags=["dictionary"])
app.include_router(parents_router, prefix="/api", tags=["parents"])


def seed_default_data():
    """Seed complete demo data: org -> school -> teacher -> classroom -> students.

    Only runs when users table is empty (fresh DB).
    Wrapped in try/except so it doesn't crash during tests.
    """
    import secrets
    import string
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

            # -- 1. Organization --
            org = Organization(name="朗朗教育基金會", display_name="朗朗教育基金會", is_active=True)
            db.add(org)
            db.flush()

            # -- 2. Schools --
            def _gen_code(k):
                return "".join(secrets.choice(string.ascii_uppercase + string.digits) for _ in range(k))

            school1 = School(name="台北市大安國小", organization_id=org.id, is_active=True, address="台北市大安區信義路四段1號", join_code=_gen_code(8))
            school2 = School(name="新北市板橋國小", organization_id=org.id, is_active=True, address="新北市板橋區文化路一段23號", join_code=_gen_code(8))
            db.add_all([school1, school2])
            db.flush()

            # -- 3. Users --
            admin = User(email="admin@test.com", password_hash=hash_password("admin1234"), name="王管理員", is_active=True)
            teacher1 = User(email="teacher@test.com", password_hash=hash_password("teacher1234"), name="李老師", is_active=True)
            teacher2 = User(email="teacher2@test.com", password_hash=hash_password("teacher1234"), name="陳老師", is_active=True)
            student1 = User(email="student@test.com", password_hash=hash_password("student1234"), name="小明", is_active=True, username="student1")
            student2 = User(email="student2@test.com", password_hash=hash_password("student1234"), name="小華", is_active=True, username="student2")
            student3 = User(email="student3@test.com", password_hash=hash_password("student1234"), name="小美", is_active=True, username="student3")
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

            db.commit()
            logger.info(
                "Seeded demo data: 1 org, 2 schools, 3 classrooms, "
                "6 users (admin/teacher1/teacher2/student1-3)"
            )
        finally:
            db.close()
    except Exception as e:
        logger.warning("seed_default_data failed: %s", e)


@app.get("/")
def root():
    return {"status": "ok", "service": "lingoleap-api"}
