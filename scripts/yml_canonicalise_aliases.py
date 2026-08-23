#!/usr/bin/env python3
"""把同義的欄位名收斂到消費端真正在讀的那一個（#2843）。

跟 `yml_shape_normalize.py` 是兩件不同的事，刻意分開：

    yml_shape_normalize.py   收攏「註解」—— 靠樣態判斷，可以自動化
    這一支                     收斂「同義欄位」—— 靠人決定，必須查過消費端

同義欄位不能用啟發式判斷。`target_strategy` 跟 `strategy_line` 是同一件事，
`char_count` 跟 `paragraph_count` 不是 —— 機器分不出來，所以對照表是資料
（`specs/modules/field-aliases.yml`），不是規則。

## 安全前提（表裡每一條都要先確認過）

- 別名與正名**型別相同**。純量變 list 是改結構不是改名，不放進這份表。
- 正名是消費端**真正在讀**的那一個（grep 確認過）。
- 一課同時有正名與別名時**保留正名**，別名收進 `notes`，絕不覆蓋。

用法：
    yml_canonicalise_aliases.py --module goal_box --dry-run
    yml_canonicalise_aliases.py --module goal_box
"""
from __future__ import annotations

import argparse
import collections
import pathlib
import sys

import yaml

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
LESSONS = REPO_ROOT / "backend" / "data" / "lessons"
ALIAS_MAP = REPO_ROOT / "specs" / "modules" / "field-aliases.yml"
HEADER_KEYS = {"lesson_uid", "version_id", "section_no"}
CLAIMED = {"spotlight", "keypoints", "key_reading"}


def payload_of(data: dict, stem: str):
    for candidate in (stem, stem.rstrip("s"), stem + "s"):
        value = data.get(candidate)
        if isinstance(value, dict):
            return value
        if isinstance(value, list) and value and isinstance(value[0], dict):
            return value[0]
    rest = {k: v for k, v in data.items() if k not in HEADER_KEYS}
    if len(rest) == 1:
        only = next(iter(rest.values()))
        if isinstance(only, dict):
            return only
    return rest


def canonicalise(path: pathlib.Path, stem: str, aliases: dict, dry_run: bool):
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    if not isinstance(data, dict):
        return None
    body = payload_of(data, stem)
    if not isinstance(body, dict):
        return None

    renamed: list[tuple[str, str]] = []
    parked: list[str] = []

    for canon, alias_list in aliases.items():
        for alias in alias_list:
            if alias not in body:
                continue
            value = body[alias]
            if canon in body:
                # 正名已經有值 —— 別名收進 notes，不覆蓋。覆蓋等於弄丟一個值。
                notes = body.get("notes")
                notes = dict(notes) if isinstance(notes, dict) else {}
                notes[alias] = value
                body["notes"] = notes
                parked.append(alias)
            else:
                if type(value) is not str:
                    # 表裡宣告過型別一致，遇到不一致就是表過期了，停手而不是硬改
                    return {"path": str(path), "error": f"{alias} 型別是 {type(value).__name__}，非 str"}
                body[canon] = value
                renamed.append((alias, canon))
            del body[alias]

    if not renamed and not parked:
        return None
    if not dry_run:
        path.write_text(
            yaml.safe_dump(data, allow_unicode=True, sort_keys=False, width=4096),
            encoding="utf-8",
        )
    return {
        "path": str(path.relative_to(REPO_ROOT)),
        "renamed": renamed,
        "parked": parked,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--module", required=True)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if args.module in CLAIMED:
        print(f"⛔ `{args.module}` 目前有人在改，這支不碰。", file=sys.stderr)
        return 2

    table = yaml.safe_load(ALIAS_MAP.read_text(encoding="utf-8")) or {}
    aliases = table.get(args.module)
    if not aliases:
        print(f"🔴 `{args.module}` 不在 {ALIAS_MAP.name} 裡 —— 別名要人決定，不猜。", file=sys.stderr)
        return 2

    files = sorted(LESSONS.glob(f"L*/v3/{args.module}.yml"))
    if not files:
        print(f"🔴 找不到任何 {args.module}.yml", file=sys.stderr)
        return 2

    results = [r for r in (canonicalise(f, args.module, aliases, args.dry_run) for f in files) if r]
    errors = [r for r in results if "error" in r]
    changed = [r for r in results if "error" not in r]

    tag = "DRY-RUN" if args.dry_run else "已寫入"
    print(f"[{tag}] {args.module}: 掃 {len(files)} 課，動到 {len(changed)} 課")
    freq = collections.Counter(f"{a} → {c}" for r in changed for a, c in r["renamed"])
    for label, count in freq.most_common():
        print(f"    {count:>3} 課  {label}")
    parked = collections.Counter(a for r in changed for a in r["parked"])
    for alias, count in parked.most_common():
        print(f"    {count:>3} 課  {alias} → notes（正名已有值，不覆蓋）")
    if errors:
        print(f"\n🔴 {len(errors)} 份出錯，未寫入：")
        for e in errors[:5]:
            print(f"    {e['path']}: {e['error']}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
