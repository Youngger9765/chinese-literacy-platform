"""TDD RED tests for GET /api/schools/directory/search (#3804 §4.2).

Follows the TestClient + SQLite-in-memory pattern from tests/test_schools_api.py.
suggest_school_names is mocked (unittest.mock.patch) so no real Gemini call
happens in CI — same convention as test_moe_school_suggest_3804.py.
"""
import os
import sys
import uuid

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from unittest.mock import AsyncMock, patch
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.database import get_db
from app.models import Base
from app.models.school import School
from app.models.user import Role

engine = create_engine(
    "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
)


@event.listens_for(engine, "connect")
def _set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

SEED_ROLES = [
    {"name": "system_admin", "display_name": "System Admin", "scope_level": "platform"},
    {"name": "teacher", "display_name": "Teacher", "scope_level": "school"},
]


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    session = TestingSessionLocal()
    for role_data in SEED_ROLES:
        session.add(Role(**role_data))
    session.commit()

    # Seed MOE directory schools directly (bypasses the import pipeline —
    # that pipeline has its own tests in test_moe_school_import_3804.py)
    session.add_all(
        [
            School(
                name="市立大安國小",
                moe_school_code="333602",
                county_name="台北市",
                school_level="elementary",
                is_public=True,
            ),
            School(
                name="市立大安國小",
                moe_school_code="034651",
                county_name="桃園市",
                school_level="elementary",
                is_public=True,
            ),
            # #3817 — a county-exclusive school (only in 桃園市, no 台北市
            # counterpart) used to prove the suggestion fallback respects
            # the selected county instead of suggesting it for a 台北市 search.
            School(
                name="八德國小",
                moe_school_code="064701",
                county_name="桃園市",
                school_level="elementary",
                is_public=True,
            ),
            # Non-MOE school — must never be returned by the directory search
            School(name="某老師自建學校"),
        ]
    )
    session.commit()
    session.close()

    app.dependency_overrides[get_db] = _override_get_db
    yield
    app.dependency_overrides.pop(get_db, None)
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _register_user(client, suffix: str) -> dict:
    unique = uuid.uuid4().hex[:8]
    email = f"{suffix}_{unique}@example.com"
    password = "SecurePass123!"
    resp = client.post(
        "/api/auth/register",
        json={"email": email, "password": password, "name": f"{suffix.title()} {unique}"},
    )
    assert resp.status_code == 201
    verification_token = resp.json().get("verification_token")
    if verification_token:
        client.get(f"/api/auth/verify-email?token={verification_token}")
    login_resp = client.post("/api/auth/login", json={"email": email, "password": password})
    return {"token": login_resp.json()["access_token"]}


@pytest.fixture(scope="module")
def teacher_user(client):
    return _register_user(client, "directory_search_user")


class TestSchoolDirectorySearchAuth:
    def test_requires_authentication(self, client):
        resp = client.get("/api/schools/directory/search?q=大安國小")
        assert resp.status_code == 401


