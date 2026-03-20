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
from .routes.gamification import router as gamification_router
from .routes.health import router as health_router
from .routes.semesters import router as semesters_router
from .routes.co_teaching import router as co_teaching_router
from .utils.logging_config import setup_logging
from .auth.rate_limiter import general_rate_limiter

# Initialise structured logging before anything else
setup_logging()

logger = logging.getLogger(__name__)

_env = os.environ.get("ENVIRONMENT", "development")
_is_dev = _env in ("development", "preview")

if not settings.jwt_secret_key:
    if not _is_dev:
        raise RuntimeError("JWT_SECRET_KEY must be set in production!")
    else:
        import warnings
        warnings.warn("JWT_SECRET_KEY is empty — auth endpoints will fail. Set it in .env", stacklevel=2)


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
        "https://*.run.app "
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


class GlobalRateLimitMiddleware:
    """Pure ASGI middleware for global per-IP rate limiting on /api/* endpoints.

    Uses raw ASGI protocol instead of BaseHTTPMiddleware to guarantee headers
    are injected before the response starts streaming (BaseHTTPMiddleware +
    StreamingResponse can silently drop headers added after call_next).
    """

    _EXEMPT_PATHS = ("/health", "/docs", "/redoc", "/openapi.json", "/")
    # Read operations are much burstier during UI navigation (route mounts,
    # parallel data loaders, prefetch). Keep write operations stricter.
    READ_LIMIT = 300
    WRITE_LIMIT = 90
    WINDOW = 60  # seconds

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path = scope["path"]

        # Skip rate limiting for exempt or non-API paths.
        if path in self._EXEMPT_PATHS or not path.startswith("/api"):
            await self.app(scope, receive, send)
            return

        # Extract real client IP from headers.
        headers_raw = dict(scope.get("headers", []))
        forwarded_for = headers_raw.get(b"x-forwarded-for", b"").decode()
        if forwarded_for:
            ip = forwarded_for.split(",")[0].strip()
        else:
            client = scope.get("client")
            ip = client[0] if client else "unknown"
        method = scope.get("method", "GET").upper()
        is_read = method in ("GET", "HEAD", "OPTIONS")
        limit = self.READ_LIMIT if is_read else self.WRITE_LIMIT
        key = f"global:ip:{ip}:{'read' if is_read else 'write'}"

        info = general_rate_limiter.check_with_info(key, limit, self.WINDOW)

        if not info.allowed:
            response = JSONResponse(
                status_code=429,
                content={
                    "detail": (
                        "Too many requests. "
                        f"Limit is {limit} requests per {self.WINDOW} seconds per IP. "
                        f"Please retry after {info.retry_after} seconds."
                    ),
                    "retry_after": info.retry_after,
                },
                headers={
                    "Retry-After": str(info.retry_after),
                    "X-RateLimit-Limit": str(limit),
                    "X-RateLimit-Remaining": "0",
                },
            )
            await response(scope, receive, send)
            return

        # Inject rate-limit headers into the response.
        extra_headers = [
            (b"x-ratelimit-limit", str(limit).encode()),
            (b"x-ratelimit-remaining", str(info.remaining).encode()),
        ]

        async def send_with_headers(message):
            if message["type"] == "http.response.start":
                message["headers"] = list(message.get("headers", [])) + extra_headers
            await send(message)

        await self.app(scope, receive, send_with_headers)


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

# CORS — added after SecurityHeaders so CORS headers appear on all responses
# including pre-flight OPTIONS.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
# TenantMiddleware enriches request.state with org context (passive, no blocking)
app.add_middleware(TenantMiddleware)

# Global rate limiting: 300 read req/min + 90 write req/min per IP for /api/*.
# Placed after CORS so CORS preflight OPTIONS requests are not rate-limited.
app.add_middleware(GlobalRateLimitMiddleware)

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
app.include_router(gamification_router, prefix="/api", tags=["gamification"])
app.include_router(health_router)
app.include_router(semesters_router, prefix="/api", tags=["semesters"])
app.include_router(co_teaching_router, prefix="/api", tags=["co-teaching"])


def _patch_seed_assignments(db) -> None:
    """Idempotent patch: create assignment seed data if teacher@test.com has none.

    Safe to call on both fresh DBs (before users are seeded) and existing DBs.
    Introduced in #528 to fix staging QA environments missing assignment data.
    """
    from datetime import datetime, timezone, timedelta
    from .models.user import User
    from .models.school import Classroom
    from .models.session import LearningSession
    from .models.assignment import Assignment, AssignmentSubmission

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


def seed_default_data():
    """Seed complete demo data: org -> school -> teacher -> classroom -> students.

    Only runs when users table is empty (fresh DB).
    Wrapped in try/except so it doesn't crash during tests.
    """
    import secrets
    import string
    from datetime import datetime, timezone, timedelta
    from .database import SessionLocal
    from .models.school import School, Classroom, ClassroomStudent
    from .models.organization import Organization
    from .models.user import User, Role, UserRole
    from .models.session import LearningSession
    from .models.gamification import StudentStreak, StudentXPLog
    from .models.assignment import Assignment, AssignmentSubmission
    from .auth.password import hash_password
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


@app.get("/")
def root():
    return {"status": "ok", "service": "lingoleap-api"}
