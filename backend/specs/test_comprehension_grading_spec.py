"""Executable spec — comprehension grading schema and clamping contracts.

spec_id: comprehension.grading.schema_and_fail_closed
canonical_source: backend/app/services/ai_comprehension.py
owns_code: backend/app/services/ai_comprehension.py
related_issues: []
human_spec: specs/modules/comprehension-grading/INTENT.md

Machine-verifiable contracts:

  1. COMPREHENSION_SCORE_SCHEMA requires the four score fields + feedback sub-fields.
  2. Score clamping: values outside [0, 100] are clamped; missing key defaults to 50.
  3. Schema `required` list is complete (no required field accidentally removed).
  4. feedback sub-fields are also required (literal/inferential/evaluative/overall).

We test the SCHEMA definition (static) and the clamping logic (deterministic Python)
without calling the real AI service.

Run:  cd backend && python -m pytest specs/test_comprehension_grading_spec.py -v
"""
from __future__ import annotations

import pytest


def _import_schema():
    try:
        from app.services.ai_comprehension import COMPREHENSION_SCORE_SCHEMA
        return COMPREHENSION_SCORE_SCHEMA
    except Exception as exc:
        pytest.skip(f"Cannot import COMPREHENSION_SCORE_SCHEMA (run from backend/): {exc}")


# ---------------------------------------------------------------------------
# Import the REAL clamping helper from production (was a hand-copy before) so
# these contracts test the actual code path used by evaluate_comprehension().
# ---------------------------------------------------------------------------

from app.services.ai_comprehension import _apply_clamping  # noqa: E402


# ---------------------------------------------------------------------------
# Contract 1: COMPREHENSION_SCORE_SCHEMA shape
# ---------------------------------------------------------------------------

def test_schema_is_object_type():
    schema = _import_schema()
    assert schema.get("type") == "OBJECT", "Schema root type must be OBJECT"


def test_schema_has_four_score_fields():
    """Schema defines comprehension_score, literal_score, inferential_score, evaluative_score."""
    schema = _import_schema()
    props = schema.get("properties", {})
    required_score_fields = {
        "comprehension_score",
        "literal_score",
        "inferential_score",
        "evaluative_score",
    }
    missing = required_score_fields - set(props.keys())
    assert not missing, f"Schema missing score field(s): {missing}"


def test_schema_has_feedback_object():
    """Schema defines a feedback object property."""
    schema = _import_schema()
    props = schema.get("properties", {})
    assert "feedback" in props, "Schema missing 'feedback' property"
    assert props["feedback"].get("type") == "OBJECT", "feedback property must be type OBJECT"


def test_schema_feedback_has_four_subfields():
    """feedback object has literal, inferential, evaluative, overall sub-fields."""
    schema = _import_schema()
    fb_props = schema["properties"]["feedback"].get("properties", {})
    required_fb_fields = {"literal", "inferential", "evaluative", "overall"}
    missing = required_fb_fields - set(fb_props.keys())
    assert not missing, f"feedback schema missing sub-field(s): {missing}"


def test_schema_top_level_required_has_all_five_fields():
    """Top-level required list must include all 4 score fields + feedback."""
    schema = _import_schema()
    required = set(schema.get("required", []))
    expected = {
        "comprehension_score",
        "literal_score",
        "inferential_score",
        "evaluative_score",
        "feedback",
    }
    missing = expected - required
    assert not missing, (
        f"Schema 'required' list missing field(s): {missing}. "
        "Do NOT remove fields from 'required' — AI must always return all score fields."
    )


def test_schema_feedback_required_has_all_four_subfields():
    """feedback.required list must include literal, inferential, evaluative, overall."""
    schema = _import_schema()
    fb_required = set(schema["properties"]["feedback"].get("required", []))
    expected = {"literal", "inferential", "evaluative", "overall"}
    missing = expected - fb_required
    assert not missing, (
        f"feedback.required missing sub-field(s): {missing}. "
        "All feedback sub-fields are required."
    )


# ---------------------------------------------------------------------------
# Contract 2: score clamping correctness
# ---------------------------------------------------------------------------

