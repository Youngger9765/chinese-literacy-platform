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
#: 兩種寫法都在真實學習單上（實測）：
#:   語詞我最棒   `(1)  質疑 ：對某件事…`      → 括號包數字
#:   閱讀理解     `（ A ）1. 下列哪個詞語…`     → 括號裡是**答案代號**，題號是 `1.`
#: ⚠️ 只認第一種的話，閱讀理解整節會數到 0 題，而那看起來像「頁碼錯了」。
#: 題號前面允許行首、空白、或**全形右括號** —— 閱讀理解是
#: `（ A ）1. 下列哪個…`，題號緊貼在答案括號後面，要求前面是空白就抓不到。
#: 後面用 `(?!\d)` 擋掉 `2017-2021`、`190 字` 這類內文數字。
#: 七個正負向 case 驗過（見 test_gates_catch_degraded_extraction_2865）。
ITEM_RE = re.compile(r"[（(]\s*(\d{1,2})\s*[）)]|(?:^|[\s）)])(\d{1,2})[.．、](?!\d)", re.M)

#: 大題標題：行首的序號 + 名稱。
#: 序號含注音「ㄧ」—— 9 課的原稿真的是注音，那是老師打的不是錯字。
#:
#: ⚠️ 三個放寬都是校準時被真實版面打臉才加的（12 課裡 5 課因此數錯）：
#:   - 空格數不設上界：L0001 p3 是「四」+ 10 個空格 +「語詞應用」
#:   - 標題後面允許還有字：L0012 p4 是「四  語詞應用   在空格填入正確的語詞代號」
#:   - 名稱只吃非空白：避免把後面那串說明一起吃進來
#: ⚠️ 序號與名稱之間可能夾雜圈號等符號。**同一份 DOCX 轉兩次就會不一樣**：
#:   一次是「三    語詞我最棒」，另一次是「三 🅐  語詞我最棒」。
#:   吃不到就整節消失，而那不會有任何症狀 —— 對帳只會說「來源 0 題」。
#:   所以序號到名稱之間允許非中文字元，名稱本身只吃中文與連字號。
HEADING_RE = re.compile(
    r"^[ \t]*([一二三四五六七八九十ㄧ])[ \t]+[^\u4e00-\u9fff\n]{0,6}([\u4e00-\u9fff][\u4e00-\u9fff\-－]{1,11})",
    re.M,
)

#: 序號獨佔一行（雙欄排版把標題拆成兩行時會這樣）
LONE_ORDINAL_RE = re.compile(r"^[ \t]*([一二三四五六七八九十ㄧ])[ \t]*$")

