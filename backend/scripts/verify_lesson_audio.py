"""Check that a lesson's audio is actually correct, not merely present.

Written because on 2026-08-09 four mispronunciations were reported and it turned
out nothing anywhere stated what "correct" meant. The rules lived in code
comments and commit messages, so every change relied on somebody remembering
them. The five checks here are the ones from
`specs/modules/tts/INTENT.md` §7, made runnable.

Each check answers a question that has actually gone wrong:

  A1  Is this the voice we ship?          — a Google-prefix fallback served
                                            mainland-accent audio for weeks
  A2  Can stale audio still be served?    — the cache key was text-only, so a
                                            corrections change fixed nothing
                                            already cached
  A3  Are the sentence pauses short?      — Azure leaves ~885 ms, a quarter of
                                            a paragraph's runtime
  A4  Are the comma pauses intact?        — flattening every pause loses the
                                            rhythm of the sentence
  A5  Did the corrections reach this text? — a correction existing in the table
                                            does not mean this lesson uses it

Synthesis happens locally with the caches bypassed, so this checks the code in
the working tree against freshly generated audio. An earlier version called the
deployed backend over HTTP and stayed green while the pause threshold was
mutated to a no-op — it was measuring neither the right code nor fresh audio.
Requires AZURE_SPEECH_KEY in the environment.

Usage:
    python -m scripts.verify_lesson_audio --lesson 1
    python -m scripts.verify_lesson_audio --lesson 1 2 48 --json

Exits non-zero if any check fails, so it can gate a release.
"""
from __future__ import annotations

import argparse
import array
import json
import os
import subprocess
import sys
import tempfile
import urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.tts.normalization import (  # noqa: E402
    CORRECTIONS_FINGERPRINT,
    _apply_phoneme_corrections,
)
from app.services.tts.pauses import (  # noqa: E402
    LONG_PAUSE_MS,
    TARGET_PAUSE_MS,
    find_silences,
)

DEFAULT_API = os.environ.get(
    "LESSON_AUDIO_API",
    "https://lingoleap-backend-staging-958347263320.asia-east1.run.app",
)

MAX_INTERNAL_PAUSE_MS = 400   # A3 — TARGET_PAUSE_MS plus detector slack
COMMA_PAUSE_RANGE = (150, 400)  # A4 — measured 235–288 ms in real paragraphs
EDGE_MS = 250                 # head/tail silence is not an internal pause
COMMA_LIKE_PUNCTUATION = "，、；："  # A4 — punctuation a comma-pause should follow


def _decode(mp3: bytes) -> array.array:
    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as f:
        f.write(mp3)
        path = f.name
    try:
        raw = subprocess.run(
            ["ffmpeg", "-v", "quiet", "-i", path, "-f", "s16le",
             "-ac", "1", "-ar", "48000", "-"],
            capture_output=True, timeout=120,
        ).stdout
    finally:
        os.unlink(path)
    samples = array.array("h")
    samples.frombytes(raw)
    return samples


def _paragraphs(api: str, lesson_id: int) -> list[str]:
    with urllib.request.urlopen(f"{api}/api/tts/mapping/{lesson_id}", timeout=60) as r:
        mapping = json.load(r)
    return ["".join(s["text"] for s in p["sentences"]) for p in mapping["paragraphs"]]


def _synthesize(api: str, text: str) -> tuple[bytes, str]:
    """Synthesize locally, bypassing every cache. Returns (audio, provider).

    Deliberately NOT an HTTP call to the deployed backend. That version passed
    while the pause-shortening threshold was mutated to a no-op — twice over:
    the request exercised the deployed code rather than the code being checked,
    and the deployed side answered from its cache without synthesizing at all.
    A gate that cannot go red is not a gate.

    Going through _synthesize_speech_with_provider with the caches stubbed
    means this checks the code in the working tree, every run, on freshly
    generated audio — and reports which provider actually produced it, rather
    than A1 inferring that from pause duration (a paragraph short enough to
    have no long internal pause looked identical to a Google fallback: both
    have "no pause over 890ms", for different reasons).
    """
    import app.services.tts as tts_module

    saved_get, saved_put = tts_module._gcs_get, tts_module._gcs_put
    tts_module._gcs_get = lambda *a, **k: None
    tts_module._gcs_put = lambda *a, **k: None
    tts_module._TTS_CACHE.clear()
    try:
        return tts_module._synthesize_speech_with_provider(text)
    finally:
        tts_module._gcs_get, tts_module._gcs_put = saved_get, saved_put
        tts_module._TTS_CACHE.clear()


def _fingerprint_moves_the_key(sample: str) -> bool:
    """A2 — does the cache key move when the corrections table's fingerprint
    changes? If it doesn't, changing a pronunciation fixes nothing already
    cached: the old audio keeps being served under the same key forever.

    Probes this by swapping CORRECTIONS_FINGERPRINT to a sentinel value and
    comparing the resulting key against the one computed under the real
    fingerprint. The swap is always undone in a finally: an exception raised
    while computing the probing key must not leave the shared normalization
    module's fingerprint poisoned for every _cache_key call for the rest of
    the process — every lesson checked after that point in the same run would
    silently use the wrong key.
    """
    import app.services.tts.normalization as norm

    key_now = norm._cache_key(sample)
    original = norm.CORRECTIONS_FINGERPRINT
    try:
        norm.CORRECTIONS_FINGERPRINT = "probe"
        key_other = norm._cache_key(sample)
    finally:
        norm.CORRECTIONS_FINGERPRINT = original
    return key_now != key_other


