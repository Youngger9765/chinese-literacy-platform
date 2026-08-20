"""選項寫在跟空格同一個括號裡的第三種寫法 —— `【□①多 ②少】`。

#2776 修好的是「第N個空格：①A ②B」那種獨立說明行的寫法。
這種更早期的寫法把選項直接塞在空格的括號內，偵測訊號完全不同，所以沒被接到。

L0072「工作記憶與閱讀速度的關係」服務之後長這樣：

    interactive_type: checkbox
    options: ['多', '多', '好']        ← 只有答案、還重複，跟句子的 6 個空格對不上
    blanks:  None                      ← 來源明明有每格自己的 options + answer，被丟掉了
    value:   '…越大【　　　】…越【　　　】；…'

學生看到 6 個空框配一組重複的 3 選項，選不出東西來。

來源其實是自帶完整資訊的，兩種形狀都是：
  - L0072：`blanks: [{answer, choice_index, options}, …]`
  - L0080 / L0098：括號內用 `☑` 標答案、`□` 標誘答（沒有標記的依 legacy 慣例也是答案）

全庫 3 課 / 6 列。
"""
from __future__ import annotations

from app.services.story_structure_cell_parser import cell_to_structure_fields

# 以下全部取自 backend/data/lessons/*/v3/keypoints.yml 的真實字串
L0080 = "1.學生有【☑①充足 □②少量】的課後時間進行體育活動\n2.經常舉辦校內、校際的體育競賽。"
L0098_A = (
    "對原住民的刻板印象：與原住民互動時，強調酒量與膚色，"
    "加深對原住民族群的【 □①憐憫　□②尊重　☑③偏見 】。"
)
L0098_B = "微歧視的特點在於它【 □①明顯　☑②隱蔽 】，因此難以被發現和改正。"


def test_single_bracket_group_becomes_one_inline_choice_blank():
    row = cell_to_structure_fields("學校", L0080)
    assert row["interactive_type"] == "inline_choice", row["interactive_type"]
    assert len(row["blanks"]) == 1
    assert row["blanks"][0]["options"] == ["充足", "少量"]


def test_the_tick_marks_the_answer():
    """`☑` 標的是答案，而且索引是 **0-based**。

    🔴 我第一版寫成 1-based，測試也照著寫，所以測試綠、東西是壞的：
    判分那邊是 `options[correct_idx]`（`ai_generation/story_structure.py`），
    兩選項會把正解判成錯的，三選項且答案在最後一個直接越界。
    **測試會鎖住錯的慣例** —— 這條的斷言必須跟判分端對齊，不是跟我的直覺對齊。
    """
    row = cell_to_structure_fields("學校", L0080)
    assert row["blanks"][0]["correct_option"] == 0, "☑①充足 是答案（0-based，判分用 options[idx]）"

    row_b = cell_to_structure_fields("2", L0098_B)
    assert row_b["blanks"][0]["correct_option"] == 1, "☑②隱蔽 是答案（0-based）"


def test_three_options_with_the_tick_in_the_middle():
    row = cell_to_structure_fields("1", L0098_A)
    assert row["interactive_type"] == "inline_choice"
    assert row["blanks"][0]["options"] == ["憐憫", "尊重", "偏見"]
    assert row["blanks"][0]["correct_option"] == 2  # ☑③偏見，0-based


def test_the_option_text_is_gone_from_the_sentence():
    """括號裡的選項不可以還印在句子上 —— 那就是學生看到選項兩次。"""
    row = cell_to_structure_fields("學校", L0080)
    v = row["value"]
    assert "①" not in v and "②" not in v and "☑" not in v and "□" not in v, v
    assert "充足" not in v and "少量" not in v, v
    assert "【" in v, "空格本身要留著，學生才知道填哪裡"


def test_a_plain_checkbox_row_is_not_affected():
    """負向對照：選項在括號**外面**的一般勾選列不可以被改掉。"""
    plain = "比賽時受傷了，他選擇（單選）\n①積極的面對與復健 □②放棄跑步、不願治療"
    row = cell_to_structure_fields("拿坡里世大運", plain)
    assert row["interactive_type"] == "checkbox"


def test_a_plain_blank_row_is_not_affected():
    """負向對照：純填空（括號裡沒有選項）維持 fill_blank。"""
    row = cell_to_structure_fields("主角", "【　　　】")
    assert row["interactive_type"] == "fill_blank"


# 橋接器會把 options 另外渲染成 legacy 記法接在句尾。這是 G7-L12 走完
# `_format_yaml_structure_table` 之後的**真實**字串 —— 只清括號那一層的話，
# 選項會在畫面上出現兩次（第一版就是這樣，靠 snapshot diff 才發現）。
POST_BRIDGE = (
    "1.學生有【☑①充足 □②少量】的課後時間進行體育活動\n"
    "2.經常舉辦校內、校際的體育競賽。\n①充足 ②少量"
)


def test_the_bridge_appended_option_line_is_stripped_too():
    row = cell_to_structure_fields("學校", POST_BRIDGE)
    assert row["interactive_type"] == "inline_choice"
    assert row["blanks"][0]["options"] == ["充足", "少量"]
    v = row["value"]
    assert "①" not in v and "②" not in v, f"選項還印在句子上：{v!r}"
    assert "充足" not in v and "少量" not in v, v


def test_an_unmarked_bracket_group_is_left_alone():
    """🔴 完全沒有 ☑/□ 標記時，文字流沒有告訴我們答案 —— 不可以猜。

    體-L* 的 `（①緊張　②雀躍）（①肯定　②批評）` 就是這種：
    答案在來源的 `內容_choices`（分別是 1 和 2），不在文字裡。
    照「第一個沒 □ 的是答案」去套，第二組會把「肯定」標成正解，而正解是「批評」。
    把錯的標成對的，比不標更糟。
    """
    text = "3.小宇站在罰球線，心裡十分【①緊張　②雀躍】\n4.佳恩準備上場，腦中都是他人【①肯定  ②批評】的聲音"
    row = cell_to_structure_fields("舉例", text)
    assert row["interactive_type"] != "inline_choice", (
        "沒有標記卻自己判了答案 —— 這會把錯的選項標成正解"
    )