class TestSchoolDirectorySearchHappyPath:
    def test_typo_query_finds_the_school(self, client, teacher_user):
        resp = client.get(
            "/api/schools/directory/search?q=大按國小",
            headers=auth_header(teacher_user["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        codes = {item["moe_school_code"] for item in data["items"]}
        assert "333602" in codes

    def test_response_omits_join_code(self, client, teacher_user):
        resp = client.get(
            "/api/schools/directory/search?q=大安國小",
            headers=auth_header(teacher_user["token"]),
        )
        data = resp.json()
        assert len(data["items"]) > 0
        for item in data["items"]:
            assert "join_code" not in item

    def test_county_filter_narrows_results(self, client, teacher_user):
        resp = client.get(
            "/api/schools/directory/search?q=大安國小&county=桃園市",
            headers=auth_header(teacher_user["token"]),
        )
        data = resp.json()
        codes = {item["moe_school_code"] for item in data["items"]}
        assert codes == {"034651"}

    def test_non_moe_school_never_appears(self, client, teacher_user):
        resp = client.get(
            "/api/schools/directory/search?q=自建",
            headers=auth_header(teacher_user["token"]),
        )
        data = resp.json()
        assert data["items"] == []


class TestSchoolDirectorySearchSuggestions:
    def test_zero_matches_triggers_llm_suggestion(self, client, teacher_user):
        mock_suggestions = [{"school_name": "大安國小", "reason": "字形相近"}]
        with patch(
            "app.routes.school_directory.suggest_school_names",
            new=AsyncMock(return_value=mock_suggestions),
        ):
            resp = client.get(
                "/api/schools/directory/search?q=完全查不到的校名字串",
                headers=auth_header(teacher_user["token"]),
            )
        assert resp.status_code == 200
        data = resp.json()
        assert data["items"] == []
        assert data["suggestions"] == mock_suggestions

    def test_llm_failure_still_returns_200_with_no_suggestions(self, client, teacher_user):
        with patch(
            "app.routes.school_directory.suggest_school_names",
            new=AsyncMock(return_value=[]),
        ):
            resp = client.get(
                "/api/schools/directory/search?q=完全查不到的校名字串2",
                headers=auth_header(teacher_user["token"]),
            )
        assert resp.status_code == 200
        assert resp.json()["suggestions"] == []

    def test_suggestions_not_attempted_when_query_omitted(self, client, teacher_user):
        mock_suggest = AsyncMock(return_value=[{"school_name": "x", "reason": "y"}])
        with patch("app.routes.school_directory.suggest_school_names", new=mock_suggest):
            resp = client.get(
                "/api/schools/directory/search?county=台北市",
                headers=auth_header(teacher_user["token"]),
            )
        assert resp.status_code == 200
        assert resp.json()["suggestions"] is None
        mock_suggest.assert_not_called()

    def test_suggestions_not_attempted_when_fuzzy_match_found_something(self, client, teacher_user):
        mock_suggest = AsyncMock(return_value=[{"school_name": "x", "reason": "y"}])
        with patch("app.routes.school_directory.suggest_school_names", new=mock_suggest):
            resp = client.get(
                "/api/schools/directory/search?q=大安國小",
                headers=auth_header(teacher_user["token"]),
            )
        assert resp.status_code == 200
        assert resp.json()["suggestions"] is None
        mock_suggest.assert_not_called()


class TestSchoolDirectorySearchSuggestionsRespectSelectedCounty:
    """#3817 — a 台北市-scoped search showed "臺中市大安區大安國民小學" as an
    AI suggestion in production: the LLM fallback had no idea a county was
    even selected, so it could (and did) suggest a real school from a
    completely different county. The fix must hold even when the LLM
    ignores the county hint in its prompt, so this locks the ROUTE-level
    deterministic filter against the directory, not the prompt wording."""

    def test_suggestion_outside_the_selected_county_is_filtered_out(self, client, teacher_user):
        # 八德國小 only exists in 桃園市 (seeded above). If the LLM
        # "suggests" it for a 台北市-scoped search, the route must drop it:
        # it is not a valid answer to "a school in 台北市".
        mock_suggestions = [{"school_name": "八德國小", "reason": "字形相近"}]
        with patch(
            "app.routes.school_directory.suggest_school_names",
            new=AsyncMock(return_value=mock_suggestions),
        ):
            resp = client.get(
                "/api/schools/directory/search?q=完全查不到的校名字串3&county=台北市",
                headers=auth_header(teacher_user["token"]),
            )
        assert resp.status_code == 200
        assert resp.json()["suggestions"] == []

    def test_suggestion_inside_the_selected_county_is_kept(self, client, teacher_user):
        # 大安國小 exists in BOTH 台北市 and 桃園市 (seeded above) -- a
        # suggestion of it for a 台北市-scoped search is valid and must
        # survive the county filter untouched (positive control for the
        # test above: the filter narrows, it does not silently empty
        # everything).
        mock_suggestions = [{"school_name": "大安國小", "reason": "字形相近"}]
        with patch(
            "app.routes.school_directory.suggest_school_names",
            new=AsyncMock(return_value=mock_suggestions),
        ):
            resp = client.get(
                "/api/schools/directory/search?q=完全查不到的校名字串4&county=台北市",
                headers=auth_header(teacher_user["token"]),
            )
        assert resp.status_code == 200
        assert resp.json()["suggestions"] == mock_suggestions

    def test_no_county_selected_keeps_all_suggestions_unfiltered(self, client, teacher_user):
        # Without a county there is nothing to narrow suggestions against --
        # behavior must be unchanged from before #3817.
        mock_suggestions = [{"school_name": "八德國小", "reason": "字形相近"}]
        with patch(
            "app.routes.school_directory.suggest_school_names",
            new=AsyncMock(return_value=mock_suggestions),
        ):
            resp = client.get(
                "/api/schools/directory/search?q=完全查不到的校名字串5",
                headers=auth_header(teacher_user["token"]),
            )
        assert resp.status_code == 200
        assert resp.json()["suggestions"] == mock_suggestions


class TestSchoolDirectorySearchInputValidation:
    def test_query_over_max_length_returns_422(self, client, teacher_user):
        resp = client.get(
            "/api/schools/directory/search?q=" + "x" * 101,
            headers=auth_header(teacher_user["token"]),
        )
        assert resp.status_code == 422