def _paragraph_findings(idx: int, text: str, audio: bytes, provider: str) -> list[str]:
    """Everything checkable about one paragraph's freshly synthesized audio."""
    findings: list[str] = []

    if not audio:
        findings.append(f"A1 paragraph {idx + 1}: empty audio")
        return findings

    samples = _decode(audio)
    if not samples:
        findings.append(f"A1 paragraph {idx + 1}: audio did not decode")
        return findings

    # A1 — is this the voice we ship? Asking the synthesis path directly
    # (via _synthesize_speech_with_provider) rather than inferring it from
    # pause duration: a paragraph with no long internal pause of its own
    # looked identical to a Google fallback under the old duration-based
    # check, and — the direction that actually matters — a paragraph that
    # legitimately has a >890ms gap would have been misreported as the
    # fallback even while genuinely served by Azure.
    if provider != "azure":
        findings.append(
            f"A1 paragraph {idx + 1}: served from provider={provider}, not azure — "
            "this is the Google fallback (mainland accent)"
        )

    total_ms = len(samples) * 1000 // 48000
    internal = [
        (start, dur) for start, dur in find_silences(samples)
        if start > EDGE_MS and start + dur < total_ms - EDGE_MS
    ]

    # A3 — no long stalls left inside a paragraph.
    too_long = [d for _, d in internal if d > MAX_INTERNAL_PAUSE_MS]
    if too_long:
        findings.append(
            f"A3 paragraph {idx + 1}: pauses of {sorted(too_long, reverse=True)[:3]} ms "
            f"exceed {MAX_INTERNAL_PAUSE_MS} ms"
        )

    # A4 — the short pauses must survive. Checked only when the source text
    # actually contains comma-like punctuation that should have produced one:
    # gating on `internal` being non-empty (the old check) meant the worst
    # case of this exact failure — shortening flattened every pause down
    # below the silence detector's floor, so find_silences reports nothing
    # at all — made `internal` empty and silently skipped the check it was
    # supposed to catch.
    if any(p in text for p in COMMA_LIKE_PUNCTUATION):
        commas = [d for _, d in internal if COMMA_PAUSE_RANGE[0] <= d <= COMMA_PAUSE_RANGE[1]]
        if not commas:
            findings.append(
                f"A4 paragraph {idx + 1}: text has comma punctuation but no pause in "
                f"{COMMA_PAUSE_RANGE} ms was found — the sentence rhythm was flattened"
            )

    return findings


def check_lesson(api: str, lesson_id: int) -> dict:
    """Run every check against one lesson. Returns a result dict."""
    findings: list[str] = []
    paragraphs = _paragraphs(api, lesson_id)

    # A2 — the key must move when pronunciation does. Verified structurally
    # rather than by synthesizing: _cache_key mixes the fingerprint in, so two
    # different fingerprints must produce different keys for the same text.
    sample = paragraphs[0] if paragraphs else "測試"
    if CORRECTIONS_FINGERPRINT not in (None, ""):
        if not _fingerprint_moves_the_key(sample):
            findings.append("A2 cache key ignores the corrections table — stale audio is unreachable-proof")
    else:
        findings.append("A2 no corrections fingerprint")

    corrected_paragraphs = 0
    for idx, text in enumerate(paragraphs):
        # A5 — do the corrections actually touch this lesson's text?
        if _apply_phoneme_corrections(text) != text:
            corrected_paragraphs += 1

        audio, provider = _synthesize(api, text)
        findings.extend(_paragraph_findings(idx, text, audio, provider))

    # A5 — reported, not failed. A lesson may legitimately contain no corrected
    # word; what would be wrong is the table never applying to *anything*.
    return {
        "lesson": lesson_id,
        "paragraphs": len(paragraphs),
        "paragraphs_with_corrections": corrected_paragraphs,
        "fingerprint": CORRECTIONS_FINGERPRINT,
        "findings": findings,
        "ok": not findings,
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--lesson", type=int, nargs="+", required=True)
    ap.add_argument("--api", default=DEFAULT_API)
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)

    results = [check_lesson(args.api, lid) for lid in args.lesson]

    if args.json:
        print(json.dumps(results, ensure_ascii=False, indent=1))
    else:
        for r in results:
            mark = "✅" if r["ok"] else "❌"
            print(f"{mark} L{r['lesson']:02d}  {r['paragraphs']} 段"
                  f"（{r['paragraphs_with_corrections']} 段有讀音校正）"
                  f"  指紋 {r['fingerprint']}")
            for f in r["findings"]:
                print(f"     {f}")

    failed = [r for r in results if not r["ok"]]
    if failed:
        print(f"\n{len(failed)}/{len(results)} 課未通過", file=sys.stderr)
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
