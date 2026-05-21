"""Regression: OMO grader LOCKED on gemini-2.5-flash @ us-central1 (per #1730 spatial reasoning).
Catches if anyone tries to swap grader to lite model for cost savings.
"""


def test_omo_grader_locked_on_2_5_flash():
    from app.services.llm_models import get_model_for_task

    model, location = get_model_for_task("omo_grader")
    assert model == "gemini-2.5-flash", f"LOCKED per #1730, got {model}"
    assert location == "us-central1", f"LOCKED per #1730, got {location}"
