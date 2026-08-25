#!/usr/bin/env python3
"""學習單上印的每一個大題，都要有著落（#2876）。

## 這道門補的洞

前面那些門問的都是「**抽出來的東西對不對**」：

    schema      形狀對嗎
    逐字門      抄的字對嗎
    見證對帳    題號數對嗎

沒有一道問「**該有的東西在不在**」—— 一整個大題被漏抽，上面三道全是綠的，
因為它們只檢查已經存在的東西。

這道門從另一頭問：學習單自己印的目錄（`sections_present`）列了 N 個大題，
每一個都找得到對應的產出嗎？

## 三種合法的著落

    ① 有自己的頂層 yml         多數大題
    ② 住在別的模組裡           「閱讀接力」在 multi_text_parts[].reading_relay
                               —— 跨篇的題目不屬於任何單一篇
    ③ 對照表沒有這個名字       🔴 這不是著落，是缺口

⚠️ ③ 是最容易被忽略的：對照表少一個字（「文章重點表」vs「文章重點整理」）
就會讓 6 課的那一節在這道門眼裡消失，而**不會有任何症狀** ——
內容其實在 keypoints.yml 裡，只是沒有人對得起來。

## ⛔ 它不保證什麼

「有對應的 yml」不等於「那一節的內容都抽進去了」。
一節有 8 題只抽了 6 題，這道門是綠的（那是見證對帳的事）。
它只擋「整個大題不見了」這一種。
"""
from __future__ import annotations

import argparse
import pathlib
import sys

import yaml

REPO = pathlib.Path(__file__).resolve().parent.parent
LESSONS = REPO / "backend" / "data" / "lessons"
MAP = REPO / "specs" / "modules" / "section-to-module.yml"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--uid", help="只驗一課")
    a = ap.parse_args()

    doc = yaml.safe_load(MAP.read_text(encoding="utf-8"))
    matches = doc["matches"]
    inside = {x["needle"] for x in doc.get("lives_inside", [])}
    # 印在紙上、線上還沒做的大題（見對照表 not_built_yet）。
    # ⛔ 不是豁免 —— 照樣列出來，只是跟「沒注意到的漏洞」分開報。
    deferred = {x["needle"]: x.get("why", "") for x in doc.get("not_built_yet", [])}

    def to_mod(name: str):
        for m in matches:
            if m["needle"] in name:
                return m["module"]
        return None

    unmapped: dict[str, list[str]] = {}
    known: dict[str, list[str]] = {}
    missing: list[str] = []
    total = 0
    lessons = 0

    files = sorted(LESSONS.glob("L*/v3/lesson.yml"))
    if a.uid:
        files = [f for f in files if f.parent.parent.name == a.uid]
    if not files:
        print("⛔ 沒有要驗的課", file=sys.stderr)
        return 2

    for ly in files:
        uid = ly.parent.parent.name
        d = yaml.safe_load(ly.read_text(encoding="utf-8")) or {}
        secs = d.get("sections_present") or []
        if not secs:
            continue
        lessons += 1
        for s in secs:
            name = s["name"] if isinstance(s, dict) else str(s)
            total += 1
            if any(k in name for k in inside):
                continue
            mod = to_mod(name)
            if not mod:
                hit = next((k for k in deferred if k in name), None)
                if hit:
                    known.setdefault(hit, []).append(uid)
                else:
                    unmapped.setdefault(name, []).append(uid)
            # 檔名帶各自的 slug（`{模組}.{slug}.yml`，#2916），一課可能有好幾份。
            # ⛔ 別寫死 `{mod}.yml` —— 改名之後 1474 個大題會全數被判成
            #    「檔案不存在」，而檔案全都在。這道門會變成整片紅，
            #    紅到沒有人看，然後真的缺檔那天也不會有人發現。
            elif not any(ly.parent.glob(f"{mod}.*.yml")):
                missing.append(f"{uid}/{name} → {mod}.*.yml 一份都沒有")

    print(f"  {lessons} 課 · 學習單宣告的大題 {total} 個")
    bad = False
    if known:
        n = sum(len(v) for v in known.values())
        print(f"  🟡 {n} 個大題是**已知還沒做**的（不是漏抽，有具名理由）：")
        for k, us in sorted(known.items(), key=lambda x: -len(x[1])):
            print(f"      「{k}」 {len(us)} 課   例 {us[:3]}")
            print(f"         理由：{deferred[k].strip().splitlines()[0]}")
    if unmapped:
        print(f"  🔴 {sum(len(v) for v in unmapped.values())} 個大題對不到模組：")
        for n, us in sorted(unmapped.items(), key=lambda x: -len(x[1])):
            print(f"      「{n}」 {len(us)} 課   例 {us[:3]}")
        print("     ⛔ 這不是「那一節沒有內容」——多半是對照表少了這個名字，"
              "而內容其實在某個 yml 裡、只是沒有人對得起來。")
        bad = True
    if missing:
        print(f"  🔴 {len(missing)} 個大題有對應模組但檔案不存在：")
        for m in missing[:10]:
            print(f"      {m}")
        bad = True

    if total == 0:
        print("  ⛔ 一個大題都沒檢查到 —— 那是沒驗到，不是通過", file=sys.stderr)
        return 2
    if not bad:
        print("  SECTION_COMPLETENESS=PASS  （每一個大題都有著落）")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
