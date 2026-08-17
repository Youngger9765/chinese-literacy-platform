"""欄位式重點表（多模態抽取）要能接回既有的 formatter。

為什麼需要這一支：v3 換上去之後，`體-L8` 的重點表在 runtime 變成 5 列全空的
display 列 —— 學生看到一張空表格且不能作答。逐字門、模組拆分、聚光燈 render
全部是綠的，只有 keypoints manifest 的 ratchet 因為 interaction_profile 掉成
display_only 才叫出來。這裡把那個形狀鎖住。
"""
from app.services.keypoints_to_structure import keypoints_to_structure_table


def _rows(table):
    return [r for r in (table or []) if len(r) > 1]


def test_column_shape_produces_paired_rows():
    table = keypoints_to_structure_table({
        "keypoints": {
            "title": "文章重點表",
            "columns": ["主角", "事件"],
            "rows": [{"主角": "小齊", "事件": "輪到小齊站上【　】。",
                      "事件_blanks": [{"answer": "打擊區"}]}],
        }
    })
    assert table is not None, "欄位式讀不到 = 整張表變空的 display 列"
    assert ["文章重點表"] in table
    assert _rows(table) == [["小齊", "事件", "輪到小齊站上【打擊區】。"]]


def test_long_column_name_uses_shortened_sidecar():
    # 欄名「面對失敗的想法」配的旁掛是 `想法_blanks`
    table = keypoints_to_structure_table({
        "keypoints": {"columns": ["主角", "面對失敗的想法"],
                      "rows": [{"主角": "楊勇緯", "面對失敗的想法": "失敗讓他【　】。",
                                "想法_blanks": [{"answer": "不甘心"}]}]},
    })
    assert _rows(table)[0][-1] == "失敗讓他【不甘心】。"


def test_bare_blanks_belongs_to_the_last_column():
    table = keypoints_to_structure_table({
        "keypoints": {"columns": ["故事結構", "內容摘要"],
                      "rows": [{"故事結構": "【　】/案由",
                                "故事結構_blank": {"answer": "起因"},
                                "內容摘要": "【　】媽媽的布被偷了。",
                                "blanks": [{"answer": "江乙"}]}]},
    })
    row = _rows(table)[0]
    # 第一欄刻意不填答案：它在原始形式裡是區段標題，而消毒只處理 value —— 填了
    # 學生就直接看到「【起因】/案由」。preview 實測踩過，答案留在 yml 供教師端用。
    assert row[0] == "【　】/案由", "第一欄不可以填答案，那會讓學生看到答案"
    assert row[-1] == "【江乙】媽媽的布被偷了。", "裸 `blanks` 沒接到 → 主要內容欄的答案掉了"


def test_label_shape_still_works():
    # 第一版的形狀不可以因為加了欄位式就壞掉
    table = keypoints_to_structure_table({
        "keypoints": {"title": "重點表",
                      "rows": [{"label": "段一", "value": "需要驚人的__。",
                                "blanks": [{"answer": "記憶力"}]}]},
    })
    assert ["段一", "需要驚人的【記憶力】。"] in table


def test_empty_bracket_gap_is_a_gap():
    # 第一版寫 `__`，多模態寫 `【　】`，兩種都要認得
    table = keypoints_to_structure_table({
        "keypoints": {"columns": ["A", "B"],
                      "rows": [{"A": "x", "B": "填【　】這裡", "B_blanks": [{"answer": "答"}]}]},
    })
    assert _rows(table)[0][-1] == "填【答】這裡"
