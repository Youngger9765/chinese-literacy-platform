import asyncio
import logging
import os
import re
import time
import uuid
import threading
import traceback
from contextlib import asynccontextmanager

import anyio
import sentry_sdk

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

from .config import settings
from .auth.jwt import decode_token
from .routes import stories, learning, users, auth, classrooms, schools, organizations, roles, testset, spotlight_qa, keypoints_qa
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
from .routes.league import router as league_router
from .routes.health import router as health_router
from .routes.semesters import router as semesters_router
from .routes.co_teaching import router as co_teaching_router
from .routes.tts import router as tts_router
from .routes.tts_audit import router as tts_audit_router
from .routes.admin_sessions import router as admin_sessions_router
from .routes.library import router as library_router
from .routes.admin_seed import router as admin_seed_router
from .routes.admin_iap_allowlist import router as admin_iap_allowlist_router
from .routes.omo import router as omo_router
from .routes.curriculum_qa import router as curriculum_qa_router
from .routes.admin_story_structure_lab import router as admin_story_structure_lab_router
from .routes.admin_story_packs import router as admin_story_packs_router
from .routes.assets import router as assets_router
from .routes.worksheets import router as worksheets_router
from .routes.live_quiz import router as live_quiz_router
from .routes.pk import router as pk_router
from .routes.escape_room import router as escape_room_router
from .routes.team_arena import router as team_arena_router
from .utils.logging_config import setup_logging
from .auth.rate_limiter import general_rate_limiter, trusted_proxy_client_ip
from .services.live_quiz.engine import is_authenticated_member_by_code
from .services.pk.matchmaking import is_authenticated_queue_owner as pk_is_authenticated_queue_owner
from .services.pk.engine import is_authenticated_match_participant as pk_is_authenticated_match_participant
from .services.team_arena.engine import is_authenticated_session_member as team_arena_is_authenticated_member
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
        # Issue #1496: worksheet PDF iframe (#1444), plus YouTube embeds for
        # the knowledge-station videos.
        # Issue #2486: the worksheet PDF now loads through our own `/assets/*`
        # proxy instead of storage.googleapis.com — but the iframe src is only
        # same-origin on the Firebase Hosting build (ASSET_BASE == ""). On the
        # Cloud-Run-direct frontend (staging/prod/PR previews), ASSET_BASE
        # resolves to the *backend's own* Cloud Run origin, which is a
        # different host from the frontend, so the iframe is genuinely
        # cross-origin there. 'self' alone blocks it (confirmed via
        # real-browser repro on staging: CSP frame-src violation, worksheet
        # modal renders blank). https://*.run.app mirrors the same wildcard
        # already trusted by connect-src above, covering prod/staging/preview
        # backends without hardcoding per-environment URLs.
        "frame-src 'self' "
        "https://*.run.app "
        "https://www.youtube.com "
        "https://www.youtube-nocookie.com; "
        "frame-ancestors 'none';"
    )

    # Issue #2486 (part 2): widening frame-src above on the *parent* page is
    # necessary but not sufficient. This middleware used to stamp EVERY
    # response — including the PDF/image bytes served by
    # app/routes/assets.py — with `X-Frame-Options: DENY` and
    # `frame-ancestors 'none'`. Those headers govern whether the resource
    # ITSELF may be framed by anyone, which unconditionally blocked our own
    # worksheet PDF iframe from framing it (DENY has no same-origin
    # exception, and 'none' means literally no one). Confirmed via
    # real-browser QA: after fixing frame-src alone, the iframe's network
    # request succeeded (200 application/pdf, no console error) but the
    # modal stayed visually blank — curl against the same URL showed
    # `x-frame-options: DENY` / `frame-ancestors 'none'` on the PDF response
    # itself. This didn't matter pre-#2488 because storage.googleapis.com
    # (which never sends X-Frame-Options) served these files directly.
    #
    # Fix: for `/assets/*` responses only, omit X-Frame-Options (it can't
    # express "self OR this other specific origin" — only CSP frame-ancestors
    # can) and relax frame-ancestors to the same origins frame-src above
    # trusts. Every other route (HTML pages, JSON APIs) keeps the strict
    # DENY / 'none' anti-clickjacking posture unchanged.
    ASSET_FRAME_ANCESTORS_CSP = "frame-ancestors 'self' https://*.run.app;"

    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)
        is_asset_response = request.url.path.startswith("/assets/")
        response.headers["Content-Security-Policy"] = (
            self.ASSET_FRAME_ANCESTORS_CSP if is_asset_response else self.CSP
        )
        response.headers["X-Content-Type-Options"] = "nosniff"
        if not is_asset_response:
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

