"""每一輪的每個模組，都要有前端真的會讀的那個欄位（#2930）。

同一個形狀已經犯三次 —— 模組在帳本裡叫 A，送到前端的欄位卻叫 B：

    vocab_application  → fill_in_blank / vocab_bank
    keypoints          → story_structure_table
    vocab_definitions  → vocabulary

覆蓋那一層只換同名欄位，於是這幾格永遠退回頂層，三篇共用一份。
沒有錯誤、頁面正常、只有把三篇並排看才發現一模一樣。

這條鎖列出對照表，逐輪檢查。新增模組時對照不上就會紅，
而不是等到有人把三篇並排看才發現。
"""
import json

import pytest

from app.services.lesson_loader import get_lesson_by_id
from app.services.lesson_indexes import _rounds_with_flat_paragraphs

MULTI = [20029, 20063, 20111, 20137, 20144]

# 模組名 → 前端真正讀的欄位。⛔ 新增模組請一起補這裡。
MODULE_TO_FIELD = {
    "full_text_annotate": "paragraphs",
    "key_reading": "key_reading",
    "keypoints": "story_structure_table",
    "vocab_definitions": "vocabulary",
    "vocab_application": "fill_in_blank",
}

# 還沒接線的模組：具名登記，不靜默略過。接線時把它從這裡移走。
NOT_WIRED_YET = {"spotlight", "comprehension"}

# 為了給前端讀而塞進每一輪的產物 —— 它們是 MODULE_TO_FIELD 的右邊，不是模組
DERIVED = set(MODULE_TO_FIELD.values()) | {"vocab_bank"}


@pytest.mark.parametrize("lesson_id", MULTI)
def test_every_round_module_has_its_frontend_field(lesson_id):
    lesson = get_lesson_by_id(lesson_id)
    assert lesson is not None, f"找不到 {lesson_id}"
    rounds = _rounds_with_flat_paragraphs(lesson)
    assert rounds, f"{lesson_id} 沒有 repeat_rounds"

    unknown, gaps, checked = [], [], 0
    for slug, mods in rounds.items():
        for mod, data in mods.items():
            # 衍生欄位（我們自己塞進每一輪的產物），不是模組本身
            if mod in DERIVED or not data:
                continue
            if mod in NOT_WIRED_YET:
                continue
            field = MODULE_TO_FIELD.get(mod)
            if field is None:
                unknown.append(mod)
                continue
            checked += 1
            if not mods.get(field):
                gaps.append(f"{slug}.{mod} → 缺 `{field}`")

    assert not unknown, (
        f"{lesson_id} 出現對照表沒有的模組 {sorted(set(unknown))} —— "
        "請補進 MODULE_TO_FIELD 或 NOT_WIRED_YET，不要讓它靜默通過"
    )
    assert checked > 0, f"{lesson_id} 一個模組都沒檢查到 —— 對照邏輯壞了"  # 正向對照
    assert not gaps, f"{lesson_id} 這幾格會退回頂層（三篇共用）：\n  " + "\n  ".join(gaps)


def test_the_check_catches_a_missing_field():
    """注入一個缺口，這條鎖必須抓到 —— 否則上面五個綠什麼都不證明。"""
    fake_rounds = {"aaaaa": {"vocab_definitions": {"items": [{"word": "x"}]}}}  # 缺 vocabulary
    gaps = [
        f"{s}.{m} → 缺 `{MODULE_TO_FIELD[m]}`"
        for s, mods in fake_rounds.items()
        for m in mods
        if m in MODULE_TO_FIELD and not mods.get(MODULE_TO_FIELD[m])
    ]
    assert len(gaps) == 1 and "vocabulary" in gaps[0], f"該抓到缺口，實際：{gaps}"
