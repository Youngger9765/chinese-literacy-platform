"""句子裡有空格、又給了選項 → 學生必須「選一個填進空格」，不是勾選框。

2026-08-20 staging 實測 L0001《十秒的背後》的「結果」列：

    結果  他成為再度登上奧運（單選） 【 】 的短跑項目的臺灣選手。 ①100公尺 ②400公尺
          可點選項 0 個、輸入框 1 個        ← 選項變成純文字，學生選不到

同一張表的「拿坡里世大運」列（句子裡**沒有**空格）渲染正確，2 個可點選項。
差別就是那個空格。

根因：`parse_inline_choice_groups` 只認 `第N個空格：…` 這種行、而且要求至少 2 組，
它的註解寫著「只有一個空格的情況 parse_checkbox_options 已經處理得對」——
那個假設對「句子沒有空格」的列成立，對「句子有一個空格」的列不成立。

影響面：全庫 175 課掃過，**21 課 / 35 處**（真空格＋選項；
另有 19 課 / 32 處是「指示語＋選項」如「【 單選，請打勾 】」，那些渲染正常，不在此列）。
"""
from __future__ import annotations

from app.services.story_structure_cell_parser import cell_to_structure_fields

# L0001「結果」在服務路徑上的真實字串（橋接器把 options 渲染成 legacy □① 記法接在句子後）
REAL_MIXED = "他成為再度登上奧運（單選）【　】的短跑項目的臺灣選手。\n□①100公尺 ②400公尺"

# 同一張表的「拿坡里世大運」——句子裡沒有空格，這種本來就該是勾選框（負向對照）
REAL_PLAIN_CHECKBOX = "比賽時受傷了，他選擇（單選）\n①積極的面對與復健 □②放棄跑步、不願治療"


def test_sentence_with_one_blank_plus_options_becomes_inline_choice():
    row = cell_to_structure_fields("結果", REAL_MIXED)
    assert row["interactive_type"] == "inline_choice", (
        "句子有空格又有選項 → 學生要把選項填進空格，不是在句子外面勾選"
    )
    assert len(row["blanks"]) == 1
    assert row["blanks"][0]["options"] == ["100公尺", "400公尺"]
    # 句子留著，選項那一行不可以還印在畫面上
    assert "①" not in row["value"] and "②" not in row["value"]
    assert "【" in row["value"], "空格本身要留著，學生才知道要填哪裡"


def test_answer_is_carried_so_grading_still_works():
    row = cell_to_structure_fields("結果", REAL_MIXED)
    # legacy 記法：沒有 □ 的是答案。①100公尺 沒有 □ → correct_option 指向它
    assert row["blanks"][0]["correct_option"] == 1


def test_sentence_without_a_blank_stays_a_checkbox():
    """負向對照：沒有空格的列不可以被改掉 —— 它現在是對的。"""
    row = cell_to_structure_fields("拿坡里世大運", REAL_PLAIN_CHECKBOX)
    assert row["interactive_type"] == "checkbox"
    assert row["options"] == ["積極的面對與復健", "放棄跑步、不願治療"]


def test_instruction_bracket_is_not_a_blank():
    """`【 單選，請打勾 】` 是指示語不是空格 —— 這種列渲染正常，不可以被改成 inline_choice。"""
    text = "在重要比賽，輸球的狀況下，仍然選擇：【 單選，請打勾 】\n□①放棄 ②繼續努力"
    row = cell_to_structure_fields("經過", text)
    assert row["interactive_type"] == "checkbox"


def test_two_groups_still_use_the_existing_multi_blank_path():
    """既有的多空格路徑不可以被這次改動影響。"""
    # 真實格式：legacy 記法用 □ 標誘答，沒有 □ 的是答案。少了 □ 整組不會被認出來
    # （我第一次自己編 fixture 就漏了它，測試紅的是我的字串不是 code）。
    text = "主角覺得自己【　】，但其實他【　】。\n第一個空格：□①輸了 ②贏了\n第二個空格：□①失去 ②贏得"
    row = cell_to_structure_fields("結果", text)
    assert row["interactive_type"] == "inline_choice"
    assert len(row["blanks"]) == 2