class ApiNoStoreCacheMiddleware(BaseHTTPMiddleware):
    """Prevent browsers from caching dynamic API responses."""

    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)
        if request.url.path.startswith("/api/") and not response.headers.get(
            "cache-control"
        ):
            response.headers["Cache-Control"] = "no-store"
        return response


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

        # Expose the (signature-verified) user id for per-user rate limiting.
        # (#2470 HIGH-1: get_client_key relies on request.state.user_id; without
        # it, per-user AI limits silently fell back to a spoofable per-IP key.)
        request.state.user_id = user_id

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


class _LiveQuizMemberCache:
    """Positive-only (code, user_id) -> "is a member" cache for the rate-limit
    exemption below. Joining is append-only, so a cached "yes" can only go
    stale if the host removes a player — then the worst case is that player's
    polls stay exempt for up to TTL seconds while the route itself returns 403.
    Negatives are never cached, so a non-member is re-checked every time and
    stays under the per-IP limit. Per process, bounded, cleared when full."""

    TTL = 60.0
    MAX = 20000

    def __init__(self):
        self._d: dict[tuple[str, int], float] = {}
        self._lock = threading.Lock()

    def get(self, code: str, user_id: int) -> bool:
        with self._lock:
            exp = self._d.get((code, user_id))
            if exp is None:
                return False
            if exp < time.monotonic():
                del self._d[(code, user_id)]
                return False
            return True

    def put(self, code: str, user_id: int) -> None:
        with self._lock:
            if len(self._d) >= self.MAX:
                self._d.clear()
            self._d[(code, user_id)] = time.monotonic() + self.TTL

    def clear(self) -> None:
        with self._lock:
            self._d.clear()


_live_quiz_member_cache = _LiveQuizMemberCache()


class _PkIdMemberCache:
    """Same shape as ``_LiveQuizMemberCache`` (positive-only, TTL, bounded)
    but keyed by a raw integer id (``pk_queue.id`` or ``pk_matches.id``)
    instead of a 6-char code — PRD §12's "比照 live_quiz 已經驗證過的兩招"
    recommendation, applied to PK's queue-poll and match-state/-answer
    paths (see GlobalRateLimitMiddleware below)."""

    TTL = 60.0
    MAX = 20000

    def __init__(self):
        self._d: dict[tuple[int, int], float] = {}
        self._lock = threading.Lock()

    def get(self, resource_id: int, user_id: int) -> bool:
        with self._lock:
            exp = self._d.get((resource_id, user_id))
            if exp is None:
                return False
            if exp < time.monotonic():
                del self._d[(resource_id, user_id)]
                return False
            return True

    def put(self, resource_id: int, user_id: int) -> None:
        with self._lock:
            if len(self._d) >= self.MAX:
                self._d.clear()
            self._d[(resource_id, user_id)] = time.monotonic() + self.TTL

    def clear(self) -> None:
        with self._lock:
            self._d.clear()


_pk_queue_member_cache = _PkIdMemberCache()
_pk_match_member_cache = _PkIdMemberCache()


class _TeamArenaCodeMemberCache(_LiveQuizMemberCache):
    """Same (code, user_id) -> bool shape as `_LiveQuizMemberCache` — team_arena
    addresses a session by CODE like live_quiz does (not a numeric id like
    PK), so this reuses that shape by inheritance rather than copy-pasting
    the identical body a third time. Still its own cache INSTANCE (below),
    not shared storage with live_quiz's games."""


