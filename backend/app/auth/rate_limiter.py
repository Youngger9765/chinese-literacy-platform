"""Simple in-memory rate limiter using a sliding window of timestamps.

Provides:
- InMemoryRateLimiter: thread-safe, per-key sliding window limiter used by
  auth routes, AI endpoint dependency guards, and the global middleware.
- ai_rate_limiter: module-level singleton for AI/Gemini endpoint protection.
- general_rate_limiter: module-level singleton for global per-IP rate limiting.
- make_ai_rate_limit_dependency: FastAPI Depends factory for AI endpoint limits.
- make_general_rate_limit_dependency: FastAPI Depends factory for general limits.

Cloud Run note
--------------
Cloud Run can run multiple instances; this limiter is in-process only.
For per-instance limiting that is transparent to users with Cloud Run's
automatic load balancing, a per-instance limit of 60 req/min is reasonable —
a single user's traffic is ordinarily served by one instance.  If shared-state
limiting becomes a requirement, replace the store with Redis.
"""

import threading
import time
from typing import NamedTuple

from fastapi import Depends, HTTPException, Request

from .trusted_proxies import is_trusted_hop


class RateLimitInfo(NamedTuple):
    """Result of a rate-limit check with metadata for response headers."""
    allowed: bool
    remaining: int          # requests remaining in current window
    retry_after: int        # seconds until the oldest request expires (0 if allowed)
    limit: int              # configured max_requests


class InMemoryRateLimiter:
    def __init__(self):
        self._store: dict[str, list[float]] = {}
        self._lock = threading.Lock()

    def check(self, key: str, max_requests: int, window_seconds: int) -> bool:
        """Return True if the request is allowed, False if rate limit exceeded."""
        return self.check_with_info(key, max_requests, window_seconds).allowed

    def check_with_info(
        self, key: str, max_requests: int, window_seconds: int
    ) -> RateLimitInfo:
        """Check the rate limit and return detailed info for response headers.

        This is the primary implementation; :meth:`check` delegates here.
        """
        now = time.monotonic()
        cutoff = now - window_seconds

        with self._lock:
            timestamps = self._store.get(key, [])
            # Remove expired entries (sliding window)
            timestamps = [t for t in timestamps if t > cutoff]

            if len(timestamps) >= max_requests:
                self._store[key] = timestamps
                # Oldest request in window expires at timestamps[0] + window_seconds
                retry_after = max(1, int(timestamps[0] + window_seconds - now) + 1)
                return RateLimitInfo(
                    allowed=False,
                    remaining=0,
                    retry_after=retry_after,
                    limit=max_requests,
                )

            timestamps.append(now)
            self._store[key] = timestamps
            remaining = max_requests - len(timestamps)
            return RateLimitInfo(
                allowed=True,
                remaining=remaining,
                retry_after=0,
                limit=max_requests,
            )

    def reset(self):
        """Clear all stored data. Useful for testing."""
        with self._lock:
            self._store.clear()


# ---------------------------------------------------------------------------
# Module-level singletons
# ---------------------------------------------------------------------------

# Singleton used for AI/Gemini endpoint rate limiting.
ai_rate_limiter = InMemoryRateLimiter()

