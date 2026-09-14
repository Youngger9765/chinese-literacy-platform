"""朗讀診斷報告上的「和」，當連接詞時要標 ㄏㄢˋ。(#3204)

## 為什麼需要這一道

台灣把當連接詞的「和」讀 **ㄏㄢˋ**。語音那條路 2026-08 就修好了
（案主在 L01「『和』向心力」聽到大陸音），連 380 筆教育部例外清單都建好了 ——
**畫面上的注音從來沒接上去**，語料 730 處全部標成 ㄏㄜˊ，#3202 上線後仍然是。

prod 真環境重現（2026-09-14，`/reading/evaluate` HTTP 200）：

    你和我一起走      「和」→ ㄏㄜˊ   ⛔
    和平相處很重要     「和」→ ㄏㄜˊ   ✓
    一唱一和的默契     「和」→ ㄏㄜˋ   ✓

## 判斷是共用的，不是重寫的

`services/he_conjunction.py`（#3204 從 `tts/normalization.py` 抽出來）。
三道門：jieba 斷詞說「和」是否獨立成詞、380 筆教育部例外清單、
以及「和」自我指稱（`「和」`、`〈和〉`、單獨一個字的 UI 標籤）。

⛔ 不要在這裡另外寫一套判斷。`和平` ㄏㄜˊ、`一唱一和` ㄏㄜˋ、`溫和` ㄏㄜˊ ——
盲換是拿一個錯讀音換另一個，而那份清單是從辭典來的不是猜的。
"""

from __future__ import annotations

import pytest

from app.routes.learning.learning_reading import _build_zhuyin_map
from app.services.he_conjunction import _HE_EXCEPTIONS, _he_conjunction_positions

#: (句子, 「和」該讀什麼, 為什麼)
HE_CASES = [
    ("你和我一起走",   "ㄏㄢˋ", "連接詞 —— prod 重現到的那個"),
    ("爸爸和媽媽",     "ㄏㄢˋ", "連接詞"),
    ("我喜歡貓和狗",   "ㄏㄢˋ", "連接詞"),
    ("和平相處很重要", "ㄏㄜˊ", "和平 在例外清單裡"),
    ("溫和的個性",     "ㄏㄜˊ", "溫和 在例外清單裡（jieba 會把它切成 很溫/和，靠清單擋）"),
    ("一唱一和的默契", "ㄏㄜˋ", "一唱一和 —— 第三個讀音，不是 ㄏㄢˋ 也不是 ㄏㄜˊ"),
    ("「和」這個字",   "ㄏㄜˊ", "自我指稱 —— 引號夾住單一個字，不是連接詞"),
]


@pytest.mark.parametrize("sentence,expected,why", HE_CASES)
def test_he_reading(sentence: str, expected: str, why: str) -> None:
    idx = sentence.index("和")
    got = _build_zhuyin_map(sentence).get(idx)
    assert got == expected, f"{sentence!r} 的「和」標成 {got!r}，應為 {expected!r}（{why}）"


def test_the_case_set_covers_all_three_readings() -> None:
    """正向對照：上面那張表不是「全部都期望 ㄏㄢˋ」。

    少了這條，實作改成「把所有『和』都標 ㄏㄢˋ」會有大半條測試變綠，
    而那正是這張票明令不可以做的事。
    """
    expected = {e for _, e, _ in HE_CASES}
    assert expected == {"ㄏㄢˋ", "ㄏㄜˊ", "ㄏㄜˋ"}, f"案例集只涵蓋 {expected}"


def test_position_survives_an_embedded_number() -> None:
    """「和」的位置判斷要能撐過非中文字元 —— 那是 #3175 修的東西。

    `_he_conjunction_positions` 回的是**原文的字元索引**，而注音 map 是照
    `bopomofo_list` 照長度消耗走出來的。兩套索引必須對得起來，
    否則「和2019年」這種句子會把 ㄏㄢˋ 標到隔壁字上。
    """
    text = "和2019年的我"   # 和=0, "2019"=1..4, 年=5, 的=6, 我=7
    zmap = _build_zhuyin_map(text)
    assert zmap.get(0) == "ㄏㄢˋ", f"位置 0 的「和」拿到 {zmap.get(0)!r}"
    assert zmap.get(5) == "ㄋㄧㄢˊ", f"「年」拿到 {zmap.get(5)!r} —— 索引位移了"
    assert zmap.get(6) == "ㄉㄜ˙", f"「的」拿到 {zmap.get(6)!r} —— 索引位移了"
    # 數字本身不該有注音
    assert not ({1, 2, 3, 4} & set(zmap)), f"數字位置被標了注音：{ {k: zmap[k] for k in zmap if k in {1,2,3,4}} }"


def test_the_exception_list_actually_loaded() -> None:
    """例外清單非空 —— 載不到是靜默的。

    `_load_he_exceptions` fail-open 回空 tuple，那時每個「和」都會被標成 ㄏㄢˋ
    （包括 和平、溫和），而**不會有任何例外或紅燈**。這條直接對著那個症狀斷言。
    ⚠️ 這個檔從 `app/services/tts/` 搬到 `app/services/`，`parents[N]` 少一層 ——
    算錯的唯一症狀就是這個清單變空。
    """
    assert len(_HE_EXCEPTIONS) > 300, f"例外清單只有 {len(_HE_EXCEPTIONS)} 筆 —— 檔案沒讀到或路徑算錯"
    assert "和平" in _HE_EXCEPTIONS
    assert "溫和" in _HE_EXCEPTIONS


def test_no_he_means_no_work() -> None:
    """句子裡沒有「和」時不該去叫 jieba。

    `_he_conjunction_positions` 會載入 jieba 的模型（第一次數百毫秒），
    而絕大多數句子沒有「和」。呼叫端有一個 `if "和" in target_text` 的短路，
    這條確認那個短路真的擋住了。
    """
    import app.routes.learning.learning_reading as mod

    calls = []
    original = mod._he_conjunction_positions
    mod._he_conjunction_positions = lambda t: (calls.append(t), original(t))[1]
    try:
        mod._build_zhuyin_map("今天天氣很好")
        assert calls == [], f"沒有「和」卻還是叫了 jieba：{calls}"
        mod._build_zhuyin_map("你和我")
        assert calls == ["你和我"], f"有「和」卻沒叫：{calls}"
    finally:
        mod._he_conjunction_positions = original
