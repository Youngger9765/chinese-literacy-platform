"""Simple in-memory rate limiter using a sliding window of timestamps."""

import threading
import time


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