_team_arena_member_cache = _TeamArenaCodeMemberCache()


class _TeamArenaNegativeMemberCache:
    """Short-TTL cache for CONFIRMED-NOT-a-member lookups on team_arena's
    exemption path — unlike `_TeamArenaCodeMemberCache` (positive-only,
    60s TTL, by design: a non-member always stays under the per-IP limit
    either way, so there was never a correctness reason to cache a
    negative), this exists purely to blunt a sustained AUTHENTICATED
    attacker forcing a DB query on every single request by hammering
    made-up/garbage-but-well-formed codes (automated security review,
    post-push, #3632). A short TTL (5s, much shorter than the positive
    cache's 60s) is enough to cut repeated-request DB load without
    meaningfully helping a real non-member evade the per-IP limiter —
    they fall through to it identically whether this is cached or not.

    Known, accepted limitation (critic review): this cache is never
    invalidated on `join_session` — a student polling `/state` in the
    instant BEFORE their own join call lands could get cached here as
    "not a member" for up to 5s after they actually join, during which
    their polls lose the rate-limit EXEMPTION (not access: the route's
    own, uncached membership check is unaffected) and simply fall under
    the normal per-IP budget for up to 5s. Self-healing, bounded, and
    only matters under rare tight join/poll timing — not worth a cache-
    invalidation hook for this.
    """

    TTL = 5.0
    MAX = 20000

    def __init__(self):
        self._d: dict[tuple[str, int], float] = {}
        self._lock = threading.Lock()

    def get(self, code: str, user_id: int) -> bool:
        with self._lock:
            exp = self._d.get((code, user_id))
            if exp is None:
                return False
            if exp < time.monotonic():
                del self._d[(code, user_id)]
                return False
            return True

    def put(self, code: str, user_id: int) -> None:
        with self._lock:
            if len(self._d) >= self.MAX:
                self._d.clear()
            self._d[(code, user_id)] = time.monotonic() + self.TTL

    def clear(self) -> None:
        with self._lock:
            self._d.clear()


_team_arena_negative_member_cache = _TeamArenaNegativeMemberCache()


def _lookup_pk_queue_member(queue_id: int, user_id: int) -> bool:
    from .database import SessionLocal as _SessionLocal

    db = _SessionLocal()
    try:
        return pk_is_authenticated_queue_owner(db, queue_id, user_id)
    finally:
        db.close()


def _lookup_pk_match_member(match_id: int, user_id: int) -> bool:
    from .database import SessionLocal as _SessionLocal

    db = _SessionLocal()
    try:
        return pk_is_authenticated_match_participant(db, match_id, user_id)
    finally:
        db.close()


def _lookup_team_arena_member(code: str, user_id: int) -> bool:
    from .database import SessionLocal as _SessionLocal

    db = _SessionLocal()
    try:
        return team_arena_is_authenticated_member(db, code, user_id)
    finally:
        db.close()


def _lookup_live_quiz_member(code: str, user_id: int) -> bool:
    # Lazy import (not a top-level binding): looked up fresh on every call so
    # tests can monkeypatch `app.database.SessionLocal` to their own engine.
    from .database import SessionLocal as _SessionLocal

    db = _SessionLocal()
    try:
        return is_authenticated_member_by_code(db, code, user_id)
    finally:
        db.close()


