"""#3237 —— 表裡沒有的字，後端用「查表」而不是「另一套選擇器」。

## 這裡以前是第二套讀音來源

`_build_zhuyin_map()` 原本是一整套選擇器：pypinyin 看上下文挑音節 + 字型定聲調
+「和」的三道門 + 對不上時的同音節退讓。它跟逐課對照表對同一段課文會給不同答案 ——
#3218 量到全庫 **7,682 / 65,754 個破音字位置（11.7%）**不一致。

而 pypinyin 是**大陸來源**：#3202 就是它造成的（研究 ㄐㄧㄡ、血 ㄒㄩㄝˋ、垃圾 ㄌㄚㄐㄧ）。

## 現在只剩查表

#3230 之後服務端會交給前端的中文字串 100% 在表裡；朗讀評分送來的 `target_text`
實測 **1,695 / 1,696 命中**（唯一沒中的是 L0140 的 `「ㄒㄧ…ㄒㄧ…。」`——
純注音符號，沒有中文字要標）。所以課文走不到這裡，只剩**老師臨時貼的字**。

    單音字     → 字型 `single`（11,050 字，唯一讀音）
    「和」     → `he_conjunction`（jieba + 380 筆教育部例外 + 自我指稱檢查）
    其他破音字 → 字型預設讀音 `d`

三者都是**表自己用的權威**，所以結果跟表一致或退讓，不會有「兩套引擎各說一套」。

## ⚠️ 這個改動的取捨（實測，寫在這裡不要被忘記）

修好的（大陸讀音 → 台灣讀音）：

    研究 ㄐㄧㄡ → ㄐㄧㄡˋ    血液 ㄒㄩㄝˋ → ㄒㄧㄝˇ    垃圾 ㄌㄚㄐㄧ → ㄌㄜˋㄙㄜˋ

變差的（失去上下文判斷，破音字退回字型預設）：

    音樂 ㄩㄝˋ → ㄌㄜˋ      剝削 ㄒㄩㄝˋ → ㄒㄧㄠ     目的地 ㄉㄧˋ → ㄉㄜ˙

⛔ **這是刻意的**：「不準」跟「另一套引擎給出跟表不同的答案」是兩件事，
後者才是 #3202/#3204/#3215 三張票疊出四層的來源。
真正的解是**把老師貼的字也窮舉**（存檔時產表）—— 另一張票。

## 退休的兩個測試

- `test_zhuyin_map_alignment_3175.py` —— 鎖的是 pypinyin 的 zip/長度消耗對齊機制，
  那整套機制不存在了。它的意圖（注音位置不可整串位移）由表的對齊守衛接走：
  `test_served_text_all_in_table_3230` 的「槽位長度 == n == 課文 UTF-16 長度」
  ＋ 產表 oracle 的逐字身分守衛。
- `test_zhuyin_cross_surface_drift_3202.py` —— 鎖的是 pypinyin↔字型的分歧量，
  那個分歧不存在了（只有一個來源）。意圖由 `test_lesson_zhuyin_all_lessons_3218`
  （後端讀表）＋ 前端 `noRuntimeSelector3237.test.tsx`（前端不選）接走。
"""
from __future__ import annotations

import pytest


@pytest.fixture(scope="module")
def build():
    from app.routes.learning.learning_reading import _build_zhuyin_map
    return _build_zhuyin_map


def test_單音字拿字型的讀音(build):
    m = build("勞工")
    assert m[0] == "ㄌㄠˊ" and m[1] == "ㄍㄨㄥ"


def test_和當連接詞讀ㄏㄢˋ(build):
    """⭐ 跟表用同一個 `he_conjunction` 判斷 —— 不是另一套規則。"""
    assert build("我和你")[1] == "ㄏㄢˋ"


def test_和不當連接詞就不是ㄏㄢˋ(build):
    """⛔ 負向對照：不是無腦把「和」全換掉（`和平` 是 ㄏㄜˊ）。"""
    assert build("和平")[0] == "ㄏㄜˊ"


def test_破音字退回字型預設(build):
    """破音字沒有上下文可用時給字型預設 —— 是查表，不是猜。"""
    assert build("音樂")[1] == "ㄌㄜˋ"     # 字型預設；課文裡走表會是 ㄩㄝˋ


@pytest.mark.parametrize("text,idx,want,why", [
    ("研究", 1, "ㄐㄧㄡˋ", "#3202：pypinyin 給 ㄐㄧㄡ（大陸）"),
    ("血液", 0, "ㄒㄧㄝˇ", "#3202：pypinyin 給 ㄒㄩㄝˋ（大陸）"),
    ("垃圾", 0, "ㄌㄜˋ", "#3202：pypinyin 給 ㄌㄚ（大陸）"),
    ("垃圾", 1, "ㄙㄜˋ", "#3202：pypinyin 給 ㄐㄧ（大陸）"),
])
def test_三個大陸讀音被修掉了(build, text, idx, want, why):
    """⭐ 拿掉 pypinyin 的直接好處 —— 這幾個是 #3202 報的原始案例。"""
    assert build(text)[idx] == want, why


def test_沒有中文字就沒有注音(build):
    """⛔ 邊界：純標點/數字/拉丁不該拿到 ruby（#3175 的那個症狀）。"""
    assert build("2019 Wi-Fi 」，") == {}


def test_位置用UTF16單位(build):
    """⛔ 非 BMP 字之後的位置不可以位移（#3230 那輪咬了三次的索引坑）。

    `𪹚`（U+2AE5A）佔 2 個 UTF-16 單位，所以後面的「龍」在 index 2 不是 1。
    """
    m = build("𪹚龍")
    assert 2 in m, f"「龍」不在 index 2 —— 位置用了碼點而不是 UTF-16 單位：{m}"
    assert m[2] == "ㄌㄨㄥˊ"
    assert 1 not in m, "低代理位不該拿到讀音"


def test_不再import_pypinyin():
    """⭐ 結構鎖：pypinyin 不可以再出現在這個模組裡（它是第二個來源的入口）。"""
    import ast
    from pathlib import Path

    src = Path(__file__).resolve().parents[1] / "app/routes/learning/learning_reading.py"
    tree = ast.parse(src.read_text(encoding="utf-8"))
    bad = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            bad += [a.name for a in node.names if "pypinyin" in a.name]
        elif isinstance(node, ast.ImportFrom) and node.module and "pypinyin" in node.module:
            bad.append(node.module)
    assert not bad, f"又 import 了 pypinyin：{bad} —— 讀音請改表，不要在這裡選"
