"""Azure synthesis goes through requests, not urllib.

Root cause of the ~1-in-10 `IncompleteRead`. Measured on the same payload, back
to back, 25 calls each:

    urllib     3 failures  (12%)
    requests   0 failures  (0%)

Azure returns the audio with chunked transfer-encoding, and urllib's handling of
the end of a chunked stream is the fragile part — nothing to do with the text
length (failures were spread across 76–243 character paragraphs) and nothing to
do with Azure, which never refused a request.

This mattered because a raised TTSError sent synthesize_speech to the Google
fallback: cmn-CN-Chirp3-HD, the mainland accent rejected in 2026-04, with the
pause shortening skipped and a cache key that cannot tell the two apart. One
paragraph in ten came out wrong and stayed wrong.

The retry added alongside this stays: it covers the residual failures that any
network call has. This removes the ones that were self-inflicted.
"""
from __future__ import annotations

import inspect

from app.services.tts.providers import azure as az


def test_the_http_call_uses_requests():
    source = inspect.getsource(az._synthesize_azure)
    assert "requests.post" in source, (
        "back on urllib — that is a 12% IncompleteRead rate, and each one "
        "becomes mainland-accent audio via the fallback"
    )


def test_urllib_is_not_used_for_synthesis():
    source = inspect.getsource(az._synthesize_azure)
    assert "urlopen" not in source
