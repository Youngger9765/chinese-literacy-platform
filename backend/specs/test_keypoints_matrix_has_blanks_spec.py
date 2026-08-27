"""matrix 佈局的重點表也要挖空，不能把答案直接印出來（#2930 續）。

`list` 佈局的列帶 `blanks`，轉換器據此挖空 → 學生有 6 格可填。
`matrix` 佈局的列長這樣：`{項目, X_answer, X_options}` —— 沒有 `blanks`，
走另一條 `_columns_to_structure_table`，那條**沒有把 `_answer` 挖成空格**。

結果：整張表把答案印出來，畫面顯示「已填 0 / 0 題」，學生沒得做也直接看光答案。
擁有者 2026-08-27 在 G6-L22 第 3 篇（layout=matrix）看到。全庫 28 課是 matrix。
"""
import pytest

from app.services.keypoints_to_structure import keypoints_to_structure_table

# 真實形狀：G6-L22 第 3 篇（7wavn）
import json
import pathlib

FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "keypoints_matrix_L0063_p3.json"
MATRIX_KP = json.loads(FIXTURE.read_text(encoding="utf-8"))   # G6-L22 第 3 篇的真實資料


def _fillable(table) -> int:
    """有幾格是學生要作答的：`【…】` 填空，或 `□` 選擇題。"""
    j = json.dumps(table, ensure_ascii=False)
    return j.count("【") + j.count("□")


def test_matrix_layout_produces_fillable_cells():
    """matrix 佈局要有可作答的格子，不能整張把答案印出來。"""
    table = keypoints_to_structure_table(MATRIX_KP)
    assert table, "matrix 佈局轉不出表"
    assert len(table) >= 6, f"資料列掉了 —— 原始 6 列，只轉出 {len(table) - 1} 列"
    n = _fillable(table)
    assert n > 0, (
        "整張表沒有任何可作答的格子 —— 答案會直接印在畫面上，"
        f"學生沒得做也看光答案。轉出：{str(table)[:200]}"
    )


def test_answer_suffixed_columns_are_not_printed_bare():
    """`{欄名}_answer` 的內容不可以裸著印出來（要嘛選擇題要嘛空格）。"""
    table = keypoints_to_structure_table(MATRIX_KP)
    j = json.dumps(table, ensure_ascii=False)
    bare = []
    for row in MATRIX_KP.get("rows", []):
        for k, v in row.items():
            if not (isinstance(k, str) and k.endswith(("_answer", "_answers"))):
                continue
            t = str(v).strip()
            if t and t in j and f"【{t}】" not in j and "□" not in j:
                bare.append(t[:16])
    assert not bare, f"這些答案裸著印在學生畫面上：{bare}"


def test_list_layout_still_works():
    """正向對照：list 佈局本來就會挖空，不能被這次改動弄壞。"""
    # 真實形狀（G6-L22 篇 1）：value 裡有 `【　】` 佔位，答案在 blanks
    list_kp = {
        "layout": "list",
        "title": "物以稀為貴",
        "rows": [{
            "label": "問題／答案",
            "label_printed": "問題  /答 案",
            "value": "本文想回答的問題：什麼因素決定市場商品價格？\n作者的答案：【\u3000】",
            "blanks": [{"answer": "市場的供給和需求"}],
        }],
    }
    table = keypoints_to_structure_table(list_kp)
    assert table and _fillable(table) > 0, "list 佈局的挖空壞了"


# ── codex 複審指出的缺口（2026-08-27）─────────────────────────────────────
# matrix 路徑原本只認 flat cell / `_answer` / `_options` / `_blanks` / `option_bank`。
# 全庫實際還有 `_choices`（10 處，一格內多個獨立選擇題）與
# `_sub_items`（1 處，帶 label 的多個小題）—— 這兩種會靜默退成 display，
# 學生看到答案卻不能作答。

L0137 = json.loads((pathlib.Path(__file__).parent / "fixtures" / "keypoints_matrix_L0137.json").read_text(encoding="utf-8"))
L0063 = json.loads((pathlib.Path(__file__).parent / "fixtures" / "keypoints_matrix_L0063.json").read_text(encoding="utf-8"))


def _bare_answers(kp) -> list[str]:
    """該作答卻裸著印出來的答案文字。"""
    table = keypoints_to_structure_table(kp)
    j = json.dumps(table, ensure_ascii=False)
    bare = []
    for row in kp.get("rows", []):
        if not isinstance(row, dict):
            continue
        for k, v in row.items():
            if not (isinstance(k, str) and k.endswith(("_choices", "_sub_items", "_items"))):
                continue
            for sub in (v if isinstance(v, list) else [v]):
                if not isinstance(sub, dict):
                    continue
                opts = sub.get("options")
                vals = list(opts.values()) if isinstance(opts, dict) else (opts or [])
                for t in vals:
                    t = str(t).strip()
                    # 選項本身要出現，而且要帶作答記號（□）才算可作答
                    if t and t in j and "□" not in j:
                        bare.append(f"{k}:{t}"[:24])
    return bare


def test_choices_sidecar_is_answerable():
    """`_choices`（一格多個獨立選擇題）要渲染成可勾選，不能只印文字。"""
    assert not _bare_answers(L0137), (
        f"L0137 的 _choices 沒有變成可作答的題目：{_bare_answers(L0137)[:4]}"
    )


def test_sub_items_sidecar_is_answerable():
    """`_sub_items`（帶 label 的多個小題）同理。"""
    assert not _bare_answers(L0063), (
        f"L0063 的 _sub_items 沒有變成可作答的題目：{_bare_answers(L0063)[:4]}"
    )
