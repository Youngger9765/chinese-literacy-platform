"""TDD for PSE MCQ line parser (scripts/build_lesson_schema.py)."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "scripts"))

from build_lesson_schema import _parse_pse_mcq_line  # noqa: E402


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
    block = _parse_pse_mcq_line(line)
    assert block is not None
    assert block["type"] == "single"
    assert expected_answer_substr in (block.get("answer") or "")
