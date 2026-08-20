"""一格裡同時有「填空」和「選擇題空格」—— 兩者要各自可作答。

L0102「對網紅實驗的批判」的來源自我描述得很清楚：

    value:          "(1)…根本【　】。\\n(2)…→電子煙是【　】到肺裡的，\\n網紅把煙油【　】下肚，…"
    blanks:         [{answer: "看不見"}]                                  ← 第 1 個空格是填空
    inline_choices: [{locator: "電子煙是【…】到肺裡的", answer: 1},        ← 第 2 個
                     {locator: "網紅把煙油【…】下肚",   answer: 2}]        ← 第 3 個

橋接器把選項標成「第一個空格」「第二個空格」——**用的是 inline_choices 的順序，
不是空格在句子裡的位置**。於是 3 個空格對 2 組選項，數量對不上，
分類器只好整格退回 checkbox：兩組長得一樣的「吸/吃」被攤平，
學生看到一堆勾選框，不知道哪組對應哪個空格（#2785）。

`locator` 就是用來講清楚這件事的欄位，只是沒人讀它。
"""
from __future__ import annotations

from app.services.story_structure_cell_parser import cell_to_structure_fields

# 橋接器**應該**產出的形狀：選項標在它真正對應的那個空格序號上
BRIDGED = (
    "(1)棉花肺實驗的問題\n"
    "→A.棉花不等於人的肺。B.…很多有害物質如尼古丁、重金屬根本【　】。\n"
    "(2)煙油食材實驗的問題(單選)\n"
    "→電子煙是【　】到肺裡的，\n"
    "網紅把煙油【　】下肚，完全沒有說明吸電子煙對人體的影響。\n"
    # ⚠️ 這兩行不是我編的，是 `_sentence_with_inline_choices` 對 L0102 的實際輸出
    # （我第一版自己寫、把 □ 標反了，害答案斷言跟著錯）。
    "第二個空格：①吸 □②吃\n"
    "第三個空格：□①吸 ②吃"
)


def test_a_cell_with_one_text_blank_and_two_choice_blanks_is_inline_choice():
    row = cell_to_structure_fields("對網紅實驗的批判", BRIDGED)
    assert row["interactive_type"] == "inline_choice", (
        "3 個空格配 2 組選項就整格退回 checkbox —— 兩組『吸/吃』會被攤平"
    )


def test_every_blank_gets_a_slot_and_only_the_choice_ones_carry_options():
    row = cell_to_structure_fields("對網紅實驗的批判", BRIDGED)
    blanks = row["blanks"]
    assert len(blanks) == 3, f"句子有 3 個空格，blanks 應該也是 3 個：{blanks}"
    assert not blanks[0].get("options"), "第 1 個是填空，不該有選項"
    assert blanks[1]["options"] == ["吸", "吃"]
    assert blanks[2]["options"] == ["吸", "吃"]


def test_the_two_identical_option_sets_keep_their_own_answers():
    """兩組選項字面一樣（吸/吃），答案不同 —— 攤平就分不出來了。"""
    row = cell_to_structure_fields("對網紅實驗的批判", BRIDGED)
    # 0-based（判分是 `options[correct_idx]`）。來源 inline_choices 說
    # 「電子煙是【吸】到肺裡的」「網紅把煙油【吃】下肚」——語意上也對得起來。
    assert row["blanks"][1]["correct_option"] == 0, "吸"
    assert row["blanks"][2]["correct_option"] == 1, "吃"


def test_the_caption_lines_are_gone_from_the_sentence():
    row = cell_to_structure_fields("對網紅實驗的批判", BRIDGED)
    v = row["value"]
    assert "第二個空格" not in v and "第三個空格" not in v, v
    assert "①" not in v and "②" not in v, v


def test_the_existing_all_choices_shape_still_works():
    """負向對照：每個空格都是選擇題的既有形狀不可以被改壞。"""
    text = "主角覺得自己【　】，但其實他【　】。\n第一個空格：□①輸了 ②贏了\n第二個空格：□①失去 ②贏得"
    row = cell_to_structure_fields("結果", text)
    assert row["interactive_type"] == "inline_choice"
    assert len(row["blanks"]) == 2
    assert all(b.get("options") for b in row["blanks"])


def test_a_plain_fill_blank_cell_is_untouched():
    """負向對照：沒有任何選項的純填空維持 fill_blank。"""
    row = cell_to_structure_fields("主角", "他叫【　　　】，今年【　　　】歲。")
    assert row["interactive_type"] == "fill_blank"
