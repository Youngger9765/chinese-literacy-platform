"""注音挑戰出題模組的契約測試 (#3551)。

generate_zhuyin_questions(lesson_uid) 是獨立模組 zhuyin_challenge 的唯一公開
入口 —— 純函數、不碰 DB、不寫資料、不 import 任何 quiz/contest 模組。

已知答案案例（known-answer cases）直接對到真實課文裡的真實句子，答案是從
backend/data/zhuyin/font_slot_readings.json 的 slots 表手動核對過的（不是從
被測模組反推回來湊出來的數字）：

- 難（3 種讀音，見 backend/scripts/extract_font_readings.py 的 docstring
  範例：0000 -> nan2，ss01 -> nan4，ss02 -> nuo2）：
  L0027 full_text_annotate idx 4 裡「救難」「災難」都是 ss01 -> nan4，
  即教育部注音 ㄋㄢˋ。
- 還（2 種讀音，0000 -> hai2，ss01 -> huan2）：
  L0001 full_text_annotate 裡「可能還不夠呢」是預設槽 -> ㄏㄞˊ；
  L0152 full_text_annotate 裡「再不還錢就要死了」是 ss01 -> ㄏㄨㄢˊ。
- 和（6 種讀音，見 CLAUDE.md 的 _HE_CONJUNCTION_SLOT 說明：0000 -> he2，
  ss01 -> han4，其餘 4 種）：
  L0013 full_text_annotate 裡「成為小和尚」是預設槽 -> ㄏㄜˊ；
  L0001 full_text_annotate 裡「訓練和出賽」是 ss01 -> ㄏㄢˋ（連接詞的和，
  台灣讀音慣例，同 #3238/#3246/#3252 已經修過的那個事實）。
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.services.zhuyin_challenge import (
    ACCEPTED_SECTIONS,
    STOP_LIST,
    ZhuyinQuestion,
    generate_zhuyin_questions,
)

REPO = Path(__file__).resolve().parents[2]
LESSONS = REPO / "backend" / "data" / "lessons"
FONT_SLOT_READINGS = json.loads(
    (REPO / "backend" / "data" / "zhuyin" / "font_slot_readings.json").read_text(
        encoding="utf-8"
    )
)["slots"]


def _questions_for_char(lesson_uid: str, char: str, seed: int = 0) -> list[ZhuyinQuestion]:
    qs = generate_zhuyin_questions(lesson_uid, seed=seed)
    return [q for q in qs if q.char == char]


def _latest_version_dir(lesson_uid: str) -> Path:
    uid_dir = LESSONS / lesson_uid
    versions = sorted(p for p in uid_dir.iterdir() if p.is_dir() and p.name.startswith("v"))
    return versions[-1]


# ---------------------------------------------------------------------------
# Known-answer cases
# ---------------------------------------------------------------------------


def test_nan_has_the_nan4_reading_at_the_documented_disaster_position():
    """難 在「救難」「災難」是 ss01，字型權威讀音是 ㄋㄢˋ（見本檔 docstring
    與 extract_font_readings.py 的「難」範例）。"""
    hits = _questions_for_char("L0027", "難")
    assert len(hits) >= 2, "L0027 應該有至少兩個 難 的題目（救難、災難）"
    for q in hits:
        assert q.options[q.answer_index] == "ㄋㄢˋ"
        assert "ㄋㄢˋ" in q.options
        assert q.sentence[q.target_index] == "難"


def test_nan_has_three_distinct_reading_options_available():
    """難 字型有三種讀音（nan2／nan4／nuo2），選項池最多就是這三個，驗證
    我們沒有自己發明讀音。"""
    hits = _questions_for_char("L0027", "難")
    all_options = set()
    for q in hits:
        all_options.update(q.options)
    assert all_options <= set(FONT_SLOT_READINGS["難"].values())
    assert all_options == set(["ㄋㄢˊ", "ㄋㄢˋ", "ㄋㄨㄛˊ"])


def test_hai_default_reading_is_hai2():
    """還 在「可能還不夠呢」這種預設語境是 ㄏㄞˊ。"""
    hits = _questions_for_char("L0001", "還")
    assert hits, "L0001 應該至少有一題 還"
    for q in hits:
        assert q.options[q.answer_index] == "ㄏㄞˊ"
        assert len(q.options) == 2
        assert set(q.options) == set(["ㄏㄞˊ", "ㄏㄨㄢˊ"])


def test_hai_repay_sense_resolves_to_huan2():
    """還 在「再不還錢就要死了」（償還義）是 ss01 -> ㄏㄨㄢˊ。"""
    hits = _questions_for_char("L0152", "還")
    repay_hits = [q for q in hits if "還錢" in q.sentence]
    assert repay_hits, "L0152 應該有一題含「還錢」"
    for q in repay_hits:
        assert q.options[q.answer_index] == "ㄏㄨㄢˊ"


def test_he_default_reading_in_heshang_is_he2():
    """和 在「成為小和尚」是預設槽 -> ㄏㄜˊ。"""
    hits = _questions_for_char("L0013", "和")
    heshang_hits = [q for q in hits if "和尚" in q.sentence]
    assert heshang_hits, "L0013 應該有一題含「和尚」"
    for q in heshang_hits:
        assert q.options[q.answer_index] == "ㄏㄜˊ"


def test_he_conjunction_sense_resolves_to_han4():
    """和 當連接詞（訓練和出賽）是 ss01 -> ㄏㄢˋ，不是 ㄏㄜˊ。"""
    hits = _questions_for_char("L0001", "和")
    assert hits, "L0001 應該至少有一題 和"
    for q in hits:
        assert q.options[q.answer_index] == "ㄏㄢˋ"


def test_he_has_up_to_four_options_capped_from_six_real_readings():
    """和 有 6 種真實讀音，選項上限是 4（正解 + 最多 3 誘答）。"""
    hits = _questions_for_char("L0001", "和")
    for q in hits:
        assert 2 <= len(q.options) <= 4
        assert len(q.options) == len(set(q.options)), "選項不可重複"


# ---------------------------------------------------------------------------
# Cross-check: every generated question's answer matches the lesson's own
# zhuyin.json + font_slot_readings.json oracle, across a sample of lessons.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "lesson_uid", ["L0001", "L0002", "L0013", "L0020", "L0027", "L0152"]
)
def test_every_answer_matches_the_lesson_zhuyin_oracle(lesson_uid):
    """重新讀一次 zhuyin.json 跟 font_slot_readings.json（不透過被測模組的任何
    內部函式），對每一題重算一次正解，必須跟被測模組吐出來的一致。這是獨立
    的對照，不是「用同一套邏輯驗自己」。"""
    doc = json.loads((_latest_version_dir(lesson_uid) / "zhuyin.json").read_text(encoding="utf-8"))
    texts_by_key = {}
    for item in doc["texts"]:
        if item["section"] not in ACCEPTED_SECTIONS:
            continue
        texts_by_key[(item["section"], item.get("slug"), item.get("idx"))] = item

    qs = generate_zhuyin_questions(lesson_uid, seed=0)
    assert qs, f"{lesson_uid} 應該至少有一題"
    for q in qs:
        section, slug_part, idx_part, pos_str = q.id.split(":")[1:]
        pos = int(pos_str)
        slug = None if slug_part == "-" else slug_part
        idx = None if idx_part.startswith("p") else int(idx_part)
        key = (section, slug, idx)
        item = texts_by_key.get(key)
        assert item is not None, f"找不到對應段落：{q.id}"
        ssz = item["ssz"]
        digit = ssz[pos]
        slot_name = "0000" if digit == "." else "ss" + format(int(digit), "02d")
        expected = FONT_SLOT_READINGS[q.char][slot_name]
        assert q.options[q.answer_index] == expected, (
            f"{q.id} 正解應該是 {expected}，被測模組給了 "
            f"{q.options[q.answer_index]}"
        )


# ---------------------------------------------------------------------------
# Structural contracts
# ---------------------------------------------------------------------------


def test_options_are_distinct_and_answer_appears_exactly_once():
    for lesson_uid in ["L0001", "L0027", "L0152"]:
        qs = generate_zhuyin_questions(lesson_uid, seed=0)
        for q in qs:
            assert 2 <= len(q.options) <= 4
            assert len(q.options) == len(set(q.options))
            assert q.options.count(q.options[q.answer_index]) == 1


def test_target_char_is_at_target_index_in_sentence():
    for lesson_uid in ["L0001", "L0027", "L0152"]:
        qs = generate_zhuyin_questions(lesson_uid, seed=0)
        for q in qs:
            assert q.sentence[q.target_index] == q.char
            assert len(q.sentence) <= 40


def test_determinism_same_seed_same_result():
    a = generate_zhuyin_questions("L0027", seed=42)
    b = generate_zhuyin_questions("L0027", seed=42)
    assert [(q.id, tuple(q.options), q.answer_index) for q in a] == [
        (q.id, tuple(q.options), q.answer_index) for q in b
    ]


def test_no_seed_is_also_deterministic():
    a = generate_zhuyin_questions("L0027")
    b = generate_zhuyin_questions("L0027")
    assert [(q.id, tuple(q.options)) for q in a] == [(q.id, tuple(q.options)) for q in b]


def test_different_seed_changes_option_order_for_at_least_one_question():
    a = generate_zhuyin_questions("L0027", seed=1)
    c = generate_zhuyin_questions("L0027", seed=2)
    assert any(x.options != y.options for x, y in zip(a, c))


def test_limit_is_respected_and_preserves_order():
    full = generate_zhuyin_questions("L0027", seed=1)
    limited = generate_zhuyin_questions("L0027", seed=1, limit=5)
    assert len(limited) == 5
    assert limited == full[:5]


def test_limit_larger_than_available_returns_everything():
    full = generate_zhuyin_questions("L0027", seed=1)
    limited = generate_zhuyin_questions("L0027", seed=1, limit=10_000)
    assert limited == full


def test_unknown_lesson_returns_empty_list():
    assert generate_zhuyin_questions("L9999") == []
    assert generate_zhuyin_questions("not-a-real-uid") == []


def test_stop_list_chars_excluded_when_reading_is_default():
    """的 在 STOP_LIST 裡，L0001 裡的「的」全部是預設讀音 —— 不該出題。"""
    assert "的" in STOP_LIST
    hits = _questions_for_char("L0001", "的")
    assert hits == []


def test_stop_list_does_not_block_a_non_default_occurrence():
    """STOP_LIST 只擋「這個位置剛好是預設讀音」，不是整個字都禁。的 在
    STOP_LIST 裡，但 L0003「的確」是 的 的非預設讀音（ss01），那一題不該
    被濾掉 —— 如果被濾掉了，代表 STOP_LIST 的判斷式連非預設位置也一起擋，
    是實作錯誤。"""
    assert "的" in STOP_LIST
    hits = _questions_for_char("L0003", "的")
    dique_hits = [q for q in hits if "的確" in q.sentence]
    assert dique_hits, "L0003「的確」那一題被 STOP_LIST 誤擋了"


def test_lesson_with_no_qualifying_sections_returns_empty_not_crash():
    """L0136 在 ACCEPTED_SECTIONS 三個 section 都沒有內容（已知缺口，見
    模組 docstring），應該誠實回空清單，不是丟例外。"""
    assert generate_zhuyin_questions("L0136") == []
