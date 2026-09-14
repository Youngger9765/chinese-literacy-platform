#!/usr/bin/env python3
"""從出貨字型生成「字 → 台灣注音」對照表。

## 為什麼需要這支（#3202）

全站有三處會產生注音，其中兩處已經接台灣來源：

    課文注音顯示   BpmfZihiSerif-Regular.ttf + poyin_db.json
    TTS 唸出來的音  data/tts/taiwan_pronunciation.json（教育部辭典生成）
    朗讀診斷報告    ← 直接吐 pypinyin 原始輸出，那是大陸普通話讀音

拿 175 課真實課文量，單音字有 1.09%（1524/140085 字次）的讀音跟出貨字型不一致，
其中最常出現的是 究(×156) 血(×155) 息(×109) 垃(×35) 圾(×35) —— 全是經典的
台灣 vs 大陸分歧。這支把字型裡的讀音抽成一份 committed 對照表，讓那一處也接上。

## 為什麼用字型當真值而不是教育部辭典

字型就是**畫面上實際會畫出來的那個讀音**，而且是本專案已經在出貨的檔案，
不受辭典 CC BY-ND 授權限制。`extract_font_readings.py`（#3173 留下的）已經能抽。

## 注音記法沿用 pypinyin 的轉換器

字型存的是 `le4` 這種拼音＋調號，畫面要的是 `ㄌㄜˋ`。這裡直接用 pypinyin 自己的
`BopomofoConverter` 轉，**不自己寫一套對應表** —— 這樣換過去之後，改變的只有「讀音」，
「記法」一個字元都沒動，diff 才有意義。

## 用法

    python3 backend/scripts/generate_taiwan_zhuyin_table.py            # 寫入預設位置
    python3 backend/scripts/generate_taiwan_zhuyin_table.py --check    # 只驗不寫（CI 用）

⚠️ 唯讀字型、不連網。
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
FONT = REPO / "frontend" / "public" / "fonts" / "BpmfZihiSerif-Regular.ttf"
OUT = BACKEND / "data" / "zhuyin" / "font_readings.json"
EXTRACTOR = BACKEND / "scripts" / "extract_font_readings.py"

# 字型把預設讀音放在 "0000"（無變體選擇器），變體放在 ss01/ss02/…
DEFAULT_SLOT = "0000"


def _load_extractor():
    spec = importlib.util.spec_from_file_location("extract_font_readings", EXTRACTOR)
    if spec is None or spec.loader is None:  # pragma: no cover
        raise RuntimeError(f"無法載入 {EXTRACTOR}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _to_bopomofo(reading: str) -> str:
    """`le4` → `ㄌㄜˋ`，用 pypinyin 自己的轉換器（見檔頭「注音記法」）。

    字型用 `5` 標輕聲（`zhe5`），pypinyin 的轉換表只認 0–4：`([^0-4])$` 會補一個 `0`
    再對到 `˙`，而那個 `5` 會原封不動留在字串裡（`ㄓㄜ5˙`）。先拿掉它。
    """
    from pypinyin.style.bopomofo import BopomofoConverter

    return BopomofoConverter().to_bopomofo(re.sub(r"5$", "", reading))


def build() -> dict:
    mod = _load_extractor()
    raw = mod.build_reading_table(str(FONT))

    single: dict[str, str] = {}
    poly: dict[str, dict[str, str]] = {}
    for char, slots in raw.items():
        if DEFAULT_SLOT not in slots:
            # 沒有預設讀音的字不收 —— 執行期沒有東西可以當保底
            continue
        if len(slots) == 1:
            single[char] = _to_bopomofo(slots[DEFAULT_SLOT])
        else:
            # 破音字存「預設讀音 + 候選讀音集合」，兩邊都是**注音**不是拼音。
            #
            # 執行期要回答的問題是「pypinyin 依上下文挑的那個讀音，台灣字型有沒有」。
            # 拿注音比而不是拿拼音比，是因為 pypinyin 的注音輸出就是用同一個轉換器產的
            # （見 _to_bopomofo），兩邊記法保證一致；換成拼音就得在執行期再寫一套
            # ü/v、輕聲 5 的正規化，而那份正規化會跟這支漂移。
            readings = {_to_bopomofo(r) for r in slots.values()}
            poly[char] = {
                "d": _to_bopomofo(slots[DEFAULT_SLOT]),
                "v": sorted(readings),
            }

    return {
        "_provenance": {
            "generator": "backend/scripts/generate_taiwan_zhuyin_table.py",
            "source_font": str(FONT.relative_to(REPO)),
            "font_sha256": hashlib.sha256(FONT.read_bytes()).hexdigest(),
            "notation": "pypinyin BopomofoConverter（記法與 Style.BOPOMOFO 相同）",
            "edition": f"git {_git_sha()}",
            # ⛔ 不放 generated_at —— 重跑產生器即使資料一個字沒變也會產生 diff，
            # 在 399KB 的檔上讓人完全看不出「資料到底變了沒」。
            # provenance 要回答的是「從什麼推出來的」，那由 font_sha256 + edition 精確回答，
            # 而且它們只在輸入真的變了才會變。
            "issue": "#3202",
        },
        "single": single,
        "poly": poly,
    }


def _git_sha() -> str:
    # 12 碼就好 —— 40 碼的十六進位字串會被 secret scanner 當成 token 擋下來
    try:
        return subprocess.run(
            ["git", "rev-parse", "--short=12", "HEAD"],
            cwd=REPO, capture_output=True, text=True, check=True,
        ).stdout.strip()
    except (OSError, subprocess.CalledProcessError):  # pragma: no cover
        return "unknown"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="只驗證，不寫檔（CI 用）")
    args = ap.parse_args()

    table = build()
    body = json.dumps(table, ensure_ascii=False, indent=1, sort_keys=False)

    if args.check:
        if not OUT.exists():
            print(f"⛔ {OUT.relative_to(REPO)} 不存在，跑一次這支產生它")
            return 1
        have = json.loads(OUT.read_text(encoding="utf-8"))
        # _provenance 帶時間與 commit，每次都會不同 —— 只比資料本身
        if have.get("single") == table["single"] and have.get("poly") == table["poly"]:
            print(f"✓ 對照表與字型一致（單音字 {len(table['single'])}、破音字 {len(table['poly'])}）")
            return 0
        print("⛔ 對照表與字型對不上 —— 字型換過了？重跑這支重新生成")
        return 1

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(body + "\n", encoding="utf-8")
    print(f"寫入 {OUT.relative_to(REPO)}")
    # ⚠️ 用位元組不是字元數 —— 中文一個字 3 個位元組，`len(body)` 會低報約三成
    print(
        f"  單音字 {len(table['single'])} 個 · 破音字 {len(table['poly'])} 個"
        f" · {len(body.encode('utf-8'))/1024:.0f} KB"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
