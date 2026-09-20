"""GET /api/stories/{id} exposes worksheet_available: {student, teacher} (#3276).

This endpoint is unauthenticated (see get_story in routes/stories.py) — the
booleans here are not sensitive (no URL, no path), just "does a downloadable
copy of each edition currently exist". The role gate lives entirely on the
download endpoint (test_worksheet_teacher_download_3276.py), not here.
"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.lesson_loader import get_all_lessons
from app.services import worksheet_registry

client = TestClient(app)

FIRST_LESSON_ID = min(l["id"] for l in get_all_lessons())


def test_worksheet_available_field_is_present_and_boolean():
    resp = client.get(f"/api/stories/{FIRST_LESSON_ID}")
    assert resp.status_code == 200
    data = resp.json()
    assert "worksheet_available" in data
    avail = data["worksheet_available"]
    assert isinstance(avail, dict)
    assert isinstance(avail["student"], bool)
    assert isinstance(avail["teacher"], bool)


def test_unknown_or_unmapped_lesson_reports_both_false(tmp_path, monkeypatch):
    """A lesson_uid absent from the mapping (or with an empty mapping file
    entirely) must report false/false, not crash and not default-true."""
    p = tmp_path / "gcs_mapping.json"
    p.write_text(json.dumps({"lessons": {}}), encoding="utf-8")
    monkeypatch.setattr(worksheet_registry, "_MAPPING_PATH", p)
    worksheet_registry._clear_cache_for_tests()
    try:
        resp = client.get(f"/api/stories/{FIRST_LESSON_ID}")
        assert resp.status_code == 200
        assert resp.json()["worksheet_available"] == {"student": False, "teacher": False}
    finally:
        worksheet_registry._clear_cache_for_tests()


def test_flag_flips_true_once_mapping_says_uploaded(tmp_path, monkeypatch):
    """Proves this is real wiring, not a hardcoded false — point the registry
    at a lesson_uid actually served by lesson_loader with an uploaded entry."""
    from app.services.lesson_loader import get_lesson_by_id
    lesson = get_lesson_by_id(FIRST_LESSON_ID)
    uid = lesson.get("lesson_uid")
    if not uid:
        pytest.skip("first lesson has no lesson_uid (legacy layer1 lesson) — nothing to wire")

    mapping = {
        "lessons": {
            uid: {
                "catalog_slot": "TEST",
                "teacher": {"gcs_path": f"worksheets-gated/{uid}-teacher.docx", "gcs_uploaded": True},
                "student": {"gcs_path": f"worksheets-gated/{uid}-student.docx", "gcs_uploaded": False},
            }
        }
    }
    p = tmp_path / "gcs_mapping.json"
    p.write_text(json.dumps(mapping), encoding="utf-8")
    monkeypatch.setattr(worksheet_registry, "_MAPPING_PATH", p)
    worksheet_registry._clear_cache_for_tests()
    try:
        resp = client.get(f"/api/stories/{FIRST_LESSON_ID}")
        assert resp.status_code == 200
        assert resp.json()["worksheet_available"] == {"student": False, "teacher": True}
    finally:
        worksheet_registry._clear_cache_for_tests()
