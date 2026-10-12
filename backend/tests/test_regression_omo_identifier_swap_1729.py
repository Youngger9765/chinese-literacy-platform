"""Regression: OMO identifier must use gemini-2.5-flash-lite@global.
#1729 moved it to gemini-flash-lite-latest; that alias now returns 404 NOT_FOUND
on Vertex global, so identification failed (#3440). Catches a revert to it.
"""
import os


def test_omo_identifier_routes_to_correct_model():
    from app.services.llm_models import get_model_for_task

    model, location = get_model_for_task("omo_identifier")
    assert model == "gemini-2.5-flash-lite", f"expected gemini-2.5-flash-lite, got {model}"
    assert model != "gemini-flash-lite-latest", "gemini-flash-lite-latest returns 404 (#3440)"
    assert location == "global", f"expected global, got {location}"


def test_omo_identifier_uses_central_config():
    src = open(
        os.path.join(os.path.dirname(__file__), "..", "app", "services", "omo_identifier.py"),
        encoding="utf-8",
    ).read()
    assert "get_model_for_task" in src or "TASK_MODELS" in src, (
        "omo_identifier.py must route via central config"
    )