class GlobalRateLimitMiddleware:
    """Pure ASGI middleware for global per-IP rate limiting on /api/* and /assets/*.

    Uses raw ASGI protocol instead of BaseHTTPMiddleware to guarantee headers
    are injected before the response starts streaming (BaseHTTPMiddleware +
    StreamingResponse can silently drop headers added after call_next).

    /assets/* is included (#2486): it's the proxy in front of the now-private
    lingoleap-assets GCS bucket. Without a rate limit here, closing off public
    bucket listing would still leave the door open for a single IP to hammer
    the proxy (and therefore our GCS egress) at unlimited rate.
    """

    _EXEMPT_PATHS = ("/health", "/docs", "/redoc", "/openapi.json", "/")
    # /api/live-quiz/games/{code}/state|answer — see the membership-gated
    # exemption below (#3551 external review #3).
    _LIVE_QUIZ_RATE_EXEMPT_RE = re.compile(r"^/api/live-quiz/games/([^/]+)/(state|answer)$")
    # /api/pk/queue/{id}/poll and /api/pk/matches/{id}/(state|answer) — PRD
    # §12's "另開一條 PK 專屬的豁免規則" (see the membership-gated exemption
    # block below, mirroring _LIVE_QUIZ_RATE_EXEMPT_RE's pattern).
    _PK_QUEUE_RATE_EXEMPT_RE = re.compile(r"^/api/pk/queue/(\d+)/poll$")
    _PK_MATCH_RATE_EXEMPT_RE = re.compile(r"^/api/pk/matches/(\d+)/(?:state|answer)$")
    # /api/team-arena/sessions/{code}/state|answer — same reasoning as the
    # live-quiz block (PRD §7 "限流" row: "state／answer 不算入同位址限流，
    # 改成『每場次、每人』上限＋加入時驗證成員身分"), same code-keyed shape
    # as live_quiz (not a numeric id like PK).
    _TEAM_ARENA_RATE_EXEMPT_RE = re.compile(r"^/api/team-arena/sessions/([^/]+)/(?:state|answer)$")
    # Automated security review (post-push, #3632): a well-formed team_arena
    # code is currently always exactly 6 chars from engine.py's
    # `_CODE_CHARS` alphabet (A-Z0-9 minus the confusable 0/1/I/O —
    # `_CODE_LENGTH = 6`). This regex is deliberately a looser SUPERSET
    # (any-length-4-8, full A-Z0-9 incl. the excluded confusables) rather
    # than pinning those exact constants — a real code always matches it,
    # and it stays correct even if the generator's length/alphabet ever
    # changes, at the cost of not rejecting every conceivable garbage
    # string (it doesn't need to: it only needs to reject the vast
    # majority cheaply before ever touching the DB).
    _TEAM_ARENA_CODE_FORMAT_RE = re.compile(r"^[A-Z0-9]{4,8}$")
    # /join is not membership-gated (you are not a member yet) but has its own
    # per-user limit (10/min, routes/live_quiz.py). 10 classes in one school
    # share one NAT IP: 300 joins in a minute exhausted the per-IP write budget
    # on staging (2026-10-16). An authenticated join skips the per-IP count;
    # an anonymous one still pays it (and gets 401 from the route).
    _LIVE_QUIZ_JOIN_RE = re.compile(r"^/api/live-quiz/games/[^/]+/join$")
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

        # Skip rate limiting for exempt paths, or paths outside the two
        # limited surfaces (/api/* and /assets/*).
        is_limited_surface = path.startswith("/api") or path.startswith("/assets")
        if path in self._EXEMPT_PATHS or not is_limited_surface:
            await self.app(scope, receive, send)
            return

        # (#3227) CORS preflight never counts. The frontend and backend live on
        # different origins in EVERY environment (two separate Cloud Run
        # services), so the browser fires an OPTIONS preflight ahead of every
        # request that carries an Authorization header. Counting those did two
        # bad things and bought nothing:
        #
        #   1. It halved every real user's budget -- 300 reads/min became 150
        #      actual requests, and a classroom behind one NAT shares that.
        #   2. A 429 on the preflight carries no Access-Control-Allow-Origin
        #      header, so the browser blocks the real request and reports it as
        #      "blocked by CORS policy" with no status at all (-1/ERR_FAILED).
        #      The app cannot tell it was rate-limited, so it cannot back off --
        #      it just sees a network failure and, in our case, dumped the
        #      student at the login screen holding a perfectly valid token.
        #
        # And it protects nothing: preflights are browser-generated. A script
        # attacking us sends the real request directly and never emits one, so
        # counting OPTIONS only ever penalised people using an actual browser.
        # The real request is still counted, so the DoS ceiling is unchanged.
        #
        # Measured on staging over the 12 minutes of one E2E run (2026-09-16):
        # peak read budget 310 > 300 -> limiter tripped; OPTIONS contributed 57
        # of those and 4 of the 429s landed on preflights. Counting only
        # GET/HEAD gives 253, which is UNDER the limit -- the preflights are the
        # whole reason it tripped.
        if scope.get("method", "").upper() == "OPTIONS":
            await self.app(scope, receive, send)
            return

        # Live-quiz polling (#3551 external review #3): a class of 30+
        # students each polling /state ~1/s would blow straight through the
        # 300/min per-IP read budget on its own (one classroom NAT = one
        # IP). The naive fix — "exempt /api/live-quiz/*/state and /answer
        # from the per-IP limit" — would also exempt an UNAUTHENTICATED
        # caller or someone polling a game they have nothing to do with, so
        # instead this only skips per-IP counting when the request is BOTH
        # authenticated (JWT already decoded by RequestLoggingMiddleware,
        # which runs outside this one — see request.state.user_id there)
        # AND the host/a joined player of THIS game. Everyone else
        # (anonymous, or guessing codes) stays under the normal limit.
        #
        # This intentionally does NOT replace per-IP limiting with a
        # separate "N req/s per user per game" counter: that counter would
        # be per-process under Cloud Run's multiple instances and would not
        # actually bound anything globally (external review #3). A verified
        # member's state/answer calls are naturally bounded by classroom
        # size and the ~1 req/s poll interval, so simply exempting them is
        # both simpler and more honest than a fake-precision limit.
        if self._LIVE_QUIZ_JOIN_RE.match(path) and (scope.get("state") or {}).get("user_id") is not None:
            await self.app(scope, receive, send)
            return

        live_quiz_match = self._LIVE_QUIZ_RATE_EXEMPT_RE.match(path)
        if live_quiz_match:
            state = scope.get("state") or {}
            raw_user_id = state.get("user_id")
            if raw_user_id is not None:
                try:
                    user_id = int(raw_user_id)
                    code = live_quiz_match.group(1)
                    member = _live_quiz_member_cache.get(code, user_id)
                    if not member:
                        # Blocking DB call: run it off the event loop, or every
                        # in-flight request on this instance waits behind it
                        # (2026-10-15 staging load test, 30 pollers: requests
                        # queued up to 150 s and members fell back to 429s).
                        member = await anyio.to_thread.run_sync(_lookup_live_quiz_member, code, user_id)
                        if member:
                            _live_quiz_member_cache.put(code, user_id)
                except Exception:
                    logger.warning(
                        "live-quiz rate-limit membership check failed; falling back to per-IP limiting",
                        exc_info=True,
                    )
                    member = False
                if member:
                    await self.app(scope, receive, send)
                    return
            # Unauthenticated or non-member: fall through to normal per-IP
            # limiting below, same as any other /api/* request.

        # PK polling (PRD §12, same reasoning/shape as the live-quiz block
        # above): a classroom's worth of students simultaneously waiting in
        # the matchmaking queue or mid-battle would otherwise share one
        # classroom-NAT IP's per-IP budget. Exempt only when the caller is
        # BOTH authenticated AND the owner/a participant of THIS resource —
        # a stranger polling someone else's queue_id/match_id still pays
        # the per-IP limit.
        pk_queue_match = self._PK_QUEUE_RATE_EXEMPT_RE.match(path)
        pk_match_match = self._PK_MATCH_RATE_EXEMPT_RE.match(path) if not pk_queue_match else None
        if pk_queue_match or pk_match_match:
            state = scope.get("state") or {}
            raw_user_id = state.get("user_id")
            if raw_user_id is not None:
                try:
                    user_id = int(raw_user_id)
                    if pk_queue_match:
                        resource_id = int(pk_queue_match.group(1))
                        cache, lookup_fn = _pk_queue_member_cache, _lookup_pk_queue_member
                    else:
                        resource_id = int(pk_match_match.group(1))
                        cache, lookup_fn = _pk_match_member_cache, _lookup_pk_match_member
                    member = cache.get(resource_id, user_id)
                    if not member:
                        member = await anyio.to_thread.run_sync(lookup_fn, resource_id, user_id)
                        if member:
                            cache.put(resource_id, user_id)
                except Exception:
                    logger.warning(
                        "pk rate-limit membership check failed; falling back to per-IP limiting",
                        exc_info=True,
                    )
                    member = False
                if member:
                    await self.app(scope, receive, send)
                    return
            # Unauthenticated or non-member: fall through to normal per-IP
            # limiting below, same as any other /api/* request.

        # Team-arena polling (PRD §7 "限流", same reasoning/shape as the
        # live-quiz block above): a classroom's worth of students sharing
        # one NAT IP, each polling /state ~1/s across potentially several
        # concurrent matches in one session, would blow straight through
        # the per-IP read budget on its own. Exempt only when the caller is
        # BOTH authenticated AND the teacher/a joined member of THIS
        # session (is_authenticated_session_member — includes lobby-only
        # roster members, not just post-team-formation TeamArenaMember
        # rows, since the busiest pre-game polling window is exactly the
        # lobby wait before teams are assigned).
        team_arena_match = self._TEAM_ARENA_RATE_EXEMPT_RE.match(path)
        if team_arena_match:
            state = scope.get("state") or {}
            raw_user_id = state.get("user_id")
            if raw_user_id is not None:
                try:
                    user_id = int(raw_user_id)
                    # Normalize to uppercase ONCE here — used consistently
                    # as both the cache key and the DB query argument (the
                    # DB query itself also upper()s, but keying the cache
                    # on the raw, possibly-lowercase path segment would let
                    # "ab12cd" and "AB12CD" miss each other for no reason).
                    code = team_arena_match.group(1).upper()
                    if not self._TEAM_ARENA_CODE_FORMAT_RE.match(code):
                        # Malformed shape can never be a real session code
                        # — skip the DB entirely (automated security
                        # review, post-push: don't let an authenticated
                        # attacker force a query per request just by
                        # hammering garbage).
                        member = False
                    elif _team_arena_negative_member_cache.get(code, user_id):
                        member = False
                    else:
                        member = _team_arena_member_cache.get(code, user_id)
                        if not member:
                            member = await anyio.to_thread.run_sync(
                                _lookup_team_arena_member, code, user_id
                            )
                            if member:
                                _team_arena_member_cache.put(code, user_id)
                            else:
                                _team_arena_negative_member_cache.put(code, user_id)
                except Exception:
                    logger.warning(
                        "team-arena rate-limit membership check failed; falling back to per-IP limiting",
                        exc_info=True,
                    )
                    member = False
                if member:
                    await self.app(scope, receive, send)
                    return
            # Unauthenticated or non-member: fall through to normal per-IP
            # limiting below, same as any other /api/* request.

        # Extract the real client IP (#2470 HIGH-1a, #3740): take the
        # GCP-appended second-from-right XFF entry -- UNLESS this backend
        # has itself cryptographically verified this request as coming
        # from the frontend's own service account (the same-origin proxy
        # hop, via X-Frontend-Identity), in which case trust the
        # X-Client-IP the frontend derived instead. See
        # trusted_proxy_client_ip's docstring for why (#3740 postmortem:
        # the proxy hop broke the plain XFF rule, collapsing every user
        # behind it into one shared bucket) and why X-Frontend-Identity
        # gets verified here rather than trusting Cloud Run's own
        # X-Serverless-Authorization unconditionally (follow-up security
        # review: that trust was conditional on an auth mode this backend
        # doesn't control from this call site).
        headers_raw = dict(scope.get("headers", []))
        forwarded_for = headers_raw.get(b"x-forwarded-for", b"").decode()
        frontend_identity = headers_raw.get(b"x-frontend-identity", b"").decode()
        client_ip_header = headers_raw.get(b"x-client-ip", b"").decode()
        client = scope.get("client")
        ip = trusted_proxy_client_ip(
            forwarded_for,
            client[0] if client else None,
            frontend_identity,
            client_ip_header,
            settings.frontend_proxy_sa,
            settings.backend_audience,
        )
        method = scope.get("method", "GET").upper()
        # OPTIONS is handled above (#3227) and never reaches here.
        is_read = method in ("GET", "HEAD")
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