#: 大題名稱：2–12 字純中文（含連字號）。⛔ 不要放寬，會把內文抓成標題。
SECTION_NAME_RE = re.compile(r"([\u4e00-\u9fff][\u4e00-\u9fff\-－]{1,11})")

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
    _last_ordinal = [None]  # 自己的序號，續頁要靠它判斷「哪個標題才算下一節」
    _seen_max = [0]         # 目前收到的最大題號，續頁銜接靠它
    for p in pages:
        text = page_text(pdf, p)
        if not text.strip():
            continue

        heads = [(m.start(), m.group(1), m.group(2)) for m in HEADING_RE.finditer(text)]
        # 雙欄排版會把標題自己拆成兩行 —— 實測 L0018 p7：第 2 行只有「七」，
        # 名稱「閱讀理解」被擠到第 4 行（跟另一欄的答案括號混在一起）。
        # 序號獨佔一行時，往後三行找第一個像大題名稱的中文詞補上。
        # ⛔ 只找三行，且只認 2–12 字的純中文 —— 放寬會把內文抓成標題。
        if not heads or True:
            lines = text.split("\n")
            offs, acc = [], 0
            for ln in lines:
                offs.append(acc); acc += len(ln) + 1
            known = {h[1] for h in heads}
            for i, ln in enumerate(lines):
                mm = LONE_ORDINAL_RE.match(ln)
                if not mm or mm.group(1) in known:
                    continue
                # ⛔ **不可以隨便抓第一個中文詞當名稱** —— 雙欄下前一行常是別欄的內文
                # （實測 L0018：序號「七」的下一行是「明都叫承恩，身高卻差了…」）。
                # 只認**我們要找的那個節名**，找不到就不補 —— 寧可少一個標題，
                # 也不要造一個假的出來污染切節。
                if not section:
                    continue
                for j in range(i + 1, min(i + 5, len(lines))):
                    if section in lines[j]:
                        heads.append((offs[i], mm.group(1), section))
                        break
            heads.sort()
        for pos, no, name in heads:
            out.append({"id": f"p{p}-heading-{no}", "kind": "heading",
                        "page": p, "text": f"{no} {name}"})

        # 要數題號的範圍：指定節就取「該標題到下一個標題」，否則整頁
        ranges: list[tuple[int, int, str]] = []
        if section:
            ORD = "一二三四五六七八九十"

            # 🔴 先確認這一頁的文字順序**還原得出版面順序**。
            # pdftotext 對某些雙欄版面會完全打亂（實測 L0038 p3：
            # 「三 語詞我最棒」排在第 39 行，在它自己的題目和「四 語詞應用」**之後**；
            # -layout / 預設 / -raw 三種模式都一樣亂）。
            # 順序亂掉時任何「切節」規則都是錯的 —— 與其給一個假答案，
            # 不如什麼都不回，讓對帳門說「數不到見證」而不是「漏抽 11 題」。
            # ⚠️ 判準只看**我要找的那一節**有沒有排錯位置，不是整頁序號遞不遞增。
            # 第一版用「整頁序號要遞增」，把 L0047 / L0022 這種「別節排錯但我這節
            # 好好的」也判成驗不了 —— 那是把好的判死，比漏抓更糟。
            mine = [h for h in heads if (section and (section in h[2] or h[2] in section))]
            if mine and mine[0][1] in ORD:
                my_pos, my_no = mine[0][0], mine[0][1]
                earlier_bigger = [
                    h for h in heads
                    if h[0] < my_pos and h[1] in ORD and ORD.index(h[1]) > ORD.index(my_no)
                ]
                if earlier_bigger:
                    # 序號比我大的大題排在我前面 = 我這一節的文字位置不可信
                    out.append({"id": f"p{p}-ORDER-SCRAMBLED", "kind": "unreliable",
                                "page": p,
                                "text": f"「{section}」的標題排在序號更大的"
                                        f"「{earlier_bigger[0][2]}」之後（文字順序與版面不符）"})
                    continue

            for i, (pos, no, name) in enumerate(heads):
                if not (section in name or name in section):
                    continue
                # ⚠️ 終點**不是**文字順序的下一個標題 —— 雙欄交錯會讓下一節排在前面
                # （實測 L0038 p3：「四 語詞應用」在「三 語詞我最棒」之前，
                #  取它當終點會得到負範圍 → 0 題）。
                # 取「位置在我後面**且序號比我大**」的第一個。
                end = len(text)
                for pos2, no2, _n2 in heads:
                    if pos2 <= pos:
                        continue
                    if no in ORD and no2 in ORD and ORD.index(no2) <= ORD.index(no):
                        continue
                    end = pos2
                    break
                ranges.append((pos, end, name))
                started = True
                _last_ordinal[0] = no
            if not ranges:
                if started:
                    # 續頁：這一節從上一頁延續過來，續頁上**不會再印一次標題**。
                    #
                    # ⚠️ 範圍**不能**取到「這頁第一個標題」就切 —— 雙欄排版下
                    # 右欄的下一個大題標題會排在左欄的續題**前面**（實測 L0022 p4：
                    # 第 1 行是「五 品格聚光燈」，第 2 行才是語詞應用的第 8 題）。
                    # 那樣切會漏掉續頁的第一批題，而症狀只是「少一題」。
                    #
                    # 改成切在「序號**大於**自己的下一個大題」，而且要往後找到
                    # 第一個真的比自己晚的。找不到就整頁都還是我的。
                    ORD = "一二三四五六七八九十"
                    mine = _last_ordinal[0]
                    cut = len(text)
                    for pos, no, _name in heads:
                        if mine and no in ORD and mine in ORD and ORD.index(no) > ORD.index(mine):
                            cut = pos
                            break
                    ranges.append((0, cut, section))
                    # ⚠️ 雙欄排版下，續頁的題號可能排在下一個大題標題**之後**
                    # （實測 L0022 p4：「五 品格聚光燈」在第 1 行，語詞應用的
                    #  第 8 題在第 4 行）。切在標題救不了 —— 文字順序就是這樣。
                    #
                    # 所以切點之後再收一次，但**只收編號接得上自己的**：
                    # 上一頁最後是第 7 題，就只認第 8 題，不認重新從 1 開始的。
                    # 這樣不會把隔壁節的 (1)(2)(3) 吃進來。
                    # ⛔ 只收「切點之後、下一個大題標題之前」的 ——
                    # 不設這個上界的話會把下一節的題吃進來
                    # （實測 L0055：語詞應用的 (9) 在「四 語詞應用」之後，
                    #  被當成語詞我最棒的第 9 題）。
                    # 切點之後那段屬於下一個大題。只有在它**看起來是我的延續**
                    # 而不是新一節時才收 —— 判準是「那段裡有沒有重新從 1 開始」。
                    #
                    # L0022：切點後只有 (8)，接得上我的 7 → 收（那是被雙欄擠過去的）
                    # L0055：切點後有 (1)(2)…(9)，重新從 1 開始 → 不收（那是語詞應用）
                    #
                    # ⛔ 少了這個判準，兩者長得一模一樣，收了就多一題、不收就少一題。
                    tail_nums = {
                        int(g) for mm in ITEM_RE.finditer(text[cut:])
                        for g in mm.groups() if g
                    }
                    if cut < len(text) and 1 not in tail_nums:
                        nxt = (_seen_max[0] or 0) + 1
                        while nxt in tail_nums:
                            out.append({"id": f"item-{nxt}", "kind": "item",
                                        "page": p, "n": nxt, "section": section})
                            nxt += 1
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
            nums = {int(g) for m in ITEM_RE.finditer(seg) for g in m.groups() if g}
            if nums:
                _seen_max[0] = max(_seen_max[0], max(nums))
            for n in sorted(nums):
                if not 1 <= n <= 30:
                    continue
                out.append({"id": f"item-{n}", "kind": "item",
                            "page": p, "n": n, "section": name})

    # ⚠️ item 的 id **不帶頁碼** —— 題號在一節裡本來就唯一，帶頁碼的話
    # 跨頁時同一題會被算成兩個見證（實測 L0047 跨三頁 → 8 題數成 16）。
    # heading / bank 仍然帶頁碼，那些每頁都可能各有一個。
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
