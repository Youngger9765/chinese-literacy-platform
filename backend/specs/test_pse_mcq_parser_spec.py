"""TDD for PSE MCQ line parser (spotlight_pse_parser.py)."""

from __future__ import annotations

import pytest

from app.services.spotlight_pse_parser import parse_pse_mcq_line


@pytest.mark.parametrize(
    "line, expected_answer_substr",
    [
        (
            "❶主角是誰？　　烏鴉　　　□麻雀",
            "烏鴉",
        ),
        (
            "❸問題如何「解決」？□拜託秦王讓給幸姬 □再去買一件 食客潛入寶庫偷回白狐裘",
            "偷",
        ),
    ],
)
def test_parse_pse_mcq_line_answer_not_first_distractor(line: str, expected_answer_substr: str):
    block = parse_pse_mcq_line(line)
    assert block is not None
    assert block["type"] == "single"
    assert expected_answer_substr in (block.get("answer") or "")
