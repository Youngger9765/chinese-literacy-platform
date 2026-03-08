"""Simple in-memory rate limiter using a sliding window of timestamps.

Provides:
- InMemoryRateLimiter: thread-safe, per-key sliding window limiter used by
  auth routes and AI endpoint dependency guards.
- ai_rate_limiter: module-level singleton for AI/Gemini endpoint protection.
- check_ai_rate_limit: FastAPI Depends factory that enforces per-user rate limits
  on AI endpoints.
"""

import threading
import time

from fastapi import Depends, HTTPException, Request


class InMemoryRateLimiter:
    def __init__(self):
        self._store: dict[str, list[float]] = {}
        self._lock = threading.Lock()

    def check(self, key: str, max_requests: int, window_seconds: int) -> bool:
        """Return True if the request is allowed, False if rate limit exceeded."""
        now = time.monotonic()
        cutoff = now - window_seconds

        with self._lock:
            timestamps = self._store.get(key, [])
            # Remove expired entries
            timestamps = [t for t in timestamps if t > cutoff]

            if len(timestamps) >= max_requests:
                self._store[key] = timestamps
                return False

            timestamps.append(now)
            self._store[key] = timestamps
            return True

    def reset(self):
        """Clear all stored data. Useful for testing."""
        with self._lock:
            self._store.clear()


# Singleton used for AI/Gemini endpoint rate limiting.
ai_rate_limiter = InMemoryRateLimiter()

# Singleton used for general API endpoint rate limiting (100 req/min per IP).
general_rate_limiter = InMemoryRateLimiter()


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


# Pre-built dependency instances for common limits.
# AI endpoints: 10 requests / minute per user
ai_limit_10_per_min = make_ai_rate_limit_dependency(max_requests=10, window_seconds=60)
# Strict AI endpoints (e.g. full-reading): 5 requests / minute per user
ai_limit_5_per_min = make_ai_rate_limit_dependency(max_requests=5, window_seconds=60)
# General API: 100 requests / minute per IP
general_limit_100_per_min = make_general_rate_limit_dependency(max_requests=100, window_seconds=60)
