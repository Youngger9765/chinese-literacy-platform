"""Contract tests for GET /api/omo/lessons — Phase 1b sub-feature 2 (Issue #1591).

Tests:
    /api/omo/lessons returns a list of [{lesson_id, grade_code, title}]
    /api/omo/lessons is accessible without auth
    /api/omo/lessons returns at least 1 lesson (lesson_loader has 57+ lessons)
    /api/omo/lessons items are sorted by lesson_id

Run:
    cd backend && python -m pytest tests/test_omo_lessons.py -v
"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient

from app.main import app

# ---------------------------------------------------------------------------
# Reuse the main app (no DB needed for this endpoint)
# ---------------------------------------------------------------------------

client = TestClient(app, raise_server_exceptions=True)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_lessons_endpoint_accessible_without_auth():
    """GET /api/omo/lessons should return 200 without Authorization header."""
    res = client.get("/api/omo/lessons")
    assert res.status_code == 200, f"Expected 200, got {res.status_code}: {res.text}"


def test_lessons_returns_list():
    """Response must be a JSON array."""
    res = client.get("/api/omo/lessons")
    assert res.status_code == 200
    data = res.json()
    assert isinstance(data, list), f"Expected list, got {type(data)}"


def test_lessons_at_least_one_entry():
    """There must be at least 1 lesson in the lesson_loader."""
    res = client.get("/api/omo/lessons")
    data = res.json()
    assert len(data) >= 1, f"Expected at least 1 lesson, got {len(data)}"


def test_lessons_item_schema():
    """Each item must have lesson_id (int), grade_code (str), title (str)."""
    res = client.get("/api/omo/lessons")
    data = res.json()
    for item in data[:5]:  # spot check first 5
        assert "lesson_id" in item, f"Missing lesson_id in {item}"
        assert "grade_code" in item, f"Missing grade_code in {item}"
        assert "title" in item, f"Missing title in {item}"
        assert isinstance(item["lesson_id"], int), f"lesson_id must be int: {item}"
        assert isinstance(item["grade_code"], str), f"grade_code must be str: {item}"
        assert isinstance(item["title"], str), f"title must be str: {item}"
        assert len(item["title"]) > 0, f"title must not be empty: {item}"


def test_lessons_sorted_by_lesson_id():
    """Items must be returned in ascending lesson_id order."""
    res = client.get("/api/omo/lessons")
    data = res.json()
    ids = [item["lesson_id"] for item in data]
    assert ids == sorted(ids), f"Lessons not sorted by lesson_id: {ids[:10]}"


def test_lessons_no_duplicates():
    """No duplicate lesson_ids in the response."""
    res = client.get("/api/omo/lessons")
    data = res.json()
    ids = [item["lesson_id"] for item in data]
    assert len(ids) == len(set(ids)), f"Duplicate lesson_ids found: {[x for x in ids if ids.count(x) > 1]}"
