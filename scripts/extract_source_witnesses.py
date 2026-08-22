#!/usr/bin/env python3
"""從原稿數出「這一節該有幾個目標」—— 決定性，不經 LLM（#2865）。

## 為什麼要有這支：避免球員兼裁判

現在的流程是**飛機自己說「我看到 5 題，都抽了」** —— 那 5 是它自己數的。
它少看到 3 題、回報「3 題都抽了」，形狀門一樣全綠，因為門只驗
「你交的東西長得像不像 yml」，沒有人問「來源上到底有幾題」。

所以裁判必須在球員之外：

```
起飛前  🔧 腳本從原稿數出目標清單並編號   ← 這支
飛行中  🤖 飛機抽內容，回填「我對到哪幾個」
落地後  🔧 腳本逐一對帳，對不上就失敗     ← witness_reconcile_gate.py
```

見證清單**不由 LLM 產生、數量不由 LLM 決定**，這是整個設計唯一重要的地方。

## 材料：`-layout` 原文，不是 normalise 過的

`build_section_pages.normalise()` 會把標點與空白全部洗掉（它只需要比對標題字串）。
洗完之後 `(1) 質疑：對某件事…` 變成 `1質疑對某件事…`，題號跟內文的數字混在一起，
數不出來。所以這支直接讀 `pdftotext -layout` 的原文。

## 見證型別

| 型別 | 怎麼認 | 用在哪 |
|---|---|---|
| `item` | 行首的 `(N)` / `N.` / `（N）` | 有編號題目的模組（語詞我最棒、閱讀理解…） |
| `heading` | 大題序號 + 標題 | 確認飛機真的在對的那一節上 |
| `bank` | 「本課語詞」這類框標題 | 有語詞框的模組 |

⚠️ **`item` 只認行首** —— 內文裡的 `例如：這間教室可以容納 30 位` 不會被誤認成題號，
因為它不在行首。這條規則是看著真實版面訂的，不是憑感覺。

## 用法

    python3 scripts/extract_source_witnesses.py --pdf x.pdf --pages 3 --uid L0072
    python3 scripts/extract_source_witnesses.py --pdf x.pdf --pages 3,4 --json

exit 0 = 數出來了（至少一個見證）
exit 1 = 一個見證都沒有 —— 那多半是頁碼錯了或這頁沒有這一節，⛔ 不要當成「這節沒題目」
exit 2 = 材料不齊
"""
from __future__ import annotations

import argparse
import json
import pathlib
import re
import subprocess
import sys

#: 題號。⚠️ **不能只認行首** —— 雙欄排版下右欄的題號在行中間
#: （實測 L0072 第 3 頁：`(1)` 跟 `(4)` 在同一行、`(5)` 在行中間）。
#: 只認行首會漏掉整個右欄，而漏掉的部分不會有任何症狀。
ITEM_RE = re.compile(r"[（(](\d{1,2})[）)]")

#: 大題標題：行首的序號 + 名稱。
#: 序號含注音「ㄧ」—— 9 課的原稿真的是注音，那是老師打的不是錯字。
#:
#: ⚠️ 三個放寬都是校準時被真實版面打臉才加的（12 課裡 5 課因此數錯）：
#:   - 空格數不設上界：L0001 p3 是「四」+ 10 個空格 +「語詞應用」
#:   - 標題後面允許還有字：L0012 p4 是「四  語詞應用   在空格填入正確的語詞代號」
#:   - 名稱只吃非空白：避免把後面那串說明一起吃進來
HEADING_RE = re.compile(r"^[ \t]*([一二三四五六七八九十ㄧ])[ \t]{1,20}(\S{2,12})", re.M)

#: 語詞框標題
BANK_RE = re.compile(r"(本課語詞|語詞框|參考語詞)")


def page_text(pdf: pathlib.Path, page: int) -> str:
    r = subprocess.run(
        ["pdftotext", "-layout", "-f", str(page), "-l", str(page), str(pdf), "-"],
        capture_output=True, text=True, timeout=120,
    )
    return r.stdout if r.returncode == 0 else ""