class PreviewModeWriteGuardMiddleware(BaseHTTPMiddleware):
    """Blocks every write when the request's JWT carries preview=true (Issue #3027).

    Background: a teacher "previewing as a student" (Issue #3027, see
    docs/prd/2026-09-hans-feedback-teacher-visibility.md) is issued a token
    whose `sub` claim is the STUDENT's id, not the teacher's — this is what
    lets every existing current_user.id-scoped read route (there is no
    admin/role-based read path in this codebase; access is always resolved
    from `sub`) keep working completely unmodified. But that also means the
    identity can, in principle, hit any of the ~26 POST/PUT/PATCH/DELETE
    endpoints under /api/learning/* and write into the real student's
    records exactly as if the student had done it themselves.

    Rather than teach each of those ~26 handlers to check a preview flag —
    easy to get right today and easy to forget on the 27th endpoint someone
    adds next month — this single middleware blocks by HTTP method for any
    token carrying `preview: true`, before the request ever reaches a route
    handler. New write endpoints are covered automatically.

    Deliberately NOT scoped to a path prefix. Every write endpoint in this
    app happens to already live under /api (some via an explicit prefix=
    argument to include_router, some via APIRouter(prefix="/api/...") on
    the router itself — e.g. tts.py) or has no write endpoints at all (e.g.
    assets.py is a GET-only GCS proxy registered without an /api prefix).
    But that is a property of today's route table, not something this
    middleware should trust: a future POST added to a router that isn't
    under /api would silently escape a path-scoped check. Gating on HTTP
    method alone costs nothing extra (no legitimate write anywhere in this
    app is exempt from needing a real, non-preview identity) and closes
    that gap by construction instead of by convention.
    """

    SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}

    async def dispatch(self, request: Request, call_next) -> Response:
        if request.method not in self.SAFE_METHODS:
            auth_header = request.headers.get("authorization", "")
            if auth_header.startswith("Bearer "):
                token = auth_header[len("Bearer "):]
                try:
                    payload = decode_token(token)
                except Exception:
                    # Not this middleware's job to validate the token — an
                    # invalid/expired/garbage token falls through untouched
                    # and gets the normal 401 from get_current_user. Only a
                    # SUCCESSFULLY decoded preview=true token is ever blocked
                    # here, so this can never mask a real auth failure behind
                    # the preview-mode error message.
                    payload = None
                if payload and payload.get("preview") is True:
                    return JSONResponse(
                        status_code=403,
                        content={"detail": "預覽模式為唯讀，不允許寫入"},
                    )
        return await call_next(request)


