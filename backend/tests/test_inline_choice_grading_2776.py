"""Grading regression lock for `inline_choice` rows (#2776).

A sentence with two blanks, each with its own tiny option set, is graded one
answer item per blank — index comparison, not fuzzy text match (that's what
plain fill_blank does). This locks the new branch in
`app.services.ai_generation.story_structure.grade_story_structure`.
"""
from __future__ import annotations

import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from app.services.ai_generation import grade_story_structure  # noqa: E402


def _l0011_result_structure() -> dict:
    return {
        "rows": [
            {
                "label": "事例",
                "value": "",
                "interactive_type": "display",
                "sub_rows": [
                    {
                        "label": "結果",
                        "value": "結果，小戴【　　　】球賽，卻【　　　】全國人民的尊敬。",
                        "interactive_type": "inline_choice",
                        "blanks": [
                            {"options": ["贏了", "輸了"], "correct_option": 1},
                            {"options": ["贏得", "失去"], "correct_option": 0},
                        ],
                    },
                ],
            },
        ],
    }


@pytest.mark.asyncio
class TestInlineChoiceGrading:
    async def test_both_blanks_correct_scores_100(self):
        structure = _l0011_result_structure()
        answers = [
            {"row_index": 0, "sub_row_index": 0, "blank_index": 0, "selected_option": 1},
            {"row_index": 0, "sub_row_index": 0, "blank_index": 1, "selected_option": 0},
        ]
        result = await grade_story_structure(structure, answers)
        assert result["score"] == 100
        assert all(r["correct"] for r in result["results"])

    async def test_one_blank_wrong_scores_50_and_reveals_that_blanks_own_answer(self):
        structure = _l0011_result_structure()
        answers = [
            {"row_index": 0, "sub_row_index": 0, "blank_index": 0, "selected_option": 0},  # wrong: 贏了
            {"row_index": 0, "sub_row_index": 0, "blank_index": 1, "selected_option": 0},  # correct: 贏得
        ]
        result = await grade_story_structure(structure, answers)
        assert result["score"] == 50
        by_blank = {r["blank_index"]: r for r in result["results"]}
        assert by_blank[0]["correct"] is False
        assert by_blank[0]["correct_answer"] == "輸了"
        assert by_blank[1]["correct"] is True

    async def test_missing_selection_scores_wrong_not_a_crash(self):
        """學生沒選就送出（selected_option 缺席）—— 判錯，不是 500。"""
        structure = _l0011_result_structure()
        answers = [
            {"row_index": 0, "sub_row_index": 0, "blank_index": 0, "selected_option": None},
            {"row_index": 0, "sub_row_index": 0, "blank_index": 1, "selected_option": 0},
        ]
        result = await grade_story_structure(structure, answers)
        by_blank = {r["blank_index"]: r for r in result["results"]}
        assert by_blank[0]["correct"] is False

    async def test_correct_option_never_required_to_reach_client_but_grading_still_works(self):
        """伺服器端結構仍要帶 `correct_option`（消毒器才是拿掉它的那一層），
        不然這裡什麼都判不出來 —— 呼應 checkbox 的
        `test_grading_still_has_the_answers_it_needs`。
        """
        structure = _l0011_result_structure()
        blanks = structure["rows"][0]["sub_rows"][0]["blanks"]
        assert all("correct_option" in b for b in blanks)
