#!/usr/bin/env python3
"""每個模組「少了它就等於沒做」的欄位在不在（#2843）。

⛔ **這不是新的一道門** —— 是把「什麼叫做完」寫下來，在既有的 verify
步驟裡順手檢查。判準在 `specs/modules/essential-fields.yml`，來自實測。

## 為什麼需要

L0011 第一次用新架構完整抽完，**八道門全綠**，但三個模組抽得比現有薄
（`key_reading` 沒 `passage`、`resources` 用錯載體鍵、
`full_text_annotate` 漏 `inline_marked_terms`）。

schema 的 `required` 擋不住（它只要求最低限度）、逐字門只驗「有寫的抄得對不對」、
見證對帳只數題號。**沒有任何一道會說「你少抽了一欄」。**
"""
from __future__ import annotations

import argparse
import pathlib
import sys

import yaml

REPO = pathlib.Path(__file__).resolve().parent.parent
LESSONS = REPO / "backend" / "data" / "lessons"
SPEC = REPO / "specs" / "modules" / "essential-fields.yml"


def _body(f: pathlib.Path, mod: str) -> dict | None:
    try:
        d = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
    except (OSError, yaml.YAMLError):
        return None
    b = d.get(mod)
    return b if isinstance(b, dict) else (d if isinstance(d, dict) else None)


def _has(b: dict, k: str) -> bool:
    return b.get(k) not in (None, [], {}, "")


def check(uid: str, mod: str, rules: dict,
          src_dir: pathlib.Path | None = None) -> list[str]:
    """`src_dir` 指向剛抽出來的產出目錄。

    🔴 沒有它的話，管線 verify 的時候這支會去讀**語料庫**而不是這一輪的產出 ——
    於是它驗的是舊資料，對新抽的東西一句話都沒說。實測踩過：
    我那份 L0011 的 key_reading 根本沒有 passage，它照樣回 ✅。
    **一道檢查別的東西的門，比沒有門更危險。**
    """
    f = (src_dir / f"{mod}.yml") if src_dir else (LESSONS / uid / "v3" / f"{mod}.yml")
    if not f.is_file():
        return []
    b = _body(f, mod)
    if b is None:
        return [f"{uid}/{mod}: 讀不到內容"]
    exc = rules.get("except") or {}
    out = []
    for k in rules.get("all") or []:
        if not _has(b, k):
            out.append(f"{uid}/{mod}: 缺 `{k}`")
    for group in rules.get("any_of") or []:
        if any(_has(b, k) for k in group):
            continue
        # 宣告過的例外課不算缺
        skip = False
        for k in group:
            e = exc.get(k) or {}
            if uid in (e.get("uids") or []):
                skip = True
            # `uids_count_max`：那些課是「原稿真的沒有」不是抽漏，逐課列沒有意義
            # （會變成一張要人維護的名單）。改成**數量上限** —— 個別課不報，
            # 但總數漲了就代表有人開始漏抽了。⛔ 這是刻意放寬到「可偵測」而不是
            # 「零容忍」：訂太嚴會對 18 課誤報，而會誤報的門最後會被關掉。
            if e.get("uids_count_max") is not None:
                skip = True
                _tally.setdefault(f"{mod}.{k}", []).append(uid)
        if not skip:
            out.append(f"{uid}/{mod}: {group} 一個都沒有")
    return out


#: 走 uids_count_max 那條的，累計起來最後一起判
_tally: dict[str, list[str]] = {}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--uid")
    ap.add_argument("--dir", type=pathlib.Path, default=None,
                    help="改讀這個目錄裡的產出（管線 verify 用；需搭 --uid）")
    a = ap.parse_args()

    spec = yaml.safe_load(SPEC.read_text(encoding="utf-8"))
    mods = spec["modules"]
    uids = sorted(p.parent.parent.name for p in LESSONS.glob("L*/v3/lesson.yml"))
    if a.uid:
        uids = [u for u in uids if u == a.uid]
    if not uids:
        print("⛔ 沒有要驗的課", file=sys.stderr)
        return 2

    if a.dir and not a.uid:
        print("⛔ --dir 必須搭 --uid（一個產出目錄只屬於一課）", file=sys.stderr)
        return 2

    problems: list[str] = []
    checked = 0
    for u in uids:
        for mod, rules in mods.items():
            base = a.dir if a.dir else (LESSONS / u / "v3")
            if (base / f"{mod}.yml").is_file():
                checked += 1
                problems += check(u, mod, rules, a.dir)

    if checked == 0:
        print("⛔ 一個模組都沒檢查到 —— 那是沒驗到，不是通過", file=sys.stderr)
        return 2

    print(f"  {len(uids)} 課 · 檢查 {checked} 個模組實例")
    # uids_count_max 的總數判斷
    for key, uids_hit in sorted(_tally.items()):
        mod, field = key.split(".", 1)
        cap = ((mods[mod].get("except") or {}).get(field) or {}).get("uids_count_max")
        if cap is not None and len(uids_hit) > cap:
            problems.append(
                f"{mod}.{field} 缺的課從上限 {cap} 漲到 {len(uids_hit)} —— "
                f"有人開始漏抽了：{sorted(uids_hit)[:6]}")

    if problems:
        print(f"  🔴 {len(problems)} 個模組少了必要欄位：")
        for p in problems[:20]:
            print(f"      {p}")
        if len(problems) > 20:
            print(f"      …還有 {len(problems) - 20} 個")
        return 1
    print("  ESSENTIAL_FIELDS=PASS  （每個模組該有的欄位都在）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