def configure_default_executor(loop) -> None:
    """Size asyncio's default executor for a classroom (2026-10-16).

    asyncio.to_thread runs on it, and Python's default is min(32, cpu+4) = 5
    threads on a 1-vCPU Cloud Run instance. /reading/transcribe pushes
    transcode, silence check and the Gemini call through it, so with 5
    threads the 6th student per instance queued — and the queue time counted
    toward the Gemini timeout. The work is mostly waiting on the network or
    on an ffmpeg subprocess, so more threads than CPUs is the right shape.
    """
    from concurrent.futures import ThreadPoolExecutor

    workers = int(os.environ.get("ASYNC_THREAD_WORKERS", "32"))
    loop.set_default_executor(ThreadPoolExecutor(max_workers=max(1, workers), thread_name_prefix="async-io"))


@asynccontextmanager
async def lifespan(app: FastAPI):
    configure_default_executor(asyncio.get_running_loop())
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

# Starlette's add_middleware() does user_middleware.insert(0, ...): each call
# pushes to the FRONT of the list, which — after build_middleware_stack()
# reverses it to compose the onion — means the middleware added LAST ends up
# OUTERMOST (sees the request first, touches the response last on the way
# out), and the one added FIRST ends up INNERMOST (closest to the router).
#
# Issue #3027: PreviewModeWriteGuardMiddleware is registered FIRST, i.e.
# innermost of this block, on purpose. If it were outermost (as an earlier
# version had it, added last) it would short-circuit a blocked write with a
# bare 403 that never passes through SecurityHeaders/CORS/RateLimit/Logging
# below — no security headers, no CORS headers on the error response, and no
# log line, because those middlewares' dispatch() bodies never run at all
# unless something outer actually calls into them. Being innermost means
# every one of those still wraps its response on the way back out, blocked
# or not — verified via adversarial review (appsec-pentest-reviewer) probing
# the actual response headers and log output of a blocked request.
app.add_middleware(PreviewModeWriteGuardMiddleware)

