"""重點表：學生看得到的字串裡不可以有 Python 結構，更不可以有答案（#2736）

為什麼需要這支
--------------
`keypoints_to_structure._render_cell` 用 `str(text)` 產出儲存格文字。text 幾乎都是
字串，但有些課把**整個小題寫成 mapping** 塞進那一格，於是 `str()` 印出的是 Python
的 repr：

    {'instruction': '(勾選，可複選)', 'select': 'multi',
     'options': {1: '尷尬', 2: '生氣', 3: '感到丟臉'},
     'answer': [1, 3], 'answer_carrier': '紅色 ☑（圖形）'}

🔴 `'answer': [1, 3]` —— **答案跟題目一起印給學生**。而且 route 的消毒
（`_strip_blank_answers`）只認 `【…】` 這個記法，對 repr 完全無效：
`{'value': '感到【　　　】', 'blanks': [{'answer': '失落'}]}` 消毒過後，空格被挖掉了，
答案卻還原封不動留在後面那半截。挖空格反而讓洩題更醒目。

第二種形狀不帶答案但一樣是 repr：`□①{1: '茫然', 2: '害羞', 3: '緊張'}` ——
`_sidecar()` 把 dict 包成 list（那是給「單數 `_blank`」用的正規化），`_options` 的
dict 被包了之後，`_render_choice_cell` 會把整張選項表當成「第一個選項的文字」。

量的是什麼
----------
⚠️ 斷言打在**學生真的收到的那個 payload** 上，不是橋的輸出 ——
中間還隔著 `_format_yaml_structure_table` 與 `_sanitize_structure_for_client`。
只驗橋等於驗半條路。

⚠️ 判準用**數量**（全庫命中數 == 0），不是「至少有一課是對的」。
被測對象是一族同型實例，抽一課會過的測試證明不了另外 148 課。

兩條鎖故意分開：
  Lock A 抓「學生看到 Python 結構」——涵蓋面大。
  Lock B 抓「答案欄位以任何序列化形式外露」——涵蓋面小但講的是**安全性質**，
         而且對序列化方式不敏感（改用 json.dumps 會躲過 A，躲不過 B）。

⛔ Lock B 不可以寫成「答案的字不准出現在畫面上」。實測過：那樣 149 課有 **97 課**
   會紅 —— 答案多半是「司機」「讓座」「狼」這種普通詞，本來就會出現在課文裡。
   那種門會把好課判死。要抓的是**答案欄位被當成資料印出來**，不是那個詞出現。
"""
from __future__ import annotations

import pathlib
import re
import sys

import pytest
import yaml

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from app.routes.stories import (  # noqa: E402
    _format_yaml_structure_table,
    _sanitize_structure_for_client,
)
from app.services.keypoints_to_structure import (  # noqa: E402
    keypoints_to_structure_table,
)

LESSONS = pathlib.Path(__file__).resolve().parent.parent / "data/lessons"

# Lock A：Python 容器的 repr 漏進文字。`{'k'` / `{1:` / `'k': ` / `[1, 3]`
PY_REPR = re.compile(r"\{\s*['\"\d]|'\s*:\s*|\[\s*\d+\s*,")

# Lock B：答案「欄位」被印出來。故意不綁 repr 的引號寫法 —— json（"answer":）
# 與 kv（answer=）都要抓得到，否則換一種序列化就繞過去了。
ANSWER_FIELD = re.compile(r"""['"]?\banswers?\b['"]?\s*[:=]""")


def _student_view(doc: dict):
    """學生真的收到的那份 payload（橋 → 格式化 → 消毒）。"""
    table = keypoints_to_structure_table(doc)
    if not table:
        return None
    return _sanitize_structure_for_client(_format_yaml_structure_table(table))


def _strings(node, out: list[str]) -> list[str]:
    if isinstance(node, str):
        out.append(node)
    elif isinstance(node, dict):
        for v in node.values():
            _strings(v, out)
    elif isinstance(node, list):
        for v in node:
            _strings(v, out)
    return out


