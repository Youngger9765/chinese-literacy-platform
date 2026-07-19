"""Regression locks for QA-tool shared-secret gate + early Content-Length cap (#2534).

Locks:
1. QA_TOOLS_SHARED_SECRET set + missing/wrong x-qa-token → 401 on all 6 endpoints
2. secret set + correct header → auth passes (200 / expected non-401)
3. secret unset/empty → open behavior preserved (local-dev escape hatch)
4. keypoints/spotlight save with Content-Length > 4MB → 413 before body parse

Run:
    cd backend && source .venv/bin/activate && python -m pytest tests/test_qa_tools_auth.py -q
"""
from __future__ import annotations

import json
import os
import sys
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app, raise_server_exceptions=False)

SECRET = "test-only-qa-tools-shared-secret-not-prod"
GOOD_SPOTLIGHT = {"reviewer": "啟翔", "tool_version": 2, "lessons": [{"lesson_code": "G6-L22"}]}
GOOD_KEYPOINTS = {"reviewer": "啟翔", "tool_version": 1, "lessons": [{"lesson_code": "G6-L22"}]}
MAX_BYTES = 4 * 1024 * 1024

SPOTLIGHT_BUCKET = "app.routes.spotlight_qa._get_gcs_bucket"
KEYPOINTS_BUCKET = "app.routes.keypoints_qa._get_gcs_bucket"

# (method, path, kwargs_factory) — kwargs_factory() → client call kwargs
PROTECTED_ENDPOINTS = [
    (
        "POST",
        "/api/spotlight-qa/save",
        lambda: {"json": GOOD_SPOTLIGHT},
        SPOTLIGHT_BUCKET,
    ),
    (
        "GET",
        "/api/spotlight-qa/reviews",
        lambda: {},
        SPOTLIGHT_BUCKET,
    ),
    (
        "GET",
        "/api/spotlight-qa/review",
        lambda: {"params": {"path": "spotlight-qa/啟翔/20260707T101112-abcd1234.json"}},
        SPOTLIGHT_BUCKET,
    ),
    (
        "POST",
        "/api/keypoints-qa/save",
        lambda: {"json": GOOD_KEYPOINTS},
        KEYPOINTS_BUCKET,
    ),
    (
        "GET",
        "/api/keypoints-qa/reviews",
        lambda: {},
        KEYPOINTS_BUCKET,
    ),
    (
        "GET",
        "/api/keypoints-qa/review",
        lambda: {"params": {"path": "keypoints-qa/啟翔/20260707T101112-abcd1234.json"}},
        KEYPOINTS_BUCKET,
    ),
]


def _mock_bucket_for(path: str) -> MagicMock:
    """GCS mock that supports save / list / read for either tool."""
    bucket = MagicMock()
    blob = MagicMock()
    blob.upload_from_string.return_value = None
    blob.exists.return_value = True
    payload = GOOD_SPOTLIGHT if "spotlight" in path else GOOD_KEYPOINTS
    blob.download_as_text.return_value = json.dumps(payload, ensure_ascii=False)
    blob.name = (
        "spotlight-qa/啟翔/20260707T101112-abcd1234.json"
        if "spotlight" in path
        else "keypoints-qa/啟翔/20260707T101112-abcd1234.json"
    )
    blob.size = 123
    bucket.blob.return_value = blob
    bucket.list_blobs.return_value = [blob]
    return bucket


def _set_secret(monkeypatch: pytest.MonkeyPatch, value: str) -> None:
    monkeypatch.setattr("app.config.settings.qa_tools_shared_secret", value)
    # dependency may import settings under its own module path
    monkeypatch.setattr("app.auth.qa_tools.settings.qa_tools_shared_secret", value, raising=False)


def _call(method: str, path: str, headers: dict | None = None, **kwargs):
    headers = dict(headers or {})
    return client.request(method, path, headers=headers, **kwargs)


