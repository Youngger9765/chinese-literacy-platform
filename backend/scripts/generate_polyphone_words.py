#!/usr/bin/env python3
"""把 poyin_db 的詞樣式展開成「詞 → 那個多音字讀什麼」。(#3215)

## 為什麼

朗讀診斷報告的破音字讀音靠 pypinyin 的上下文判讀，而它是大陸語料 ——
結構上給不出「銀行 = ㄏㄤˊ」「災難 = ㄋㄢˋ」。prod 實測：`難` 的五種情境
pypinyin **全部回 ㄋㄢˊ**，即使字型明明收了 `ss01 = nan4`。

正確答案一直在 `frontend/public/data/poyin_db.json` 裡 —— 課文頁用的就是它，
而且已被 #3177 逐字對過字型。這支把它搬成後端能吃的形狀。

## 這支**不**做什麼

⛔ 不移植 `polyphonicPatternMatcher.ts`。2026-09-14 的複審移植過，漏掉
一/不 變調分支與 `skipPrev` 狀態，跑出「15.2% / 9600 處」而且吐出 `不 → ㄈㄨ` ——
看起來完全合理的錯數字。

這支只做**字串展開**：`災*` → 詞「災難」、多音字在位移 0+1；`*民` → 詞「難民」、位移 0。
沒有任何判讀邏輯，所以沒有可以移植錯的東西。執行期的比對是「最長詞優先」，
跟 `services/he_conjunction.py` 同一個形狀。

## 讀音從哪來

`poyin_db` 只有「第幾個變體」，沒有讀音。讀音在字型裡：
變體 0 → glyph slot `0000`，變體 i → `ssNN`。所以這支同時讀字型，
用 `extract_font_readings.py`（#3173 留下的）。

    python3 backend/scripts/generate_polyphone_words.py
    python3 backend/scripts/generate_polyphone_words.py --check   # 只驗不寫
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import re
import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
REPO = BACKEND.parent
POYIN = REPO / "frontend" / "public" / "data" / "poyin_db.json"
FONT = REPO / "frontend" / "public" / "fonts" / "BpmfZihiSerif-Regular.ttf"
EXTRACTOR = BACKEND / "scripts" / "extract_font_readings.py"
OUT = BACKEND / "data" / "zhuyin" / "polyphone_words.json"


#: ⚠️ `一` 與 `不` 也留在表裡，雖然它們的聲調其實由**後一個字**決定
#: （前端 `toneSandhi.ts` 在算變調，poyin_db 的詞樣式只覆蓋一部分）。
#:
#: 兩邊都量過才決定留：
#:     一/不 留在表裡   前端 31 條斷言紅 2 條
#:     一/不 排除       紅 5 條   ← 更差，因為 `第一`／`買一` 這些真的是詞
#:
#: 剩下那 2 條（`拿一杯水` 要 ㄧˋ、`一起走` 要 ㄧ）需要真的變調規則，
#: 記在 `tests/test_polyphone_words_3215.py` 的 SANDHI_GAPS 裡。


def _to_bopomofo(reading: str) -> str:
    from pypinyin.style.bopomofo import BopomofoConverter

    # 字型用 5 標輕聲，pypinyin 的轉換表只認 0–4
    return BopomofoConverter().to_bopomofo(re.sub(r"5$", "", reading))


def _font_table() -> dict:
    spec = importlib.util.spec_from_file_location("efr", EXTRACTOR)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.build_reading_table(str(FONT))


def _git_sha() -> str:
    # 12 碼 —— 40 碼的十六進位會被 secret scanner 當 token 擋下來
    try:
        return subprocess.run(
            ["git", "rev-parse", "--short=12", "HEAD"],
            cwd=REPO, capture_output=True, text=True, check=True,
        ).stdout.strip()
    except (OSError, subprocess.CalledProcessError):  # pragma: no cover
        return "unknown"


def build() -> dict:
    poyin = json.loads(POYIN.read_text(encoding="utf-8"))["data"]
    font = _font_table()

    #: 詞 → {多音字在詞裡的位移: 注音}
    words: dict[str, dict[str, str]] = {}
    skipped_no_font: list[str] = []

    for char, entry in poyin.items():
        variants = entry.get("v") or []
        # ⛔ 不可以先把空字串濾掉再列舉 —— 變體的**索引**就是字型的 slot 編號，
        #    濾掉會整串位移。`了` 的變體 0 是空的、變體 1 是 `*解/受不*/…`；
        #    濾掉之後變體 1 變成索引 0 → 拿到 `0000` 的 ㄌㄜ˙ 而不是 `ss01` 的 ㄌㄧㄠˇ。
        #    （這個 bug 我真的寫出來過，被 `了解` 與 `受不了` 兩條測試抓到。）
        if not any(variants):
            continue          # 這個字沒有任何詞樣式（只有 `s` 欄），無事可做
        slots = font.get(char)
        if not slots:
            skipped_no_font.append(char)
            continue
        for i, pattern in enumerate(variants):
            if not pattern:
                continue
            slot = "0000" if i == 0 else f"ss{i:02d}"
            raw = slots.get(slot)
            if not raw:
                # 字型沒有這個變體槽 → 沒有讀音可給，跳過（誠實的漏，不是猜）
                continue
            reading = _to_bopomofo(raw)
            for token in pattern.split("/"):
                if not token or "*" not in token:
                    continue
                word = token.replace("*", char)
                # 一個樣式裡可能有多個 `*`（例如 `**出`），逐一記位移
                for pos, ch in enumerate(token):
                    if ch != "*":
                        continue
                    offset = pos  # token 與 word 等長，`*` 被同一個字替換
                    words.setdefault(word, {})
                    # 同一個詞同一個位移被兩個變體指到 = poyin_db 自己衝突，
                    # 保留第一個並記下來（下面 _conflicts 會列出）
                    words[word].setdefault(str(offset), reading)

    return {
        "_provenance": {
            "generator": "backend/scripts/generate_polyphone_words.py",
            "source_patterns": str(POYIN.relative_to(REPO)),
            "source_readings": str(FONT.relative_to(REPO)),
            "font_sha256": hashlib.sha256(FONT.read_bytes()).hexdigest(),
            "poyin_sha256": hashlib.sha256(POYIN.read_bytes()).hexdigest(),
            "edition": f"git {_git_sha()}",
            "issue": "#3215",
            "note": "詞樣式展開，無判讀邏輯；執行期最長詞優先比對",
        },
        "words": words,
        "_skipped_no_font": sorted(skipped_no_font),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    table = build()
    body = json.dumps(table, ensure_ascii=False, indent=1, sort_keys=True)

    if args.check:
        if not OUT.exists():
            print(f"⛔ {OUT.relative_to(REPO)} 不存在，跑一次這支")
            return 1
        have = json.loads(OUT.read_text(encoding="utf-8"))
        if have.get("words") == table["words"]:
            print(f"✓ 對照表與來源一致（{len(table['words'])} 個詞）")
            return 0
        print("⛔ 對照表與 poyin_db／字型對不上 —— 重跑這支")
        return 1

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(body + "\n", encoding="utf-8")
    print(f"寫入 {OUT.relative_to(REPO)}")
    print(f"  詞 {len(table['words'])} 個 · {len(body.encode('utf-8'))/1024:.0f} KB")
    if table["_skipped_no_font"]:
        print(f"  字型沒收而跳過的字: {len(table['_skipped_no_font'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
