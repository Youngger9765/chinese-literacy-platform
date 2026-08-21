#!/usr/bin/env python3
"""把散在 payload top-level 的一次性註解欄位收進固定的 `notes`（#2843）。

## 這支在解什麼

同一個模組的 175 課，核心欄位其實是穩的。亂的是尾巴 ——
LLM 每抽一課就把它的隨手備註當成一個**新的 top-level key** 塞進 payload：

    char_count_note   benchmark_threshold_note   _圈選note
    bank_note         decoy_note                 qr_note

於是 `full_text_annotate` 164 課長出 115 種形狀。資料本身一致，是旁白在長。

    改之前                              改之後
    key_reading:                        key_reading:
      passage: "..."                      passage: "..."
      benchmark: 120                      benchmark: 120
      char_count_note: "紙上是 320"       notes:
      benchmark_threshold_note: "..."       char_count: "紙上是 320"
                                            benchmark_threshold: "..."

## 鐵律

**只搬位置，不改值。** 搬完每一份檔的葉節點值集合必須逐字相同，
有一個對不上就整批回滾 —— 這件事由 `--verify` 強制，不是靠自律。

用法：
    yml_shape_normalize.py --module full_text_annotate --dry-run
    yml_shape_normalize.py --module full_text_annotate
    yml_shape_normalize.py --module full_text_annotate --verify
"""
from __future__ import annotations

import argparse
import collections
import pathlib
import re
import sys

import yaml

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
LESSONS = REPO_ROOT / "backend" / "data" / "lessons"
HEADER_KEYS = {"lesson_uid", "version_id", "section_no"}

#: 收進 notes 的固定欄位名
NOTES_KEY = "notes"

#: 註解型欄位的樣態。**保守 —— 寧可漏收，不可誤收**：誤收會把真資料搬走，
#: 而漏收只是形狀數少降一點。所以這裡只認明確的註解字尾/字首，
#: 不用「看起來像說明」這種模糊判斷。
NOTEISH = re.compile(r"(note|說明|備註)$|^_|_ref$|errata|carrier|scope", re.IGNORECASE)

#: ⛔ 這三個模組有人正在改，不碰（Young 2026-08-21：不要去動其他人的）
#:    spotlight / keypoints → @stgst
#:    key_reading           → @if-else-master（正在刪 v2 修 v3）
CLAIMED = {"spotlight", "keypoints", "key_reading"}


def payload_container(data: dict, stem: str):
    """回傳 (容器 dict, 說明字串)，找不到就 (None, 原因)。

    大多數檔是 `{header..., <stem>: {...}}`，但有些直接把欄位攤在 top-level。
    兩種都要處理 —— 只認第一種會讓攤平的那批被靜默跳過，
    然後「處理了 N 課」這個數字看起來很好，實際上漏了一半。
    """
    for candidate in (stem, stem.rstrip("s"), stem + "s"):
        if isinstance(data.get(candidate), dict):
            return data[candidate], f"nested:{candidate}"
    rest = {k: v for k, v in data.items() if k not in HEADER_KEYS}
    if len(rest) == 1:
        only_key = next(iter(rest))
        if isinstance(rest[only_key], dict):
            return data[only_key], f"nested:{only_key}"
    if rest:
        return data, "flat"
    return None, "empty"


def leaf_values(obj) -> list[str]:
    """攤平出所有葉節點值，用來證明「只搬了鍵、沒動值」。

    排序後比對，因為搬動會改變走訪順序但不該改變值的集合。
    """
    out: list[str] = []
    stack = [obj]
    while stack:
        cur = stack.pop()
        if isinstance(cur, dict):
            stack.extend(cur.values())
        elif isinstance(cur, list):
            stack.extend(cur)
        else:
            out.append(repr(cur))
    return sorted(out)


def strip_suffix(key: str) -> str:
    """`char_count_note` → `char_count`；`_圈選note` → `圈選`。

    收進 notes 之後再帶 `_note` 字尾就變成 `notes.char_count_note`，
    贅字。但去完若撞名（已經有 `char_count`）就保留原名，不覆蓋。
    """
    k = re.sub(r"(_note|note|_說明|說明|_備註|備註)$", "", key, flags=re.IGNORECASE)
    k = k.lstrip("_")
    return k or key


def normalise_one(path: pathlib.Path, stem: str, dry_run: bool) -> dict | None:
    try:
        raw = path.read_text(encoding="utf-8")
        data = yaml.safe_load(raw) or {}
    except Exception as exc:
        return {"path": str(path), "error": f"讀不到: {exc}"}
    if not isinstance(data, dict):
        return None

    container, how = payload_container(data, stem)
    if container is None:
        return None

    moved: dict[str, object] = {}
    for key in list(container.keys()):
        if key == NOTES_KEY:
            continue
        value = container[key]
        # dict 不動 —— 巢狀結構多半是真資料，即使名字裡有 note
        if isinstance(value, dict):
            continue
        if not NOTEISH.search(str(key)):
            continue
        moved[key] = value

    if not moved:
        return None

    before = leaf_values(data)

    existing = container.get(NOTES_KEY)
    notes: dict[str, object] = dict(existing) if isinstance(existing, dict) else {}
    for key, value in moved.items():
        target = strip_suffix(str(key))
        # 撞名就保留原鍵名，不覆蓋既有的 —— 覆蓋等於弄丟一個值
        if target in notes:
            target = str(key)
        notes[target] = value
        del container[key]
    container[NOTES_KEY] = notes

    after = leaf_values(data)
    if before != after:
        # 這裡就擋下來，不要等 --verify 才發現 —— 那時候檔案已經寫壞了
        return {"path": str(path), "error": "值變了，已中止此檔", "moved": list(moved)}

    if not dry_run:
        path.write_text(
            yaml.safe_dump(data, allow_unicode=True, sort_keys=False, width=4096),
            encoding="utf-8",
        )
    return {"path": str(path.relative_to(REPO_ROOT)), "moved": sorted(moved), "how": how}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--module", required=True, help="只處理這一個模組")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--allow-claimed", action="store_true",
                    help="強制處理有人認領的模組（預設拒絕）")
    args = ap.parse_args()

    if args.module in CLAIMED and not args.allow_claimed:
        print(f"⛔ `{args.module}` 目前有人在改，這支預設不碰。", file=sys.stderr)
        print("   spotlight / keypoints → @stgst；key_reading → @if-else-master", file=sys.stderr)
        return 2

    files = sorted(LESSONS.glob(f"L*/v3/{args.module}.yml"))
    if not files:
        # 掃不到檔要當錯誤，不要印「處理 0 課」看起來像做完了
        print(f"🔴 找不到任何 {args.module}.yml", file=sys.stderr)
        return 2

    results = [r for r in (normalise_one(f, args.module, args.dry_run) for f in files) if r]
    errors = [r for r in results if "error" in r]
    changed = [r for r in results if "error" not in r]

    tag = "DRY-RUN" if args.dry_run else "已寫入"
    print(f"[{tag}] {args.module}: 掃 {len(files)} 課，動到 {len(changed)} 課")
    field_freq = collections.Counter(k for r in changed for k in r["moved"])
    for key, count in field_freq.most_common(12):
        print(f"    {count:>4} 課  {key}")
    if len(field_freq) > 12:
        print(f"    …另外 {len(field_freq) - 12} 種欄位")
    if errors:
        print(f"\n🔴 {len(errors)} 份出錯，未寫入：")
        for e in errors[:5]:
            print(f"    {e['path']}: {e['error']}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
