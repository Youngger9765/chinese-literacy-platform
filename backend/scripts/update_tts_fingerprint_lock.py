#!/usr/bin/env python3
"""量一次真實 bucket，把「音檔現在用哪個發音指紋定址」寫進 lock（#2742）。

為什麼要有這支
--------------
`_cache_key` 把發音修正表的指紋混進 key，所以改一行發音 = 整個 key space 平移，
bucket 裡的每一個物件同時變成不可達。2026-08-20 實測：加一條修正條目，
指紋 cda4399d726e → 79e1c52637d3，6356 個 key 命中數從 2764 掉到 **0**。
CI 綠、部署成功、log 不報錯 —— 沒有任何一個地方會講這件事。

`tests/test_tts_fingerprint_lock.py` 會擋，但它只能比對 lock 裡記的指紋。
lock 要能被信任，就不能是人手打的一行字，所以這支腳本是唯一該用來更新它的方式：
它**真的去列 bucket**，命中率不夠就不寫。

⚠️ 句子清單一律跟真環境要（`/api/tts/mapping/{id}`），不在這裡自己切句。
播放器送什麼字串就要熱什麼字串 —— 切法差一個標點就是不同的 key，
2026-08-20 為此白跑 236 分鐘（見 prewarm_tts_cache.py 的 sentences_of 註解）。
所以這裡直接沿用 prewarm 的那兩個函式，不做第二份實作。

用法：
    python3 backend/scripts/update_tts_fingerprint_lock.py --base https://<staging-backend>
    python3 backend/scripts/update_tts_fingerprint_lock.py --base ... --dry-run
"""
from __future__ import annotations

import argparse
import datetime as dt
import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from app.services.tts.cache import TTS_GCS_BUCKET, _blob_path  # noqa: E402
from app.services.tts.fingerprint_lock import LOCK_PATH  # noqa: E402
from app.services.tts.normalization import CORRECTIONS_FINGERPRINT, _cache_key  # noqa: E402

DEFAULT_MIN_RATIO = 0.95


def _env_label(base: str) -> str:
    """哪個環境量的 —— 不記完整 URL，見下方 payload 的註解。"""
    for name in ("staging", "prod", "preview"):
        if name in base:
            return name
    return "other"


