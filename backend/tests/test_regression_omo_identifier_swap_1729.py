"""Regression: OMO identifier must use gemini-flash-lite-latest@global (per #1729).
Catches if someone reverts identifier model to gemini-2.5-flash.
"""
import os


def test_omo_identifier_routes_to_correct_model():
    from app.services.llm_models import get_model_for_task

    model, location = get_model_for_task("omo_identifier")
    assert model == "gemini-flash-lite-latest", f"expected flash-lite-latest, got {model}"
    assert location == "global", f"expected global, got {location}"


def test_omo_identifier_uses_central_config():
    src = open(
        os.path.join(os.path.dirname(__file__), "..", "app", "services", "omo_identifier.py"),
        encoding="utf-8",
    ).read()
    assert "get_model_for_task" in src or "TASK_MODELS" in src, (
        "omo_identifier.py must route via central config"
    )
