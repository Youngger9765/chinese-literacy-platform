#!/usr/bin/env python3
"""把 overview scan 判到的大題，交給決定性定位器算頁碼（#2865）。

## 為什麼需要這一支

抽取流程有兩個問題要回答，它們的穩定度**完全不同**：

| 問題 | 誰答得穩 | 實測（L0072 × 3 次） |
|---|---|---|
| 這張學習單有哪幾個大題 | 🤖 LLM | ✅ 序號+名稱+順序 3/3 全同 |
| 每個大題在第幾頁 | 🔧 字串定位 | LLM 8/9 —— **1 次錯**，而錯的那次沒有任何症狀 |

`lesson-overview-scan` 原本**兩件都問 LLM**。少讀一頁的飛機照樣抽得出東西、
照樣過門、照樣回報成功 —— 那是靜默截斷，沒有一道門看得到。

所以這支把界線劃清楚：**LLM 只交出大題清單，頁碼一律由 `build_section_pages.locate`
重算**（同一套用在既有 175 課上的程式碼，1426 定位 / 23 夾出 / 0 失敗）。

⚠️ 它**不修** DOCX→PDF 不可重現那件事（同一份轉三次 8/9/9 頁）。
那由 `assert_pdf_matches_manifest.py` 在派工前擋。這支只負責「頁碼不要出自 LLM」。

## 用法

    python3 scripts/locate_scanned_sections.py \
        --scan run-a.json --pdf /tmp/L0176/src.pdf --uid L0176

`--scan` 吃 overview 的輸出（`[{"no","name","pages"?}, ...]`，`pages` 有也會被忽略）。
印出 YAML，形狀跟 `specs/modules/section-pages.yml` 的一課相同，可直接併進去。

exit 0 = 每個大題都定位到或夾得出來
exit 1 = 有大題定位不到 —— ⛔ 不要派工，先看是掃錯還是原稿真的沒印標題
exit 2 = 材料不齊
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import pathlib
import sys

REPO = pathlib.Path(__file__).resolve().parents[1]


def _load_locator():
    """借用 build_section_pages 的純函式。

    ⛔ 不要複製它的演算法過來 —— 那支的單調指派 DP 修過兩個真實 bug
    （子字串吃掉、散文提及被當標題），複製一份等於把那兩個 bug 放回來。
    """
    spec = importlib.util.spec_from_file_location(
        "bsp", REPO / "scripts" / "build_section_pages.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--scan", required=True, type=pathlib.Path,
                    help="overview scan 的輸出（JSON array）")
    ap.add_argument("--pdf", required=True, type=pathlib.Path)
    ap.add_argument("--uid", required=True)
    args = ap.parse_args()

    if not args.pdf.is_file():
        print(f"⛔ 讀不到 PDF：{args.pdf}", file=sys.stderr)
        return 2
    try:
        raw = args.scan.read_text(encoding="utf-8")
    except OSError as exc:
        print(f"⛔ 讀不到 scan：{exc}", file=sys.stderr)
        return 2
    lo, hi = raw.find("["), raw.rfind("]")
    if lo < 0 or hi < lo:
        print("⛔ scan 檔裡找不到 JSON array", file=sys.stderr)
        return 2
    sections = json.loads(raw[lo : hi + 1])
    if not sections:
        print("⛔ scan 一個大題都沒有 —— 那是掃描失敗，不是這課沒有大題", file=sys.stderr)
        return 2

    bsp = _load_locator()
    texts = bsp.page_texts(args.pdf)
    if not texts:
        print("⛔ PDF 抽不出文字層 —— 定位器沒有材料", file=sys.stderr)
        return 2

    names = [str(s.get("name") or "") for s in sections]
    ordinals = [str(s.get("no") or "") for s in sections]
    starts = bsp.locate(names, texts, ordinals)
    spans = bsp.spans(starts, len(texts))

    out_sections = []
    unlocated = []
    for sec, (pages, source) in zip(sections, spans):
        if source == "unlocated":
            unlocated.append(f"{sec.get('no')} {sec.get('name')}")
        row = {"no": sec.get("no"), "name": sec.get("name"), "pages": pages}
        if source != "located":
            row["pages_source"] = source
        # ⚠️ 刻意不保留 scan 給的 pages —— 留著會讓下一個人以為兩個都可以用
        out_sections.append(row)

    entry = {args.uid: {"pdf_pages": len(texts), "sections": out_sections}}
    print(bsp._dump({"lessons": entry}))

    llm_pages = [s.get("pages") for s in sections]
    if any(p for p in llm_pages):
        agree = sum(1 for s, r in zip(sections, out_sections)
                    if list(s.get("pages") or []) == list(r["pages"]))
        print(f"# scan 自己也給了頁碼：{agree}/{len(sections)} 與定位器相同"
              f"（不同的以定位器為準）", file=sys.stderr)

    if unlocated:
        print(f"🔴 {len(unlocated)} 個大題定位不到：{', '.join(unlocated)}", file=sys.stderr)
        print("   ⛔ 不要派工。先看是 scan 判錯名字，還是原稿真的沒印那個標題。",
              file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
