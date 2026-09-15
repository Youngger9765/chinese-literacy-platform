"""診斷報告的破音字要跟課文頁挑同一個音。(#3215)

涵蓋 `poyin_db` 的**全部**多音字 —— 539 個字、3233 個詞樣式。

做法是**客製化的資料表**，不是通用演算法：把詞樣式（`災*`、`*民`、`多*興邦`）
展開成具體的詞，執行期最長詞優先比對。跟 `services/he_conjunction.py` 同一個形狀。

真值來源：`frontend/public/data/poyin_db.json` 的詞樣式表，課文頁用的就是它，
而且已被 #3177 逐字對過字型。案例是從前端自己 committed 的斷言**解析**出來的，不是手抄。

⛔ 不要把 `polyphonicPatternMatcher.ts` 移植進來 —— 複審踩過，移植版漏掉
一/不 變調與 `skipPrev`，吐出 `不 → ㄈㄨ` 這種看起來合理的錯答案。
這裡只做「最長詞優先比對」，跟 `services/he_conjunction.py` 同一個形狀。
"""

from __future__ import annotations

import json
import pathlib
import re

import pytest

from app.routes.learning.learning_reading import _build_zhuyin_map

REPO = pathlib.Path(__file__).resolve().parents[2]
FE_TESTS = [
    REPO / "frontend/src/components/zhuyin/polyphonicReadings.test.ts",
    REPO / "frontend/src/components/zhuyin/reportedWords3173.test.ts",
]
_CASE = re.compile(r"\[\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([a-z]+[0-9])'\s*\]")



def _to_bopomofo(pinyin_with_tone: str) -> str:
    from pypinyin.style.bopomofo import BopomofoConverter

    return BopomofoConverter().to_bopomofo(re.sub(r"5$", "", pinyin_with_tone))


def _cases() -> list[tuple[str, str, str]]:
    out, seen = [], set()
    for path in FE_TESTS:
        if not path.exists():
            continue
        for text, char, pinyin in _CASE.findall(path.read_text(encoding="utf-8")):
            if (text, char) not in seen:
                seen.add((text, char))
                out.append((text, char, _to_bopomofo(pinyin)))
    return out


def test_cases_were_parsed() -> None:
    """前提：真的解析到案例（解析失敗會讓下面那條變成零案例全綠）。"""
    assert len(_cases()) >= 28, f"只解析到 {len(_cases())} 條 —— 正則跟不上檔案格式了"


#: 需要「變調」才能對的案例 —— 詞樣式表管不到。
#:
#: `一`／`不` 的聲調由後一個字的聲調決定（前端 `toneSandhi.ts` 在算），
#: 而 poyin_db 的詞樣式只覆蓋一部分。兩邊都量過：一/不 留在表裡紅 2 條、
#: 排除掉紅 5 條 —— 所以留著，剩這 2 條誠實記成缺口。
#:
#: `strict=True`：有人把變調搬過來的那天這兩條會 XPASS 而整支紅，逼人回來刪掉。
SANDHI_GAPS = {("拿一杯水", "一"), ("一起走", "一")}


@pytest.mark.parametrize("sentence,char,expected", _cases())
def test_diagnosis_matches_the_lesson_page(
    sentence: str, char: str, expected: str, request: pytest.FixtureRequest
) -> None:
    if (sentence, char) in SANDHI_GAPS:
        pytest.xfail("需要變調規則，詞樣式表管不到（見 SANDHI_GAPS）")
    idx = sentence.index(char)
    got = _build_zhuyin_map(sentence).get(idx)
    assert got == expected, f"{sentence!r} 的「{char}」診斷頁標 {got!r}，課文頁是 {expected!r}"


def test_the_table_really_came_from_poyin_db_and_the_font() -> None:
    """committed 的詞表必須真的是從來源推出來的，不是有人手改的。

    #3202 的 `font_readings.json` 有同款的門
    （`test_table_really_came_from_the_shipped_font`），這張表原本沒有 ——
    對抗式複審在 `origin/staging` 上構造了一個完全溜過去的變更來證明：
    改 `因為` 與 `重要` 兩筆，四支注音測試 **94 passed，跟沒改一模一樣**。

    ⛔ 不要把這支改成「比對一份寫死的期望值」—— 那又是一張會過期的表。
    它每次都真的重讀 `poyin_db.json` 與 TTF 重新展開一次。
    """
    import importlib.util

    spec = importlib.util.spec_from_file_location(
        "gpw", pathlib.Path(__file__).resolve().parents[1] / "scripts" / "generate_polyphone_words.py"
    )
    gen = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(gen)

    fresh = gen.build()
    have = json.loads(
        (pathlib.Path(__file__).resolve().parents[1] / "data" / "zhuyin" / "polyphone_words.json")
        .read_text(encoding="utf-8")
    )
    assert have["words"] == fresh["words"], (
        "詞表跟 poyin_db／字型對不上 —— 有人手改了它，或來源變了沒重跑產生器：\n"
        "  `python3 backend/scripts/generate_polyphone_words.py`"
    )
    assert have["_provenance"]["poyin_sha256"], "詞表要記得它從哪來"
