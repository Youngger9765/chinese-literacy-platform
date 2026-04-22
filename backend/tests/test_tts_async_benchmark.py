"""
TTS async route benchmark — Issue #1225.

Proves that making /api/tts/synthesize async def + asyncio.to_thread() allows
concurrent requests to overlap instead of serialising on the FastAPI worker.

Strategy
--------
- Mock synthesize_speech to sleep for SIMULATED_DELAY_S seconds (simulates
  a real Azure / Google / Gemini HTTP round-trip).
- Fire CONCURRENCY requests in parallel using httpx.AsyncClient.
- Assert:
    total wall-clock time < CONCURRENCY * SIMULATED_DELAY_S * 0.75
  i.e. the requests overlapped meaningfully (at least 25% overlap).
- A synchronous `def` route would serialise calls → total ≈ CONCURRENCY * delay.
  An `async def` + to_thread route allows overlap → total ≈ SIMULATED_DELAY_S.

Run:
    cd backend
    python -m pytest tests/test_tts_async_benchmark.py -v -s
"""

import asyncio
import time
from unittest.mock import patch

import httpx
import pytest
import pytest_asyncio

from app.main import app

SIMULATED_DELAY_S = 0.5   # simulate 500 ms TTS call (real = 8-15 s)
CONCURRENCY = 5            # number of parallel requests
# If async, total ≈ SIMULATED_DELAY_S.  Threshold: < 75% of serial time.
SERIAL_EQUIVALENT = CONCURRENCY * SIMULATED_DELAY_S
ASYNC_THRESHOLD = SERIAL_EQUIVALENT * 0.75  # must finish in < 75% of serial time


def _fake_synthesize(_text: str) -> bytes:
    """Simulates a blocking TTS HTTP call that takes SIMULATED_DELAY_S seconds."""
    time.sleep(SIMULATED_DELAY_S)
    return b"MP3_AUDIO_BYTES"


@pytest.mark.asyncio
async def test_concurrent_tts_requests_overlap():
    """5 parallel /synthesize requests should finish in < 75% of serial time.

    This proves that async def + asyncio.to_thread() allows the FastAPI event
    loop to handle concurrent I/O-bound requests without serialisation.

    Expected timeline (async):
      t=0      all 5 requests start
      t≈0.5 s  all 5 complete (overlapped in thread pool)
      total ≈ 0.5 s   < 75% of serial (2.5 s)

    If the route were sync def, FastAPI would process requests sequentially:
      total ≈ 2.5 s   ≥ 75% of serial
    """
    with patch("app.routes.tts.synthesize_speech", side_effect=_fake_synthesize):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://test",
        ) as client:
            payload = {"text": "測試文字"}

            start = time.perf_counter()
            results = await asyncio.gather(
                *[
                    client.post("/api/tts/synthesize", json=payload)
                    for _ in range(CONCURRENCY)
                ]
            )
            elapsed = time.perf_counter() - start

    # All requests must succeed (200 with audio or 503 on TTS unavailable)
    for resp in results:
        assert resp.status_code in (200, 503), (
            f"Unexpected status {resp.status_code}: {resp.text[:200]}"
        )

    print(
        f"\n  [TTS async benchmark]  {CONCURRENCY} concurrent requests: "
        f"elapsed={elapsed:.2f}s  "
        f"(serial would be ~{SERIAL_EQUIVALENT:.1f}s, "
        f"threshold={ASYNC_THRESHOLD:.2f}s)"
    )

    assert elapsed < ASYNC_THRESHOLD, (
        f"TTS routes do NOT appear to be truly async: "
        f"elapsed={elapsed:.2f}s >= threshold={ASYNC_THRESHOLD:.2f}s. "
        f"Check that synthesize() is `async def` + uses asyncio.to_thread()."
    )