# Singleton used for global per-IP rate limiting (middleware).
general_rate_limiter = InMemoryRateLimiter()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def real_ip_from_xff(xff: str, peer: str | None = None) -> str:
    """Return the real client IP behind the Cloud Run / GCP load balancer.

    History
    -------
    find_016GfbjuPFtSeUVkfhAUcLPp (high, CWE-348): used to always take the
    SECOND-from-right entry, assuming GCP always appends exactly two
    trusted hops. False on the direct `*.run.app` path (no ingress
    restriction, what VITE_API_URL points at): Cloud Run there appends only
    ONE trusted hop, so parts[-2] was an attacker-chosen value they could
    rotate per request to defeat every per-IP rate limit.

    find_01RtSp6b2GvNCj76v7dhrLmg (high, CWE-799): the fix for the above --
    always take the LAST entry -- traded that spoofability for a different
    bug. The LAST entry is always Cloud Run's own honest append (the real
    TCP peer it saw, never client-supplied), but on
    `lingoleap-prod.web.app` / `lingoleap-staging.web.app` that peer is
    FIREBASE HOSTING'S OWN serving address, not the end user -- every
    distinct visitor arriving through that hostname collapsed onto one
    shared rate-limit identity (90 writes/min or 300 reads/min for ALL of
    them combined, not each).

    Fix: trusted-hop stripping, not a fixed index -- but bounded to AT MOST
    ONE hop (coordinator review, 2026-11-07, after the first version of
    this fix walked an unbounded number of trusted hops from the right).
    The real topology has exactly one Google-operated hop in front of this
    backend (Firebase Hosting); an unbounded walk only existed to be
    "future-proof" against a second hypothetical layer that does not exist
    today, and it bought real risk for no real benefit: IS_TRUSTED_HOP's
    allowlist, even narrowed to a single observed prefix (see
    `google_trusted_proxy_ranges.json`), is still a network an attacker
    could plausibly reach from (e.g. Google Apps Script, a Google-hosted
    crawler, or any other first-party Google service that is not Cloud
    Run's own ingress). If TWO consecutive entries both happened to look
    trusted -- one genuine (Cloud Run's real append) and one an attacker
    pre-pended from such a vantage point -- an unbounded walk would strip
    BOTH and exposed a THIRD, attacker-controlled entry as "the real
    client". Stopping after one hop means that can never happen: at most
    the single genuine Cloud-Run-appended entry is ever discarded.

    The last entry is always genuine (Cloud Run never lets a client
    override it). If it belongs to the trusted allowlist, the request
    arrived through that one known Google-operated hop, so the real client
    is the entry immediately before it (which that hop itself set, not
    something the browser could forge) -- look no further back than that,
    even if more entries remain. If the last entry is NOT in the
    allowlist, there was no such hop: the request hit Cloud Run directly,
    and that last entry already IS the real client -- nothing the
    attacker put earlier in the header is ever read. Either way, a
    client-supplied prefix on the direct `*.run.app` path cannot influence
    the result: resolution reads at most the last two entries, never more.

    This is a coarsening, not the only defense: `GlobalRateLimitMiddleware`
    additionally keys authenticated traffic on `request.state.user_id`
    (see that class), which is the actual fix for "every visitor shares
    one bucket" for any logged-in user. IP-based keying -- what this
    function ultimately feeds -- only still matters for anonymous traffic,
    where a coarser (shared, but never attacker-chosen) identity is an
    accepted tradeoff, not the primary defense.
    """
    parts = [p.strip() for p in (xff or "").split(",") if p.strip()]
    if not parts:
        return peer or "unknown"
    if len(parts) == 1:
        return parts[0]

    # The last entry is always Cloud Run's own genuine append. Step back
    # over it ONLY if it is a known trusted hop -- never more than this one
    # position, regardless of what the entries further left look like.
    if is_trusted_hop(parts[-1]):
        return parts[-2]
    return parts[-1]


def real_client_ip(request: Request) -> str:
    """Real client IP for a FastAPI Request (see real_ip_from_xff)."""
    return real_ip_from_xff(
        request.headers.get("x-forwarded-for", ""),
        request.client.host if request.client else None,
    )


def get_client_key(request: Request) -> str:
    """Return a stable key for the current request client.

    Uses the authenticated user ID when available (from a previously decoded
    JWT stored by the auth dependency), falling back to the real client IP.
    """
    # The auth dependency stores the user id in request.state.user_id.
    user_id = getattr(request.state, "user_id", None)
    if user_id is not None:
        return f"user:{user_id}"
    return f"ip:{real_client_ip(request)}"


# ---------------------------------------------------------------------------
# FastAPI dependency factories
# ---------------------------------------------------------------------------

def make_ai_rate_limit_dependency(max_requests: int = 10, window_seconds: int = 60):
    """Return a FastAPI dependency that enforces an AI endpoint rate limit.

    Args:
        max_requests: Maximum allowed requests within the time window.
        window_seconds: Sliding window size in seconds.

    Usage::

        @router.post("/some-ai-endpoint")
        async def endpoint(
            _rl: None = Depends(make_ai_rate_limit_dependency(max_requests=10)),
        ):
            ...
    """
    def _dependency(request: Request) -> None:
        # ── #3300：預算要**逐端點**分開 ────────────────────────────────────
        #
        # ⛔ key 原本是 `ai:{client}` —— 不含端點也不含層級，所以
        #    `make_ai_rate_limit_dependency()` 產生的每一個 dependency
        #    （不論宣告 5 還是 10）全部共用同一顆 module-level 水桶。
        #    目前掛在上面的端點有 15 支。
        #
        #    真實流程「重點朗讀 → 理解題 → 生字 → 出場券」是同一個 session 內
        #    幾十秒的連續動作，前面幾步很容易在 60 秒內把共用桶用掉，於是學生
        #    **第一次**按出場券就被擋 —— prod 實測 53 次呼叫 5 次 429（9.4%），
        #    而那 5 次不是重複產生出場券。
        #
        #    TTS 早就有自己的 store（`tts_rate_limiter`），註解寫明「不可消耗
        #    socratic/comprehension/reading 的配額」—— 其餘 15 支從沒有這層隔離。
        #
        # ⚠️ 用**模板化路徑**（`/sessions/{session_id}/…`）而不是真實路徑：
        #    真實路徑含 session id，換一個 session 就換一顆桶 = 限流形同虛設，
        #    而且 key 會無限長大。
        # ⚠️ 只認**字串**的 path。測試替身常是 MagicMock，`getattr(route,"path")`
        #    會回一個每個實例都不同的物件 —— 那會讓 key 每次都不一樣，等於沒有限流
        #    （實測弄壞了 `test_ai_limit_uses_user_id_when_available`：同一個使用者
        #    跨 IP 本來該共用一顆桶）。拿不到字串就退回不分端點的舊行為。
        scope_name = ""
        scope = getattr(request, "scope", None)
        if isinstance(scope, dict):
            cand = getattr(scope.get("route"), "path", None)
            if isinstance(cand, str):
                scope_name = cand
        if not scope_name:
            cand = getattr(getattr(request, "url", None), "path", None)
            if isinstance(cand, str):
                scope_name = cand
        key = f"ai:{scope_name}:{get_client_key(request)}" if scope_name else f"ai:{get_client_key(request)}"
        if not ai_rate_limiter.check(key, max_requests, window_seconds):
            raise HTTPException(
                status_code=429,
                detail="AI endpoint rate limit exceeded. Please wait before retrying.",
            )

    return _dependency