# Add API no-store inside the response security wrappers so route-defined
# Cache-Control headers are visible and preserved before outer middleware runs.
app.add_middleware(ApiNoStoreCacheMiddleware)

# Security headers must be added before CORSMiddleware so they appear on
# every response (including CORS preflight responses).
app.add_middleware(SecurityHeadersMiddleware)

# CORS — added after SecurityHeaders so CORS headers appear on all responses
# including pre-flight OPTIONS.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins_list,
    # Our own PR-preview frontends, outside production only (#3139).
    allow_origin_regex=settings.preview_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global rate limiting: 300 read req/min + 90 write req/min per IP for
# /api/* and /assets/* (#2486).
# Placed after CORS so CORS preflight OPTIONS requests are not rate-limited.
# gzip（#3234）。⛔ 以前一個都沒有 —— 課文 23 KB、注音表 39 KB（最大那課 109 KB）
# 全部未壓上線，而學生多半在手機的行動網路上。
#
# `minimum_size=1000`：小回應壓縮的 CPU 比省下的位元組貴。
# 只在 client 送 `Accept-Encoding` 時作用，已編碼的內容（音檔）會被跳過。
app.add_middleware(GZipMiddleware, minimum_size=1000)

app.add_middleware(GlobalRateLimitMiddleware)

