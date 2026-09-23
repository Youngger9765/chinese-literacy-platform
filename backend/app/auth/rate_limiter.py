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

    (#2470 HIGH-1a) GCP appends [real-client-ip, load-balancer-ip] to any
    client-supplied X-Forwarded-For, so the trustworthy client IP is the
    SECOND-from-right. Entries to the left are attacker-controlled (a client can
    prepend anything) and MUST NOT be used for rate-limiting / security — taking
    the leftmost let an attacker rotate a fake IP to bypass per-IP limits.
    """
    parts = [p.strip() for p in (xff or "").split(",") if p.strip()]
    if len(parts) >= 2:
        return parts[-2]
    if parts:
        return parts[-1]
    return peer or "unknown"


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


def make_general_rate_limit_dependency(max_requests: int = 100, window_seconds: int = 60):
    """Return a FastAPI dependency that enforces a general API rate limit per IP.

    Args:
        max_requests: Maximum allowed requests within the time window.
        window_seconds: Sliding window size in seconds.
    """
    def _dependency(request: Request) -> None:
        client = request.client
        ip = client.host if client else "unknown"
        key = f"general:ip:{ip}"
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
# General API: 100 requests / minute per IP
general_limit_100_per_min = make_general_rate_limit_dependency(max_requests=100, window_seconds=60)


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