def make_general_rate_limit_dependency(max_requests: int = 100, window_seconds: int = 60, *, name: str):
    """Return a FastAPI dependency that enforces a general API rate limit.

    Claude Security find_01Mro5omduiXVs3dmVTHdpJn (medium, CWE-770): this
    used to key on `request.client.host` alone -- on Cloud Run that is
    always the platform's own proxy address, the SAME value for every
    request reaching an instance, so every caller of every endpoint using
    this factory shared ONE counter. One client flooding any of the three
    endpoints this backs (dictionary, school-directory search,
    mcq-attempt) could 429 every other user of ALL THREE on that instance.
    `mcq_attempt`'s dependency also ran before authentication (declared at
    the route-decorator level), so even an anonymous caller could do it.

    Fixed:
      - `name` (now required) namespaces the key per call site, so the
        three endpoints no longer share one bucket.
      - Keys via get_client_key(), the same helper make_ai_rate_limit_
        dependency already uses: the authenticated user id when
        request.state.user_id is set (populated by main.py's logging
        middleware from a SIGNATURE-VERIFIED JWT, for every request,
        before any route dependency runs -- so this works regardless of
        where get_current_user sits in the route's own dependency order,
        including mcq_attempt's route-decorator-level placement, with no
        extra DB query). Anonymous callers fall back to real_client_ip(),
        not the raw, shared Cloud Run proxy address.

    Args:
        max_requests: Maximum allowed requests within the time window.
        window_seconds: Sliding window size in seconds.
        name: Short, unique identifier for this call site (e.g. "dictionary",
            "school-directory-search", "mcq-attempt") -- required so
            distinct endpoints never share a bucket.
    """
    def _dependency(request: Request) -> None:
        key = f"general:{name}:{get_client_key(request)}"
        if not general_rate_limiter.check(key, max_requests, window_seconds):
            raise HTTPException(
                status_code=429,
                detail="Too many requests. Please slow down.",
            )

    return _dependency


# ---------------------------------------------------------------------------
# Pre-built dependency instances for common limits
# ---------------------------------------------------------------------------

# AI endpoints: 10 requests / minute per user
ai_limit_10_per_min = make_ai_rate_limit_dependency(max_requests=10, window_seconds=60)
# Strict AI endpoints (e.g. full-reading): 5 requests / minute per user
ai_limit_5_per_min = make_ai_rate_limit_dependency(max_requests=5, window_seconds=60)
# General API: 100 requests / minute, keyed by user id when authenticated
# (mcq-attempt is reachable anonymously -- see make_general_rate_limit_dependency).
general_limit_100_per_min = make_general_rate_limit_dependency(
    max_requests=100, window_seconds=60, name="mcq-attempt"
)


# ---------------------------------------------------------------------------
# TTS-specific rate limiter (Issue #1808)
# ---------------------------------------------------------------------------

# Dedicated in-memory limiter for TTS — isolated from the shared ai_rate_limiter
# so that TTS bursts do NOT consume the socratic/comprehension/reading quota.
tts_rate_limiter = InMemoryRateLimiter()

# TTS limits per user_id (not IP — avoids classroom NAT collapse problem).
TTS_MAX_REQUESTS = 30
TTS_WINDOW_SECONDS = 60


def tts_rate_limit(user_id: int) -> RateLimitInfo:
    """Check TTS rate limit for *user_id* using the dedicated TTS bucket.

    Key: ``ai:tts:user:{user_id}`` — completely separate from the shared
    ``ai:`` bucket so TTS bursts cannot starve socratic/comprehension quota.

    Args:
        user_id: The authenticated user's integer ID.

    Returns:
        RateLimitInfo with allowed=True if under limit, False if exceeded.
        When allowed=False, retry_after contains seconds until the window resets.
    """
    key = f"ai:tts:user:{user_id}"
    return tts_rate_limiter.check_with_info(key, TTS_MAX_REQUESTS, TTS_WINDOW_SECONDS)