# Logging middleware wraps everything (added after CORS so it runs outermost)
app.add_middleware(RequestLoggingMiddleware)

# QR 短網址：掛根路徑，因為 `/q/9a7x4` 是要印在紙上給人掃的（#2916）
from .routes import slug_redirect as _slug_redirect
app.include_router(_slug_redirect.router)
app.include_router(stories.router, prefix="/api")
app.include_router(testset.router, prefix="/api")
app.include_router(spotlight_qa.router, prefix="/api")
app.include_router(keypoints_qa.router, prefix="/api")
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
app.include_router(league_router, prefix="/api", tags=["league"])
app.include_router(health_router)
app.include_router(semesters_router, prefix="/api", tags=["semesters"])
app.include_router(co_teaching_router, prefix="/api", tags=["co-teaching"])
app.include_router(tts_router)
app.include_router(tts_audit_router)
app.include_router(admin_sessions_router, prefix="/api", tags=["admin-sessions"])
app.include_router(library_router, prefix="/api", tags=["library"])
app.include_router(admin_seed_router, prefix="/api", tags=["admin-seed"])
app.include_router(admin_iap_allowlist_router, prefix="/api", tags=["admin-iap-allowlist"])
app.include_router(omo_router, prefix="/api", tags=["omo"])
app.include_router(curriculum_qa_router, prefix="/api", tags=["curriculum-qa"])
app.include_router(admin_story_structure_lab_router, prefix="/api", tags=["admin-story-structure-lab"])
app.include_router(admin_story_packs_router, prefix="/api", tags=["admin-story-packs"])
# No /api prefix — matches the Firebase Hosting `/assets/**` rewrite target (#2486).
app.include_router(assets_router)
app.include_router(live_quiz_router, prefix="/api", tags=["live-quiz"])
app.include_router(pk_router, prefix="/api", tags=["pk"])
app.include_router(escape_room_router, prefix="/api", tags=["escape-room"])
app.include_router(team_arena_router, prefix="/api", tags=["team-arena"])
# Role-gated worksheet download (#3276) — separate from the public assets proxy above.
app.include_router(worksheets_router)


@app.get("/")
def root():
    return {"status": "ok", "service": "lingoleap-api"}
