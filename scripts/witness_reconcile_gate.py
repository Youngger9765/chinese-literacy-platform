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


def yml_items(path: pathlib.Path, module: str) -> list | None:
    try:
        doc = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except (OSError, yaml.YAMLError):
        return None
    body = doc.get(module, doc)
    if not isinstance(body, dict):
        return None
    items = body.get("items")
    if items is None:
        items = body.get("questions")
    return items if isinstance(items, list) else None


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

    items = yml_items(args.yaml, args.module)
    if items is None:
        print(f"⛔ {args.yaml} 讀不到 items —— 那是抽失敗，不是零題", file=sys.stderr)
        return 2

    esw = _witnesses_mod()
    ws = esw.witnesses(args.pdf, pages, args.section)
    src_items = [w for w in ws if w["kind"] == "item"]

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
