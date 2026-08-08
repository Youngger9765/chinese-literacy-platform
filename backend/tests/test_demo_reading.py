"""TDD contracts for the demo-reading audio/QR batch."""
from __future__ import annotations

import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.routes.assets import _is_safe_object_path
from scripts.build_demo_reading import (
    build_failure_report,
    build_qr_rows,
    plan_demo_audio,
    validate_mp3_bytes,
)


def lesson(*, lesson_id: int, grade: int, passage: str | None = "指定段落") -> dict:
    return {
        "id": lesson_id,
        "grade": grade,
        "grade_code": f"G{grade}-L{lesson_id}",
        "title": f"Lesson {lesson_id}",
        "paragraphs": ["第一段。", "第二段。"],
        "key_reading": {"passage": passage} if passage is not None else None,
    }


def test_grade_planner_uses_full_and_passage_rules() -> None:
    plans = plan_demo_audio(
        [lesson(lesson_id=4, grade=4), lesson(lesson_id=8, grade=8)]
    )

    assert [(item.lesson_id, item.kind) for item in plans] == [
        (4, "full"),
        (4, "passage"),
        (8, "passage"),
    ]


# Every grade the platform actually ships gets its own assertion.
#
# The version of this test that only used G4 and G8 stayed green when the grade
# sets were mutated to drop 7 or 9 — G7 (33 lessons) or G9 (19 lessons) would
# have produced no audio at all, silently. Sampling one grade per branch does
# not test a rule that is defined *by* which grade you are in.
@pytest.mark.parametrize(
    ("grade", "expected_kinds"),
    [
        (4, ["full", "passage"]),
        (5, ["full", "passage"]),
        (6, ["full", "passage"]),
        (7, ["full", "passage"]),
        (8, ["passage"]),
        (9, ["passage"]),
    ],
)
def test_every_shipped_grade_gets_its_documented_outputs(
    grade: int, expected_kinds: list[str]
) -> None:
    plans = plan_demo_audio([lesson(lesson_id=grade * 100, grade=grade)])

    assert [item.kind for item in plans] == expected_kinds


def test_unknown_grade_is_reported_not_silently_dropped() -> None:
    """A grade outside 4-9 must surface, not vanish.

    The planner used to have no else branch, so an unrecognised grade produced
    no plan and no report entry — the lesson simply disappeared from a run that
    still looked complete.
    """
    unknown = lesson(lesson_id=999, grade=3)

    assert plan_demo_audio([unknown]) == []
    reasons = [row["reason"] for row in build_failure_report([unknown])]
    assert reasons == ["unsupported_grade"]


def test_g4_missing_passage_produces_full_only() -> None:
    plans = plan_demo_audio([lesson(lesson_id=41, grade=4, passage=None)])

    assert [(item.lesson_id, item.kind) for item in plans] == [(41, "full")]


def test_mp3_validator_rejects_empty_short_and_non_mp3_bytes() -> None:
    assert validate_mp3_bytes(b"ID3" + b"x" * 1_997) is True
    assert validate_mp3_bytes(b"\xff\xfb" + b"x" * 1_998) is True
    assert validate_mp3_bytes(b"ID3" + b"x" * 2_000) is True
    assert validate_mp3_bytes(b"\xff\xfb" + b"x" * 2_000) is True
    assert validate_mp3_bytes(b"") is False
    assert validate_mp3_bytes(b"ID3" + b"x" * 1_996) is False
    assert validate_mp3_bytes(b"not-an-mp3" + b"x" * 2_000) is False


def test_demo_asset_path_allows_objects_but_rejects_bare_prefix() -> None:
    assert _is_safe_object_path("demo-reading/41/full.mp3") is True
    assert _is_safe_object_path("demo-reading/41/full.png") is True
    assert _is_safe_object_path("demo-reading/") is False
    assert _is_safe_object_path("demo-reading") is False


def test_qr_rows_use_public_demo_url_and_demo_asset_paths() -> None:
    plans = plan_demo_audio([lesson(lesson_id=41, grade=4)])

    rows = build_qr_rows(plans, "https://example.test")

    assert rows[0]["course_id"] == 41
    assert rows[0]["grade"] == 4
    assert rows[0]["url"] == "https://example.test/demo-reading/41/full"
    assert rows[0]["audio_asset_path"] == "demo-reading/41/full.mp3"
    assert rows[0]["qr_asset_path"] == "demo-reading/41/full.png"


def test_failure_report_includes_g8_missing_passage_but_not_g4() -> None:
    rows = build_failure_report(
        [
            lesson(lesson_id=41, grade=4, passage=None),
            lesson(lesson_id=81, grade=8, passage=None),
            lesson(lesson_id=82, grade=8, passage="有段落"),
        ]
    )

    assert rows == [
        {
            "lesson_id": 81,
            "grade": 8,
            "reason": "missing_passage",
            "message": "G8-G9 lesson has no passage",
        }
    ]
