"""
Tests for the Dictionary API (issue #259: MOE dictionary integration).

Covers:
- GET  /api/dictionary/character/{character}  — single character lookup (auth required)
- GET  /api/dictionary/lookup?chars=XY        — multi-char GET convenience endpoint (auth required, issue #1230)
- POST /api/dictionary/batch                  — batch lookup (auth required)
- Auth gate: unauthenticated requests return 401/403

Uses SQLite in-memory DB and mocked HTTP calls to avoid external API dependency.

Run with:
    cd backend
    python -m pytest tests/test_dictionary_api.py -v
"""

import sys
import os
import json
from unittest.mock import patch, MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.database import get_db
from app.models import Base
from app.models.user import User
from app.auth.dependencies import get_current_user
from app.services.dictionary_service import (
    _strip_markup,
    _parse_moe_response,
    lookup_character,
    lookup_characters_batch,
)

# Fake authenticated user for all route-level tests
_FAKE_USER = User(id=1, email="dict-test-user", name="Test Student", password_hash="x")


# ---------------------------------------------------------------------------
# Test database setup
# ---------------------------------------------------------------------------

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)

TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture(scope="module", autouse=True)
def create_tables():
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture()
def db():
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture()
def client(db):
    def override_get_db():
        try:
            yield db
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    # Bypass auth: all dict route tests assume a logged-in student
    app.dependency_overrides[get_current_user] = lambda: _FAKE_USER
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture()
def unauthenticated_client(db):
    """Client with NO auth override — verifies 401/403 is returned."""
    def override_get_db():
        try:
            yield db
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    # Explicitly do NOT override get_current_user
    with TestClient(app, raise_server_exceptions=False) as c:
        yield c
    app.dependency_overrides.pop(get_db, None)


# ---------------------------------------------------------------------------
# Sample MOE API response fixture
# ---------------------------------------------------------------------------

SAMPLE_MOE_RESPONSE = {
    "t": "山",
    "c": 3,
    "h": [
        {
            "b": "ㄕㄢ",
            "p": "shān",
            "d": [
                {
                    "type": "`名~",
                    "f": "`陸地~`上~`高~`起~`的~`部分~。",
                    "q": [
                        "`左~`傳~：「`登山~`以~`望~。」"
                    ]
                },
                {
                    "type": "`名~",
                    "f": "`墳墓~。",
                    "e": ["`靡~`迤~`秦~`山~"]
                },
                {
                    "type": "`形~",
                    "f": "`山~`中的~。",
                    "e": ["「`山村~」"]
                },
            ]
        }
    ]
}


# ===========================================================================
# Unit tests — service functions
# ===========================================================================

class TestStripMarkup:
    def test_removes_backtick_tilde_pairs(self):
        assert _strip_markup("`陸地~`上~`高~`起~`的~`部分~") == "陸地上高起的部分"

    def test_removes_stray_backticks(self):
        assert _strip_markup("`名~") == "名"

    def test_plain_text_unchanged(self):
        assert _strip_markup("普通文字") == "普通文字"

    def test_empty_string(self):
        assert _strip_markup("") == ""

    def test_mixed_content(self):
        result = _strip_markup("`山村~是個好地方")
        assert result == "山村是個好地方"


class TestParseMoeResponse:
    def test_parses_zhuyin(self):
        parsed = _parse_moe_response(SAMPLE_MOE_RESPONSE)
        assert parsed["zhuyin"] == "ㄕㄢ"

    def test_parses_stroke_count(self):
        parsed = _parse_moe_response(SAMPLE_MOE_RESPONSE)
        assert parsed["stroke_count"] == 3

    def test_parses_definitions(self):
        parsed = _parse_moe_response(SAMPLE_MOE_RESPONSE)
        assert len(parsed["definitions"]) == 3

    def test_first_definition_text(self):
        parsed = _parse_moe_response(SAMPLE_MOE_RESPONSE)
        assert parsed["definitions"][0]["definition"] == "陸地上高起的部分。"

    def test_first_definition_type(self):
        parsed = _parse_moe_response(SAMPLE_MOE_RESPONSE)
        assert parsed["definitions"][0]["type"] == "名"

    def test_definition_examples_from_q_field(self):
        parsed = _parse_moe_response(SAMPLE_MOE_RESPONSE)
        assert len(parsed["definitions"][0]["examples"]) >= 1

    def test_definition_examples_from_e_field(self):
        parsed = _parse_moe_response(SAMPLE_MOE_RESPONSE)
        # Third definition has "e" field
        assert len(parsed["definitions"][2]["examples"]) >= 1

    def test_empty_response(self):
        parsed = _parse_moe_response({})
        assert parsed["zhuyin"] is None
        assert parsed["stroke_count"] is None
        assert parsed["definitions"] == []

    def test_no_heteronyms(self):
        parsed = _parse_moe_response({"h": []})
        assert parsed["definitions"] == []

    def test_stroke_count_as_int(self):
        raw = {"c": "5", "h": [{"b": "ㄇㄡˇ", "d": []}]}
        parsed = _parse_moe_response(raw)
        assert parsed["stroke_count"] == 5


