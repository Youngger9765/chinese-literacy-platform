import logging
import os
import time
import uuid
import traceback
from contextlib import asynccontextmanager

import sentry_sdk

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

from .config import settings
from .routes import stories, learning, users, auth, classrooms, schools, organizations, roles, testset, spotlight_qa
from .routes.classroom_texts import router as classroom_texts_router
from .routes.teacher import router as teacher_router
from .routes.assignments import router as assignments_router
from .routes.admin_stories import router as admin_stories_router
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
from .routes.tts import router as tts_router
from .routes.tts_audit import router as tts_audit_router
from .routes.admin_sessions import router as admin_sessions_router
from .routes.library import router as library_router
from .routes.admin_seed import router as admin_seed_router
from .routes.omo import router as omo_router
from .routes.curriculum_qa import router as curriculum_qa_router
from .routes.admin_story_structure_lab import router as admin_story_structure_lab_router
from .utils.logging_config import setup_logging
from .auth.rate_limiter import general_rate_limiter
from .services.seed import seed_default_data, repair_pii_accounts

# Initialise structured logging before anything else
setup_logging()

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Sentry error tracking
# ---------------------------------------------------------------------------
# To enable Sentry, set the SENTRY_DSN environment variable in Cloud Run:
#   gcloud run services update lingoleap-backend \
#     --set-env-vars SENTRY_DSN=https://<key>@<org>.ingest.sentry.io/<project-id>
#
# ENVIRONMENT env var controls the Sentry environment tag (default: "production").
# Leave SENTRY_DSN unset (or empty) in local dev to skip initialisation.
_sentry_dsn = os.environ.get("SENTRY_DSN", "").strip()
if _sentry_dsn:
    sentry_sdk.init(
        dsn=_sentry_dsn,
        environment=os.environ.get("ENVIRONMENT", "production"),
        traces_sample_rate=0.1,
    )
    logger.info("Sentry initialised (environment=%s)", os.environ.get("ENVIRONMENT", "production"))
else:
    logger.info("Sentry not initialised — SENTRY_DSN is not set")

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
        "img-src 'self' data: blob: https:; "  # blob: needed for OMO cropped image previews (#1917)
        "media-src 'self' blob:; "
        "connect-src 'self' "
        "https://*.run.app "
        "https://*.googleapis.com "
        "https://*.firebaseapp.com "
        "https://*.cloudfunctions.net "
        "https://us-central1-aiplatform.googleapis.com; "
        # Issue #1496: allow GCS bucket for the worksheet PDF iframe (#1444),
        # plus YouTube embeds for the knowledge-station videos.
        # NOTE: CSP frame-src cannot restrict by path (spec limitation), so the
        # entire storage.googleapis.com host is whitelisted. The actual PDFs
        # live under public-read `lingoleap-assets/worksheets/`; tighter scoping
        # would require proxying PDFs through our own origin.
        "frame-src 'self' "
        "https://storage.googleapis.com "
        "https://www.youtube.com "
        "https://www.youtube-nocookie.com; "
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
            # Manually inject CORS headers on the 500 fallback response.
            # BaseHTTPMiddleware short-circuits the ASGI send chain, so
            # CORSMiddleware's send-wrapper is bypassed when we return a
            # raw JSONResponse here. We replicate the same logic as
            # Starlette's CORSMiddleware.simple_response() so that browsers
            # can read the error body instead of seeing a CORS-blocked response.
            # (#1910 Sub-bug B)
            origin = request.headers.get("origin", "")
            cors_headers: dict[str, str] = {}
            if origin and origin in settings.origins_list:
                cors_headers["Access-Control-Allow-Origin"] = origin
                cors_headers["Access-Control-Allow-Credentials"] = "true"
                cors_headers["Vary"] = "Origin"
            return JSONResponse(
                status_code=500,
                content={
                    "detail": "Internal server error",
                    "request_id": request_id,
                },
                headers=cors_headers if cors_headers else None,
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
    # Allow env overrides so local dev (React StrictMode double-invocations,
    # HMR replays) doesn't trip the global limiter while debugging.
    READ_LIMIT = int(os.getenv("RATE_LIMIT_READ", "300"))
    WRITE_LIMIT = int(os.getenv("RATE_LIMIT_WRITE", "90"))
    WINDOW = int(os.getenv("RATE_LIMIT_WINDOW", "60"))  # seconds

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
    # seed_default_data() internally respects ENABLE_TEST_SEED and ENVIRONMENT:
    # on prod (ENABLE_TEST_SEED=false) it only runs non-seeding startup tasks
    # (YAML → texts sync, migration patches) without creating demo accounts.
    seed_default_data()
    # Idempotent: deactivate PII gmail accounts that leaked into staging DB (#1920).
    # Safe on prod — does nothing if accounts don't exist.
    try:
        from .database import SessionLocal as _SessionLocal
        _db = _SessionLocal()
        try:
            repair_pii_accounts(_db)
        finally:
            _db.close()
    except Exception as _e:
        logger.warning("repair_pii_accounts failed (non-fatal): %s", _e)
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

# Global rate limiting: 300 read req/min + 90 write req/min per IP for /api/*.
# Placed after CORS so CORS preflight OPTIONS requests are not rate-limited.
app.add_middleware(GlobalRateLimitMiddleware)

# Logging middleware wraps everything (added after CORS so it runs outermost)
app.add_middleware(RequestLoggingMiddleware)

app.include_router(stories.router, prefix="/api")
app.include_router(testset.router, prefix="/api")
app.include_router(spotlight_qa.router, prefix="/api")
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
app.include_router(tts_router)
app.include_router(tts_audit_router)
app.include_router(admin_sessions_router, prefix="/api", tags=["admin-sessions"])
app.include_router(library_router, prefix="/api", tags=["library"])
app.include_router(admin_seed_router, prefix="/api", tags=["admin-seed"])
app.include_router(omo_router, prefix="/api", tags=["omo"])
app.include_router(curriculum_qa_router, prefix="/api", tags=["curriculum-qa"])
app.include_router(admin_story_structure_lab_router, prefix="/api", tags=["admin-story-structure-lab"])


@app.get("/")
def root():
    return {"status": "ok", "service": "lingoleap-api"}
