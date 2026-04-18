"""
probe_tts_speed.py — Issue #1112: measure Azure vs Gemini audio duration for same sentences.

Usage (from repo root):
  cd backend
  TTS_PROVIDER=azure python scripts/probe_tts_speed.py
  TTS_PROVIDER=gemini31 python scripts/probe_tts_speed.py

Outputs duration_ms for each sample sentence so we can compare providers.
Does NOT need a live server — calls tts_service directly.

NOTE: one-shot measurement script. Results documented in PR #1112 description.
Do not run in CI.
"""

import os
import struct
import sys
import time


def _wav_duration_ms(data: bytes) -> float | None:
    """Return WAV duration in ms from header, or None if not WAV/parseable."""
    try:
        if data[:4] != b'RIFF' or data[8:12] != b'WAVE':
            return None
        i = 12
        while i < len(data) - 8:
            chunk_id = data[i:i+4]
            chunk_size = struct.unpack_from('<I', data, i+4)[0]
            if chunk_id == b'fmt ':
                _ch, _sr, byte_rate, _ba, _bps = struct.unpack_from('<HHIIHH', data, i+8)
                j = i + 8 + chunk_size
                while j < len(data) - 8:
                    did = data[j:j+4]
                    dsz = struct.unpack_from('<I', data, j+4)[0]
                    if did == b'data' and byte_rate > 0:
                        return (dsz / byte_rate) * 1000
                    j += 8 + dsz
            i += 8 + chunk_size
    except Exception:
        pass
    return None


def _mp3_duration_ms_heuristic(data: bytes) -> float:
    """Rough MP3 duration from file size (Azure outputs 192kbps = 24000 bytes/sec)."""
    return len(data) / 24000 * 1000


SAMPLE_SENTENCES = [
    "夏天的夜晚，蟬聲此起彼落，讓人感受到大自然的生命力。",
    "她站在山頂上，望著遠方的城市，心裡充滿了對未來的期待。",
    "老師說，閱讀是開啟知識大門的鑰匙，每天都要養成閱讀的好習慣。",
    "小明看到路旁的野花開得燦爛，忍不住蹲下來仔細觀察。",
    "秋天到了，樹葉慢慢變成了紅色和黃色，像一幅美麗的圖畫。",
]


def probe() -> None:
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
    from app.services import tts_service  # type: ignore[import]

    provider = os.environ.get('TTS_PROVIDER', tts_service.TTS_PROVIDER)
    print(f"\n=== TTS Speed Probe (provider={provider}) — Issue #1112 ===\n")
    print(f"{'Sentence':<55} {'bytes':>8} {'dur_ms':>9} {'char/s':>7}")
    print("-" * 85)

    total_ms = 0.0
    total_chars = 0

    for sentence in SAMPLE_SENTENCES:
        t0 = time.monotonic()
        try:
            audio_bytes = tts_service.synthesize_speech(sentence)
        except Exception as exc:
            print(f"{sentence[:50]:<55} ERROR: {exc}")
            continue
        api_ms = (time.monotonic() - t0) * 1000

        dur_ms = _wav_duration_ms(audio_bytes) or _mp3_duration_ms_heuristic(audio_bytes)
        chars = len(sentence)
        cps = chars / (dur_ms / 1000) if dur_ms > 0 else 0
        total_ms += dur_ms
        total_chars += chars

        print(f"{sentence[:50]:<55} {len(audio_bytes):>8} {dur_ms:>8.0f}ms {cps:>6.1f}/s  [api {api_ms:.0f}ms]")

    overall_cps = total_chars / (total_ms / 1000) if total_ms > 0 else 0
    print("-" * 85)
    print(f"{'TOTAL/AVG':<55} {'':>8} {total_ms:>8.0f}ms {overall_cps:>6.1f}/s")
    print(f"\nReference: Azure rate=0.95 → ~4.0 chars/sec (MP3 heuristic at 192kbps)")
    print(f"Note: WAV durations are exact; MP3 is estimated. Run ffprobe for accuracy.\n")


if __name__ == '__main__':
    probe()
