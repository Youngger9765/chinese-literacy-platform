#!/usr/bin/env python3
"""把一修的 YouTube URL 接回二修的 `resources.yml`。

為什麼需要這支
--------------
二修抽取從來沒有抽過 QR code —— `_extracted` / `v2` / `v3` 三代的影片
全都是 `has_qr: true` 但沒有 `url`。於是「知識補給站」對 19 課 39 支影片
一律顯示「這篇課文目前沒有知識補給站影片」。

一修資料裡有 346 支不重複的 YouTube URL（`data/curriculum/lessons/*.yml`
的 `video_links`），只是沒有人把它接過來。

對接鍵為什麼不是課號
--------------------
⛔ 一修片名是 `影片1` / `影片2` 這種佔位字串，不能當鍵。
⛔ 課號也不能用：二修 renumber 之後課號會張冠李戴（一修 catalog 目前有 22 個
   課碼指向不存在或別的課），而「內容放錯課」正是這個專案 2026-06 那批 bug 的形狀。

改用**課名**（內容推導的鍵），並且**要求影片支數也吻合**才採用。
支數是一個獨立於課名的信號 —— 兩個都對上，配錯的機會就低得多。

正規化後仍對不上的，再看字串相似度，門檻 0.75，**一樣要支數吻合**。
低於門檻的一律不採用，寧可留白也不要接錯課（接錯的成本遠高於缺一筆）。

課內順序是假設，不是驗證過的
----------------------------
一修的片名是 `影片1` / `影片2` 這種佔位字串，**沒有東西可以拿來比對
「這一課的第一支」是不是對到「那一課的第一支」**。這裡按順序 zip。

課對得準（課名精確吻合 + 支數吻合），但同一課內兩支影片誰先誰後是假設。
影響有限（同一課的補充影片互換，學生兩支都看得到），但它是假設就要說出來，
所以 `url_source` 會寫進檔案，將來有疑問時查得到是怎麼接的。

每一筆都寫 `url_source`
----------------------
搬過來的 URL 標上它從哪個一修課號來、用哪種鍵對到的。
這不是裝飾：將來有人問「這支影片憑什麼掛在這一課」，答案要在檔案裡，
而不是在某個人的記憶裡。

用法：
    python3 scripts/migrate_legacy_video_urls.py --dry-run   # 只看會做什麼
    python3 scripts/migrate_legacy_video_urls.py             # 真的寫入
"""
from __future__ import annotations

import argparse
import difflib
import pathlib
import re
import sys

import yaml

REPO = pathlib.Path(__file__).resolve().parent.parent
LESSONS = REPO / "data" / "lessons"
CATALOG = REPO / "data" / "curriculum" / "lessons"

FUZZY_THRESHOLD = 0.75
_PUNCT = re.compile(r"[\s―—–\-－_、，,。．.：:；;！!？?「」『』（）()《》〈〉\"'#＃]")


def norm(t: str) -> str:
    return _PUNCT.sub("", str(t)).lower()


def load_legacy() -> list[tuple[str, str, str, list[str]]]:
    out = []
    for f in sorted(CATALOG.glob("*.yml")):
        d = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
        urls = [v.get("url") for v in (d.get("video_links") or []) if v.get("url")]
        title = str(d.get("title") or "").strip()
        if urls and title:
            out.append((f.stem, title, norm(title), urls))
    return out


def lesson_title(uid_dir: pathlib.Path) -> str:
    """v3 的課名。`metadata.yml` 沒有 title 欄位，走服務端同一支 loader 拿。"""
    sys.path.insert(0, str(REPO))
    from app.services.lesson_loader import search_lessons  # noqa: E402

    global _TITLES
    if "_TITLES" not in globals():
        _TITLES = {l.get("lesson_uid"): str(l.get("title") or "").strip()
                   for l in search_lessons()}
    return _TITLES.get(uid_dir.name, "")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    legacy = load_legacy()
    if len(legacy) < 50:
        raise SystemExit(f"⛔ 只讀到 {len(legacy)} 筆一修影片資料，明顯太少 —— 路徑或格式變了")

    written = skipped = 0
    for d in sorted(LESSONS.iterdir()):
        r = d / "v3" / "resources.yml"
        if not (d.is_dir() and d.name.startswith("L") and r.exists()):
            continue
        doc = yaml.safe_load(r.read_text(encoding="utf-8")) or {}
        res = doc.get("resources") or {}
        vids = res.get("videos") or []
        if not vids or all(v.get("url") for v in vids):
            continue

        nt = norm(lesson_title(d))
        if not nt:
            print(f"  {d.name} 沒有課名，跳過")
            skipped += 1
            continue

        hit = next((x for x in legacy if x[2] == nt), None)
        how = "課名"
        if hit is None:
            best = max(legacy, key=lambda x: difflib.SequenceMatcher(None, nt, x[2]).ratio())
            ratio = difflib.SequenceMatcher(None, nt, best[2]).ratio()
            if ratio >= FUZZY_THRESHOLD:
                hit, how = best, f"課名相似 {ratio:.0%}"

        if hit is None or len(hit[3]) != len(vids):
            why = "對不到一修課名" if hit is None else f"支數不符 v3={len(vids)} 一修={len(hit[3])}"
            print(f"  {d.name} 不採用：{why}")
            skipped += 1
            continue

        code, _, _, urls = hit
        for v, url in zip(vids, urls):
            v["url"] = url
            v["url_source"] = f"一修 {code}（依{how}對接）"
        print(f"  {d.name} ← {code} 搬 {len(urls)} 支（{how}）")
        written += 1
        if not args.dry_run:
            r.write_text(
                yaml.safe_dump(doc, allow_unicode=True, sort_keys=False, width=200),
                encoding="utf-8",
            )

    print(f"\n  搬了 {written} 課，未採用 {skipped} 課"
          + ("（dry-run，沒有真的寫入）" if args.dry_run else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
