"""Gemini tail latency (2026-10-16 staging load tests): about 1 in 30 reading
transcriptions got no answer within the 30 s timeout and the student saw a
fallback, while the median call is ~4-7 s. A second request sent when the
first is unusually slow ("hedged request") rescues those without making the
worst case slower: the outer 30 s timeout is unchanged."""
import os
import sys
import threading
import time

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.reading_transcription_service import _hedged_call


def _fake(delays, errors=None):
    calls = []
    lock = threading.Lock()

    def call():
        with lock:
            n = len(calls)
            calls.append(n)
        time.sleep(delays[n])
        if errors and errors[n]:
            raise errors[n]
        return f"result-{n}"

    return call, calls


@pytest.mark.asyncio
async def test_slow_first_call_is_rescued_by_a_second_one():
    call, calls = _fake([1.0, 0.05])
    t0 = time.monotonic()
    out = await _hedged_call(call, hedge_after=0.1)
    assert out == "result-1"
    assert len(calls) == 2
    assert time.monotonic() - t0 < 0.6


@pytest.mark.asyncio
async def test_fast_first_call_sends_only_one_request():
    call, calls = _fake([0.02, 0.02])
    assert await _hedged_call(call, hedge_after=0.2) == "result-0"
    assert len(calls) == 1


@pytest.mark.asyncio
async def test_a_fast_error_is_not_retried():
    call, calls = _fake([0.01, 0.01], errors=[ValueError("bad"), None])
    with pytest.raises(ValueError):
        await _hedged_call(call, hedge_after=0.2)
    assert len(calls) == 1


@pytest.mark.asyncio
async def test_if_the_hedge_fails_the_slow_first_answer_still_wins():
    call, calls = _fake([0.3, 0.01], errors=[None, ValueError("hedge failed")])
    assert await _hedged_call(call, hedge_after=0.1) == "result-0"
    assert len(calls) == 2