def _keypoints_files(uid: str) -> list[pathlib.Path]:
    """這一課的所有重點表 —— 多篇課一篇一份（#2916）。"""
    return sorted((LESSONS / uid / "v3").glob("keypoints.*.yml"))


def _one_keypoints_doc(uid: str):
    """單篇課的那一份。這幾條鎖的對象都是單篇課，多份時就不是它們要驗的形狀。"""
    files = _keypoints_files(uid)
    assert files, f"{uid} 一份重點表都找不到 —— 是檔名規則變了還是課不見了？"
    return yaml.safe_load(files[0].read_text(encoding="utf-8"))


def _all_student_strings():
    """(uid, 字串) —— 全庫，學生看得到的每一段文字。"""
    # 檔名是 `keypoints.{自己的 slug}.yml`（#2916）。多篇課一課好幾份，
    # 每一份都要掃 —— 只掃第一份的話，第 2、3 篇的洩答案永遠看不到。
    for p in sorted(LESSONS.glob("*/v3/keypoints.*.yml")):
        view = _student_view(yaml.safe_load(p.read_text(encoding="utf-8")))
        if view is None:
            continue
        for s in _strings(view, []):
            yield p.parts[-3], s


def _hits(pattern: re.Pattern) -> list[tuple[str, str]]:
    return [(uid, s) for uid, s in _all_student_strings() if pattern.search(s)]


def test_corpus_is_actually_being_scanned():
    """正向對照：先證明這支測試真的看得到東西。

    少了這條，`LESSONS` 指錯路徑會讓下面兩條變成掃 0 筆的空跑 —— 而空跑是綠的。
    """
    scanned = list(_all_student_strings())
    uids = {uid for uid, _ in scanned}
    assert len(uids) >= 140, f"只掃到 {len(uids)} 課，路徑或載入壞了"
    assert len(scanned) >= 1000, f"只掃到 {len(scanned)} 段文字，不像掃到全庫"


def test_lock_a_no_python_repr_in_student_view():
    """Lock A：學生看得到的字串裡，一個 Python 結構都不可以有。"""
    hits = _hits(PY_REPR)
    per_lesson = sorted({uid for uid, _ in hits})
    assert not hits, (
        f"{len(hits)} 段文字把 Python 結構印給學生看，涵蓋 {len(per_lesson)} 課："
        f"{per_lesson}\n第一筆：{hits[0][0]} → {hits[0][1][:160]}"
    )


def test_lock_b_no_answer_field_reaches_the_student():
    """Lock B：答案欄位不可以用任何序列化形式出現在學生看得到的字串裡。

    這條比 Lock A 重要 —— A 是「難看」，B 是「洩題」。
    """
    hits = _hits(ANSWER_FIELD)
    per_lesson = sorted({uid for uid, _ in hits})
    assert not hits, (
        f"🔴 洩題：{len(hits)} 段文字把答案欄位印給學生看，涵蓋 {len(per_lesson)} 課："
        f"{per_lesson}\n第一筆：{hits[0][0]} → {hits[0][1][:160]}"
    )


@pytest.mark.parametrize(
    "uid,column",
    [("L0004", "感受"), ("L0017", "感受")],
)
def test_choice_cells_render_as_options_not_as_a_dict(uid: str, column: str):
    """回歸鎖（原始壞掉的 case）：選項要渲染成 `①…②…`，不是一坨 dict。

    L0004 = mapping 整個塞進儲存格；L0017 = `{欄名}_options` 被 `_sidecar` 包成 list。
    兩個不同成因，都會印出 dict，所以各鎖一課。
    """
    doc = _one_keypoints_doc(uid)
    table = keypoints_to_structure_table(doc)
    assert table, f"{uid} 橋接不回來"
    cells = [str(c) for row in table for c in row]
    assert not [c for c in cells if PY_REPR.search(c)], f"{uid} 仍有 dict repr"
    assert any("①" in c for c in cells), f"{uid} 應該要有選項記號 ①，實際一個都沒有"


