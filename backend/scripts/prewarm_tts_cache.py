#!/usr/bin/env python3
"""把每一課的句子先合成好，學生就不會是第一個等的人。

為什麼
------
2026-08-19 staging 實測，同一句送三次：

    第 1 次  1.87s   103680 bytes
    第 2 次  0.24s   103680
    第 3 次  0.20s   103680      三次 md5 相同 = 快取有中

`time_starttransfer ≈ time_total` —— 合成完才開始傳，沒有邊合成邊播。
所以每一個沒被唸過的句子，第一個點的學生要等將近兩秒。
課文句子是固定的，沒有理由讓學生當那個第一次。

⚠️ **一定要打有 Azure key 的環境**（staging / prod），不要打本機。
本機沒有 key 會退回 Google 中國腔 —— 2026-04 盲聽已否決，而且
一旦寫進共用快取就永久回讀。`tts/cache.py` 現在會 fail-closed 擋住寫入
（#2765），但打對環境仍然是這支腳本的前提，不是靠那道防線兜。

用法：
    python3 scripts/prewarm_tts_cache.py --dry-run
    python3 scripts/prewarm_tts_cache.py --base https://<staging-backend>
    python3 scripts/prewarm_tts_cache.py --base ... --limit 50   # 先試一小批
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import json
import pathlib
import re
import sys
import time
import urllib.error
import urllib.request

BACKEND = pathlib.Path(__file__).resolve().parent.parent
LESSONS = BACKEND / "data" / "lessons"

# 句子邊界：中文句號/問號/驚嘆號/分號。太短的不送（單字沒有預熱價值）。
_SPLIT = re.compile(r"[。！？；]")
MIN_CHARS = 4


def sentences_of(uid: str) -> list[str]:
    """一課的所有句子，去重後保持原序。"""
    out: list[str] = []
    seen: set[str] = set()
    for name in ("full_text_annotate.yml", "classical_text.yml", "key_reading.yml"):
        f = LESSONS / uid / "v3" / name
        if not f.exists():
            continue
        import yaml

        doc = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
        sec = doc.get(f.stem) or doc
        blocks = sec.get("paragraphs") or sec.get("lines") or sec.get("sentences") or []
        if isinstance(sec.get("passage"), str):
            blocks = list(blocks) + [sec["passage"]]
        for b in blocks:
            text = (b.get("text") or b.get("content") or "") if isinstance(b, dict) else b
            for raw in _SPLIT.split(str(text)):
                s = raw.strip()
                if len(s) >= MIN_CHARS and s not in seen:
                    seen.add(s)
                    out.append(s)
    return out


def synth(base: str, text: str, timeout: int = 60) -> tuple[bool, float, int, str]:
    """回 (成功, 秒數, bytes, 失敗原因)。

    ⚠️ 原因一定要回傳。第一版把所有例外吞成 `False`，於是 5011 句失敗只印 ✗，
    看起來像「服務壞了」——實際上是 429（每分鐘 30 次的限流），
    而單發測試照樣 200。**吞掉原因的錯誤處理，會讓人去修一個沒壞的東西。**
    """
    body = json.dumps({"text": text}).encode()
    req = urllib.request.Request(
        f"{base}/api/tts/synthesize", data=body,
        headers={"Content-Type": "application/json"},
    )
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            n = len(r.read())
        return True, time.time() - t0, n, ""
    except urllib.error.HTTPError as e:
        return False, time.time() - t0, 0, f"HTTP {e.code}"
    except Exception as e:                                     # noqa: BLE001
        return False, time.time() - t0, 0, type(e).__name__


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", help="後端 base URL（要有 Azure key 的環境）")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--workers", type=int, default=2,
                    help="併發數。後端限流是每分鐘 30 次，開太多只會換來一整批 429。")
    ap.add_argument("--rpm", type=int, default=28,
                    help="每分鐘送幾句。後端 TTS_MAX_REQUESTS=30/60s，留一點餘裕。")
    args = ap.parse_args()

    jobs: list[tuple[str, str]] = []
    for d in sorted(LESSONS.iterdir()):
        if not (d.is_dir() and d.name.startswith("L")):
            continue
        for s in sentences_of(d.name):
            jobs.append((d.name, s))
    if args.limit:
        jobs = jobs[: args.limit]

    print(f"  {len({j[0] for j in jobs})} 課 / {len(jobs)} 句")
    if args.dry_run:
        for uid, s in jobs[:5]:
            print(f"    {uid}  {s[:38]}")
        print("  ※ dry-run，沒有真的送出")
        return 0
    if not args.base:
        raise SystemExit("⛔ 要 --base（而且必須是有 Azure key 的環境）")
    if "localhost" in args.base or "127.0.0.1" in args.base:
        raise SystemExit(
            "⛔ 不要對本機預熱：沒有 AZURE_SPEECH_KEY 會退回 Google 中國腔。"
            "打 staging 或 prod。"
        )

    # 後端限流：`TTS_MAX_REQUESTS = 30 / 60s`（`auth/rate_limiter.py`）。
    # 一口氣灌 5181 句的下場是前 170 句成功、其餘 5011 句 429 ——
    # 送得快不等於做得完，只是把配額燒在被拒絕的請求上。
    interval = 60.0 / max(1, args.rpm)
    print(f"  節流：每分鐘 {args.rpm} 句（後端上限 30/60s），"
          f"預估 {len(jobs)/args.rpm/60:.1f} 小時")

    ok = fail = 0
    reasons: dict[str, int] = {}
    slow: list[float] = []
    t_start = time.time()
    with cf.ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {}
        for uid, s in jobs:
            futs[ex.submit(synth, args.base, s)] = (uid, s)
            time.sleep(interval)
        for i, fut in enumerate(cf.as_completed(futs), 1):
            good, secs, n, why = fut.result()
            if good:
                ok += 1
                slow.append(secs)
            else:
                fail += 1
                reasons[why] = reasons.get(why, 0) + 1
            if i % 200 == 0:
                el = time.time() - t_start
                print(f"    {i}/{len(jobs)}  成功 {ok} 失敗 {fail} {reasons or ''}  "
                      f"已花 {el/60:.0f} 分")

    el = time.time() - t_start
    slow.sort()
    p50 = slow[len(slow) // 2] if slow else 0
    print(f"\n  完成：成功 {ok}，失敗 {fail}，{el/60:.1f} 分鐘")
    if reasons:
        print(f"  失敗原因分布：{reasons}")
        if reasons.get("HTTP 429"):
            print("  ⚠️ 有 429 = 送太快。降 --rpm 重跑，已成功的那些是快取命中不會重算。")
    print(f"  單句中位數 {p50:.2f}s（含已快取的）")
    return 0 if fail == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
