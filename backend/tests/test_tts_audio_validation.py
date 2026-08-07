"""TDD lock for the shared TTS audio-bytes validator (#2614).

Root cause this guards against: Azure (and any REST TTS provider) can answer
HTTP 200 with an empty or truncated body. Before this guard existed,
batch_azure_tts.py uploaded that response as-is and counted it a success
(err=0) — an observed run produced 2 confirmed 0-byte objects that then
*permanently* won the runtime cache (silence forever, no error anywhere).

validate_mp3_bytes() is used by the batch generator right after synthesis
(full audio in memory). validate_mp3_metadata() is used by the audit tool to
re-check objects already in GCS without downloading the full object (only
size metadata + a short byte-range peek). Both must agree on what counts as
a valid mp3 — that is the point of sharing one module instead of each script
inventing its own check.
"""
from __future__ import annotations

from app.services.tts.audio_validation import (
    MP3_PEEK_BYTES,
    validate_mp3_bytes,
    validate_mp3_metadata,
)


class TestValidateMp3Bytes:
    """Full in-memory payload validation (batch generator path)."""

    def test_none_is_rejected(self):
        assert validate_mp3_bytes(None) is not None

    def test_empty_bytes_is_rejected(self):
        reason = validate_mp3_bytes(b"")
        assert reason is not None
        assert "0 bytes" in reason or "empty" in reason.lower()

    def test_too_small_is_rejected(self):
        # a legit-looking ID3 prefix but way under the size floor
        reason = validate_mp3_bytes(b"ID3" + b"\x00" * 50, min_bytes=2000)
        assert reason is not None
        assert "small" in reason.lower()

    def test_wav_header_is_rejected(self):
        """A WAV file (RIFF magic) must never pass as an mp3."""
        payload = b"RIFF" + b"\x00" * 5000
        reason = validate_mp3_bytes(payload)
        assert reason is not None
        assert "mp3" in reason.lower()

    def test_html_error_page_is_rejected(self):
        """A proxy/error page body must never pass as audio."""
        payload = b"<html><body>500 Internal Server Error</body></html>" + b" " * 5000
        reason = validate_mp3_bytes(payload)
        assert reason is not None

    def test_valid_id3_tagged_mp3_passes(self):
        payload = b"ID3" + b"\x00" * 5000
        assert validate_mp3_bytes(payload) is None

    def test_valid_raw_frame_sync_variants_pass(self):
        for magic in (b"\xff\xfb", b"\xff\xf3", b"\xff\xf2"):
            payload = magic + b"\x00" * 5000
            assert validate_mp3_bytes(payload) is None, f"{magic!r} should be accepted"

    def test_custom_min_bytes_threshold_is_respected(self):
        payload = b"ID3" + b"\x00" * 100
        assert validate_mp3_bytes(payload, min_bytes=50) is None
        assert validate_mp3_bytes(payload, min_bytes=200) is not None


class TestValidateMp3Metadata:
    """Size + short byte-range peek validation (audit tool path — no full download)."""

    def test_zero_size_is_rejected(self):
        reason = validate_mp3_metadata(size=0, head=b"")
        assert reason is not None

    def test_none_size_is_rejected(self):
        reason = validate_mp3_metadata(size=None, head=b"")
        assert reason is not None

    def test_too_small_size_is_rejected_even_with_good_head(self):
        # size alone should be enough to flag it — head is irrelevant here
        reason = validate_mp3_metadata(size=50, head=b"ID3\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00", min_bytes=2000)
        assert reason is not None
        assert "small" in reason.lower()

    def test_good_size_with_bad_magic_is_rejected(self):
        reason = validate_mp3_metadata(size=50000, head=b"RIFF\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00", min_bytes=2000)
        assert reason is not None
        assert "mp3" in reason.lower()

    def test_good_size_with_good_magic_passes(self):
        head = b"ID3" + b"\x00" * (MP3_PEEK_BYTES - 3)
        assert validate_mp3_metadata(size=50000, head=head, min_bytes=2000) is None

    def test_good_size_with_raw_frame_sync_passes(self):
        head = b"\xff\xfb" + b"\x00" * (MP3_PEEK_BYTES - 2)
        assert validate_mp3_metadata(size=50000, head=head, min_bytes=2000) is None
