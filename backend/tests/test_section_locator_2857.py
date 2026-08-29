"""定位器三個純函式的 unit test（#2857）。

## 為什麼要單獨測這三個

`candidates` / `locate` / `spans` 決定每一架飛機讀哪幾頁 —— 它們錯了，
飛機就去讀別人那一節，而**症狀是「抽到一半」不是「失敗」**。

它們的輸入是 `list[str]`，不需要 PDF、不需要 `private/`，所以**CI 跑得動**。
在這之前它們只能靠人在有原稿的機器上手跑，等於沒有守護。

三個 case 各自對應一個**真的發生過**的 bug，不是想像出來的：

| 測 | 真實來源 |
|---|---|
| 子字串吃掉命中 | L0029「閱讀理解」命中在「綜合閱讀理解」那一頁 → 游標跳到第 19 頁，**後面八個大題全滅** |
| 內文提及 vs 標題 | L0085「讀全文-做記號」第 5 頁那個是交叉引用（`□②沒學過這篇課文…`），真標題在第 6 頁 |
| 標題沒印出來 | L0075「語詞我最棒」全份文字層 0 命中，但前後鄰居定位得到 |
"""
from __future__ import annotations

import importlib.util
import pathlib

import pytest

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]


def _load():
    spec = importlib.util.spec_from_file_location(
        "build_section_pages", REPO_ROOT / "scripts" / "build_section_pages.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="module")
def bsp():
    return _load()


def test_normalise_ignores_punctuation_and_width(bsp):
    """`讀全文-做記號` 在紙上可能印成全形破折號 —— 那不該影響定位。"""
    assert bsp.normalise("讀全文-做記號") == bsp.normalise("讀全文－做記號")
    assert bsp.normalise("語詞我最棒") == bsp.normalise("語 詞 我 最 棒\n")


def test_longer_sibling_name_eats_the_hit(bsp):
    """L0029：「閱讀理解」唯一的命中其實是「綜合閱讀理解」那一頁。"""
    names = ["閱讀理解", "綜合閱讀理解"]
    texts = [bsp.normalise(t) for t in ["前言", "綜合閱讀理解 第一題"]]
    got = bsp.candidates(names, texts)
    assert got[0] == [], "「閱讀理解」不該把「綜合閱讀理解」那一頁認成自己的"
    assert got[1] == [2]


def test_a_wrong_hit_must_not_destroy_the_sections_after_it(bsp):
    """這是 L0029 真正的災情：貪心取第一個命中會把游標推過頭。

    「閱讀理解」在紙上根本沒印（只有第 4 頁那個「綜合閱讀理解」），
    貪心版會把它定位到第 4 頁，於是它後面的大題只能從第 4 頁之後找 —— 全滅。
    """
    names = ["念順順", "閱讀理解", "語詞我最棒", "綜合閱讀理解"]
    texts = [bsp.normalise(t) for t in [
        "念順順 計時", "語詞我最棒 語詞框", "其他內容", "綜合閱讀理解 第一題",
    ]]
    starts = bsp.locate(names, texts)
    assert starts[0] == 1
    assert starts[1] is None, "沒印出來就該是 None，不是硬指一個頁碼"
    assert starts[2] == 2, "它不該被前一個大題的錯誤命中連坐"
    assert starts[3] == 4


def test_the_hanzi_ordinal_separates_a_title_from_a_mention(bsp):
    """L0085：第 5 頁是內文交叉引用，第 6 頁才是標題。

    判別材料是 `sections_present` 已經有的漢字序號 —— 標題長成「一 讀全文-做記號」，
    內文提及不會帶序號。
    """
    names = ["讀全文-做記號"]
    texts = [bsp.normalise(t) for t in [
        "沒學過這篇課文請從讀全文-做記號開始",   # p1 內文提及
        "一 讀全文-做記號 Level 7 說明文",        # p2 真標題
    ]]
    assert bsp.candidates(names, texts) == [[1, 2]], "沒有序號時兩頁都是候選"
    assert bsp.candidates(names, texts, ["一"]) == [[2]], "有序號時只留標題那一頁"


def test_repeated_section_names_are_separated_by_order_not_by_name(bsp):
    """多文本課同一個大題名出現兩次 —— 名字分不出第幾篇，靠單調性分。"""
    names = ["語詞我最棒", "語詞應用", "語詞我最棒", "語詞應用"]
    texts = [bsp.normalise(t) for t in [
        "語詞我最棒", "語詞應用", "語詞我最棒", "語詞應用",
    ]]
    assert bsp.locate(names, texts) == [1, 2, 3, 4]


def test_span_includes_the_next_sections_first_page(bsp):
    """本節的尾巴可能就印在下一節開始的那一頁上半 —— 寧可多一頁。"""
    assert bsp.spans([1, 4], 6) == [([1, 2, 3, 4], "located"), ([4, 5, 6], "located")]


def test_unlocated_section_is_bracketed_by_neighbours_not_given_the_whole_document(bsp):
    """L0075：標題沒印，但它仍然夾在前後兩個定位得到的大題之間。

    ⛔ 這條在擋的是「定位不到就給全份」—— 那會讓門變綠而拆分的收益歸零。
    """
    got = bsp.spans([2, None, 5], 20)
    assert got[1] == ([2, 3, 4, 5], "bracketed")
    assert len(got[1][0]) < 20, "夾出來的範圍必須遠小於全份"


def test_a_lesson_with_nothing_located_gets_no_pages_at_all(bsp):
    """一個都沒定位到 = 定位器壞了。⛔ 不要拿全份頁碼粉飾成「有頁碼」。"""
    assert bsp.spans([None, None], 9) == [([], "unlocated"), ([], "unlocated")]
