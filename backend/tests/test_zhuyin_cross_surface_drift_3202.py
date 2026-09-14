"""同一句話，課文頁跟朗讀診斷頁標的注音對不對得起來。(#3202)

## 為什麼需要這一道

`test_taiwan_zhuyin_readings_3202.py::test_backend_table_agrees_with_the_frontend_projection`
比的是**兩份表對同一個字收了哪些候選讀音** —— 那個 541/541 一致。
但它**不保證同一句話裡兩邊挑同一個**，而學生看到的正是後者。

實測（2026-09-14）：拿前端自己 committed 的 31 條斷言，同樣句子餵後端，
**19 條對不起來**：

    銀行裡的行員  課文 ㄏㄤˊ   診斷 ㄒㄧㄥˊ
    他看著遠方    課文 ㄓㄜ˙   診斷 ㄓㄨˋ
    災難         課文 ㄋㄢˋ   診斷 ㄋㄢˊ
    他跑得快      課文 ㄉㄜ˙   診斷 ㄉㄜˊ

⚠️ **這不是 #3202 造成的，#3202 也沒有修到它** —— 改動前後都是 12 一致。
不一致全落在破音字，而 #3202 只讓單音字查表。誠實的說法是：
#3202 關掉了單音字那條軸，破音字這條軸沒動，而在此之前沒有任何東西在守它。

## 為什麼是棘輪不是 xfail

清單會兩個方向變動：**變多是退步**（新的字對不起來），**變少是進步**
（有人修好了）。兩種都該有人看到，所以用「凍結的集合」比對而不是逐條 xfail：
- 多了 → 紅，訊息說哪一句新壞掉
- 少了 → 紅，訊息說「修好了，請把它從凍結清單移除」

## 真值來源：前端自己 committed 的斷言，不是我重寫一份

案例是從 `polyphonicReadings.test.ts` / `reportedWords3173.test.ts` **解析出來的**，
不是抄進來的 —— 前端改斷言，這裡跟著動。
⛔ 不要改成在這裡維護一份自己的句子清單：那就變成兩份會漂的真值，
正是這支在守的那個病。

（複審提醒過同族的坑：有人曾把前端的 `polyphonicPatternMatcher.ts` 移植到 Python
去量這件事，漏掉一/不變調與 `SPECIAL_DOUBLE_CHARACTERS`，量出來的數字是錯的。
解析斷言沒有移植風險。）
"""

from __future__ import annotations

import pathlib
import re

import pytest

from app.routes.learning.learning_reading import _build_zhuyin_map

REPO = pathlib.Path(__file__).resolve().parents[2]
FE_TESTS = [
    REPO / "frontend/src/components/zhuyin/polyphonicReadings.test.ts",
    REPO / "frontend/src/components/zhuyin/reportedWords3173.test.ts",
]

#: `['銀行裡的行員', '行', 'hang2'],` 這種 parametrize 列
_CASE = re.compile(r"\[\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([a-z]+[0-9])'\s*\]")


def _to_bopomofo(pinyin_with_tone: str) -> str:
    from pypinyin.style.bopomofo import BopomofoConverter

    return BopomofoConverter().to_bopomofo(re.sub(r"5$", "", pinyin_with_tone))


def _frontend_cases() -> list[tuple[str, str, str]]:
    seen: set[tuple[str, str, str]] = set()
    cases: list[tuple[str, str, str]] = []
    for path in FE_TESTS:
        if not path.exists():
            continue
        for text, char, pinyin in _CASE.findall(path.read_text(encoding="utf-8")):
            key = (text, char, pinyin)
            if key not in seen:
                seen.add(key)
                cases.append(key)
    return cases


