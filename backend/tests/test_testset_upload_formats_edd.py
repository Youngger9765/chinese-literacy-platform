"""EDD lock: #2427 added mp3/wav upload — verify those formats survive the
reading-transcription preprocessing.

Why this exists (eval derived from the real shipped scenario, not eval-first):
- #2427 lets contributors upload mp3/wav (previously only webm recordings).
- upload stores every file under a hardcoded `.webm` path and does NOT record
  the real content_type in meta (testset.py:174-183).
- batch-eval therefore calls transcribe_reading_audio(..., mime_type="audio/webm")
  hardcoded (testset.py:432) for EVERY recording, including mp3/wav.

Empirically verified 2026-07-01: ffmpeg sniffs the real container (the mime only
picks a temp-file extension, never a hard `-f` input flag), so non-webm bytes
labeled "audio/webm" still work:
  - _max_volume_db(wav/mp3, "audio/webm") detects real volume → silence gate OK
  - _transcode_to_ogg(wav/mp3, "audio/webm") yields valid Ogg/Opus → Gemini gets
    ogg labeled audio/ogg (service line 354) → transcribes fine.

Net finding: mp3/wav uploads transcribe correctly. The hardcoded mime is a minor
inefficiency (natively-supported wav/mp3 get an unnecessary transcode), NOT a
correctness bug. This test catches a regression if a future change to the
wrong-mime path breaks these formats (e.g. switching ffmpeg to a hard `-f` flag).

ffmpeg required — skips if absent (CI currently installs no ffmpeg; runs locally
and in any prod-like image where the silence gate already depends on ffmpeg).

Run: cd backend && python -m pytest tests/test_testset_upload_formats_edd.py -v
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest

from app.services.reading_transcription_service import _max_volume_db, _transcode_to_ogg

pytestmark = pytest.mark.skipif(
    shutil.which("ffmpeg") is None, reason="ffmpeg not installed"
)

# The mime batch-eval actually passes for every recording (testset.py:432).
HARDCODED_MIME = "audio/webm"


def _gen_tone(fmt: str) -> bytes:
    """Generate a 2s 440Hz tone in the given real format via ffmpeg."""
    suffix = {"wav": ".wav", "mp3": ".mp3"}[fmt]
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
        path = f.name
    try:
        cmd = ["ffmpeg", "-y", "-f", "lavfi",
               "-i", "sine=frequency=440:duration=2", "-ar", "16000"]
        if fmt == "mp3":
            cmd += ["-b:a", "64k"]
        cmd += [path]
        subprocess.run(cmd, capture_output=True, check=True)
        with open(path, "rb") as fh:
            return fh.read()
    finally:
        if os.path.exists(path):
            os.unlink(path)


@pytest.fixture(scope="module")
def wav_bytes() -> bytes:
    return _gen_tone("wav")


@pytest.fixture(scope="module")
def mp3_bytes() -> bytes:
    return _gen_tone("mp3")


class TestNonWebmSurvivesHardcodedWebmMime:
    """Real wav/mp3 bytes labeled as audio/webm (the batch-eval scenario) must
    still preprocess correctly — silence gate detects sound, transcode yields
    valid ogg. Locks the #2427 mp3/wav upload path against the wrong-mime hint."""

    def test_wav_silence_gate_detects_sound(self, wav_bytes):
        db = _max_volume_db(wav_bytes, HARDCODED_MIME)
        assert db is not None and db != float("-inf"), \
            "silence gate false-rejected a real wav labeled webm"

    def test_mp3_silence_gate_detects_sound(self, mp3_bytes):
        db = _max_volume_db(mp3_bytes, HARDCODED_MIME)
        assert db is not None and db != float("-inf"), \
            "silence gate false-rejected a real mp3 labeled webm"

    def test_wav_transcodes_to_valid_ogg(self, wav_bytes):
        ogg = _transcode_to_ogg(wav_bytes, HARDCODED_MIME)
        assert ogg is not None and ogg[:4] == b"OggS", \
            "wav (labeled webm) failed to transcode to valid ogg"

    def test_mp3_transcodes_to_valid_ogg(self, mp3_bytes):
        ogg = _transcode_to_ogg(mp3_bytes, HARDCODED_MIME)
        assert ogg is not None and ogg[:4] == b"OggS", \
            "mp3 (labeled webm) failed to transcode to valid ogg"
