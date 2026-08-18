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

WHY IT CALLS `synthesize_speech` AND NOTHING ELSE
------------------------------------------------
Every attempt at pre-generating this corpus has drifted from the runtime and become
unreachable. Four now, each a different way of re-implementing something the runtime
already does:

  · #1208 — the front end split sentences with its own regex, so the sha256 it asked for
    was not the sha256 that had been generated. 303 of 2871 matched.
  · #2605 — the cache key gained the pronunciation fingerprint; the corpus was never
    regenerated. 0 of 7236 matched.
  · 2026-08-17 — this script generated one clip per SENTENCE while the player sends a
    whole PARAGRAPH when it has lesson context. 53 of 1657 matched.
  · 2026-08-18 — this script called `_synthesize_gemini` and wrote the `gemini31` prefix.
    Every deployed environment runs `TTS_PROVIDER=azure` (`staging-deploy.yml`,
    `deploy.yml`, `preview-deploy.yml`), which reads `azure/sentences/`. 8666 clips
    landed in a prefix nothing reads. 靖杭 found it by pressing play and still waiting.

The last one is the reason this file no longer names a provider. `synthesize_speech` IS
the runtime path — it computes the key, checks L1 and GCS, picks the provider from
`TTS_PROVIDER`, applies that provider's post-processing (Azure's 885 ms sentence-end
silence is shortened on the way into the cache; Gemini's is not), and writes to that
provider's prefix. So the only thing this script decides is WHICH TEXTS to synthesise;
everything about HOW belongs to the runtime.

That also settles the loudness question the ops doc raised: going through the runtime's
own encoder makes batch and live clips identical by construction.

WHAT UNIT, AND WHY IT IS NOT DECIDED HERE
-----------------------------------------
The first version of this script generated one clip per SENTENCE for every track. The
player sends a whole PARAGRAPH whenever it has lesson context (`ttsApi.ts::
_speakViaBackend`), so 53 of 1657 paragraph units matched — the same class of miss as
#1208 and #2605, committed while the docstring above warned against it.

The unit now comes from `reading_audio_units.py`, derived from the call sites, and the
report imports the same module. Two families, both derived from `body.yml` alone:

    paragraph   1657   speakText(text, lessonId, idx)  — 逐段/全文朗讀
    sentence    7243   speakText(text)                 — 重點朗讀, 後台試聽
    union       8703

Deriving both from `body.yml` and nothing else is deliberate: the key passage must be one
of its paragraphs (#2720 check 3), so this covers the passage deployed today AND any
passage a later re-extraction picks. The audio can therefore be generated and tested
before the extraction change merges.

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

from build_reading_audio_manifest import BUCKET, PROVIDER, list_existing  # noqa: E402
from reading_audio_units import all_units  # noqa: E402

from app.services.tts import synthesize_speech  # noqa: E402
from app.services.tts.cache import _blob_path, _get_gcs_bucket  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--workers", type=int, default=10)
    ap.add_argument("--limit", type=int, help="只做前 N 句（試跑）")
    ap.add_argument("--provenance", default="/tmp/reading-audio-provenance.jsonl")
    a = ap.parse_args()

    todo = {k: u["text"] for k, u in all_units().items()}

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

    bucket = _get_gcs_bucket()

    def work(key: str) -> tuple[str, str | None]:
        # `synthesize_speech` IS the runtime path: it computes the key, checks L1 and
        # GCS, synthesises with the CONFIGURED provider, applies that provider's
        # post-processing, and writes to that provider's prefix. Calling it means this
        # script cannot name a provider, and therefore cannot name the wrong one.
        try:
            audio = synthesize_speech(missing[key])
        except Exception as exc:                       # one sentence must not kill the run
            return key, f"{type(exc).__name__}: {exc}"[:200]
        if not audio:
            return key, "empty audio"
        # Returning bytes is not the same as having filled the cache this run is for.
        # When Azure fails, `_synthesize_speech_with_provider` falls back to Google and
        # stores under the GOOGLE prefix (`used_provider` decides the path) — so the
        # student gets a mainland-accent clip live, the `azure/` key stays missing, and
        # this loop would report success. Every miss this corpus has ever had was a
        # success report that nobody checked, so the landing is checked.
        if bucket is not None and not bucket.blob(_blob_path(key, PROVIDER)).exists():
            return key, f"synthesised but not stored under {PROVIDER} (provider fell back?)"
        return key, None

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
