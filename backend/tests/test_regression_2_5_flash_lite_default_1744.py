"""Regression: 8 text/JSON tasks use gemini-2.5-flash-lite (-78% cost vs flash-lite-latest, per #1744).
Catches if someone reverts to flash-lite-latest.
"""
import pytest


EIGHT_TEXT_TASKS = [
    "socratic_question",
    "socratic_agent_process",
    "comprehension_score",
    "sentence_validate",
    "exit_ticket_generate",
    "example_sentences",
    "story_structure",
    "reading_analysis",
]


@pytest.mark.parametrize("task", EIGHT_TEXT_TASKS)
def test_text_task_uses_2_5_flash_lite(task):
    from app.services.llm_models import get_model_for_task

    model, location = get_model_for_task(task)
    assert model == "gemini-2.5-flash-lite", (
        f"{task} should use 2.5-flash-lite per #1744, got {model}"
    )
    assert location == "global"
