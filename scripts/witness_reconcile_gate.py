#!/usr/bin/env python3
"""對帳：來源上有幾題，yml 就要有幾題（#2865）。

## 這道門解決的是「球員兼裁判」

在它之前，飛機自己說「我看到 5 題，都抽了」—— 那個 5 是**它自己數的**。
少看到 3 題、回報「3 題都抽了」，形狀門一樣全綠，因為門只問
「你交的東西長得像不像 yml」，沒有人問「來源上到底有幾題」。

```
🔧 extract_source_witnesses.py   從原稿數出目標清單     ← LLM 碰不到
🤖 飛機                          抽內容                ← 只是球員
🔧 這一支                        逐一對帳              ← LLM 碰不到
```

裁判自己也要被驗：拿 12 課已知答案的課校準，一致 12/12。
（第一版只有 7/12，露餡的原因是三個真問題 —— 標題後有字、序號後空格過多、
跨頁續頁沒標題被整頁跳過。修的是那三個，不是調參數。）

## 這道門**不**證明什麼

- ⛔ 不證明內容抄對了（那是 verbatim_gate 的事，它要原稿，CI 跑不了）
- ⛔ 不證明答案判對了
- 它只證明**沒有整題被靜默丟掉** —— 而那正是飛機少讀一頁時的失敗形狀

## 用法

    python3 scripts/witness_reconcile_gate.py \\
        --uid L0072 --module vocab_definitions \\
        --pdf /tmp/L0072/src.pdf --section 語詞我最棒 \\
        --yaml backend/data/lessons/L0072/v3/vocab_definitions.yml

exit 0 = 來源題數 == yml 題數
exit 1 = 對不上 —— ⛔ 不要落地，先查是漏抽還是多抽
exit 2 = 材料不齊（讀不到 PDF / yml / 數不出見證）
        ⚠️ 這**不是**通過。沒驗到跟驗過是兩件事。
"""
from __future__ import annotations

import argparse
import importlib.util
import pathlib
import sys

import yaml

REPO = pathlib.Path(__file__).resolve().parents[1]


