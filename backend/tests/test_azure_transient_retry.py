"""A dropped connection is not "Azure is down". Retry it.

Measured: the same paragraph synthesized 10 times in a row failed once, always
the same way —

    TTSError: Azure TTS request failed: IncompleteRead(138240 bytes read)

The response started arriving and the connection closed mid-stream. Azure did
not refuse anything; the transfer broke.

The old code treated that as a provider failure and fell through to Google,
which is `cmn-CN-Chirp3-HD` — the mainland accent rejected in 2026-04 — and
which also skips the pause shortening. So roughly one paragraph in ten was
silently synthesized in the wrong accent with the long pauses left in, and the
cache key does not record the provider, so once written it kept being served.

A truncated read is exactly what a retry is for. HTTP errors are not retried:
a 400 means the SSML is wrong and sending it again produces the same 400.
"""
from __future__ import annotations

import http.client
import urllib.error
from unittest.mock import MagicMock, patch

import pytest

from app.services.tts import TTSError
from app.services.tts.providers import azure as az


AUDIO = b"ID3\x04\x00\x00" + b"\xff\xfb" * 100


def _response(data: bytes):
    resp = MagicMock()
    resp.read.return_value = data
    resp.__enter__ = lambda self: self
    resp.__exit__ = lambda self, *a: False
    return resp


class TestTransientFailures:
    def test_a_truncated_read_is_retried(self):
        attempts = [
            http.client.IncompleteRead(b"partial"),
            _response(AUDIO),
        ]

        def urlopen(*_a, **_k):
            outcome = attempts.pop(0)
            if isinstance(outcome, Exception):
                raise outcome
            return outcome

        with patch.object(az, "AZURE_SPEECH_KEY", "k"), \
             patch.object(az.urllib.request, "urlopen", side_effect=urlopen), \
             patch.object(az, "time", MagicMock()):
            assert az._synthesize_azure("測試") == AUDIO
        assert attempts == [], "the second attempt was never made"

    def test_it_gives_up_rather_than_retrying_forever(self):
        with patch.object(az, "AZURE_SPEECH_KEY", "k"), \
             patch.object(az.urllib.request, "urlopen",
                          side_effect=http.client.IncompleteRead(b"")), \
             patch.object(az, "time", MagicMock()):
            with pytest.raises(TTSError):
                az._synthesize_azure("測試")

    def test_a_timeout_is_retried_too(self):
        attempts = [TimeoutError("timed out"), _response(AUDIO)]

        def urlopen(*_a, **_k):
            outcome = attempts.pop(0)
            if isinstance(outcome, Exception):
                raise outcome
            return outcome

        with patch.object(az, "AZURE_SPEECH_KEY", "k"), \
             patch.object(az.urllib.request, "urlopen", side_effect=urlopen), \
             patch.object(az, "time", MagicMock()):
            assert az._synthesize_azure("測試") == AUDIO


class TestPermanentFailures:
    def test_an_http_error_is_not_retried(self):
        """400 means the SSML is wrong; sending it again yields the same 400.

        Retrying here would multiply the latency of every genuine mistake.
        """
        calls = []

        def urlopen(*_a, **_k):
            calls.append(1)
            raise urllib.error.HTTPError("u", 400, "Bad Request", {}, None)

        with patch.object(az, "AZURE_SPEECH_KEY", "k"), \
             patch.object(az.urllib.request, "urlopen", side_effect=urlopen), \
             patch.object(az, "time", MagicMock()):
            with pytest.raises(TTSError):
                az._synthesize_azure("測試")

        assert len(calls) == 1, f"an HTTP error was retried {len(calls)} times"

    def test_empty_audio_is_still_an_error(self):
        with patch.object(az, "AZURE_SPEECH_KEY", "k"), \
             patch.object(az.urllib.request, "urlopen", return_value=_response(b"")), \
             patch.object(az, "time", MagicMock()):
            with pytest.raises(TTSError):
                az._synthesize_azure("測試")