#: 2026-09-14 凍結：後端跟課文頁挑不同讀音的句子。
#:
#: 一/不 那五筆是**變調**（前端做、後端不做），其餘 14 筆是破音字上下文判讀不同 ——
#: pypinyin 是大陸語料，結構上給不出「銀行 = ㄏㄤˊ」。
#: 真正的修法是讓後端也讀 `poyin_db.json`（詞樣式表，已被 #3177 逐字對過字型），
#: 但它住在 `frontend/public/`，backend 的 Dockerfile 沒有 COPY 它 → 獨立一張票。
FROZEN_DISAGREEMENTS = frozenset({
    # 2026-09-15 #3215 之後只剩這兩筆。原本 19 筆，17 筆由詞樣式表修掉
    # （`poyin_db` 的詞樣式展開成 3167 個詞，執行期最長詞優先比對）。
    #
    # 剩下這兩筆需要真的**變調**規則：`一` 的聲調由後一個字的聲調決定，
    # 前端 `toneSandhi.ts` 在算，而那是規則不是資料 —— 搬規則是另一件事。
    ("拿一杯水", "一"),
    ("一起走", "一"),
})


def test_the_case_list_was_actually_parsed() -> None:
    """前提：正則真的解析到東西。

    解析失敗是靜默的 —— 回空清單，下面那條就變成「零筆全部一致」而全綠。
    這條是那個情況的守衛（見 rules/testing-strategy「靜默跳過」）。
    """
    cases = _frontend_cases()
    assert len(cases) >= 25, (
        f"只從前端測試解析到 {len(cases)} 條斷言 —— 正則跟不上檔案格式了，"
        f"下面那條會變成空轉。檔案：{[p.name for p in FE_TESTS]}"
    )


def test_cross_surface_disagreement_does_not_grow() -> None:
    """課文頁與朗讀診斷頁對同一句話的判讀差異，只准變少不准變多。"""
    cases = _frontend_cases()
    assert cases, "沒有案例 —— 見上一條"

    now = set()
    detail = {}
    for text, char, pinyin in cases:
        want = _to_bopomofo(pinyin)
        idx = text.index(char)
        got = _build_zhuyin_map(text).get(idx)
        if got != want:
            now.add((text, char))
            detail[(text, char)] = f"課文={want} 診斷={got}"

    new = sorted(now - FROZEN_DISAGREEMENTS)
    fixed = sorted(FROZEN_DISAGREEMENTS - now)

    assert not new, "新增了跨畫面不一致（退步）：" + "; ".join(
        f"{t}「{c}」 {detail[(t, c)]}" for t, c in new
    )
    assert not fixed, (
        "以下已經修好了（進步）—— 請把它們從 FROZEN_DISAGREEMENTS 移除，"
        "讓棘輪收緊：" + "; ".join(f"{t}「{c}」" for t, c in fixed)
    )


def test_the_agreeing_half_really_agrees() -> None:
    """正向對照：沒被凍結的那些，現在真的是一致的。

    少了這條，`FROZEN_DISAGREEMENTS` 可能被寫成「全部」而上面那條恆綠。
    """
    cases = _frontend_cases()
    should_agree = [(t, c, p) for t, c, p in cases if (t, c) not in FROZEN_DISAGREEMENTS]
    assert len(should_agree) >= 10, f"只有 {len(should_agree)} 條該一致 —— 凍結清單是不是寫太寬"

    broken = []
    for text, char, pinyin in should_agree:
        idx = text.index(char)
        got = _build_zhuyin_map(text).get(idx)
        want = _to_bopomofo(pinyin)
        if got != want:
            broken.append(f"{text}「{char}」 課文={want} 診斷={got}")
    assert not broken, "本來一致的變得不一致了：" + "; ".join(broken)


