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


ORDINAL = "一二三四五六七八九十ㄧ"
DUP_HEADING_WINDOW = 5   # 幾段以內視為同一個標題的複本（實測複本間距是 2）


def _heading_hits(paras: list[str], name: str) -> list[int]:
    """哪幾個段落**是這一節的標題**（而不是別處提到這幾個字）。

    🔴 只取「第一個含這個字串的段落」會出事：L0072 的「閱讀理解」四個字
    先出現在聚光燈那一節的說明裡（#31），真正的標題在 #200。用它當起點，
    整個聚光燈的編號都被算進閱讀理解，於是這道門會宣稱「原稿有 9 題、
    yml 只有 5 題」—— 而原稿其實正好 5 題。**我差點照這個開兩張缺陷票。**

    標題的形狀：段落很短（就是標題本身），而且上一段是序號（一二三…）
    或這一段自己以序號開頭。
    """
    raw = []
    for i, t in enumerate(paras):
        if name not in t or len(t) > len(name) + 8:
            continue
        prev = paras[i - 1].strip() if i else ""
        if (len(prev) == 1 and prev in ORDINAL) or (t[:1] in ORDINAL):
            raw.append(i)
    # 🔴 同一個標題常在 XML 裡出現兩次（文字方塊的複本，實測間距固定是 2），
    #    而多文本課的兩個「閱讀理解」隔了 100 段以上。不合併的話，
    #    「這個標題出現幾次」會把單文本課誤判成多文本 —— 那會讓多文本護欄
    #    把 40 個本來判得出來的模組一起關掉（假警報跟漏抓一樣會廢掉一道門）。
    out: list[int] = []
    for i in raw:
        if out and i - out[-1] <= DUP_HEADING_WINDOW:
            continue
        out.append(i)
    return out


def section_span(paras: list[str], name: str, next_name: str | None) -> tuple[int, int] | None:
    """這一節從哪個段落到哪個段落。找不到起點就回 None（⛔ 不猜）。

    ⚠️ 多文本課（同一個大題名出現好幾次，一篇一組）**不適用** ——
    第一個標題到下一節之間會橫跨第二、三篇，題號整片被算進來。
    L0144 有三篇、每篇各一個「閱讀理解」，這樣算會宣稱原稿有 5 題、
    yml 只有 4 題，而第一篇其實正好 4 題。呼叫端要自己擋（見 `count`）。
    """
    starts = _heading_hits(paras, name)
    if not starts:
        # 退而求其次：短段落且完全等於節名。⛔ 仍然不接受「內文裡提到」。
        starts = [i for i, t in enumerate(paras) if t.strip() == name]
    if not starts:
        return None
    lo = starts[0]
    ends = [i for i in _heading_hits(paras, next_name) if i > lo] if next_name else []
    if next_name and not ends:
        ends = [i for i, t in enumerate(paras) if t.strip() == next_name and i > lo]
    hi = ends[0] if ends else len(paras)
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
    # 多文本課：同一個大題名在原稿裡出現好幾次（一篇一組）→ 這條路算不了。
    # ⛔ 回 unknown，不要給一個橫跨兩三篇的答案 —— 那會看起來很篤定，
    #    而且方向是「原稿比 yml 多」，最像真缺陷，最容易被照著開票。
    if len(_heading_hits(paras, section)) > 1:
        return {"status": "unknown",
                "why": f"「{section}」在原稿裡出現 "
                       f"{len(_heading_hits(paras, section))} 次（多文本課），這條路算不了"}
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
