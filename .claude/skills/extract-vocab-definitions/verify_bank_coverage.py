#!/usr/bin/env python3
"""答案是不是都來自語詞框 —— 抽完不看原稿就能跑的自驗（#2857）。

## 這支證明什麼、不證明什麼

「語詞我最棒」的答案池就是印在上面的**語詞框**，所以
`items[].word`（或 `answer`）理當都能在 `vocabulary_bank` 裡找到。
抽歪（抄到隔壁那一節、把解釋當成語詞）幾乎一定會讓某個答案掉出語詞框。

⚠️ 它**不**證明：
- 有沒有整題漏掉（那看 `index` 連不連號）
- 解釋文字有沒有抄對（那是逐字門的事）
- 選擇題的答案對不對（`answer` 是選項字母，本來就不在語詞框裡）

## 判準為什麼是「子字串」而不是「相等」

全庫有 3 個答案的語詞框印的是簡寫：`前兆` ⟷ `徵兆、前兆`、
`兵來將擋` ⟷ `兵來將擋，水來土掩`。要求完全相等會把這三個**正確**的答案判成錯，
然後有人去「修正」它們。判準訂錯比沒有判準更糟。
"""
from __future__ import annotations

import argparse
import pathlib
import sys

import yaml

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]


def check(uid: str, root: pathlib.Path | None = None) -> tuple[int, list[str]]:
    # `--root` 讓還沒進 backend/data 的產出也驗得了（#2865）。原本路徑寫死，
    # 意思是「要驗自己抽的東西，得先覆蓋掉真實課程資料」—— 於是驗證性跑批
    # 照文件跑會拿到一個跟自己輸出無關的綠燈（那個綠在動筆之前就已經綠了）。
    base = root or (REPO_ROOT / "backend" / "data" / "lessons")
    path = base / uid / "v3" / "vocab_definitions.yml"
    if not path.is_file():
        return 2, [f"沒有這個檔：{path}"]
    body = (yaml.safe_load(path.read_text(encoding="utf-8")) or {}).get("vocab_definitions") or {}
    bank = list(body.get("vocabulary_bank") or []) + list(body.get("word_bank") or [])
    items = [i for i in (body.get("items") or []) if isinstance(i, dict)]
    if not items:
        return 1, ["一個 item 都沒有 —— 這是抽失敗，不是通過"]
    if not bank:
        # 「沒得驗」不是「通過」（#2865）。原本這裡回 0 —— 而語詞框 143/150 課都有印，
        # 所以「這課沒有 bank」幾乎一定是抽漏了，那卻是這支唯一會回綠的失敗路徑。
        # 第一次真的派飛機（L0072）時，一份被砍成 1 題、空定義、無 bank 的劣化輸出
        # 就是從這裡拿到綠燈的。回 3 = INVALID（沒驗到），跟 1（驗到有錯）分開。
        return 3, [
            f"🟡 {uid} 沒有語詞框 —— 這支驗不了（{len(items)} 個 item 未受檢）。",
            "   ⚠️ 143/150 課都印語詞框，所以這多半是抽漏了而不是這課沒有。",
            "   要嘛補抽，要嘛在回報裡寫明這課原稿真的沒印。⛔ 不可以當成通過。",
        ]

    problems = []
    checked = 0
    for item in items:
        answer = item.get("word") or item.get("answer")
        if not answer:
            problems.append(f"index {item.get('index')}: 既沒有 word 也沒有 answer")
            continue
        if item.get("type") or item.get("options"):
            continue  # 選擇題，answer 是選項字母不是語詞
        checked += 1
        # 簡寫：語詞框那條是答案的**子字串**也算命中（見檔頭的兩個實例）。
        # ⛔ 反方向（答案是語詞框那條的子字串）**刻意不放行** —— 檔頭兩個實例都是
        # 「框裡印簡寫、答案是全稱」，沒有反過來的先例；實測拿掉反方向後
        # 全庫 1591 個受檢 item 失敗數一樣是 0（純鬆綁、零收益），
        # 而它會讓被截斷的答案（`矗` 對上框裡的 `矗立`）過關。
        if not any(b == answer or b in answer for b in bank):
            problems.append(f"index {item.get('index')}: 「{answer}」不在語詞框裡")

    if problems:
        return 1, [f"🔴 {uid}: {len(problems)}/{checked} 個答案對不上語詞框"] + [f"    {p}" for p in problems]
    return 0, [f"✅ {uid}: {checked} 個答案全部來自語詞框（語詞框 {len(bank)} 條）"]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("uids", nargs="+")
    ap.add_argument("--root", type=pathlib.Path, default=None,
                    help="改讀這個目錄下的 <uid>/v3/*.yml（驗還沒落地的產出用）")
    args = ap.parse_args()
    worst = 0
    for uid in args.uids:
        code, lines = check(uid, args.root)
        worst = max(worst, code)
        print("\n".join(lines))
    return worst


if __name__ == "__main__":
    raise SystemExit(main())
