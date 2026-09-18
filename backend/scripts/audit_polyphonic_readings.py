#!/usr/bin/env python3
"""破音字讀音的系統性稽核 —— 課文是封閉的，所以可以暴力窮舉（#3269）。

## 為什麼要這支（2026-09-18 Young 明令）

`#3218`／`#3230` 把**位置**窮舉完了（40,529 字串 / 1,067,017 槽位全部有值），
而那**不等於讀音是對的**。「長高的祕密」的「長」在 prod 上是 ㄔㄤˊ，
全庫 35 處 `長高` 只有 2 處對 —— 而每一道門都是綠的。

三個結構性原因（都驗過）：

1. **窮舉的是位置不是正確性。** 值的來源是 `poyin_db` 的**樣式清單**
   （`長` 有 度/期/處/… 的樣式），那是 generative 的 pattern language ——
   一次長一個 pattern，**本質上不宣稱完整**。`長高` 沒有樣式 → 落到預設 ㄔㄤˊ。
2. **1,083 條逐課測試鎖的是「表現在說什麼」不是「表應該說什麼」。**
   表是凍結的，測試讀凍結的表 → 同義反覆。所以錯著而門全綠。
3. **量正確率時問錯了問題。** 「這個讀音是這個字的合法讀音嗎」—— ㄔㄤˊ **是**
   長的合法讀音，所以那把尺對這一類結構性失明（實測 99.2%，而它看不到 35 處錯）。

## 這支怎麼做（Young 給的四步）

    Phase 1  把所有破音字找出來（來源＝出貨字型的合法讀音集合，不是猜）
    Phase 2  建 metadata：它在課文的哪些「詞」裡、哪一課、什麼位置、上下文
    Phase 3  字典多重比對 ＋ LLM 依上下文裁決
    Phase 4  回到課文 SOT 比對，吐出分歧清單

⛔ **不用 jieba**：它的字典是簡體導向，對繁體的「長」根本不斷詞
（1,654 次全部切成單字），「和」也同一個問題（#3238）。
所以「詞」的候選**直接從封閉語料的 n-gram 取**，不依賴任何斷詞器。

⛔ **LLM 只在離線跑一次，結果凍結進表** —— 執行期永遠是查表。
跟 #3218 同一條紀律：讀音是內容不是計算。
"""
from __future__ import annotations

import argparse
import collections
import json
import re
import sys
from pathlib import Path

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))

_LESSONS = _BACKEND / "data" / "lessons"
_SLOTS = _BACKEND / "data" / "zhuyin" / "font_slot_readings.json"
_OUT = _BACKEND / "data" / "zhuyin" / "polyphonic_audit.json"

_CJK = re.compile(r"[㐀-䶿一-鿿\U00020000-\U0002FA1F]")
#: 上下文視窗：前後各取幾個字給 LLM 看。⚠️ 太短 LLM 判不出詞義，太長浪費 token。
_CTX = 12
#: n-gram 的長度上限。2 字抓「長高」，3-4 字抓「長時間」「一長一短」這種。
_NGRAM_MAX = 4


def u16(text: str) -> list[str | None]:
    """切成 UTF-16 單位 —— 跟前端的 `text[i]` 與表的 `ssz` 同語意。

    ⛔ Python 的 `list(text)` 是碼點。非 BMP 字差一格，而槽位是照 UTF-16 排的。
    """
    out: list[str | None] = []
    for ch in text:
        out.append(ch)
        if ord(ch) > 0xFFFF:
            out.append(None)
    return out


def load_slots() -> dict[str, dict[str, str]]:
    return json.loads(_SLOTS.read_text(encoding="utf-8"))["slots"]


def phase1_polyphonic_chars(slots: dict) -> set[str]:
    """Phase 1 —— 哪些字是破音字。

    來源是**出貨字型**（`BpmfZihiSerif-Regular.ttf`）的合法讀音集合：字型為一個字
    準備了 2–5 個變體，就代表台灣的權威認定它有那幾個讀音。
    ⛔ 不用「我覺得這個字有多音」，也不用外部字表 —— 字型是我們真的畫得出來的那一組。
    """
    return {ch for ch, m in slots.items() if len(m) > 1}