def _load_prewarm():
    """動態載入 prewarm_tts_cache.py，直接用它的 lesson_ids / sentences_of。

    它是 standalone script 不是 package，所以走 spec_from_file_location ——
    跟 audit_tts_coverage.py 借 batch_azure_tts.load_sentences() 同一個模式。
    重點是不要在這裡複製一份句子列舉：兩份列舉遲早會分岔，而分岔正是
    這整條線一直在踩的坑。
    """
    spec = importlib.util.spec_from_file_location(
        "prewarm_tts_cache_ref", ROOT / "backend" / "scripts" / "prewarm_tts_cache.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def collect_texts(base: str) -> list[str]:
    """播放器會逐句請求的所有字串（跨全部課，去重）。"""
    pw = _load_prewarm()
    ids = pw.lesson_ids(base)
    seen: set[str] = set()
    out: list[str] = []
    skipped = 0
    for lid in ids:
        try:
            for t in pw.sentences_of(base, lid):
                if t not in seen:
                    seen.add(t)
                    out.append(t)
        except Exception as exc:                                      # noqa: BLE001
            skipped += 1
            print(f"    ⚠️ 課 {lid} 的 mapping 拿不到（{type(exc).__name__}），跳過")
    if skipped:
        print(f"    ⚠️ 共 {skipped}/{len(ids)} 課沒拿到 —— 這批數字是低估的")
    print(f"  {len(ids)} 課 / {len(out)} 句（去重後）")
    return out


def existing_keys(bucket, provider: str) -> set[str]:
    """bucket 裡該 provider 前綴下所有 .mp3 的 key。

    一次 list_blobs，不要 per-key exists() —— 六千多個 key 那樣跑要十分鐘以上。
    """
    prefix = _blob_path("", provider).removesuffix(".mp3")
    return {
        b.name[len(prefix):-4]
        for b in bucket.list_blobs(prefix=prefix)
        if b.name.endswith(".mp3")
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True,
                    help="後端 base URL（句子清單跟它要）")
    ap.add_argument("--provider", default="azure")
    ap.add_argument("--bucket", default=TTS_GCS_BUCKET)
    ap.add_argument("--min-ratio", type=float, default=DEFAULT_MIN_RATIO,
                    help=f"命中率低於此值就不寫 lock（預設 {DEFAULT_MIN_RATIO}）")
    ap.add_argument("--allow-partial", action="store_true",
                    help="命中率不足仍寫入，並在 lock 裡標 partial=true")
    ap.add_argument("--dry-run", action="store_true", help="只量不寫")
    args = ap.parse_args()

    # prewarm_tts_cache.py 擋 localhost 是怕寫進中國腔；這裡擋它是另一個理由：
    # lock 描述的是**共用 bucket**，而只有 staging / prod 會去填那顆 bucket。
    # 拿本機或 preview 後端來列舉，語料集可能根本不同，量出來的數字會安靜地
    # 描述一個不存在的對應關係 —— 然後被 commit 進去當成事實。
    env = _env_label(args.base)
    if "localhost" in args.base or "127.0.0.1" in args.base:
        print("⛔ 不要用本機後端量：它的語料集不保證跟共用 bucket 對應。用 staging 或 prod。")
        return 1
    if env not in ("staging", "prod"):
        print(f"⛔ --base 看起來是 {env} 環境。lock 描述的是共用 bucket "
              f"({args.bucket})，只有 staging / prod 會填它 —— 換一個。")
        return 1

    from google.cloud import storage

    print(f"  目前程式算出的指紋：{CORRECTIONS_FINGERPRINT}")
    texts = collect_texts(args.base)
    if not texts:
        print("⛔ 一句都沒拿到 —— 不是快取的問題，是列舉壞了。不寫 lock。")
        return 1

    expected = {_cache_key(t) for t in texts}
    bucket = storage.Client().bucket(args.bucket)
    existing = existing_keys(bucket, args.provider)
    reachable = expected & existing
    ratio = len(reachable) / len(expected)

    print(f"  bucket {args.bucket} / provider={args.provider}")
    print(f"  該有 {len(expected)} 個 key，bucket 裡有 {len(existing)} 個物件，"
          f"對得上 {len(reachable)} 個（{ratio:.1%}）")
    print(f"  定址不到的物件：{len(existing - expected)} 個（歷次指紋的殘留）")

    if ratio < args.min_ratio:
        # 命中率低有兩種可能，而它們的處置完全相反，所以要講清楚是哪一種：
        # 指紋對不上 = 全庫平移（近乎 0%）；單純沒生成完 = 部分缺。
        print(f"\n  ⚠️ 命中率 {ratio:.1%} < 門檻 {args.min_ratio:.0%}")
        if ratio < 0.05:
            print("     幾乎全滅 —— 這是指紋平移的形狀，不是「有幾句沒生成」。")
            print("     線上跑的程式可能跟這份 checkout 不同版，或者根本還沒重生過。")
        else:
            print("     部分缺 —— 先把 prewarm 跑完再回來量。")
        if not args.allow_partial:
            print("\n⛔ 不寫 lock。要記錄這個部分狀態請加 --allow-partial。")
            return 1
        print("     --allow-partial：照實寫入，lock 會標 partial=true。")

    payload = {
        "fingerprint": CORRECTIONS_FINGERPRINT,
        "measured_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "bucket": args.bucket,
        "provider": args.provider,
        "expected_keys": len(expected),
        "reachable_keys": len(reachable),
        "bucket_objects": len(existing),
        "unaddressable_objects": len(existing - expected),
        "partial": ratio < args.min_ratio,
        # 記端點形狀而不是完整 URL：這個檔會 commit 進 public repo，
        # 沒有必要在 CLAUDE.md 之外再釘一份環境網址進去。
        "source": "GET {backend}/api/tts/mapping/{lesson_id}",
        "environment": env,
        "note": (
            "改了發音修正表就要重生全庫，然後用 "
            "scripts/update_tts_fingerprint_lock.py 重量一次。"
            "手改這個檔 = 把不可達的音檔變成綠燈。"
        ),
    }

    if args.dry_run:
        print("\n  ※ dry-run，沒有寫檔。內容會是：")
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return 0

    LOCK_PATH.parent.mkdir(parents=True, exist_ok=True)
    LOCK_PATH.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"\n  ✅ 已寫入 {LOCK_PATH.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