# ── #3202 自己的帳：一個修好、兩個變差 ────────────────────────────────────
#
# 破音字對不上時的規則是「音節聽 pypinyin、聲調聽字型」（見 learning_reading.py）。
# 全語料量過（536 個走到該分支的位置、17 個字），這條規則**只改變兩個字**：
#
#   削 ×21  ㄒㄧㄠ → ㄒㄩㄝˋ   ✅ 修好（語料全是 剝削/削弱/瘦削/削減）
#   欸 ×3   ㄟˋ  → ㄞˇ      ⛔ 改壞（正確是 ㄟˋ；pypinyin 給的音節 ㄞ 本身就錯）
#
# 另外一個語料裡沒有、但規則上會錯的：
#
#   削鉛筆  ㄒㄧㄠ → ㄒㄩㄝˋ   ⛔ 本來是**碰巧**對的（退預設剛好對），現在跟著
#                            pypinyin 錯的音節走。語料 0 次，所以不影響學生，但帳要記。
#
# ⛔ **不要試著用一條規則同時修好 削 跟 欸。** 兩者的結構一模一樣
#（pypinyin 挑的音節不在字型候選裡、預設是另一個音節、同音節候選恰好一個），
# repo 內部沒有任何資訊分得開它們 —— 分開它們要靠 `poyin_db.json` 的**詞樣式表**
#（它對兩者都判對：削 有「剝*/*壁/*足/瘦*」、欸 的變體 1 是「*乃」），
# 而那份住在 `frontend/public/`、backend 的 Dockerfile 沒有 COPY 它 → 獨立一張票。
NEW_DISAGREEMENT_FROM_3202 = [
    ("欸你看", "欸", "ㄟˋ", "ㄞˇ"),
]

FIXED_BY_3202 = [
    ("剝削勞工", "削", "ㄒㄩㄝˋ"),
    ("瘦削的臉", "削", "ㄒㄩㄝˋ"),
]


@pytest.mark.parametrize("sentence,char,correct,current", NEW_DISAGREEMENT_FROM_3202)
def test_the_cases_this_change_made_worse_are_recorded(
    sentence: str, char: str, correct: str, current: str
) -> None:
    """斷言的是**現況**，目的是讓它成為可見的帳而不是消失的缺陷。

    有人修好（讓它變成 `correct`）時這條會紅，訊息會告訴他把這一筆刪掉。
    """
    idx = sentence.index(char)
    got = _build_zhuyin_map(sentence).get(idx)
    assert got == current, (
        f"{sentence}「{char}」現在給 {got}（紀錄上是 {current}）。"
        f"如果它已經變成正確的 {correct}，請把這一筆從 NEW_DISAGREEMENT_FROM_3202 刪掉"
    )


@pytest.mark.parametrize("sentence,char,correct", FIXED_BY_3202)
def test_the_cases_this_change_fixed_stay_fixed(sentence: str, char: str, correct: str) -> None:
    """正向對照：上面那筆帳不是「規則整體是壞的」的證據。

    同一條規則修好了 `削`（語料 21 處），這裡把它釘住 —— 否則有人為了
    修 `欸` 把規則整條拿掉，`削` 會靜悄悄退回 ㄒㄧㄠ。
    """
    idx = sentence.index(char)
    assert _build_zhuyin_map(sentence).get(idx) == correct


def test_the_two_cases_are_structurally_indistinguishable() -> None:
    """釘住「為什麼不能用一條內部規則同時修好兩者」。

    下一個人看到 `欸` 會很自然地想再加一條規則去救它。這條直接證明：
    `削` 與 `欸` 在 repo 內部的資訊下長得一模一樣，任何只看字型＋pypinyin 的規則
    都必然同時動到兩者。要分開它們只能引入外部資訊（`poyin_db` 的詞樣式表）。
    """
    from app.routes.learning.learning_reading import _strip_tone
    from app.services.zhuyin_readings import font_zhuyin_table
    from pypinyin import Style, lazy_pinyin

    _, poly = font_zhuyin_table()
    shapes = []
    for sentence, char in [("剝削勞工", "削"), ("欸你看", "欸")]:
        idx = sentence.index(char)
        pick = lazy_pinyin(sentence, style=Style.BOPOMOFO)[idx]
        entry = poly[char]
        same = [r for r in entry["v"] if _strip_tone(r) == _strip_tone(pick)]
        shapes.append((
            pick in entry["v"],                                  # 嚴格比對對不上
            _strip_tone(entry["d"]) == _strip_tone(pick),        # 預設是不是同音節
            len(same),                                           # 同音節候選幾個
        ))
    assert shapes[0] == shapes[1] == (False, False, 1), (
        f"兩者的結構不再相同了（{shapes}）—— 那表示現在有辦法分開它們，"
        "請重新評估規則並更新上面的帳"
    )