@pytest.fixture
def non_prod(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("ENVIRONMENT", "staging")
    monkeypatch.delenv("K_SERVICE", raising=False)


class TestQaTokenMissingOrWrong:
    """secret SET + no/wrong x-qa-token → 401 on each of save/reviews/review (both tools)."""

    @pytest.mark.parametrize(
        "method,path,kwargs_factory,bucket_path",
        PROTECTED_ENDPOINTS,
        ids=[ep[1] for ep in PROTECTED_ENDPOINTS],
    )
    def test_missing_header_401(
        self, monkeypatch, non_prod, method, path, kwargs_factory, bucket_path
    ):
        _set_secret(monkeypatch, SECRET)
        with patch(bucket_path, return_value=_mock_bucket_for(path)):
            r = _call(method, path, **kwargs_factory())
        assert r.status_code == 401, f"{method} {path}: {r.status_code} {r.text}"

    @pytest.mark.parametrize(
        "method,path,kwargs_factory,bucket_path",
        PROTECTED_ENDPOINTS,
        ids=[ep[1] for ep in PROTECTED_ENDPOINTS],
    )
    def test_wrong_token_401(
        self, monkeypatch, non_prod, method, path, kwargs_factory, bucket_path
    ):
        _set_secret(monkeypatch, SECRET)
        with patch(bucket_path, return_value=_mock_bucket_for(path)):
            r = _call(
                method,
                path,
                headers={"x-qa-token": "wrong-token-not-the-secret"},
                **kwargs_factory(),
            )
        assert r.status_code == 401, f"{method} {path}: {r.status_code} {r.text}"


class TestQaTokenCorrect:
    """secret SET + correct header → auth passes (not 401)."""

    @pytest.mark.parametrize(
        "method,path,kwargs_factory,bucket_path",
        PROTECTED_ENDPOINTS,
        ids=[ep[1] for ep in PROTECTED_ENDPOINTS],
    )
    def test_correct_header_passes_auth(
        self, monkeypatch, non_prod, method, path, kwargs_factory, bucket_path
    ):
        _set_secret(monkeypatch, SECRET)
        with patch(bucket_path, return_value=_mock_bucket_for(path)):
            r = _call(
                method,
                path,
                headers={"x-qa-token": SECRET},
                **kwargs_factory(),
            )
        assert r.status_code != 401, f"{method} {path}: unexpected 401 {r.text}"
        assert r.status_code == 200, f"{method} {path}: {r.status_code} {r.text}"


class TestQaTokenUnsetOpen:
    """secret UNSET → open behavior preserved (no 401) — local-dev escape hatch."""

    @pytest.mark.parametrize(
        "method,path,kwargs_factory,bucket_path",
        PROTECTED_ENDPOINTS,
        ids=[ep[1] for ep in PROTECTED_ENDPOINTS],
    )
    def test_unset_secret_no_401(
        self, monkeypatch, non_prod, method, path, kwargs_factory, bucket_path
    ):
        _set_secret(monkeypatch, "")
        with patch(bucket_path, return_value=_mock_bucket_for(path)):
            r = _call(method, path, **kwargs_factory())
        assert r.status_code != 401, f"{method} {path}: got 401 with secret unset"
        assert r.status_code == 200, f"{method} {path}: {r.status_code} {r.text}"


class TestContentLengthPreParse:
    """Content-Length over 4MB → 413 before body is parsed into memory."""

    def test_keypoints_save_content_length_over_4mb_413(self, monkeypatch, non_prod):
        _set_secret(monkeypatch, "")  # auth open so we isolate size-cap
        # Small body + forged Content-Length > 4MB. Guard must reject on header
        # alone — must NOT require uploading 4MB+ of bytes.
        over = MAX_BYTES + 1
        with patch(KEYPOINTS_BUCKET, return_value=_mock_bucket_for("/api/keypoints-qa/save")) as bucket:
            r = client.post(
                "/api/keypoints-qa/save",
                content=b'{"reviewer":"x","lessons":[]}',
                headers={
                    "Content-Type": "application/json",
                    "Content-Length": str(over),
                },
            )
        assert r.status_code == 413, r.text
        # Must reject before any GCS write (proves we didn't fully process as save)
        bucket.return_value.blob.assert_not_called()

    def test_spotlight_save_content_length_over_4mb_413(self, monkeypatch, non_prod):
        _set_secret(monkeypatch, "")
        over = MAX_BYTES + 1
        with patch(SPOTLIGHT_BUCKET, return_value=_mock_bucket_for("/api/spotlight-qa/save")) as bucket:
            r = client.post(
                "/api/spotlight-qa/save",
                content=b'{"reviewer":"x","lessons":[]}',
                headers={
                    "Content-Type": "application/json",
                    "Content-Length": str(over),
                },
            )
        assert r.status_code == 413, r.text
        bucket.return_value.blob.assert_not_called()
