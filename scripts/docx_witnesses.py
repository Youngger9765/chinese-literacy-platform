#!/usr/bin/env python3
"""從 DOCX 的 XML 直接數見證 —— 給「pdftotext 還原不出版面順序」的頁用（#2868）。

## 為什麼要第二個來源

`extract_source_witnesses.py` 讀的是 `pdftotext` 的輸出，而那是**排版之後**的
產物：42 個模組所在的頁，pdftotext 吐出的順序是亂的（實測 L0038 p3：自己的
標題排在自己的題目和下一節之後），三種模式都一樣。任何靠「文字位置切節」的
規則在那些頁上都是錯的。

`word/document.xml` 的 `<w:t>` 流是**文件順序**，沒有經過排版。實測 L0038
九個大題的段落序號單調遞增，三個模組的題號集合與 yml 逐一相符。

## ⛔ 它不取代 PDF 那條路

兩條路各有各的盲區：

| | PDF（pdftotext） | DOCX XML |
|---|---|---|
| 看得到 | 印出來的樣子 | 文件順序 |
| 看不到 | 版面被重排時的真實順序 | 畫在圖上的文字、Word 自動編號 |

Word 的自動編號由 `numbering.xml` 產生，**不在 `<w:t>` 裡** —— 所以某些課
XML 會少數到題號。因此這支是**第二意見**：兩邊一致才是高信心，只有一邊有
答案時標明是哪一邊給的，兩邊不一致就是 unknown（不猜）。

## 🔴 段落不可以用 `<w:p .*?</w:p>` 切

文字方塊裡有巢狀 `<w:p>`，非貪婪比對會在**內層**的 `</w:p>` 收尾，把外層段落
後面的文字整段丟掉 —— L0038 的閱讀理解第 3 題就是這樣消失的，而我差點把它
當成「原稿真的沒有第 3 題」報上去。用 `</w:p>` 當斷點就沒有這個問題
（內層也斷，對數題號無害）。
"""
from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys
import zipfile

# 跟 extract_source_witnesses.py 同一條，刻意不共用 import ——
# 兩支要能各自被驗，共用會讓「兩個獨立來源」變成一個。
ITEM_RE = re.compile(r"[（(]\s*(\d{1,2})\s*[）)]|(?:^|[\s）)])(\d{1,2})[.．、](?!\d)")


def docx_paragraphs(docx: pathlib.Path) -> list[str]:
    """回傳文件順序的段落文字。"""
    with zipfile.ZipFile(docx) as z:
        xml = z.read("word/document.xml").decode("utf-8", "ignore")
    xml = xml.replace("</w:p>", "\x00")
    xml = re.sub(r"<w:tab[^>]*/>", " ", xml)
    out = []
    for chunk in xml.split("\x00"):
        t = "".join(re.findall(r"<w:t[^>]*>([^<]*)</w:t>", chunk)).strip()
        if t:
            out.append(t)
    return out


def section_span(paras: list[str], name: str, next_name: str | None) -> tuple[int, int] | None:
    """這一節從哪個段落到哪個段落。找不到起點就回 None（⛔ 不猜）。"""
    starts = [i for i, t in enumerate(paras) if name in t]
    if not starts:
        return None
    lo = starts[0]
    if next_name:
        after = [i for i, t in enumerate(paras) if next_name in t and i > lo]
        hi = after[0] if after else len(paras)
    else:
        hi = len(paras)
    return lo + 1, hi


def item_numbers(paras: list[str], span: tuple[int, int]) -> list[int]:
    lo, hi = span
    nums: set[int] = set()
    for t in paras[lo:hi]:
        for a, b in ITEM_RE.findall(t):
            nums.add(int(a or b))
    return sorted(nums)


def count(docx: pathlib.Path, section: str, next_section: str | None) -> dict:
    paras = docx_paragraphs(docx)
    span = section_span(paras, section, next_section)
    if span is None:
        return {"status": "unknown", "why": f"XML 裡找不到「{section}」這個標題"}
    nums = item_numbers(paras, span)
    if not nums:
        return {"status": "unknown", "why": "這一節抓不到任何題號"
                                            "（多半是 Word 自動編號，不在 w:t 裡）",
                "span": list(span)}
    return {"status": "ok", "numbers": nums, "count": len(nums), "span": list(span)}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--docx", required=True, type=pathlib.Path)
    ap.add_argument("--section", required=True)
    ap.add_argument("--next-section", default=None)
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    if not a.docx.is_file():
        print(f"⛔ 讀不到原稿：{a.docx}", file=sys.stderr)
        return 2
    r = count(a.docx, a.section, a.next_section)
    print(json.dumps(r, ensure_ascii=False) if a.json
          else f"  {a.section}: {r.get('status')} {r.get('numbers', r.get('why'))}")
    return 0 if r["status"] == "ok" else 1


if __name__ == "__main__":
    raise SystemExit(main())