def witnesses(pdf: pathlib.Path, pages: list[int], section: str | None = None) -> list[dict]:
    """數出這幾頁上的見證。給 `section` 就只數那一節的。

    🔴 **一定要給 section**：一頁上幾乎一定有別的大題（實測 150 筆派工，
    100% 的課至少與別的大題共用一頁）。不分節就會把隔壁節的題號算進來 ——
    L0072 第 3 頁不分節會數到 9 個，分節之後是「語詞我最棒 5、語詞應用 4」。
    """
    out: list[dict] = []
    started = False  # 這一節的標題出現過了沒（跨頁續頁靠它判斷）
    for p in pages:
        text = page_text(pdf, p)
        if not text.strip():
            continue

        heads = [(m.start(), m.group(1), m.group(2)) for m in HEADING_RE.finditer(text)]
        for pos, no, name in heads:
            out.append({"id": f"p{p}-heading-{no}", "kind": "heading",
                        "page": p, "text": f"{no} {name}"})

        # 要數題號的範圍：指定節就取「該標題到下一個標題」，否則整頁
        ranges: list[tuple[int, int, str]] = []
        if section:
            for i, (pos, no, name) in enumerate(heads):
                if section in name or name in section:
                    end = heads[i + 1][0] if i + 1 < len(heads) else len(text)
                    ranges.append((pos, end, name))
                    started = True
            if not ranges:
                if started:
                    # 續頁：這一節從上一頁延續過來，續頁上**不會再印一次標題**。
                    # 範圍是「頁首 → 這頁第一個標題」（下一個大題開始的地方），
                    # 沒有標題就是整頁都還是我的。
                    # 校準時 L0009 p4 的題號 6–12 就是這樣整頁被丟掉的。
                    end = heads[0][0] if heads else len(text)
                    ranges.append((0, end, section))
                else:
                    # 還沒開始就沒有標題 = 頁碼錯了，不是「這節沒題目」。
                    # ⛔ 不可以退回「整頁都算」—— 那會把隔壁節的題目算成自己的。
                    continue
        else:
            ranges = [(0, len(text), "")]

        for lo, hi, name in ranges:
            seg = text[lo:hi]
            if BANK_RE.search(seg):
                out.append({"id": f"p{p}-bank", "kind": "bank", "page": p,
                            "text": BANK_RE.search(seg).group(1)})
            for n in sorted({int(m.group(1)) for m in ITEM_RE.finditer(seg)}):
                if not 1 <= n <= 30:
                    continue
                out.append({"id": f"p{p}-item-{n}", "kind": "item",
                            "page": p, "n": n, "section": name})

    seen, uniq = set(), []
    for w in out:
        if w["id"] in seen:
            continue
        seen.add(w["id"])
        uniq.append(w)
    return uniq


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf", required=True, type=pathlib.Path)
    ap.add_argument("--pages", required=True, help="逗號分隔，1-based，如 3 或 3,4")
    ap.add_argument("--uid", default="")
    ap.add_argument("--section", default=None,
                    help="大題名稱（如「語詞我最棒」）。⚠️ 幾乎一定要給 —— 一頁上通常還有別的大題")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    if not args.pdf.is_file():
        print(f"⛔ 讀不到 PDF：{args.pdf}", file=sys.stderr)
        return 2
    try:
        pages = [int(x) for x in args.pages.split(",") if x.strip()]
    except ValueError:
        print("⛔ --pages 格式不對", file=sys.stderr)
        return 2

    ws = witnesses(args.pdf, pages, args.section)
    if args.json:
        print(json.dumps(ws, ensure_ascii=False, indent=2))
    else:
        items = [w for w in ws if w["kind"] == "item"]
        print(f"  {args.uid or args.pdf.name} 第 {args.pages} 頁：{len(ws)} 個見證"
              f"（題目 {len(items)}）")
        for w in ws:
            print(f"    {w['id']:18} {w['kind']:8} {w.get('text', '')[:48]}")

    if not ws:
        print("🔴 一個見證都沒數到 —— 多半是頁碼錯了或這頁沒有這一節。"
              "⛔ 不要當成「這節本來就沒題目」", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
