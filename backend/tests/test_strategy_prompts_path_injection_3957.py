"""Path-injection regression lock for strategy_prompts._load_prompt_uncached (#3957).

`_load_prompt_uncached(strategy_type)` built `_PROMPTS_DIR / norm / "prompt.yml"`
directly from the caller-supplied `strategy_type`, with no validation. That
value reaches here from `POST /api/learning/mcq-rescue/start`'s
`McqRescueStartRequest.strategy_type` — gated only by `Depends(get_current_user)`
(any logged-in student) and a 64-char length cap, no format/allowlist check —
so a traversal string like "../../../../etc" would make the loader attempt to
read "<repo>/etc/prompt.yml" (and, worse, fold whatever it finds into the LLM
system prompt via `yaml.safe_load`).

This test proves the traversal primitive directly against a throwaway
`tmp_path` tree (independent of what currently happens to sit on disk outside
the real `strategy_prompts/` directory), and separately exercises the real
`/api/learning/mcq-rescue/start` endpoint end-to-end with the exact payload
from the issue.

Proven red on the pre-fix code: `_load_prompt_uncached("../../secret")`
returned the parsed contents of `<tmp_path>/secret/prompt.yml`, a file
entirely outside `_PROMPTS_DIR`.
"""
from __future__ import annotations

import os
import sys
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth.dependencies import get_current_user
from app.database import get_db
from app.main import app
from app.models import Base
from app.models.user import Role, User
from app.services import strategy_prompts as svc

TRAVERSAL_STRATEGY_TYPES = [
    "..",
    "../..",
    "../secret",
    "../../secret",
    "../../../../etc",
]


@pytest.fixture
def prompts_dir(tmp_path, monkeypatch):
    root = tmp_path / "strategy_prompts"
    (root / "default").mkdir(parents=True)
    (root / "default" / "prompt.yml").write_text(
        "strategy: default\nopening: 'hi'\n", encoding="utf-8"
    )
    (root / "summary_psr").mkdir(parents=True)
    (root / "summary_psr" / "prompt.yml").write_text(
        "strategy: summary_psr\nopening: 'hi psr'\n", encoding="utf-8"
    )

    # Traversal target: a file OUTSIDE `_PROMPTS_DIR` (one level above `root`),
    # named exactly what the loader tries to read if an unvalidated
    # `..`-laden strategy_type reaches it.
    secret_dir = tmp_path / "secret"
    secret_dir.mkdir()
    (secret_dir / "prompt.yml").write_text(
        "strategy: LEAKED\nopening: 'should never load'\n", encoding="utf-8"
    )

    monkeypatch.setattr(svc, "_PROMPTS_DIR", root)
    svc.clear_cache()
    yield root
    svc.clear_cache()


class TestLoadStrategyPromptPathInjection:
    def test_traversal_strategy_type_falls_back_to_default(self, prompts_dir):
        for bad in TRAVERSAL_STRATEGY_TYPES:
            prompt = svc.load_strategy_prompt(bad)
            assert prompt["strategy"] == "default", (bad, prompt)

    def test_real_strategy_type_still_resolves_its_own_prompt(self, prompts_dir):
        # Positive control — the fix must not break the happy path.
        prompt = svc.load_strategy_prompt("summary_psr")
        assert prompt["strategy"] == "summary_psr"
        assert prompt["opening"] == "hi psr"


# ---------------------------------------------------------------------------
# End-to-end: POST /api/learning/mcq-rescue/start with a traversal strategy_type
# ---------------------------------------------------------------------------

engine = create_engine(
    "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
FAKE_USER_ID = 4242


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


_fake_user = User(
    id=FAKE_USER_ID,
    username="path_injection_test_student",
    name="Path Injection Test Student",
    email="pathinjectiontest@example.com",
    password_hash="fake",
)


def _override_get_current_user():
    return _fake_user


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    role = Role(name="student", display_name="Student", scope_level="school")
    db.add(role)
    db.commit()
    _fake_user.role_id = role.id
    db.close()
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def client():
    from app.auth.rate_limiter import ai_rate_limiter, general_rate_limiter
    from app.services.mcq_rescue_agent import _store as _rescue_store

    ai_rate_limiter.reset()
    general_rate_limiter.reset()
    _rescue_store._sessions.clear()
    _rescue_store._rate_counts.clear()

    app.dependency_overrides[get_db] = _override_get_db
    app.dependency_overrides[get_current_user] = _override_get_current_user
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


START_URL = "/api/learning/mcq-rescue/start"


class TestMcqRescueStartRejectsTraversalStrategyType:
    def test_traversal_strategy_type_does_not_500_or_leak(self, client):
        """A traversal strategy_type must resolve via the default fallback
        (same as any other unknown value), not crash, and not surface a raw
        filesystem path in the error body."""
        payload = {
            "question_id": "G6-L23-3957-path-injection",
            "lesson_id": "G6-L23",
            "wrong_choice": "B",
            "question_text": "本文主要在說什麼？",
            "correct_answer": "D",
            "strategy_type": "../../../../etc",
        }
        resp = client.post(START_URL, json=payload)
        assert resp.status_code in (200, 503), (
            f"Expected a clean 200 (default fallback) or 503 (AI unavailable in "
            f"test env), got {resp.status_code}: {resp.text}"
        )
        assert "etc" not in resp.text and "No prompt.yml found" not in resp.text, resp.text
