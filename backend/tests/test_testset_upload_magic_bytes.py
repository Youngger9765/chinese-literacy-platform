"""Regression lock for testset upload magic-bytes validation.

Bug (verified 2026-06-30 against staging): POST /testset/upload trusted only the
client-supplied content_type form field, so a non-audio file relabelled as
audio/wav (spoofed MIME) was accepted and stored in GCS, polluting the training
manifest. Fix added `_audio_bytes_match_declared_mime` which inspects the actual
leading bytes; the upload route now raises 400 when bytes don't match the
declared MIME.

This test locks the function's behavior (deterministic, no mocks). The route
call site (`if not _audio_bytes_match_declared_mime(...): raise HTTPException(400)`)
is verified by reading testset.py.

Run:
    cd backend && python -m pytest tests/test_testset_upload_magic_bytes.py -v
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest

from app.routes.testset import _audio_bytes_match_declared_mime as match


@pytest.mark.parametrize(
    "data,mime,expected",
    [
        # real headers accepted
        (b"RIFF\x24\x00\x00\x00WAVEfmt ", "audio/wav", True),
        (b"ID3\x03\x00\x00\x00", "audio/mpeg", True),          # MP3 ID3 tag
        (b"\xff\xfb\x90\x00", "audio/mpeg", True),              # MP3 frame sync
        (b"\x1a\x45\xdf\xa3rest", "audio/webm", True),          # WebM EBML
        (b"OggS\x00\x02\x00\x00", "audio/ogg", True),           # Ogg container
        (b"\x00\x00\x00\x18ftypM4A ", "audio/mp4", True),       # ISO BMFF / M4A
        # THE BUG: spoofed non-audio relabelled as audio must be rejected
        (b"this is not audio at all", "audio/wav", False),
        (b"this is not audio at all", "audio/mpeg", False),
        (b"<html>nope</html>", "audio/webm", False),
        (b"this is not audio", "audio/ogg", False),
        (b"this is not audio", "audio/mp4", False),
        # empty / truncated rejected
        (b"", "audio/wav", False),
        (b"RIFF", "audio/wav", False),                          # too short for WAVE check
    ],
)
def test_magic_bytes_match(data, mime, expected):
    assert match(data, mime) is expected
