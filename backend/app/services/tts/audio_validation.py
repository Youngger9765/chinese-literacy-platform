"""Shared "is this actually an mp3" validator for TTS cache writes (#2614).

Why this exists: Azure's TTS REST endpoint (and in principle any REST TTS
provider) can answer HTTP 200 with an empty or truncated body. Uploading
that response as-is to the GCS TTS cache produces a silent/corrupt mp3 that
then *permanently* wins the runtime cache — production sees a cache hit and
never regenerates, so a student who reaches that sentence gets silence
forever, with no error anywhere in the stack. An actual batch run produced
2 confirmed 0-byte objects with err=0 before this guard existed, so this is
not theoretical.

Two entry points share the same notion of "valid":
  - validate_mp3_bytes()    — full in-memory payload, called right after
                              synthesis and before the object ever reaches
                              the bucket (backend/scripts/batch_azure_tts.py).
  - validate_mp3_metadata() — re-checks an object already in GCS using only
                              its size (free, from blob metadata) and a short
                              byte-range peek, so auditing thousands of
                              existing objects never requires a full download
                              (backend/scripts/audit_tts_objects.py).

Keep both in this one module — if the batch generator and the audit tool
disagreed about what counts as valid, an object that passes on write could
still be silently miscategorized on audit (or vice versa).
"""
from __future__ import annotations

# ~0.05s of audio at 192kbps; real Chinese sentences from this manifest are
# 15KB+, so anything under this is either an error body or a truncated
# response, never a legitimate short clip.
MIN_MP3_BYTES = 2000

# 48kHz/192kbps mono mp3 from Azure (and Gemini's re-encode via ffmpeg) starts
# with either an ID3v2 tag or a raw MPEG frame sync. Anything else — RIFF/WAV,
# an HTML error page, a truncated/garbled response — is not the audio we
# asked for.
_MP3_FRAME_SYNC_PREFIXES = (b"\xff\xfb", b"\xff\xf3", b"\xff\xf2")

# Enough bytes to see either the ID3 tag or the 2-byte frame sync. Kept small
# on purpose: the audit tool does a ranged GET for this many bytes per
# object instead of downloading the full file.
MP3_PEEK_BYTES = 16


def _bad_magic(head: bytes) -> bool:
    return not (head.startswith(b"ID3") or head[:2] in _MP3_FRAME_SYNC_PREFIXES)


def validate_mp3_bytes(audio: bytes | None, min_bytes: int = MIN_MP3_BYTES) -> str | None:
    """Validate a full in-memory mp3 payload. Returns a reason string if
    invalid, or None if it looks like real audio."""
    if not audio:
        return "empty response body (0 bytes)"
    if len(audio) < min_bytes:
        return f"suspiciously small ({len(audio)} bytes < {min_bytes})"
    if _bad_magic(audio):
        return f"not an mp3 (leading bytes {audio[:4]!r})"
    return None


def validate_mp3_metadata(
    size: int | None, head: bytes, min_bytes: int = MIN_MP3_BYTES
) -> str | None:
    """Validate an already-uploaded GCS object using only its size (blob
    metadata, free) and a short byte-range peek (`head`, up to
    MP3_PEEK_BYTES). Returns a reason string if invalid, or None if OK.

    Deliberately does not require `head` when size alone already disqualifies
    the object (0 bytes / too small) — callers should skip the ranged GET in
    that case, it would just cost an extra network round trip for a foregone
    conclusion.
    """
    if not size:
        return "empty object (0 bytes)"
    if size < min_bytes:
        return f"suspiciously small ({size} bytes < {min_bytes})"
    if _bad_magic(head):
        return f"not an mp3 (leading bytes {head[:4]!r})"
    return None
