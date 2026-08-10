"""Shorten the silence Azure leaves at every sentence end.

Measured on a real 139-character paragraph: 29.90 s of audio holding 7.57 s of
silence — a quarter of the runtime — in two cleanly separated groups.

    comma pauses     235–288 ms   (5)
    sentence pauses  878–889 ms   (6)

The comma pauses are the rhythm of the sentence. The sentence pauses are nearly
a second each, and they are what makes a whole-lesson reading drag: 「現在句子
跟句子之間停頓接近一秒誒」.

I reached the wrong conclusion here once by taking Azure's own timing as the
target — our per-sentence gap measured 763 ms against Azure's 873 ms, so I
argued there was nothing to fix and deleted a working trim. What that missed is
that natural for a news reader is not right for a child following the text in a
book. The number to aim at comes from the reading task, not from the engine.

This module only *plans* the cuts. Splicing them out of the audio is the
caller's job, so the arithmetic is testable without decoding anything.
"""
from __future__ import annotations

import logging
import os


logger = logging.getLogger(__name__)

# Anything at least this long is a sentence boundary rather than a comma.
# The two groups are 600 ms apart, so the threshold sits comfortably between
# them and does not need to be precise.
LONG_PAUSE_MS = 600

# What a sentence boundary is shortened to. Long enough to still hear the
# sentence end — remove it entirely and the sentences run together, which is
# harder to follow than the original problem — short enough that a 6-sentence
# paragraph stops losing 5 seconds to dead air.
TARGET_PAUSE_MS = 350

# Silence at the very start or end of a clip is not an internal pause: the head
# is the onset (cutting into it clips the first syllable) and the tail is the
# gap to the next paragraph, where a pause belongs.
EDGE_GUARD_MS = 250


def plan_pause_cuts(
    silences: list[tuple[int, int]],
    total_ms: int,
) -> list[tuple[int, int]]:
    """Decide which stretches of silence to remove.

    Args:
        silences: (start_ms, duration_ms) for each detected run, any order.
        total_ms: length of the whole clip, used to recognise the trailing run.

    Returns:
        (start_ms, duration_ms) stretches to delete, in playback order and
        non-overlapping, so a caller can splice them out by walking forward.
    """
    cuts: list[tuple[int, int]] = []

    for start, duration in sorted(silences):
        if duration < LONG_PAUSE_MS:
            continue
        if start <= EDGE_GUARD_MS:
            continue  # leading silence — the clip's onset
        if start + duration >= total_ms - EDGE_GUARD_MS:
            continue  # trailing silence — the gap to the next paragraph
        excess = duration - TARGET_PAUSE_MS
        if excess <= 0:
            continue
        # Keep the first TARGET_PAUSE_MS of the run and drop the remainder, so
        # the boundary still lands where the speech actually stopped.
        cuts.append((start + TARGET_PAUSE_MS, excess))

    return cuts


# ── Applying the plan to real audio ─────────────────────────────────────────
#
# Detection and splicing both work on decoded PCM, because MP3 frames are 24 ms
# and a pause boundary does not land on one. The clip is re-encoded once at the
# original bitrate; this runs offline into a cache, so the cost is paid once per
# paragraph and never on a listener's request.

SILENCE_THRESHOLD = 300      # |sample| below this counts as silence (16-bit)
MIN_RUN_MS = 150             # shorter dips are articulation, not a pause
SAMPLE_RATE = 48000


def find_silences(samples, sample_rate: int = SAMPLE_RATE) -> list[tuple[int, int]]:
    """Locate silent runs as (start_ms, duration_ms)."""
    runs: list[tuple[int, int]] = []
    min_run = MIN_RUN_MS * sample_rate // 1000
    run = 0
    for i, v in enumerate(samples):
        if -SILENCE_THRESHOLD < v < SILENCE_THRESHOLD:
            run += 1
        else:
            if run >= min_run:
                runs.append(((i - run) * 1000 // sample_rate, run * 1000 // sample_rate))
            run = 0
    if run >= min_run:
        n = len(samples)
        runs.append(((n - run) * 1000 // sample_rate, run * 1000 // sample_rate))
    return runs


def splice_out(samples, cuts: list[tuple[int, int]], sample_rate: int = SAMPLE_RATE):
    """Remove the planned stretches. `cuts` must be ordered and non-overlapping."""
    if not cuts:
        return samples
    out = samples[:0]   # same array type, empty
    pos = 0
    for start_ms, dur_ms in cuts:
        a = start_ms * sample_rate // 1000
        b = (start_ms + dur_ms) * sample_rate // 1000
        if a > pos:
            out.extend(samples[pos:a])
        pos = max(pos, b)
    out.extend(samples[pos:])
    return out


def shorten_sentence_pauses(mp3_bytes: bytes) -> bytes:
    """Shorten the ~885 ms Azure leaves at each sentence end. Never raises.

    Decodes, splices, re-encodes at the original bitrate. That is one lossy
    generation, which is the price of cutting at a pause boundary — MP3 frames
    are 24 ms and a pause does not land on one.

    It runs once per paragraph, on the way into the cache, so no listener ever
    waits for it. If ffmpeg is missing or anything goes wrong the original is
    returned unchanged: a slightly draggy reading is a far better failure than
    no audio.
    """
    import shutil
    import subprocess
    import tempfile
    from array import array

    if not mp3_bytes or not shutil.which("ffmpeg"):
        return mp3_bytes

    try:
        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as f:
            f.write(mp3_bytes)
            src = f.name
        try:
            raw = subprocess.run(
                ["ffmpeg", "-v", "quiet", "-i", src, "-f", "s16le",
                 "-ac", "1", "-ar", str(SAMPLE_RATE), "-"],
                capture_output=True, timeout=60,
            ).stdout
            if not raw:
                return mp3_bytes

            samples = array("h")
            samples.frombytes(raw)
            total_ms = len(samples) * 1000 // SAMPLE_RATE
            cuts = plan_pause_cuts(find_silences(samples), total_ms)
            if not cuts:
                return mp3_bytes

            trimmed = splice_out(samples, cuts)
            encoded = subprocess.run(
                ["ffmpeg", "-v", "quiet", "-f", "s16le", "-ac", "1",
                 "-ar", str(SAMPLE_RATE), "-i", "-", "-b:a", "192k",
                 "-f", "mp3", "-"],
                input=trimmed.tobytes(), capture_output=True, timeout=60,
            ).stdout
            # An empty or absurdly small result means the encode failed in a way
            # ffmpeg did not report; keep the original rather than ship silence.
            if len(encoded) < len(mp3_bytes) // 4:
                return mp3_bytes
            logger.info(
                "Shortened %d sentence pauses (%.2fs → %.2fs)",
                len(cuts), len(samples) / SAMPLE_RATE, len(trimmed) / SAMPLE_RATE,
            )
            return encoded
        finally:
            os.unlink(src)
    except Exception as exc:  # noqa: BLE001 - never break synthesis over this
        logger.warning("Pause shortening skipped: %s", exc)
        return mp3_bytes
