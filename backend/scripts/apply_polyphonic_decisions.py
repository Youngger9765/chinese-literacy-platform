#!/usr/bin/env python3
"""把逐筆寫死的注音修正套回課文表。

## 為什麼是位置清單，不是規則

課文是封閉的 —— 179 課、40,529 個字串、266,351 個破音字位置都在 git 裡。
所以「哪個位置該讀什麼」的答案是**一份清單**，不是一套推論。

先前這支腳本走過兩條規則路：

  1. `--rules` 自動套用一／不 的變調。乾跑實測 3,700 個規劃寫入有 3,527 個（95.3%）
     會把本來正確的表覆寫成錯的預設值。已刪除。
  2. 核可清單用 `prev`/`next` 白名單當單位（例：「目的」→ ㄉㄧˋ，除了前字是
     題／科／節／書／帳／條／數／曲／劇 的時候）。那同樣是通解 —— 我替**沒看過的詞**
     寫了規則，而那些字有一半是我憑印象列的。已刪除。

現在只有一條路徑：讀 `data/zhuyin/polyphonic_fixes.json`，逐筆比對，逐筆替換。
它只會動到**已經被人看過的那 434 個位置**，不可能擴散。

## 鍵

`(sha256(句子)[:16], UTF-16 位置)`。句子給定，位置就唯一 ——
不需要分詞、不需要 n-gram、不需要猜詞界。「加長高度」之所以會破壞 n-gram 鍵，
就是因為兩個字的鍵不知道詞在哪裡結束；一整句加一個位移沒有這個問題。

## 用法

    python3 backend/scripts/apply_polyphonic_decisions.py          # 只列計畫
    python3 backend/scripts/apply_polyphonic_decisions.py --write  # 真的寫
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
_FIXES = _BACKEND / "data" / "zhuyin" / "polyphonic_fixes.json"


def u16(text: str) -> list[str | None]:
    """UTF-16 單位序列。非 BMP 字元佔兩格，第二格填 None，
    這樣索引才跟前端的 `str[i]` 對得上。"""
    out: list[str | None] = []
    for ch in text:
        out.append(ch)
        if ord(ch) > 0xFFFF:
            out.append(None)
    return out


def sentence_key(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def code_for(slots: dict, char: str, reading: str) -> str | None:
    """讀音 → ssz 裡該放的字元。字型畫不出來的回 None，呼叫端必須拒收。"""
    for slot, value in slots.get(char, {}).items():
        if value == reading:
            return "." if slot == "0000" else slot[-1]
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true", help="真的寫檔（不給就只列計畫）")
    a = ap.parse_args()

    slots = json.loads(_SLOTS_PATH.read_text(encoding="utf-8"))["slots"]
    fixes = json.loads(_FIXES.read_text(encoding="utf-8"))["fixes"]
    want: dict[tuple[str, int], dict] = {(f["sha"], f["u16"]): f for f in fixes}

    summary: collections.Counter = collections.Counter()
    touched: dict[Path, int] = {}
    problems: list[str] = []
    seen: set[tuple[str, int]] = set()

    for path in sorted(_LESSONS.glob("L*/v*/zhuyin.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        edits: list[tuple] = []
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
                fix = want.get((sha, i))
                if fix is None:
                    continue
                seen.add((sha, i))
                if units[i] != fix["char"]:
                    problems.append(
                        f"{fix['lesson']} {sha}@{i}: 清單寫「{fix['char']}」"
                        f"但課文是「{units[i]}」—— 拒絕替換")
                    continue
                code = code_for(slots, fix["char"], fix["to"])
                if code is None:
                    problems.append(
                        f"{fix['lesson']} {sha}@{i}: 字型畫不出「{fix['char']}」的"
                        f"{fix['to']} —— 拒絕替換")
                    continue
                if chars[i] != code:
                    chars[i] = code
                    dirty += 1
                    summary[(fix["char"], fix["from"], fix["to"])] += 1
            new_ssz = "".join(chars)
            if new_ssz != ssz:
                edits.append((text, t.get("n"), ssz, new_ssz))
        if edits:
            touched[path] = dirty
            if a.write:
                # ⛔ 不用 json.dump 重寫整檔 —— 縮排與鍵序不同會讓幾百個位置的改動
                #    變成十幾萬行插入，真正的改動淹沒在裡面沒人 review 得動。
                # ⛔ 也不能只用 ssz 當定位鍵 —— 短句的 ssz 大量重複
                #    （L0001 裡 "....." 有 19 筆共用），會改到別句。
                raw = path.read_text(encoding="utf-8")
                for text_v, n_v, old_ssz, new_ssz in edits:
                    head = (f'"text":{json.dumps(text_v, ensure_ascii=False)},'
                            f'"n":{n_v},"ssz":')
                    needle = f'{head}"{old_ssz}"'
                    if raw.count(needle) < 1:
                        raise SystemExit(f"{path.name}: 定位鍵找不到 —— 拒絕替換")
                    raw = raw.replace(needle, f'{head}"{new_ssz}"')
                path.write_text(raw, encoding="utf-8")

    missing = set(want) - seen
    verb = "已寫入" if a.write else "計畫"
    print(f"清單 {len(want):,} 個位置 · {verb} {sum(touched.values()):,} 個 · "
          f"{len(touched)} 個課文檔")
    for (ch, frm, to), n in summary.most_common():
        print(f"   {n:5,}× 「{ch}」 {frm} → {to}")
    if missing:
        print(f"\n🔴 清單裡有 {len(missing):,} 個位置在課文表裡找不到"
              f"（句子被改過或課文被重抽？）")
    if problems:
        print(f"\n🔴 拒絕替換 {len(problems)} 筆:")
        for p in problems[:10]:
            print(f"   {p}")
    if not a.write and (summary or missing or problems):
        print("\n（這是計畫。要真的改加 --write）")
    return 1 if (missing or problems) else 0


if __name__ == "__main__":
    raise SystemExit(main())
