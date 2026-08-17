#!/usr/bin/env python3
"""build_reading_audio_manifest.py — 朗讀音檔覆蓋率盤點 (#2605, #2606).

WHAT IT ANSWERS
---------------
Pressing play on 朗讀 waits 8–24 seconds and sometimes 503s, because the clip is being
synthesised on the spot. Two things have to line up for it to be a cache hit (~0.3s):

  1. the audio exists in `gs://lingoleap-tts-cache/<prefix>/sentences/<sha>.mp3`
  2. the `<sha>` is the one the RUNTIME will ask for

(2) is what has failed three times. It is not decided here — `reading_audio_units.py`
derives it from the player's call sites and both this file and the generator import it,
so counting and generating cannot disagree about the unit.

READING A "0 objects" RESULT
----------------------------
A bucket that lists zero objects and a bucket that cannot be listed are different
problems, and #2605 conflated them for a while: the pre-generated audio was reported
missing when the account simply had no `storage.objects.list`. A listing failure exits 2
and never prints a coverage number.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "scripts"))

from reading_audio_units import all_units, lesson_bodies, paragraph_unit, sentence_units  # noqa: E402

from app.services.tts.normalization import _cache_key  # noqa: E402

#: Must match the serving Cloud Run revision. A different value writes the audio to a
#: prefix the runtime never reads — a whole batch wasted, silently.
PROVIDER = os.getenv("TTS_PROVIDER", "gemini31")
BUCKET = os.getenv("TTS_GCS_BUCKET", "lingoleap-tts-cache")


def blob_prefix() -> str:
    """The runtime's own path builder, so the two cannot drift."""
    from app.services.tts.cache import _blob_path

    return _blob_path("x" * 64, PROVIDER).rsplit("/", 1)[0] + "/"


def list_existing() -> set[str] | None:
    """sha keys already in the bucket, or None when the bucket cannot be listed."""
    try:
        from google.cloud import storage
    except ImportError:
        print("google-cloud-storage 未安裝 — 無法算覆蓋率", file=sys.stderr)
        return None
    try:
        client = storage.Client()
        prefix = blob_prefix()
        return {
            Path(b.name).stem
            for b in client.list_blobs(client.bucket(BUCKET), prefix=prefix)
            if b.name.endswith(".mp3")
        }
    except Exception as exc:
        print(f"無法列出 gs://{BUCKET}/{blob_prefix()} — {type(exc).__name__}: {exc}",
              file=sys.stderr)
        print("這是權限或憑證問題，不是「沒有音檔」。先修這個，否則會重生一整批已經存在的東西。",
              file=sys.stderr)
        return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--report", action="store_true", help="（預設行為）")
    ap.add_argument("--out", help="把待生清單寫成 JSONL")
    a = ap.parse_args()

    units = all_units()
    by_family: dict[str, set[str]] = {}
    for key, u in units.items():
        for fam in u["family"]:
            by_family.setdefault(fam, set()).add(key)

    print(f"provider={PROVIDER}  bucket=gs://{BUCKET}/{blob_prefix()}")
    print(f"執行期會請求的 unique 單位 {len(units)}")
    print(f"  整段（有帶 lessonId 的路徑：逐段/全文朗讀）: {len(by_family.get('paragraph', ()))}")
    print(f"  逐句（沒帶 lessonId 的路徑：重點朗讀、後台試聽）: {len(by_family.get('sentence', ()))}")

    existing = list_existing()
    if existing is None:
        return 2

    missing = sorted(k for k in units if k not in existing)
    have = len(units) - len(missing)
    print(f"\nbucket 內 {len(existing)} 個物件 → 已涵蓋 {have}/{len(units)}"
          f"（{100 * have // max(1, len(units))}%），待生 {len(missing)}")
    for fam, keys in sorted(by_family.items()):
        hit = len(keys & existing)
        print(f"  {fam}: {hit}/{len(keys)}（{100 * hit // max(1, len(keys))}%）")

    # Per-lesson, because "80% of sentences" does not tell a teacher which lesson stalls.
    bodies = lesson_bodies()
    stalls: list[str] = []
    for uid, paras in bodies.items():
        need = {_cache_key(u) for p in paras if (u := paragraph_unit(p))}
        need |= {_cache_key(s) for p in paras for s in sentence_units(p)}
        if need and not need <= existing:
            stalls.append(uid)
    print(f"\n會讓學生等待的課：{len(stalls)}/{len(bodies)}")
    if stalls:
        print(f"  {', '.join(stalls[:12])}{' …' if len(stalls) > 12 else ''}")

    if a.out:
        with open(a.out, "w", encoding="utf-8") as f:
            for key in missing:
                u = units[key]
                f.write(json.dumps(
                    {"hash": key, "text": u["text"], "family": sorted(u["family"])},
                    ensure_ascii=False) + "\n")
        print(f"\n待生清單 → {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