def phase2_build_metadata(poly: set[str], slots: dict) -> dict:
    """Phase 2 —— 每一個破音字位置的 metadata（課、section、位置、上下文、候選詞）。

    候選詞不靠斷詞器：取以該字為中心、長度 2–4 的所有 n-gram（只含漢字的），
    因為語料是封閉的，這些 n-gram 就是「這個字在這套教材裡真的出現過的詞形」的上界。
    """
    occ: dict[str, list[dict]] = collections.defaultdict(list)
    ngrams: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)

    for path in sorted(_LESSONS.glob("L*/v*/zhuyin.json")):
        uid = path.parts[-3]
        data = json.loads(path.read_text(encoding="utf-8"))
        for t in data.get("texts") or []:
            text, ssz = t.get("text"), t.get("ssz")
            if not isinstance(text, str) or not isinstance(ssz, str):
                continue
            units = u16(text)
            if len(units) != len(ssz):
                # 表與課文對不上就跳過並記下 —— 那本身是另一個 bug，不要靜靜吞掉
                occ["__misaligned__"].append({"lesson": uid, "section": t.get("section")})
                continue
            for i, code in enumerate(ssz):
                ch = units[i]
                if ch is None or ch not in poly:
                    continue
                cp = sum(1 for k in range(i) if units[k] is not None)
                slot = "0000" if code == "." else f"ss0{code}"
                reading = slots.get(ch, {}).get(slot)
                occ[ch].append({
                    "lesson": uid,
                    "section": t.get("section"),
                    "idx": t.get("idx"),
                    "u16": i,
                    "cp": cp,
                    "slot": slot,
                    "reading": reading,
                    "context": text[max(0, cp - _CTX):cp + _CTX + 1],
                    "at": min(cp, _CTX),
                })
                for n in range(2, _NGRAM_MAX + 1):
                    for start in range(max(0, cp - n + 1), cp + 1):
                        gram = text[start:start + n]
                        if len(gram) == n and all(_CJK.match(c) for c in gram):
                            ngrams[ch][gram] += 1
    return {"occurrences": occ, "ngrams": {k: dict(v) for k, v in ngrams.items()}}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--phase", default="12", help="跑哪幾個 phase（預設 12）")
    ap.add_argument("--char", help="只看某個字（除錯用）")
    a = ap.parse_args()

    slots = load_slots()
    poly = phase1_polyphonic_chars(slots)
    print(f"Phase 1 —— 字型認定的破音字: {len(poly):,} 個")

    meta = phase2_build_metadata(poly, slots)
    occ = meta["occurrences"]
    mis = len(occ.pop("__misaligned__", []))
    seen = {c: v for c, v in occ.items() if v}
    positions = sum(len(v) for v in seen.values())
    print(f"Phase 2 —— 語料實際出現 {len(seen):,} 種 · {positions:,} 個位置"
          + (f" · ⚠️ 表與課文長度對不上 {mis} 段" if mis else ""))

    # 每個字被指派了幾種讀音 —— 內部一致性的第一層訊號
    multi = {c: collections.Counter(o["reading"] for o in v) for c, v in seen.items()}
    twoplus = {c: d for c, d in multi.items() if len(d) > 1}
    print(f"          其中被指派過 2 種以上讀音的字: {len(twoplus):,} 種")

    if a.char:
        c = a.char
        print(f"\n「{c}」 讀音分佈: {dict(multi.get(c, {}))}")
        grams = sorted(meta['ngrams'].get(c, {}).items(), key=lambda kv: -kv[1])[:15]
        print(f"「{c}」 的 n-gram（前 15）: {grams}")
        return 0

    _OUT.write_text(json.dumps({
        "_provenance": {
            "generator": "backend/scripts/audit_polyphonic_readings.py",
            "polyphonic_source": "frontend/public/fonts/BpmfZihiSerif-Regular.ttf 的合法讀音集合",
            "note": "課文是封閉的，所以這份是窮舉不是抽樣",
        },
        "polyphonic_chars": len(poly),
        "chars_in_corpus": len(seen),
        "positions": positions,
        "readings_per_char": {c: dict(d) for c, d in sorted(multi.items())},
    }, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"\n寫入 {_OUT.relative_to(_BACKEND.parent)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
