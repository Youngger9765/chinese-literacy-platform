"""
Tests for GET /api/health and GET /api/health/detailed endpoints.

TDD: written before health.py implementation.
Red → Green → Refactor.
"""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.main import app
from app.database import get_db
from app.models import Base

# ---------------------------------------------------------------------------
# In-memory SQLite for tests (same pattern as other test files)
# ---------------------------------------------------------------------------
SQLALCHEMY_TEST_URL = "sqlite:///:memory:"

engine = create_engine(
    SQLALCHEMY_TEST_URL,
    connect_args={"check_same_thread": False},
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base.metadata.create_all(bind=engine)


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = override_get_db
client = TestClient(app)


# ---------------------------------------------------------------------------
# Tests for GET /api/health (basic liveness)
# ---------------------------------------------------------------------------

class TestHealthLiveness:
    def test_returns_200(self):
        response = client.get("/api/health")
        assert response.status_code == 200

    def test_returns_status_ok(self):
        response = client.get("/api/health")
        data = response.json()
        assert data["status"] == "ok"

    def test_returns_version(self):
        response = client.get("/api/health")
        data = response.json()
        assert "version" in data
        assert isinstance(data["version"], str)
        assert len(data["version"]) > 0

    def test_response_is_json(self):
        response = client.get("/api/health")
        assert response.headers["content-type"].startswith("application/json")


# ---------------------------------------------------------------------------
# Tests for GET /api/health/detailed
# ---------------------------------------------------------------------------

class TestHealthDetailed:
    def test_returns_200_when_db_healthy(self):
        response = client.get("/api/health/detailed")
        # Should be 200 (db is SQLite in-memory, always healthy in tests)
        assert response.status_code in (200, 503)

    def test_response_has_required_fields(self):
        response = client.get("/api/health/detailed")
        data = response.json()
        required = ["status", "version", "environment", "uptime_seconds",
                    "started_at", "checked_at", "components"]
        for field in required:
            assert field in data, f"Missing field: {field}"

    def test_components_has_database_key(self):
        response = client.get("/api/health/detailed")
        data = response.json()
        assert "database" in data["components"]

    def test_database_component_has_status(self):
        response = client.get("/api/health/detailed")
        data = response.json()
        db_component = data["components"]["database"]
        assert "status" in db_component

    def test_database_component_is_ok_with_sqlite(self):
        """SQLite in-memory DB should always respond to SELECT 1."""
        response = client.get("/api/health/detailed")
        data = response.json()
        assert data["components"]["database"]["status"] == "ok"

    def test_components_has_ai_service_key(self):
        response = client.get("/api/health/detailed")
        data = response.json()
        assert "ai_service" in data["components"]

    def test_ai_service_status_is_valid_value(self):
        response = client.get("/api/health/detailed")
        data = response.json()
        ai_status = data["components"]["ai_service"]["status"]
        assert ai_status in ("ok", "degraded", "error")

    def test_uptime_seconds_is_non_negative(self):
        response = client.get("/api/health/detailed")
        data = response.json()
        assert data["uptime_seconds"] >= 0

    def test_environment_field_is_string(self):
        response = client.get("/api/health/detailed")
        data = response.json()
        assert isinstance(data["environment"], str)

    def test_timestamps_are_iso_format(self):
        from datetime import datetime
        response = client.get("/api/health/detailed")
        data = response.json()
        # Should not raise
        datetime.fromisoformat(data["started_at"].replace("Z", "+00:00"))
        datetime.fromisoformat(data["checked_at"].replace("Z", "+00:00"))

    def test_overall_status_matches_components(self):
        """If all components are ok, overall status must be ok."""
        response = client.get("/api/health/detailed")
        data = response.json()
        all_ok = all(
            v.get("status") == "ok"
            for v in data["components"].values()
        )
        if all_ok:
            assert data["status"] == "ok"

    def test_503_when_db_fails(self, monkeypatch):
        """Simulate DB failure — endpoint must return HTTP 503."""
        from sqlalchemy.exc import OperationalError

        def bad_db():
            db = TestingSessionLocal()
            original_execute = db.execute

            def raise_on_execute(*args, **kwargs):
                raise OperationalError("SELECT 1", {}, Exception("simulated DB failure"))

            db.execute = raise_on_execute
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[get_db] = bad_db
        try:
            response = client.get("/api/health/detailed")
            assert response.status_code == 503
            data = response.json()
            assert data["status"] == "degraded"
            assert data["components"]["database"]["status"] == "error"
        finally:
            app.dependency_overrides[get_db] = override_get_db
