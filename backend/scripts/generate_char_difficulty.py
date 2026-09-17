#!/usr/bin/env python3
"""產出「哪個字對哪個年級算難」的凍結表（#3247）。

## 為什麼是表不是規則

跟注音同一套架構（#3218/#3230）：**難易度是教材的屬性，離線算好、執行期查表**。
差別只在注音是逐課逐字，這裡是全庫逐字 —— 一個字的難易不隨課文改變。

## 難的定義

    難（對就讀 G 年級的孩子）= 這個字在整套教材裡少見          （出現課數 < 總課數 × cut_ratio）
                           且 不是更低年級就教過的            （首見年級 >= G）

兩個訊號都從**這 179 課的課文本文**算出來，不需要外部字表。

## cut_ratio 是量出來的，不是猜的（2026-09-17）

目標：標記率落在「鷹架」的量級 —— 標太多退化成全注音，標太少等於沒做。
逐年級各自校準出來的 cut 落在 4–11 課，單一門檻 7 課（= 7/179 ≈ 3.9%）
在每個年級都給出跟逐年級校準幾乎相同的結果：

    G4 3.3% · G5 3.1% · G6 2.4% · G7 1.4% · G8 1.4% · G9 0.6% · 文言/品格 0.4%

所以用單一 `cut_ratio`，不做逐年級表 —— 多一張表就多一個會漂移的地方。

## ⚠️ 已知的資料邊界

**四年級是這套教材的地板**，「更低年級教過」那條對 G4 篩不掉任何東西，所以 G4
幾乎全靠字頻。字頻是**這 179 課的**字頻，不是中文的字頻 —— 於是「休 玉 拍 棒
肩 胸 腰 腿」這種生活常用但在本教材少見的字，對 G4 會被判成難。

真正的解是接**教育部分年字表**（哪個字幾年級教）。在那之前這是可得的最佳代理，
而且它已經把家長點名的九個字（之加千同大失小手成）全部排除掉了。
接上分年字表時，改的是這支腳本的 `first_grade` 來源，不是消費端。
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

_CJK = re.compile(r"[㐀-䶿一-鿿\U00020000-\U0002FA1F]")
_OUT = _BACKEND / "data" / "zhuyin" / "char_difficulty.json"
_LESSONS = _BACKEND / "data" / "lessons"

# 一課標多少 —— 取「最少見的 3% 相異字」，下限 3 個（下限在服務層 `_PICK_MIN`）。
#
# ⚠️ 為什麼是逐課比例而不是全域門檻：全域門檻（出現 <= N 篇算難）的標記率會隨年級
#    崩掉 —— 九年級與無年級課程只剩 ~0.3%，整篇課文標一個字。逐課取比例把量由
#    構造保證：實測 179 課中位 1.8%、最低 1.03%、最高 5.3%，各年級 1.6–2.0%。
PICK_RATIO = 0.03

# ⛔ 無年級的課（catalog_slot 是「文-L10」「品-…」「體-…」）**不要指派一個假年級**。
#    上一版拿 9 當它們的年級，於是「首見年級 >= 9」對那 27 課幾乎篩不掉東西，
#    標記率掉到 0.3%（複審 2026-09-17 擋下）。現在它們在表裡就是沒有年級，
#    服務層看到沒有年級就只用罕見度排序。


def lesson_grade(uid: str) -> int | None:
    """從 `lesson.yml` 的 `catalog_slot: G4-L12` 取年級。非 G 開頭的回 None。"""
    from app.services.lesson_uid_loader import _latest_version

    vdir = _latest_version(_LESSONS / uid)
    if vdir is None:
        return None
    f = vdir / "lesson.yml"
    if not f.is_file():
        return None
    m = re.search(r"^catalog_slot:\s*G(\d+)-", f.read_text(encoding="utf-8"), re.M)
    return int(m.group(1)) if m else None


def lesson_body_chars(uid: str) -> set[str]:
    """這一課**課文本文**的相異漢字。

    ⛔ 語料的定義（哪些 section 算本文）**只有一份**，在
       `app.services.lesson_zhuyin.lesson_body_text` —— 執行期查表用的是同一支。
       這裡不要自己再寫一遍條件：兩邊分岔的話，表裡沒有的字會被執行期當成
       「不在任何課文出現過」而靜靜地不標，沒有任何訊息。
    """
    from app.services.lesson_zhuyin import lesson_body_text

    return {c for c in (lesson_body_text(uid) or "") if _CJK.match(c)}


def _body_fingerprint(uid: str) -> str:
    """課文本文的指紋 —— 用來認出「同一篇課文掛在不同年級」。"""
    import hashlib

    from app.services.lesson_zhuyin import lesson_body_text

    return hashlib.sha256((lesson_body_text(uid) or "").encode("utf-8")).hexdigest()


def build() -> dict:
    from app.services.lesson_uid_loader import available_uids

    # ⚠️ 按**相異課文**去重，不是按課號（2026-09-17 實測才發現）。
    #
    # 同一篇課文會掛在好幾個年級（氣象小幫手同時是 L0003 G4 與 L0085 G7；
    # 小和尚那篇有五個課號）。不去重的話：
    #   ① 字頻被灌水 —— 一篇課文的字看起來像出現在 5 課
    #   ② 更慘的是首見年級 —— 判 L0085(G7) 時，「蜘」的首見年級是 4（來自它**自己**
    #      的 G4 分身）→ 判定成「三年前就教過」→ 整課難字清空
    # 症狀就是 #3247 回報的「開關看起來壞掉」的另一半。
    texts: dict[str, dict] = {}          # 課文指紋 → {grade, chars, uids}
    for uid in sorted(available_uids()):
        chars = lesson_body_chars(uid)
        if not chars:
            continue
        body = _body_fingerprint(uid)
        g = lesson_grade(uid)
        e = texts.setdefault(body, {"grade": None, "chars": chars, "uids": []})
        e["uids"].append(uid)
        if g is not None:
            e["grade"] = g if e["grade"] is None else min(e["grade"], g)

    first: dict[str, int] = {}
    seen = collections.Counter()
    for e in texts.values():
        for c in e["chars"]:
            seen[c] += 1
            if e["grade"] is not None:
                first[c] = min(first.get(c, 99), e["grade"])

    # 課號 → 這篇課文的**正典年級**（它最早出現在哪個年級）。判定要用這個，
    # 不是課號自己的年級 —— 否則同一篇課文的高年級分身會被自己的低年級分身蓋掉。
    canonical: dict[str, int] = {}
    for e in texts.values():
        if e["grade"] is None:
            continue          # 沒有年級就不寫進表 —— 服務層據此走「只看罕見度」
        for uid in e["uids"]:
            canonical[uid] = e["grade"]

    return {
        "_provenance": {
            "generator": "backend/scripts/generate_char_difficulty.py",
            "corpus": "課文本文（full_text_annotate），按相異課文去重",
            "lesson_uids_with_body": sum(len(e["uids"]) for e in texts.values()),
            "note": "first = 首見年級（相異課文計）；n = 出現在幾篇相異課文",
        },
        "total_lessons": len(texts),
        "pick_ratio": PICK_RATIO,
        "lesson_grade": dict(sorted(canonical.items())),
        "chars": {c: [first.get(c, 99), n] for c, n in sorted(seen.items())},
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="重算並跟committed 的表比對，不寫檔")
    a = ap.parse_args()
    table = build()
    if a.check:
        if not _OUT.is_file():
            print(f"❌ {_OUT} 不存在")
            return 1
        have = json.loads(_OUT.read_text(encoding="utf-8"))
        if have == table:
            print(f"✅ 表與課文一致（{len(table['chars'])} 字 / {table['total_lessons']} 課）")
            return 0
        print("❌ 表與課文不一致 —— 課文改過但沒重產。跑 `python backend/scripts/generate_char_difficulty.py`")
        return 1
    _OUT.write_text(
        json.dumps(table, ensure_ascii=False, indent=1, sort_keys=False) + "\n",
        encoding="utf-8",
    )
    print(f"寫入 {_OUT}：{len(table['chars'])} 字 / {table['total_lessons']} 課 / 每課取最少見的 {table['pick_ratio']:.0%}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
