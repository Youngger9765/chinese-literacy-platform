"""
Tests for /api/stories pagination — page_size cap (#1383).

Background: backend loads 165 lessons (57 Layer-1 + 108 Layer-2 parsed),
but the previous page_size cap (le=100) split them across 2+ pages.
Frontend `fetchStories` defaulted to page=1 and never paginated, so the
7 教授指定 lessons (G6-L22~25, G7-L28~30, IDs 1076-1110) which sort to
page 2 were invisible to students.

Fix: bump page_size cap from 100 → 300 so the entire bounded library
(~270 lessons projected at 8/2026 full curriculum) fits in one request.

Run with:
    cd backend && python -m pytest tests/test_stories_pagination.py -v
"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


# ── Cap boundary ─────────────────────────────────────────────────────────────


class TestPageSizeCap:
    def test_page_size_300_accepted(self, client):
        """New cap (300) accepts the upper bound."""
        resp = client.get("/api/stories?page_size=300")
        assert resp.status_code == 200

    def test_page_size_301_rejected(self, client):
        """Cap is exclusive at 301 (le=300)."""
        resp = client.get("/api/stories?page_size=301")
        assert resp.status_code == 422

    def test_page_size_100_still_works(self, client):
        """Existing callers using 100 are unaffected."""
        resp = client.get("/api/stories?page_size=100")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["stories"]) <= 100

    def test_default_page_size_unchanged(self, client):
        """Default page_size=60 is preserved (backward compat)."""
        resp = client.get("/api/stories")
        assert resp.status_code == 200
        data = resp.json()
        # total may be > 60; default returns at most 60
        assert len(data["stories"]) <= 60


# ── 7 educator-designated lessons reachable on page 1 with page_size=300 ────


class TestSevenDesignatedLessonsReachable:
    """7 lessons assigned for 7/1 deadline must be in first response when
    frontend uses page_size=300."""

    DESIGNATED_CODES = [
        "G6-L22", "G6-L23", "G6-L24", "G6-L25",
        "G7-L28", "G7-L29", "G7-L30",
    ]

    def test_all_seven_visible_on_page1_with_300(self, client):
        resp = client.get("/api/stories?page_size=300")
        assert resp.status_code == 200
        codes_in_response = {s["grade_code"] for s in resp.json()["stories"]}
        missing = [c for c in self.DESIGNATED_CODES if c not in codes_in_response]
        assert missing == [], f"Missing designated lessons: {missing}"

    def test_total_count_unchanged_by_page_size(self, client):
        """`total` reflects the full library size regardless of page_size."""
        small = client.get("/api/stories?page_size=10").json()
        large = client.get("/api/stories?page_size=300").json()
        assert small["total"] == large["total"]


# ── Pagination math sanity ────────────────────────────────────────────────────


class TestPaginationMath:
    def test_page2_returns_remainder(self, client):
        """page=2&page_size=100 returns at most (total - 100) stories."""
        resp_all = client.get("/api/stories?page_size=300").json()
        total = resp_all["total"]

        resp_p1 = client.get("/api/stories?page=1&page_size=100").json()
        resp_p2 = client.get("/api/stories?page=2&page_size=100").json()

        assert len(resp_p1["stories"]) == min(100, total)
        assert len(resp_p2["stories"]) == max(0, min(100, total - 100))

    def test_page_beyond_end_returns_empty(self, client):
        """Requesting page beyond available data returns empty list (not 404)."""
        resp = client.get("/api/stories?page=999&page_size=10")
        assert resp.status_code == 200
        assert resp.json()["stories"] == []
