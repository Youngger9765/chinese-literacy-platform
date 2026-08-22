"""結果頁要把答案填回句子 —— 而原本的 regex 對 1198 題全部空轉（#2878）。

## 怎麼發現的

拿真資料把 L0011 從頭抽到尾、跟現有 yml 逐欄比對時撞到的：
我照原稿寫 `(  )`，現有 yml 寫 `（　）`。查慣例才發現**六種寫法並存**，
而前端 `FillInBlankExercise` 的 regex 要求 `（　　）`（**兩個全形空格**）——
全庫 1198 題裡符合的有 **0 題**。

```
791  （　）      全形括號 + 一個全形空格
223  (　)        半形括號 + 一個全形空格
137  (  )            半形括號 + 兩個半形空格
 17  (   )    15  (    )    8  (  　 )
```

⛔ **完全沒有症狀**：畫面照樣渲染、測試照樣綠、API 回應正常。
學生做完看到的是「他精湛的演出，贏得全場觀眾的（　）。」
而不是「…贏得全場觀眾的【喝采】。」

修完 0 → 1196/1198。剩 2 題是子練習的引導語（本來就沒有空格）。
"""
from __future__ import annotations

import pathlib
import re

import yaml

REPO = pathlib.Path(__file__).resolve().parents[2]
COMP = (REPO / "frontend" / "src" / "components" / "reading-steps"
        / "FillInBlankExercise.tsx")


def _frontend_regex() -> re.Pattern:
    """把元件裡的 BLANK_RE 抽出來，用**同一條**去驗語料。

    ⛔ 不要在測試裡自己寫一條「差不多的」—— 那樣測的是我抄過來的那條，
    不是元件真的用的那條，而兩者漂開的時候不會有任何症狀。
    """
    src = COMP.read_text(encoding="utf-8")
    m = re.search(r"const BLANK_RE = /(.+?)/;", src)
    assert m, "元件裡找不到 BLANK_RE"
    return re.compile(m.group(1).replace("\\u3000", "　"))


def _stems() -> list[tuple[str, int, str]]:
    out = []
    for f in sorted((REPO / "backend" / "data" / "lessons").glob(
            "L*/v3/vocab_application.yml")):
        b = (yaml.safe_load(f.read_text(encoding="utf-8")) or {}).get(
            "vocab_application") or {}
        for it in (b.get("items") or []):
            s = str(it.get("stem") or "")
            if s:
                out.append((f.parent.parent.name, it.get("index"), s))
    return out


def test_the_blank_marker_matches_almost_every_question():
    """用**比例**斷言，不是「至少有一題」。

    原本的 regex 命中 0/1198，而「至少有一題命中」那種斷言
    在 0 跟 1196 之間分不出差別。
    """
    rx = _frontend_regex()
    stems = _stems()
    assert len(stems) > 1000, f"只讀到 {len(stems)} 題，語料讀法壞了"
    hit = [s for s in stems if rx.search(s[2])]
    rate = len(hit) / len(stems)
    assert rate >= 0.98, (
        f"空格 regex 只命中 {len(hit)}/{len(stems)}（{rate:.0%}）—— "
        "結果頁會把答案填不回句子裡，而畫面看起來完全正常"
    )


def test_the_two_known_misses_are_not_fill_in_blanks():
    """剩下沒命中的必須是「本來就沒有空格」的，⛔ 不可以是真的漏。"""
    rx = _frontend_regex()
    miss = [s for s in _stems() if not rx.search(s[2])]
    assert len(miss) <= 3, f"沒命中的變多了：{[(u, i) for u, i, _ in miss][:8]}"
    for uid, idx, s in miss:
        assert "請根據語境填入" in s or "下面是一段短文" in s, (
            f"{uid} 第{idx}題沒有空格，但它看起來是填空題：{s[:60]}"
        )


def test_regex_covers_all_six_spellings_that_exist():
    """六種寫法都要認 —— 這是實測全庫數出來的，不是想像的。"""
    rx = _frontend_regex()
    for spelling in ["（　）", "(　)", "(  )", "(   )", "(    )",
                     "(  　 )"]:
        assert rx.search(f"前面{spelling}後面"), f"認不得 {spelling!r}"