def _witnesses_mod():
    spec = importlib.util.spec_from_file_location(
        "esw", REPO / "scripts" / "extract_source_witnesses.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


#: 有題號型內容的模組（實測全庫 2019 份 yml 分類的結果）。
#: 只有這 7 個適用「來源幾題 == yml 幾題」的對帳 —— 其餘 14 個模組的內容
#: 不是編號題目（課文段落、重點表格、聚光燈 block、找字表…），
#: ⛔ 對它們喊「讀不到 items = 抽失敗」是**假警報**，會讓人學會忽略這道門。
#: ⛔ `self_check_before_reading` / `goal_box` / `multi_text_parts` /
#: `cross_text_banner` 也不在：它們是**無編號元素**（跨大題的框），
#: 派工單裡本來就沒有它們的節名（實測 58/58、70/70、4/4、2/2 課皆然）。
#: 對它們喊「派工單沒有節名，驗不了」會讓 31 課無故變紅。
#:
#: ⛔ `resources`（知識補給站）**刻意不在名單裡**：它的內容是 QR 圖與影片連結，
#: 文字層數不到。實測 26 課只對 20 課（77%），而錯的那 6 課都不是資料壞，
#: 是文字層本來就沒有那些編號。判準訂錯比沒有判準更糟。
NUMBERED_MODULES = {
    "comprehension",                 # 172 份
    "vocab_definitions",             # 150 份
    "vocab_application",             # 149 份
    "word_matching",                 #  11 份
    "keypoints_followup_questions",  #   2 份
}


def yml_items(path: pathlib.Path, module: str) -> list | None:
    try:
        doc = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except (OSError, yaml.YAMLError):
        return None
    body = doc.get(module, doc)
    if not isinstance(body, dict):
        return None
    # 載體不只一種（實測 resources：items+videos 120 課、只有 videos 19 課、只有 items 9 課）。
    # 只認 items 的話，那 19 課會被報成「抽失敗」—— 假警報比沒有門更糟。
    for key in ("items", "questions", "videos"):
        v = body.get(key)
        if isinstance(v, list):
            return v
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--uid", required=True)
    ap.add_argument("--module", required=True)
    ap.add_argument("--pdf", required=True, type=pathlib.Path)
    ap.add_argument("--section", required=True, help="大題名稱，如「語詞我最棒」")
    ap.add_argument("--yaml", required=True, type=pathlib.Path)
    ap.add_argument("--pages", default=None,
                    help="逗號分隔。不給就從派工單的 dispatch_pages 取")
    args = ap.parse_args()

    if not args.pdf.is_file():
        print(f"⛔ 讀不到 PDF：{args.pdf}", file=sys.stderr)
        return 2

    if args.pages:
        pages = [int(x) for x in args.pages.split(",") if x.strip()]
    else:
        mf = REPO / "backend" / "data" / "lessons" / args.uid / "v3" / "_manifest.yml"
        if not mf.is_file():
            print(f"⛔ 沒有派工單也沒給 --pages：{mf}", file=sys.stderr)
            return 2
        m = yaml.safe_load(mf.read_text(encoding="utf-8")) or {}
        pages = (m.get("dispatch_pages") or {}).get(args.module) or []
        if not pages:
            print(f"⛔ 派工單沒有 {args.module} 的頁碼 —— 不能當成「這節沒題目」",
                  file=sys.stderr)
            return 2

    # 多文本課：同一個模組對應到兩個以上大題（兩篇各一節），`dispatch_pages`
    # 是兩篇的**聯集**，而兩篇的題號各自從 1 開始 —— 逐一對帳在這裡沒有意義。
    # ⚠️ 回 0 是「不適用」不是「驗過了」，訊息要講清楚。
    # 實測全庫 4 課有 `篇次`（L0029/L0063/L0137/L0144）。
    mf_path = REPO / "backend" / "data" / "lessons" / args.uid / "v3" / "_manifest.yml"
    if mf_path.is_file():
        _m = yaml.safe_load(mf_path.read_text(encoding="utf-8")) or {}
        _same = [x for x in (_m.get("sections") or []) if x.get("module") == args.module]
        if len(_same) > 1:
            print(f"  ⬜ {args.uid} 的 {args.module} 對應到 {len(_same)} 個大題（多文本課），"
                  "頁碼是聯集、題號各篇從 1 開始 —— 這道門不適用")
            print("     ⚠️ 這**不代表**它被驗過。多文本要逐篇對帳，那還沒做。")
            return 0

    if args.module not in NUMBERED_MODULES:
        # 這個模組的內容不是編號題目 —— 這道門對它沒有意義。
        # ⚠️ 回 0 不是「驗過了」，是「不適用」。訊息要講清楚，
        # 否則下一個人會以為這個模組的內容被驗過了。
        print(f"  ⬜ {args.module} 不是題號型模組，這道門不適用（{len(NUMBERED_MODULES)} "
              f"個模組適用：{', '.join(sorted(NUMBERED_MODULES))}）")
        print("     ⚠️ 這**不代表**它的內容被驗過 —— 那要靠逐字門。")
        return 0

    items = yml_items(args.yaml, args.module)
    if items is None:
        print(f"⛔ {args.yaml} 讀不到 items —— 那是抽失敗，不是零題", file=sys.stderr)
        return 2

    esw = _witnesses_mod()
    ws = esw.witnesses(args.pdf, pages, args.section)
    src_items = [w for w in ws if w["kind"] == "item"]

    unreliable = [w for w in ws if w["kind"] == "unreliable"]
    if unreliable:
        # 文字順序還原不出版面順序 —— 這道門在這一頁上沒有判斷力。
        # ⛔ 回 2（材料不齊）不是 1（對不上），也不是 0。
        print(f"  🟡 {args.uid} · {args.module}：{unreliable[0]['text']}")
        print("     這道門在這一頁上驗不了。⛔ 這**不是**通過，也不是「抽錯了」。")
        print("     要驗只能回原稿人工看，或換一個不靠文字順序的做法。")
        return 2

    if not ws:
        print(f"⛔ 在第 {pages} 頁數不到任何見證 —— 頁碼可能錯了。"
              "⛔ 不可以當成通過", file=sys.stderr)
        return 2

    src_ns = sorted(w["n"] for w in src_items)
    yml_ns = sorted(
        i.get("index") for i in items
        if isinstance(i, dict) and isinstance(i.get("index"), int)
    )

    print(f"  {args.uid} · {args.module} · 第 {pages} 頁")
    print(f"    來源數到 {len(src_ns)} 題  {src_ns}")
    print(f"    yml 有   {len(yml_ns)} 題  {yml_ns}")

    if len(src_ns) != len(items):
        missing = sorted(set(src_ns) - set(yml_ns))
        extra = sorted(set(yml_ns) - set(src_ns))
        print(f"\n🔴 對不上：來源 {len(src_ns)} 題，yml {len(items)} 題")
        if missing:
            print(f"   來源有、yml 沒有（漏抽）：{missing}")
        if extra:
            print(f"   yml 有、來源沒有（多抽或抽到隔壁節）：{extra}")
        print("   ⛔ 不要落地。")
        return 1

    if src_ns != yml_ns:
        print(f"\n🔴 題數相同但編號對不上：來源 {src_ns} / yml {yml_ns}")
        print("   ⛔ 數量相同不代表抽對了 —— 可能整段錯位。")
        return 1

    print(f"\n✅ 來源與 yml 逐題對得上（{len(src_ns)} 題）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
