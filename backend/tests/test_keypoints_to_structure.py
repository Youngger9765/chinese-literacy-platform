"""Regression lock for the 重點表 source bridge (#2683).

The failure this guards is quiet and expensive: if `story_structure_table` comes back
empty, `/stories/{id}/structure` does not error — it falls through and asks an LLM to
invent a table. The page still renders, so nothing looks broken; the student is just
no longer seeing the table the teacher wrote. So the tests that matter here are the
ones that pin "returns None, never an empty list" and the round-trip through the real
corpus.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services.keypoints_to_structure import keypoints_to_structure_table as K  # noqa: E402


# ── shape gating: absent must stay absent, never an empty table ────────────

def test_nothing_usable_returns_none_not_empty():
    """None makes the caller fall through exactly as before. An empty list would
    render as a stripped 重點表 — content-shaped, but with nothing in it."""
    for junk in (None, {}, [], "x", {"keypoints": {}}, {"keypoints": {"rows": []}}):
        assert K(junk) is None, junk


def test_rows_that_all_get_skipped_return_none_too():
    """The early shape checks catch an EMPTY rows list, but a non-empty list whose
    every entry is unusable reaches the end with nothing built. That path must also
    return None — mutation-checked: without it, the junk cases above all bail out
    earlier and the final `or None` is never exercised."""
    assert K({"rows": ["nope", 7, None]}) is None


def test_accepts_both_wrapped_and_bare_forms():
    """keypoints.yml nests under a `keypoints:` key; the story dict carries the
    inner dict directly. Both reach this function depending on the caller."""
    bare = {"rows": [{"label": "主角", "value": "小明"}]}
    assert K(bare) == K({"keypoints": bare})


# ── cell rendering ────────────────────────────────────────────────────────

def test_blank_answer_is_restored_into_the_cell():
    out = K({"rows": [{"label": "主角", "value": "__",
                       "blanks": [{"answer": "楊俊瀚", "hint": ""}]}]})
    assert out == [["主角", "【楊俊瀚】"]]


def test_placeholder_cell_is_replaced_not_appended():
    """A cell that is only underscores IS the blank; keeping it would render 「__【答】」."""
    assert K({"rows": [{"label": "x", "value": "＿＿",
                        "blanks": [{"answer": "答"}]}]}) == [["x", "【答】"]]


def test_prompt_text_is_kept_when_the_cell_says_something():
    out = K({"rows": [{"label": "x", "value": "主角是",
                       "blanks": [{"answer": "小明"}]}]})
    assert out == [["x", "主角是【小明】"]]


# ── answers go INTO the gaps, not after them ──────────────────────────────

def test_answers_fill_the_gaps_they_belong_to():
    """The cell text carries the gaps as underscore runs. Appending the answers
    instead printed the answer key beside the question — 「需要驚人的__與__。
    【記憶力】【反應力】」 — so the student saw both the gap and its answer, and
    the gap could no longer be answered. Real case: G8-L11."""
    out = K({"rows": [{"label": "x", "value": "需要驚人的__與__。",
                       "blanks": [{"answer": "記憶力"}, {"answer": "反應力"}]}]})
    assert out == [["x", "需要驚人的【記憶力】與【反應力】。"]]


def test_a_gap_with_no_answer_keeps_its_underscores():
    """An unanswered gap is a content gap. Filling it would be inventing an answer."""
    out = K({"rows": [{"label": "x", "value": "__跟__", "blanks": [{"answer": "甲"}]}]})
    assert out == [["x", "【甲】跟__"]]


def test_an_answer_with_no_gap_is_appended_not_dropped():
    """Losing an answer silently is worse than placing it imperfectly."""
    out = K({"rows": [{"label": "x", "value": "只有__",
                       "blanks": [{"answer": "甲"}, {"answer": "乙"}]}]})
    assert out == [["x", "只有【甲】【乙】"]]


def test_a_single_underscore_is_not_treated_as_a_gap():
    """One underscore occurs inside ordinary text; only a run of two or more is a
    gap the teacher drew."""
    out = K({"rows": [{"label": "x", "value": "a_b", "blanks": [{"answer": "甲"}]}]})
    assert out == [["x", "a_b【甲】"]]


def test_blank_with_no_answer_is_not_rendered_as_an_empty_marker():
    """An unanswered blank must not become 【】 — that reads as a real blank cell."""
    assert K({"rows": [{"label": "x", "value": "y",
                        "blanks": [{"answer": "  "}]}]}) == [["x", "y"]]


def test_multiple_blanks_in_one_cell():
    out = K({"rows": [{"label": "x", "value": "",
                       "blanks": [{"answer": "甲"}, {"answer": "乙"}]}]})
    assert out == [["x", "【甲】【乙】"]]


# ── row shapes ────────────────────────────────────────────────────────────

def test_title_becomes_a_single_cell_leading_row():
    out = K({"title": "十秒的背後", "rows": [{"label": "a", "value": "b"}]})
    assert out[0] == ["十秒的背後"]


def test_nested_sub_rows_become_a_paired_block():
    out = K({"rows": [{"label": "挫折事件", "sub_rows": [
        {"sub_label": "亞運", "template": "銀牌"},
        {"sub_label": "世大運", "template": "受傷"},
    ]}]})
    assert out == [["挫折事件", "亞運", "銀牌", "世大運", "受傷"]]


def test_sub_row_cells_always_come_in_pairs():
    """`_parse_yaml_table_row` only reads a long row as paired when the remainder
    after the label is even; an odd remainder silently collapses into one joined
    cell. Every shape that reaches here must keep that remainder even."""
    for subs in (
        [{"sub_label": "a", "template": "1"}],
        [{"sub_label": "a", "template": "1"}, {"sub_label": "b"}],   # missing template
        ["not-a-dict", {"sub_label": "a", "template": "1"}],
    ):
        out = K({"rows": [{"label": "s", "sub_rows": subs}]})
        assert out, subs
        assert (len(out[0]) - 1) % 2 == 0, out


def test_non_dict_rows_are_skipped_not_crashed():
    assert K({"rows": ["nope", {"label": "a", "value": "b"}, 7]}) == [["a", "b"]]


# ── the real corpus ───────────────────────────────────────────────────────

def test_every_converted_lesson_formats_through_the_real_route_formatter():
    """End-to-end: the converted table must survive `_format_yaml_structure_table`,
    which is what actually serves the 重點表. A table that converts but does not
    format is the same silent LLM fall-through, one step later."""
    from app.routes.stories import _format_yaml_structure_table
    from app.services.lesson_loader import _ALL_LESSONS

    converted = [l for l in _ALL_LESSONS if l.get("story_structure_table")]
    assert len(converted) >= 100, f"only {len(converted)} lessons carry a table"
    for lesson in converted:
        result = _format_yaml_structure_table(lesson["story_structure_table"])
        assert result.get("rows"), f"{lesson['grade_code']} formatted to zero rows"
