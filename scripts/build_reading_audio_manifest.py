#!/usr/bin/env python3
"""build_reading_audio_manifest.py — 全文軌 + 重點軌的句表與 GCS 覆蓋率 (#2605, #2606, #2720).

WHY THIS EXISTS
---------------
Pressing play on 朗讀 waits 8–24 seconds and sometimes returns 503, because the sentence
is being synthesised on the spot. It is supposed to be a cache hit (~0.3s). Two separate
things have to line up for that, and this file is what says whether they do:

  1. the audio exists in `gs://lingoleap-tts-cache/<provider-prefix>/sentences/<sha>.mp3`
  2. the `<sha>` is the one the RUNTIME will ask for

(2) is the part that has failed twice. The cache key is `sha256` of the sentence text
after `_clean_for_tts`, so any second implementation of "split this into sentences"
produces a different key and every pre-generated file becomes unreachable. #1208: the
front end split with its own regex and 303 of 2871 sentences matched. So this file does
not have a sentence splitter — it imports the runtime's:

    _clean_for_tts  →  _split_sentences  →  _cache_key

WHY TWO TRACKS
--------------
The key passage is not a substring of the full text often enough to skip it. Measured in
#2606: only 30 of 107 lessons had their key passage fully covered by the full-text
sentences (median coverage 76%), because the marked range starts and ends mid-sentence.
Generating only the full text leaves the 重點朗讀 step — the one students actually use —
synthesising live. The extra cost is small: the two tracks overlap heavily.

WHY IT LISTS THE BUCKET ONCE
----------------------------
`blob.exists()` per key is one round trip each; at ~6500 sentences that is minutes of
latency and it reads as "the script hung". `list_blobs` is a single paged stream.

READING A "0 objects" RESULT
----------------------------
A bucket that lists zero objects and a bucket that cannot be listed are completely
different problems, and #2605 spent a while conflating them: the pre-generated audio was
reported as missing when the account simply had no `storage.objects.list`. So a listing
failure exits 2 with an explicit message and never reports a coverage number.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from app.services.tts.normalization import (  # noqa: E402
    _cache_key, _clean_for_tts, _split_sentences,
)

LESSONS = ROOT / "backend" / "data" / "lessons"

#: Must match what the serving Cloud Run revision has. A different value writes the
#: audio to a prefix the runtime never reads — a whole batch run wasted, silently.
PROVIDER = os.getenv("TTS_PROVIDER", "gemini31")
BUCKET = os.getenv("TTS_GCS_BUCKET", "lingoleap-tts-cache")


def _blob_prefix() -> str:
    """The runtime's own path builder, so the two cannot drift."""
    from app.services.tts.cache import _blob_path

    sample = _blob_path("x" * 64, PROVIDER)
    return sample.rsplit("/", 1)[0] + "/"


def _latest_version(uid_dir: Path) -> Path | None:
    versions = sorted(
        (c for c in uid_dir.iterdir() if c.is_dir() and c.name.startswith("v")),
        key=lambda c: c.name,
    ) if uid_dir.is_dir() else []
    return versions[-1] if versions else None


def _sentences(paragraphs: list[str]) -> list[str]:
    out: list[str] = []
    for p in paragraphs:
        cleaned = _clean_for_tts(str(p or ""))
        if not cleaned:
            continue
        out.extend(s for s in _split_sentences(cleaned) if s.strip())
    return out


def build_manifest() -> dict:
    """{uid: {"full": [sentences], "key": [sentences]}} over the uid tree."""
    manifest: dict[str, dict[str, list[str]]] = {}
    for uid_dir in sorted(LESSONS.glob("L*")):
        vdir = _latest_version(uid_dir)
        if vdir is None:
            continue
        bf = vdir / "body.yml"
        if not bf.exists():
            continue
        paras = (yaml.safe_load(bf.read_text(encoding="utf-8")) or {}).get("paragraphs") or []
        entry = {"full": _sentences(paras), "key": []}
        kf = vdir / "key_reading.yml"
        if kf.exists():
            passage = (yaml.safe_load(kf.read_text(encoding="utf-8")) or {}).get("passage")
            if passage:
                entry["key"] = _sentences([passage])
        if entry["full"] or entry["key"]:
            manifest[uid_dir.name] = entry
    return manifest


def list_existing() -> set[str] | None:
    """sha keys already in the bucket, or None when the bucket cannot be listed."""
    try:
        from google.cloud import storage
    except ImportError:
        print("google-cloud-storage 未安裝 — 只能算句數，無法算覆蓋率", file=sys.stderr)
        return None
    try:
        client = storage.Client()
        bucket = client.bucket(BUCKET)
        prefix = _blob_prefix()
        return {
            Path(b.name).stem
            for b in client.list_blobs(bucket, prefix=prefix)
            if b.name.endswith(".mp3")
        }
    except Exception as exc:
        print(f"無法列出 gs://{BUCKET}/{_blob_prefix()} — {type(exc).__name__}: {exc}",
              file=sys.stderr)
        print("這是權限或憑證問題，不是「沒有音檔」。先修這個，否則生了也讀不到（#2605）。",
              file=sys.stderr)
        return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--report", action="store_true", help="印覆蓋率（預設行為）")
    ap.add_argument("--out", help="把待生清單寫成 JSONL")
    a = ap.parse_args()

    manifest = build_manifest()
    tracks = {
        "全文朗讀": {k: v["full"] for k, v in manifest.items() if v["full"]},
        "重點朗讀": {k: v["key"] for k, v in manifest.items() if v["key"]},
    }
    all_keys: dict[str, str] = {}          # sha -> text, deduped across both tracks
    for sentences in tracks.values():
        for sents in sentences.values():
            for s in sents:
                all_keys.setdefault(_cache_key(s), s)

    print(f"provider={PROVIDER}  bucket=gs://{BUCKET}")
    for name, per_lesson in tracks.items():
        n_sent = sum(len(v) for v in per_lesson.values())
        n_uniq = len({_cache_key(s) for v in per_lesson.values() for s in v})
        print(f"  {name}: {len(per_lesson)} 課 / {n_sent} 句 / {n_uniq} unique")
    print(f"  兩軌合計 unique: {len(all_keys)} 句")

    existing = list_existing()
    if existing is None:
        return 2

    missing = {k: v for k, v in all_keys.items() if k not in existing}
    print(f"\nbucket 內既有 {len(existing)} 個音檔"
          f" → 已涵蓋 {len(all_keys) - len(missing)}/{len(all_keys)}"
          f"（{100 * (len(all_keys) - len(missing)) // max(1, len(all_keys))}%）"
          f"，待生 {len(missing)} 句")

    # Per-lesson, so the report names which lessons a student would wait on.
    for name, per_lesson in tracks.items():
        full = [u for u, v in per_lesson.items()
                if all(_cache_key(s) in existing for s in v)]
        none_ = [u for u, v in per_lesson.items()
                 if not any(_cache_key(s) in existing for s in v)]
        print(f"  {name}: 全齊 {len(full)} 課 / 部分 "
              f"{len(per_lesson) - len(full) - len(none_)} 課 / 完全沒有 {len(none_)} 課")

    if a.out:
        with open(a.out, "w", encoding="utf-8") as f:
            for sha, text in sorted(missing.items()):
                f.write(json.dumps({"hash": sha, "text": text}, ensure_ascii=False) + "\n")
        print(f"\n待生清單 → {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
