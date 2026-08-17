#!/usr/bin/env python3
"""generate_reading_audio.py — 預生成全庫朗讀音檔 (#2605, #2606).

WHY THIS EXISTS
---------------
Pressing play on 朗讀 waits 8–24 seconds and sometimes 503s, because the sentence is
being synthesised on the spot. `build_reading_audio_manifest.py --report` says how much
is missing; this fills it.

WHAT #2605 WAS ACTUALLY BLOCKED ON
----------------------------------
#2605 listed three candidate causes for the pre-generated audio not being served: the
blobs deleted by a lifecycle rule, the Cloud Run service account lacking read on the
bucket, or `TTS_PROVIDER` pointing at the wrong prefix. It is none of the three.

`_cache_key` is `sha256(CORRECTIONS_FINGERPRINT + text)`. The fingerprint was added so
that editing the pronunciation table makes stale clips UNREACHABLE rather than WRONG —
a good design, with a cost its own docstring states: 「Regenerating the whole corpus
costs about $2」. That regeneration never ran. Measured 2026-08-17: all 1418 objects
under `gemini31-prompt-only-v2/sentences/` are keyed by the plain `sha256(text)` of the
older scheme, and 0 of the 7236 sentences the runtime now asks for is present. The cache
is not stale in part. It is 100% unreachable.

So this script is not topping up a cache. It is the regeneration that the fingerprint
change always implied, and it will be needed again the next time that table is edited —
which is why it is a checked-in script rather than a one-off.

WHY IT CALLS THE RUNTIME'S OWN FUNCTIONS
----------------------------------------
Every previous attempt at pre-generation drifted from the runtime and became unreachable:

  · #1208 — the front end split sentences with its own regex, so the sha256 it requested
    was not the sha256 that was generated. 303 of 2871 matched.
  · this one — the key scheme moved and the generator was never re-run.

Both are the same failure: a second implementation of something the runtime already
does. So there is no synthesiser, no sentence splitter, no path builder and no MP3
encoder in this file. It imports `_synthesize_gemini`, `_split_sentences`, `_cache_key`
and `_gcs_put` and calls them. If the runtime changes, this follows for free; if it
cannot follow, the import breaks loudly instead of producing unreachable audio.

That also settles the loudness question the ops doc raised. `batch_gemini_tts_v2.py`
applied EBU R128 loudnorm and the runtime's `_pcm_to_mp3` does not, so batch-generated
and live-synthesised clips differed by 2–6 dB in adjacent sentences. Going through the
runtime's encoder means the two are identical by construction. Uniform-but-unnormalised
beats normalised-but-inconsistent.

BOTH TRACKS AT ONCE, FOR FREE
-----------------------------
#2606 measured that the key passage needed its own 210 sentences because it started and
ended mid-sentence. That is no longer true: since #2720, `key_reading.passage` is
required to be one of `body.yml`'s paragraphs, so its sentences ARE full-text sentences.
Measured on the current tree: 全文 7236 unique, 重點 470 unique, union 7236. Generating
the full-text track covers the key track completely, and it stays covered no matter which
paragraph a later re-extraction picks.

USAGE
-----
    python3 scripts/build_reading_audio_manifest.py --report          # 先看缺多少
    python3 scripts/generate_reading_audio.py --limit 20              # 小樣本試跑
    python3 scripts/generate_reading_audio.py --workers 10            # 正式跑

Needs `roles/aiplatform.user` on the project, `roles/storage.objectAdmin` on the bucket,
and ffmpeg on PATH. Resumable: sentences already in the bucket are skipped, so an
interrupted run costs nothing to repeat.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "scripts"))

from build_reading_audio_manifest import (  # noqa: E402
    BUCKET, PROVIDER, build_manifest, list_existing,
)

from app.services.tts.cache import _gcs_put  # noqa: E402
from app.services.tts.normalization import _cache_key  # noqa: E402
from app.services.tts.providers.gemini import _synthesize_gemini  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--workers", type=int, default=10)
    ap.add_argument("--limit", type=int, help="只做前 N 句（試跑）")
    ap.add_argument("--provenance", default="/tmp/reading-audio-provenance.jsonl")
    a = ap.parse_args()

    manifest = build_manifest()
    todo: dict[str, str] = {}
    for entry in manifest.values():
        for track in ("full", "key"):
            for s in entry[track]:
                todo.setdefault(_cache_key(s), s)

    existing = list_existing()
    if existing is None:
        # Never generate against an unknown cache: every sentence would look missing and
        # the run would re-synthesise a corpus that is already there.
        return 2
    missing = {k: v for k, v in todo.items() if k not in existing}
    keys = sorted(missing)
    if a.limit:
        keys = keys[: a.limit]

    print(f"provider={PROVIDER} bucket=gs://{BUCKET}")
    print(f"需要 {len(todo)} 句，已有 {len(todo) - len(missing)}，本次生成 {len(keys)} 句"
          f"，{a.workers} workers")
    if not keys:
        print("沒有缺口。")
        return 0

    lock = threading.Lock()
    done = failed = 0
    started = time.time()
    prov = open(a.provenance, "a", encoding="utf-8")

    def work(key: str) -> tuple[str, str | None]:
        text = missing[key]
        try:
            audio = _synthesize_gemini(text)
            if not audio:
                return key, "empty audio"
            _gcs_put(key, audio, PROVIDER)
            return key, None
        except Exception as exc:                       # one sentence must not kill the run
            return key, f"{type(exc).__name__}: {exc}"[:200]

    with ThreadPoolExecutor(max_workers=a.workers) as pool:
        futures = {pool.submit(work, k): k for k in keys}
        for fut in as_completed(futures):
            key, err = fut.result()
            with lock:
                if err:
                    failed += 1
                else:
                    done += 1
                prov.write(json.dumps(
                    {"hash": key, "chars": len(missing[key]), "error": err},
                    ensure_ascii=False) + "\n")
                n = done + failed
                if n % 50 == 0 or n == len(keys):
                    rate = n / max(1e-6, time.time() - started)
                    left = (len(keys) - n) / max(1e-6, rate)
                    print(f"  {n}/{len(keys)}  成功 {done} 失敗 {failed}"
                          f"  {rate:.1f} 句/秒  剩約 {left / 60:.0f} 分", flush=True)
    prov.close()

    print(f"\n完成：成功 {done}，失敗 {failed}，耗時 {(time.time() - started) / 60:.1f} 分")
    print(f"稽核紀錄 → {a.provenance}")
    if failed:
        print("失敗的句子重跑同一支即可 —— 已有音檔會被跳過，只補缺的。")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
