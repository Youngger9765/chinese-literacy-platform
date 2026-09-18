#!/usr/bin/env python3
"""把已核可的破音字裁決寫回逐課注音表。

這支刻意**不會自己決定任何事**。它只做兩件機械的事：

只有**一條寫入路徑**：套用 `polyphonic_approvals.json` 裡列名的類別。

⛔ 曾經有第二條（`--rules`，自動套用一/不 的變調）。它被刪掉不是因為粒度不夠，
   是因為它自己抄了一份 sandhi，而那份用「從決策檔查下一個字的讀音」的舊查法 ——
   決策檔只有破音字，「一杯」的杯、「不夠」的夠都不在裡面。乾跑實測：3,700 個
   規劃寫入有 **3,527 個（95.3%）** 會把本來正確的表覆寫成錯的預設值。
   同一份邏輯散在三個檔案、修好一份另外兩份繼續帶 bug，就是這個形狀。

為什麼要核可清單而不是「LLM 說改就改」
──────────────────────────────────
窮舉的 LLM 給的是**提案**。它在 L0018 抓到 25 處真錯（長高讀成 ㄔㄤˊ），
但同一批提案裡也有它自己判錯的（因為 ㄔㄤˊ 也是「長」的合法讀音，
所以值域約束擋不住這一類）。核可清單讓「哪一類改動被接受」進 git、
被 review、被追溯 —— 而套用本身是零判斷的。

表的結構：`data/lessons/L*/v*/zhuyin.json` 的 `texts[]` 每筆有 `text` 與 `ssz`，
`ssz` 每個 UTF-16 單位一個字元：`.` = 主讀音（slot 0000），數字 d = slot ss0d。
所以「改讀音」就是把那個字元換成值等於目標讀音的那個 slot 代碼。
"""
from __future__ import annotations

import argparse
import collections
import hashlib
import json
from pathlib import Path

_BACKEND = Path(__file__).resolve().parents[1]
_LESSONS = _BACKEND / "data" / "lessons"
_SLOTS_PATH = _BACKEND / "data" / "zhuyin" / "font_slot_readings.json"
_DECISIONS = _BACKEND / "data" / "zhuyin" / "polyphonic_decisions.jsonl"
_APPROVALS = _BACKEND / "data" / "zhuyin" / "polyphonic_approvals.json"

NEUTRAL_TAIL = set("了的得麼著子頭們嗎呢吧啊喔呀哦")


def u16(text: str) -> list[str | None]:
    out: list[str | None] = []
    for ch in text:
        out.append(ch)
        if ord(ch) > 0xFFFF:
            out.append(None)
    return out


def sentence_key(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def code_for(slots: dict, char: str, reading: str) -> str | None:
    """讀音 → ssz 裡該放的那個字元。畫不出來的回 None（呼叫端必須拒收）"""
    for slot, value in slots.get(char, {}).items():
        if value == reading:
            return "." if slot == "0000" else slot[-1]
    return None


def load_decisions() -> list[dict]:
    if not _DECISIONS.is_file():
        return []
    return [json.loads(l) for l in _DECISIONS.read_text(encoding="utf-8").splitlines() if l.strip()]


def wanted_changes(slots: dict) -> dict:
    """回 {(sha, u16): (char, 目標讀音)}，只含核可清單列名的類別"""
    rows = load_decisions()
    approvals = set()
    if _APPROVALS.is_file():
        for entry in json.loads(_APPROVALS.read_text(encoding="utf-8"))["approved"]:
            approvals.add((entry["char"], entry["from"], entry["to"]))

    out: dict = {}
    for r in rows:
        ch, cur, new = r["char"], r["current"], r["reading"]
        if ch in "一不":
            # ⛔ 「一」「不」永遠不走這條路。變調要看下一個字的實際聲調，
            #    而那份資訊在 reconcile_polyphonic_decisions.py 的 load_context()，
            #    不在決策檔裡。這支曾經自己抄過一份 sandiff，用的是「從決策檔查
            #    下一個字」的舊查法 —— 乾跑實測 3,700 個規劃寫入有 3,527 個（95.3%）
            #    會把本來正確的表覆寫成錯的預設值（「一杯」ㄧˋ→ㄧ、「還不夠」ㄅㄨˊ→ㄅㄨˋ）。
            #    同一個 bug 在三個檔案各一份、只修了一份，就是這個形狀。
            continue
        if new == cur:
            continue
        # 產品政策擋掉的一律不動（#3238 的「和」、詞尾輕聲、量詞「個」）
        if ch == "和" and cur == "ㄏㄢˋ" and new == "ㄏㄜˊ":
            continue
        if ch in NEUTRAL_TAIL and cur.endswith("˙") and not new.endswith("˙"):
            continue
        if ch == "個" and cur == "ㄍㄜ˙" and new == "ㄍㄜˋ":
            continue
        if (ch, cur, new) in approvals:
            out[(r["sha"], r["u16"])] = (ch, new)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true", help="真的寫檔（不給就只列計畫）")
    a = ap.parse_args()

    slots = json.loads(_SLOTS_PATH.read_text(encoding="utf-8"))["slots"]
    changes = wanted_changes(slots)
    if not changes:
        print("沒有要套用的改動")
        return 0

    summary: collections.Counter = collections.Counter()
    undrawable: collections.Counter = collections.Counter()
    touched: dict[Path, int] = {}

    for path in sorted(_LESSONS.glob("L*/v*/zhuyin.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        dirty = 0
        for t in data.get("texts") or []:
            text, ssz = t.get("text"), t.get("ssz")
            if not isinstance(text, str) or not isinstance(ssz, str):
                continue
            units = u16(text)
            if len(units) != len(ssz):
                continue
            sha = sentence_key(text)
            chars = list(ssz)
            for i in range(len(chars)):
                hit = changes.get((sha, i))
                if not hit:
                    continue
                ch, want = hit
                if units[i] != ch:          # 位置對不上就不動（不該發生，但不猜）
                    continue
                code = code_for(slots, ch, want)
                if code is None:
                    undrawable[(ch, want)] += 1
                    continue
                if chars[i] != code:
                    chars[i] = code
                    dirty += 1
                    summary[(ch, want)] += 1
            if dirty:
                t["ssz"] = "".join(chars)
        if dirty:
            touched[path] = dirty
            if a.write:
                path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n",
                                encoding="utf-8")

    verb = "已寫入" if a.write else "計畫"
    print(f"{verb}：{sum(touched.values()):,} 個位置 · {len(touched)} 個課文檔")
    for (ch, want), n in summary.most_common(25):
        print(f"   {n:5,}× 「{ch}」 → {want}")
    if undrawable:
        print("\n🔴 字型畫不出來，拒絕套用：")
        for (ch, want), n in undrawable.most_common():
            print(f"   {n:,}× 「{ch}」 → {want}")
    if not a.write:
        print("\n（這是計畫。要真的改加 --write）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