class TestLookupCharacter:
    def test_fetches_and_caches_character(self, db):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = SAMPLE_MOE_RESPONSE

        with patch("app.services.dictionary_service.httpx.get", return_value=mock_response):
            result = lookup_character("山", db)

        assert result["character"] == "山"
        assert result["zhuyin"] == "ㄕㄢ"
        assert result["stroke_count"] == 3
        assert result["cached"] is False
        assert result["not_found"] is False
        assert len(result["definitions"]) > 0

    def test_uses_cache_on_second_lookup(self, db):
        # First lookup (already cached from previous test in this session scope)
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = SAMPLE_MOE_RESPONSE

        with patch("app.services.dictionary_service.httpx.get", return_value=mock_response) as mock_get:
            # First call with a fresh character not yet cached
            result = lookup_character("水", db)
            first_call_count = mock_get.call_count

        # Second call — should use cache, no new HTTP request
        with patch("app.services.dictionary_service.httpx.get") as mock_get2:
            result2 = lookup_character("水", db)
            assert mock_get2.call_count == 0

        assert result2["cached"] is True

    def test_handles_404_from_api(self, db):
        mock_response = MagicMock()
        mock_response.status_code = 404

        with patch("app.services.dictionary_service.httpx.get", return_value=mock_response):
            result = lookup_character("龘", db)

        assert result["not_found"] is True
        assert result["definitions"] == []

    def test_handles_api_timeout(self, db):
        import httpx
        with patch(
            "app.services.dictionary_service.httpx.get",
            side_effect=httpx.TimeoutException("timeout"),
        ):
            result = lookup_character("火", db)

        # Should return empty fallback, not raise
        assert result["character"] == "火"
        assert result["definitions"] == []
        assert result.get("error") == "dictionary_unavailable"

    def test_raises_on_invalid_input(self, db):
        with pytest.raises(ValueError):
            lookup_character("", db)

        with pytest.raises(ValueError):
            lookup_character("山水", db)

    def test_batch_lookup_returns_all_chars(self, db):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = SAMPLE_MOE_RESPONSE

        with patch("app.services.dictionary_service.httpx.get", return_value=mock_response):
            results = lookup_characters_batch(["木", "火"], db)

        assert len(results) == 2
        assert results[0]["character"] == "木"
        assert results[1]["character"] == "火"

    def test_batch_lookup_deduplication_in_api(self, db):
        """Batch service handles duplicate chars without error."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = SAMPLE_MOE_RESPONSE

        with patch("app.services.dictionary_service.httpx.get", return_value=mock_response):
            results = lookup_characters_batch(["土", "土"], db)

        # Returns one result per input (duplicates resolved at route level)
        assert len(results) == 2


# ===========================================================================
# Integration tests — API endpoints
# ===========================================================================

class TestGetCharacterEndpoint:
    def test_returns_200_for_valid_character(self, client):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = SAMPLE_MOE_RESPONSE

        with patch("app.services.dictionary_service.httpx.get", return_value=mock_response):
            resp = client.get("/api/dictionary/character/山")

        assert resp.status_code == 200

    def test_response_has_expected_fields(self, client):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = SAMPLE_MOE_RESPONSE

        with patch("app.services.dictionary_service.httpx.get", return_value=mock_response):
            resp = client.get("/api/dictionary/character/日")

        data = resp.json()
        assert "character" in data
        assert "zhuyin" in data
        assert "stroke_count" in data
        assert "definitions" in data
        assert "cached" in data
        assert "not_found" in data

    def test_returns_422_for_multi_char_path(self, client):
        resp = client.get("/api/dictionary/character/山水")
        assert resp.status_code == 422

    def test_cached_response_on_second_request(self, client):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = SAMPLE_MOE_RESPONSE

        with patch("app.services.dictionary_service.httpx.get", return_value=mock_response):
            client.get("/api/dictionary/character/月")

        with patch("app.services.dictionary_service.httpx.get") as mock_get:
            resp = client.get("/api/dictionary/character/月")
            assert mock_get.call_count == 0

        assert resp.json()["cached"] is True

    def test_not_found_character_returns_200_with_flag(self, client):
        mock_response = MagicMock()
        mock_response.status_code = 404

        with patch("app.services.dictionary_service.httpx.get", return_value=mock_response):
            resp = client.get("/api/dictionary/character/㊥")

        assert resp.status_code == 200
        assert resp.json()["not_found"] is True


class TestBatchLookupEndpoint:
    def test_returns_200_for_valid_batch(self, client):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = SAMPLE_MOE_RESPONSE

        with patch("app.services.dictionary_service.httpx.get", return_value=mock_response):
            resp = client.post(
                "/api/dictionary/batch",
                json={"characters": ["金", "木"]},
            )

        assert resp.status_code == 200

    def test_batch_response_has_results_list(self, client):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = SAMPLE_MOE_RESPONSE

        with patch("app.services.dictionary_service.httpx.get", return_value=mock_response):
            resp = client.post(
                "/api/dictionary/batch",
                json={"characters": ["水", "火"]},
            )

        data = resp.json()
        assert "results" in data
        assert len(data["results"]) == 2

    def test_batch_deduplicates_characters(self, client):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = SAMPLE_MOE_RESPONSE

        with patch("app.services.dictionary_service.httpx.get", return_value=mock_response):
            resp = client.post(
                "/api/dictionary/batch",
                json={"characters": ["人", "人", "人"]},
            )

        data = resp.json()
        # Deduplicated: only 1 unique char
        assert len(data["results"]) == 1

    def test_batch_rejects_more_than_20(self, client):
        chars = list("一二三四五六七八九十甲乙丙丁戊己庚辛壬癸壬")  # 21 chars
        resp = client.post("/api/dictionary/batch", json={"characters": chars})
        assert resp.status_code == 422

    def test_batch_rejects_empty_list(self, client):
        resp = client.post("/api/dictionary/batch", json={"characters": []})
        assert resp.status_code == 422


# ===========================================================================
# GET /api/dictionary/lookup?chars=  (Issue #1230)
# ===========================================================================

class TestLookupEndpoint:
    def test_returns_200_for_multi_char_query(self, client):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = SAMPLE_MOE_RESPONSE

        with patch("app.services.dictionary_service.httpx.get", return_value=mock_response):
            resp = client.get("/api/dictionary/lookup?chars=攻擊")

        assert resp.status_code == 200

    def test_lookup_response_has_results_list(self, client):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = SAMPLE_MOE_RESPONSE

        with patch("app.services.dictionary_service.httpx.get", return_value=mock_response):
            resp = client.get("/api/dictionary/lookup?chars=攻擊")

        data = resp.json()
        assert "results" in data
        # 攻 and 擊 = 2 unique CJK chars
        assert len(data["results"]) == 2

    def test_lookup_deduplicates_chars(self, client):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = SAMPLE_MOE_RESPONSE

        with patch("app.services.dictionary_service.httpx.get", return_value=mock_response):
            resp = client.get("/api/dictionary/lookup?chars=山山山")

        data = resp.json()
        # 山 repeated 3 times → deduplicated to 1
        assert len(data["results"]) == 1

    def test_lookup_single_char(self, client):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = SAMPLE_MOE_RESPONSE

        with patch("app.services.dictionary_service.httpx.get", return_value=mock_response):
            resp = client.get("/api/dictionary/lookup?chars=山")

        assert resp.status_code == 200
        data = resp.json()
        assert len(data["results"]) == 1
        assert data["results"][0]["character"] == "山"

    def test_lookup_result_schema(self, client):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = SAMPLE_MOE_RESPONSE

        with patch("app.services.dictionary_service.httpx.get", return_value=mock_response):
            resp = client.get("/api/dictionary/lookup?chars=水")

        entry = resp.json()["results"][0]
        assert "character" in entry
        assert "zhuyin" in entry
        assert "stroke_count" in entry
        assert "definitions" in entry
        assert "cached" in entry
        assert "not_found" in entry

    def test_lookup_rejects_more_than_20_unique_chars(self, client):
        # 21 unique CJK characters
        chars = "一二三四五六七八九十甲乙丙丁戊己庚辛壬癸黃"
        resp = client.get(f"/api/dictionary/lookup?chars={chars}")
        assert resp.status_code == 422

    def test_lookup_rejects_missing_chars_param(self, client):
        resp = client.get("/api/dictionary/lookup")
        assert resp.status_code == 422


# ===========================================================================
# Auth gate — all endpoints require authentication (Issue #1230)
# ===========================================================================

class TestAuthGate:
    """Verify endpoints return 401/403 without a valid token."""

    def test_get_character_requires_auth(self, unauthenticated_client):
        resp = unauthenticated_client.get("/api/dictionary/character/山")
        assert resp.status_code in (401, 403)

    def test_lookup_requires_auth(self, unauthenticated_client):
        resp = unauthenticated_client.get("/api/dictionary/lookup?chars=山")
        assert resp.status_code in (401, 403)

    def test_batch_requires_auth(self, unauthenticated_client):
        resp = unauthenticated_client.post(
            "/api/dictionary/batch",
            json={"characters": ["山"]},
        )
        assert resp.status_code in (401, 403)
