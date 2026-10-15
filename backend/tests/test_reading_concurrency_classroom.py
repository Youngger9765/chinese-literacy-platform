"""A whole class submitting reading recordings at once (2026-10-16 capacity review).

Prod 10-13 class: every minute some /reading/transcribe took 10-33 s while the
rest of the API answered in ~0.05 s. Two per-instance limits made a class queue:

1. asyncio.to_thread uses the loop's default executor, which Python sizes at
   min(32, cpu_count + 4) = 5 threads on a 1-vCPU Cloud Run instance. Transcode,
   silence check and the Gemini call all go through it, so the 6th student in an
   instance waited for a free thread, and that wait counted toward the timeout.
2. The request's DB session got a connection for the auth lookup and kept it
   for the whole 10-30 s Gemini wait.
"""
import os
import sys
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import asyncio


def test_default_executor_is_sized_for_a_class():
    from app.main import configure_default_executor

    loop = asyncio.new_event_loop()
    try:
        configure_default_executor(loop)
        assert loop._default_executor is not None
        assert loop._default_executor._max_workers >= 32
    finally:
        loop.close()


def test_transcribe_releases_the_db_connection_before_waiting_on_gemini():
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from app.routes.learning.learning_reading import router
    from app.auth.dependencies import get_current_user
    from app.auth.rate_limiter import ai_limit_10_per_min
    from app.database import get_db

    order = []
    fake_db = MagicMock()
    fake_db.close.side_effect = lambda: order.append("db.close")

    async def fake_transcribe(**_kw):
        order.append("gemini")
        return {"transcript": "孟嘗君養了很多門客。", "method": "fallback", "reason": "error"}

    user = MagicMock()
    user.id = 42
    app = FastAPI()
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[ai_limit_10_per_min] = lambda: None
    app.dependency_overrides[get_db] = lambda: fake_db
    app.include_router(router, prefix="/api")

    with patch("app.routes.learning.learning_reading.transcribe_reading_audio", new=fake_transcribe):
        r = TestClient(app).post(
            "/api/reading/transcribe",
            files={"audio": ("rec.webm", b"fake_audio", "audio/webm")},
            data={"target_text": "孟嘗君養了很多門客。", "duration_ms": "5000"},
        )
    assert r.status_code == 200, r.text
    assert "gemini" in order and "db.close" in order, order
    assert order.index("db.close") < order.index("gemini"), f"connection held during the Gemini wait: {order}"
