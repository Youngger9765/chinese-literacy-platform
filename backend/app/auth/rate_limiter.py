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

def _get_client_key(request: Request) -> str:
    """Return a stable key for the current request client.

    Uses the authenticated user ID when available (from a previously decoded
    JWT stored by the auth dependency), falling back to the client IP address.
    """
    # The auth dependency stores the user id in request.state.user_id.
    user_id = getattr(request.state, "user_id", None)
    if user_id is not None:
        return f"user:{user_id}"
    client = request.client
    ip = client.host if client else "unknown"
    return f"ip:{ip}"


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
        key = f"ai:{_get_client_key(request)}"
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