# ─────────────────────────────────────────────────────────────────────────────
# 答案標記：修 repr 的同時，順帶修好「答案寫成 list 就整組標記消失」
#
# `_render_choice_cell` 舊的正規化是 `[question["answer"]]` —— 對 `answer: 1`
# 正確，對 `answer: [1, 3]` 會變成 `[[1, 3]]`，比對時 `correct == {"[1, 3]"}`，
# 沒有任何選項對得上 → **每個選項都加 □** → 一個答案都沒標。
# 畫面上看起來完全正常（選項都在），只是這題沒有答案，而且不會報錯。
#
# 這幾條鎖的是「標記跟原始 YAML 對得上」，不是「有標就好」。
# ─────────────────────────────────────────────────────────────────────────────

MARKS = "①②③④⑤⑥⑦⑧⑨⑩"


def _marked_as_answer(cell: str) -> set[str]:
    """一格裡「沒有 □」的那些序號 —— 依 `_render_choice_cell` 的記法，那就是答案。"""
    return {
        str(MARKS.index(ch) + 1)
        for i, ch in enumerate(cell)
        if ch in MARKS and (i == 0 or cell[i - 1] != "□")
    }


def _cell_containing(uid: str, needle: str) -> str:
    doc = _one_keypoints_doc(uid)
    for row in keypoints_to_structure_table(doc) or []:
        for cell in row:
            if needle in str(cell):
                return str(cell)
    raise AssertionError(f"{uid} 找不到含「{needle}」的儲存格")


@pytest.mark.parametrize(
    "uid,needle,expected",
    [
        # answer: [1, 3]（list 形）—— 修之前這格是「三個選項全部加 □」
        ("L0011", "奧運金牌賽", {"1", "3"}),
        # tail_question 的 answer: [1, 2, 4, 5]
        ("L0124", "讓讀者認識植物肉", {"1", "2", "4", "5"}),
        # answer: 1（scalar 形）—— 這個本來就對，當正向對照：
        # 證明上面兩條的紅不是「答案標記整個壞掉」，而是專屬 list 形
        ("L0011", "忠於自己的球風", {"1"}),
    ],
)
def test_answer_marks_match_the_source(uid: str, needle: str, expected: set[str]):
    assert _marked_as_answer(_cell_containing(uid, needle)) == expected


def test_matrix_sidecar_answers_are_found():
    """矩陣式的 `{欄名}_answers` 要被讀到。

    橋原本只查 `_multi_answer`，但規格（skill §⑥.55b）寫的是 `_answer`／`_answers`
    —— 於是照規格寫的課，答案查無、每個選項都加 □。
    L0017 第一列三個選項全是答案，所以正確結果是「三個都沒有 □」。
    """
    cell = _cell_containing("L0017", "茫然")
    assert _marked_as_answer(cell) == {"1", "2", "3"}, cell
    assert "□" not in cell, cell


# ─────────────────────────────────────────────────────────────────────────────
# 區段標題那一格（第一欄）
#
# 目前沒有任何一課的第一欄是 mapping，所以這條用合成資料。理由是後果不對稱：
# 這一格**不走消毒**（見 `_columns_to_structure_table` 的註解），一旦哪天有課
# 這樣寫，`str()` 出來的 repr 會把答案原封不動印在標題欄，而且不會有人發現。
# ─────────────────────────────────────────────────────────────────────────────

def test_mapping_in_the_section_label_column_never_leaks():
    doc = {
        "keypoints": {
            "columns": ["段落", "內容"],
            "rows": [
                {
                    "段落": {"value": "第一段", "blanks": [{"answer": "不該出現"}]},
                    "內容": "課文內容",
                }
            ],
        }
    }
    table = keypoints_to_structure_table(doc)
    flat = " ".join(str(c) for row in table or [] for c in row)
    assert "第一段" in flat, flat
    assert "不該出現" not in flat, f"區段標題欄洩漏了答案：{flat}"
    assert not PY_REPR.search(flat), f"區段標題欄印出 Python 結構：{flat}"