def test_clamping_normal_values_unchanged():
    """Scores within [0, 100] are unchanged."""
    result = _apply_clamping({
        "comprehension_score": 75.0,
        "literal_score": 80.0,
        "inferential_score": 65.0,
        "evaluative_score": 90.0,
    })
    assert result["comprehension_score"] == 75.0
    assert result["literal_score"] == 80.0
    assert result["inferential_score"] == 65.0
    assert result["evaluative_score"] == 90.0


def test_clamping_negative_becomes_zero():
    """Negative scores are clamped to 0."""
    result = _apply_clamping({
        "comprehension_score": -5.0,
        "literal_score": -100.0,
        "inferential_score": 50.0,
        "evaluative_score": 0.0,
    })
    assert result["comprehension_score"] == 0.0
    assert result["literal_score"] == 0.0


def test_clamping_over_100_becomes_100():
    """Scores above 100 are clamped to 100."""
    result = _apply_clamping({
        "comprehension_score": 150.0,
        "literal_score": 101.0,
        "inferential_score": 100.0,
        "evaluative_score": 99.9,
    })
    assert result["comprehension_score"] == 100.0
    assert result["literal_score"] == 100.0


def test_clamping_missing_key_defaults_to_50():
    """Missing score keys default to 50 (neutral mid-point, not 0 or 100)."""
    result = _apply_clamping({})  # No score fields at all
    assert result["comprehension_score"] == 50.0
    assert result["literal_score"] == 50.0
    assert result["inferential_score"] == 50.0
    assert result["evaluative_score"] == 50.0


def test_clamping_missing_key_default_is_not_zero():
    """The fallback is 50, NOT 0. Zero would unfairly penalise students for AI failures."""
    result = _apply_clamping({})
    for key in ("comprehension_score", "literal_score", "inferential_score", "evaluative_score"):
        assert result[key] != 0.0, f"{key} default must be 50, not 0"


def test_missing_overall_is_derived_from_subscores_not_flat_50():
    """When the model returns sub-scores but omits comprehension_score, the overall
    is DERIVED from the documented weighting (字面30%+推論40%+評鑑30%), not a flat 50 —
    faithful to the sub-scores that ARE present. All-missing still yields 50."""
    result = _apply_clamping({
        "literal_score": 80.0,
        "inferential_score": 60.0,
        "evaluative_score": 40.0,
        # comprehension_score intentionally omitted
    })
    assert result["comprehension_score"] == 60.0  # 0.3*80 + 0.4*60 + 0.3*40
    assert _apply_clamping({})["comprehension_score"] == 50.0  # neutral in all-missing case


def test_clamping_missing_key_default_is_not_100():
    """The fallback is 50, NOT 100. 100 would auto-pass students on AI failures."""
    result = _apply_clamping({})
    for key in ("comprehension_score", "literal_score", "inferential_score", "evaluative_score"):
        assert result[key] != 100.0, (
            f"{key} default must be 50, not 100 — "
            "returning 100 on AI failure violates the fail-closed contract"
        )


def test_clamping_result_keys_are_floats():
    """Clamped values are floats (not ints)."""
    result = _apply_clamping({"comprehension_score": 70, "literal_score": 80,
                               "inferential_score": 60, "evaluative_score": 75})
    for key in ("comprehension_score", "literal_score", "inferential_score", "evaluative_score"):
        assert isinstance(result[key], float), f"{key} should be float after clamping"


def test_clamping_boundary_zero_unchanged():
    """0.0 is exactly at the lower boundary and must not be changed."""
    result = _apply_clamping({"comprehension_score": 0.0, "literal_score": 0.0,
                               "inferential_score": 0.0, "evaluative_score": 0.0})
    for key in ("comprehension_score", "literal_score", "inferential_score", "evaluative_score"):
        assert result[key] == 0.0


def test_clamping_boundary_100_unchanged():
    """100.0 is exactly at the upper boundary and must not be changed."""
    result = _apply_clamping({"comprehension_score": 100.0, "literal_score": 100.0,
                               "inferential_score": 100.0, "evaluative_score": 100.0})
    for key in ("comprehension_score", "literal_score", "inferential_score", "evaluative_score"):
        assert result[key] == 100.0
