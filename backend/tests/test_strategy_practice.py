"""Contract tests for 閱讀聚光燈 free-text AI grading (#2192 item 5 / #2255)."""

from __future__ import annotations

import os
import sys
import uuid
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth.password import hash_password
from app.auth.rate_limiter import ai_limit_10_per_min, ai_limit_5_per_min
from app.database import get_db
from app.main import app
from app.models import Base
from app.models.user import Role, User as UserModel
from app.services.ai_generation.strategy_practice import (
    STRATEGY_VALIDATION_SCHEMA,
    validate_strategy_answer,
)
from app.services.llm_models import get_model_for_task

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)


@event.listens_for(engine, "connect")
def _set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

SEED_ROLES = [
    {"name": "student", "display_name": "Student", "scope_level": "school"},
]


@pytest.fixture(scope="module")
def db_engine():
    Base.metadata.create_all(bind=engine)
    with engine.begin() as conn:
        for role_data in SEED_ROLES:
            conn.execute(Role.__table__.insert().prefix_with("OR IGNORE"), role_data)
    yield engine
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def db_session(db_engine):
    connection = db_engine.connect()
    transaction = connection.begin()
    session = TestingSessionLocal(bind=connection)
    yield session
    session.close()
    transaction.rollback()
    connection.close()


@pytest.fixture
def client(db_session):
    def override_get_db():
        yield db_session

    async def _no_rate_limit():
        pass

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[ai_limit_10_per_min] = _no_rate_limit
    app.dependency_overrides[ai_limit_5_per_min] = _no_rate_limit
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def _mock_log_ai_usage(*_args, **_kwargs):
    return None


def _create_student_and_login(client: TestClient) -> str:
    unique = uuid.uuid4().hex[:8]
    email = f"strategy_{unique}@example.com"
    login_secret = "student1234"

    db = TestingSessionLocal()
    try:
        user = UserModel(
            email=email,
            password_hash=hash_password(login_secret),
            name=f"Strategy Student {unique}",
            email_verified=True,
            is_active=True,
        )
        db.add(user)
        db.commit()
    finally:
        db.close()

    res = client.post("/api/auth/login", json={"email": email, "password": login_secret})
    assert res.status_code == 200
    return res.json()["access_token"]


class TestStrategyValidationSchema:
    def test_schema_has_required_fields(self):
        props = STRATEGY_VALIDATION_SCHEMA["properties"]
        assert set(STRATEGY_VALIDATION_SCHEMA["required"]) == {
            "is_correct",
            "feedback",
            "suggestion",
        }
        assert props["is_correct"]["type"] == "boolean"
        assert props["feedback"]["type"] == "string"
        assert props["suggestion"]["type"] == "string"

    def test_task_model_is_flash_lite(self):
        model, region = get_model_for_task("strategy_validate")
        assert model == "gemini-2.5-flash-lite"
        assert region == "global"


class TestValidateStrategyEndpoint:
    @patch(
        "app.routes.learning.learning_strategy.validate_strategy_answer",
        new_callable=AsyncMock,
    )
    @patch("app.routes.learning.learning_strategy.log_ai_usage", side_effect=_mock_log_ai_usage)
    def test_happy_path(self, _mock_log, mock_validate, client: TestClient):
        mock_validate.return_value = {
            "is_correct": True,
            "feedback": "你有抓到重點！",
            "suggestion": "",
        }
        token = _create_student_and_login(client)
        resp = client.post(
            "/api/learning/strategy-practice/validate",
            json={
                "question": "❶找重點句：哪一句最嚴重？",
                "student_answer": "發現超過3000隻野鳥屍體",
                "strategy_name": "摘要策略",
                "story_title": "毒鳥事件",
            },
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["is_correct"] is True
        assert "重點" in data["feedback"]
        assert data["suggestion"] == ""

    @patch(
        "app.routes.learning.learning_strategy.validate_strategy_answer",
        new_callable=AsyncMock,
    )
    @patch("app.routes.learning.learning_strategy.log_ai_usage", side_effect=_mock_log_ai_usage)
    def test_off_track_answer_returns_suggestion(self, _mock_log, mock_validate, client: TestClient):
        mock_validate.return_value = {
            "is_correct": False,
            "feedback": "方向對了，再想想看～",
            "suggestion": "回到第一段找最嚴重的不好的事",
        }
        token = _create_student_and_login(client)
        resp = client.post(
            "/api/learning/strategy-practice/validate",
            json={
                "question": "❶找重點句",
                "student_answer": "不知道",
                "story_title": "毒鳥",
            },
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["is_correct"] is False
        assert data["suggestion"]

    @patch(
        "app.routes.learning.learning_strategy.validate_strategy_answer",
        new_callable=AsyncMock,
    )
    def test_ai_failure_fail_closed(self, mock_validate, client: TestClient):
        mock_validate.side_effect = Exception("Gemini outage")
        token = _create_student_and_login(client)
        resp = client.post(
            "/api/learning/strategy-practice/validate",
            json={
                "question": "主角遇到什麼問題？",
                "student_answer": "他被關起來了",
            },
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["is_correct"] is True
        assert "已記錄" in data["feedback"]

    def test_requires_auth(self, client: TestClient):
        resp = client.post(
            "/api/learning/strategy-practice/validate",
            json={"question": "Q", "student_answer": "A"},
        )
        assert resp.status_code == 401


@pytest.mark.asyncio
async def test_validate_strategy_answer_clears_suggestion_when_correct():
    with patch(
        "app.services.ai_generation.strategy_practice.generate_structured_response",
        new_callable=AsyncMock,
    ) as mock_gen:
        mock_gen.return_value = {
            "is_correct": True,
            "feedback": "很棒！",
            "suggestion": "should be cleared",
        }
        result = await validate_strategy_answer("問題", "學生答案")
    assert result["is_correct"] is True
    assert result["suggestion"] == ""
