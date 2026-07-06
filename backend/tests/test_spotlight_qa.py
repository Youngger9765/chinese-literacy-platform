"""Route tests for spotlight QA save/list/load (GCS-only, no DB).

Locks: production write-gate (403), payload validation, size cap, fail-closed
(503 when GCS down), path-traversal guard on load, and the save→list→read shape.
GCS is mocked so the happy path is reachable.

Run:
    cd backend && python -m pytest tests/test_spotlight_qa.py -v
"""
from __future__ import annotations

import json
import os
import sys
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app, raise_server_exceptions=False)

GOOD_PAYLOAD = {"reviewer": "啟翔", "tool_version": 2, "lessons": [{"lesson_code": "G6-L22"}]}
BUCKET = "app.routes.spotlight_qa._get_gcs_bucket"


def _mock_bucket() -> MagicMock:
    bucket = MagicMock()
    blob = MagicMock()
    blob.upload_from_string.return_value = None
    bucket.blob.return_value = blob
    return bucket


def _non_prod():
    return patch.dict(os.environ, {"ENVIRONMENT": "staging"}, clear=False)


class TestSave:
    def test_save_happy_path(self):
        b = _mock_bucket()
        with _non_prod(), patch(BUCKET, return_value=b):
            r = client.post("/api/spotlight-qa/save", json=GOOD_PAYLOAD)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is True
        assert body["path"].startswith("spotlight-qa/")
        assert body["path"].endswith(".json")
        b.blob.assert_called_once()
        # reviewer slug is CJK-safe and part of the path
        assert "/啟翔/" in body["path"]

    def test_production_gate_403(self):
        with patch.dict(os.environ, {"ENVIRONMENT": "production"}, clear=False), patch(
            BUCKET, return_value=_mock_bucket()
        ):
            r = client.post("/api/spotlight-qa/save", json=GOOD_PAYLOAD)
        assert r.status_code == 403

    def test_missing_lessons_400(self):
        with _non_prod(), patch(BUCKET, return_value=_mock_bucket()):
            r = client.post("/api/spotlight-qa/save", json={"reviewer": "x"})
        assert r.status_code == 400

    def test_too_large_413(self):
        big = {"reviewer": "x", "lessons": [{"blob": "A" * (5 * 1024 * 1024)}]}
        with _non_prod(), patch(BUCKET, return_value=_mock_bucket()):
            r = client.post("/api/spotlight-qa/save", json=big)
        assert r.status_code == 413

    def test_storage_down_503(self):
        with _non_prod(), patch(BUCKET, return_value=None):
            r = client.post("/api/spotlight-qa/save", json=GOOD_PAYLOAD)
        assert r.status_code == 503


class TestListAndRead:
    def test_reviews_parses_path(self):
        blob = MagicMock()
        blob.name = "spotlight-qa/啟翔/20260707T101112-abcd1234.json"
        blob.size = 123
        b = MagicMock()
        b.list_blobs.return_value = [blob]
        with patch(BUCKET, return_value=b):
            r = client.get("/api/spotlight-qa/reviews")
        assert r.status_code == 200
        body = r.json()
        assert body["ok"] is True and body["count"] == 1
        rec = body["reviews"][0]
        assert rec["reviewer"] == "啟翔"
        assert rec["saved_at"] == "20260707T101112"
        assert rec["path"] == blob.name

    def test_review_round_trip(self):
        path = "spotlight-qa/啟翔/20260707T101112-abcd1234.json"
        blob = MagicMock()
        blob.exists.return_value = True
        blob.download_as_text.return_value = json.dumps(GOOD_PAYLOAD, ensure_ascii=False)
        b = MagicMock()
        b.blob.return_value = blob
        with patch(BUCKET, return_value=b):
            r = client.get("/api/spotlight-qa/review", params={"path": path})
        assert r.status_code == 200
        assert r.json()["reviewer"] == "啟翔"

    def test_review_path_traversal_rejected(self):
        for bad in ["test-dataset/x/y.json", "spotlight-qa/../secret.json", "spotlight-qa/a/b.txt"]:
            r = client.get("/api/spotlight-qa/review", params={"path": bad})
            assert r.status_code == 400, bad
