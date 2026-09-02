"""#3043 — 詞語庫填空型的 vocab_definitions 被整批過濾成空.

真實壞過的 case: L0137/L0145/L0146/L0147/L0167/L0168/L0169 七課的
vocab_definitions yml 在磁碟上存在、items 有 8-14 筆, 但 API 的
vocabulary 欄位是空的 -> 學生看不到語詞理解, #3026 的編者標也整課消失.

根因: 這七課是「詞語庫填空型」學習單 -- 詞不放在 `word` 欄位, 放在
`answer`(學生從 word_bank 挑答案填進定義旁), 而 _vocabulary_from 的
過濾條件只認 `i.get("word")`, 於是 11 筆 items 全部被靜默丟掉 --
沒有錯誤、section 存在、items 有料, 只有最後的輸出是 0.

fixture 直接取自 L0137 的真實形狀(縮短), 不是自己編的.
"""

from app.services.lesson_indexes import _vocabulary_from


def _lesson_with_items(items):
    # v3 形狀: 模組攤在 lesson 頂層, 外層包 {lesson_uid, ..., vocab_definitions: {...}}
    # (照 _sections/_unwrap 的實際讀法, 不是 v2 的 sections list)
    return {
        "lesson_uid": "LTEST",
        "vocab_definitions": {
            "lesson_uid": "LTEST",
            "vocab_definitions": {"items": items},
        },
    }


def test_word_shape_still_works():
    """對照組: 一般 word/definition 形狀(147 課的樣子)不能被這次修動壞."""
    lesson = _lesson_with_items(
        [{"index": 1, "word": "血脈賁張", "definition": "形容情緒非常激動、緊張。"}]
    )
    vocab = _vocabulary_from(lesson)
    assert vocab == [{"word": "血脈賁張", "definition": "形容情緒非常激動、緊張。"}]


def test_answer_shape_word_bank_lessons():
    """L0137 的真實形狀: 詞在 answer 欄位. 修好前這裡回 [] (紅)."""
    lesson = _lesson_with_items(
        [
            {"index": 1, "definition": "形容一個地方住的人很少，較少有人活動。", "answer": "人煙稀少"},
            {"index": 2, "definition": "不將心裡的情緒或計畫表現出來。", "answer": "不動聲色"},
        ]
    )
    vocab = _vocabulary_from(lesson)
    assert len(vocab) == 2, (
        "詞語庫填空型(word 缺席、詞在 answer)整批被過濾成空 -- "
        "這正是 #3043 七課學生看不到語詞理解的原因"
    )
    assert vocab[0] == {"word": "人煙稀少", "definition": "形容一個地方住的人很少，較少有人活動。"}


def test_word_wins_when_both_present():
    """兩個欄位都有時 word 優先 -- answer 在混合形狀裡可能是別的意思."""
    lesson = _lesson_with_items(
        [{"index": 1, "word": "甲", "definition": "d", "answer": "乙"}]
    )
    assert _vocabulary_from(lesson)[0]["word"] == "甲"


def test_empty_rows_still_dropped():
    """負向對照: 兩個欄位都沒有的列仍要被丟掉, 不能因為放寬就吐垃圾."""
    lesson = _lesson_with_items(
        [
            {"index": 1, "definition": "只有定義沒有詞"},
            {"index": 2, "word": "有效", "definition": "d"},
        ]
    )
    vocab = _vocabulary_from(lesson)
    assert len(vocab) == 1
    assert vocab[0]["word"] == "有效"
