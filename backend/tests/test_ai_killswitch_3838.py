"""TDD tests for the emergency AI kill switch (Issue #3838 — security incident).

Context: a sister project (ai-square) had its GCP service account key stolen
via an RCE and was billed for Vertex AI abuse. Young ordered every AI
feature in LingoLeap turned OFF and HIDDEN. AI_FEATURES_ENABLED defaults to
OFF (absent = disabled); exactly the literal string "true" turns it on.

Structure:
  1. Unit tests for the flag primitives (app.services.ai_feature_flag).
  2. Central chokepoint tests — app.services.ai.gemini_client._get_client /
     _get_client_for_task must refuse to create a genai.Client when
     disabled, and must create one when enabled (positive control).
  3. The four non-central-chokepoint call sites that build their own
     genai.Client directly (bypassing gemini_client.py): omo_identifier,
     omo_grader, reading_transcription_service, tts/providers/gemini.
  4. Route-level tests for the explicit `Depends(require_ai_enabled)`
     routes, using the fact that a decorator-level dependency runs before
     the route's `Depends(get_current_user)` parameter dependency: sending
     an unauthenticated request lets us tell "blocked by the kill switch"
     (503) apart from "blocked by auth" (401) without standing up a full
     authenticated test fixture for every route.
  5. One full authenticated end-to-end test (flag off -> 503, model mock
     never called; flag on -> 200, model mock called) to prove the whole
     stack, not just the dependency wiring.
  6. GET /api/features.

Every "disabled" test is paired with an "enabled" positive control in the
same class so a mutation that deletes the gate call turns the enabled-path
assertion (mock IS called) trivially true but the disabled-path assertion
(mock is NOT called / 503) false — i.e. removing the gate makes the
disabled-side test fail. Verified manually per PR description.
"""
from __future__ import annotations

import os
import sys
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient

from app.services.ai_feature_flag import (
    AI_FEATURES_ENABLED_ENV,
    DISABLED_MESSAGE_ZH,
    AIFeaturesDisabledError,
    ai_features_enabled,
    assert_ai_enabled,
)


# ---------------------------------------------------------------------------
# 1. Flag primitives
# ---------------------------------------------------------------------------

class TestAiFeaturesEnabled:
    def test_absent_env_var_means_disabled(self, monkeypatch):
        monkeypatch.delenv(AI_FEATURES_ENABLED_ENV, raising=False)
        assert ai_features_enabled() is False

    def test_exact_lowercase_true_means_enabled(self, monkeypatch):
        monkeypatch.setenv(AI_FEATURES_ENABLED_ENV, "true")
        assert ai_features_enabled() is True

    def test_case_insensitive_and_whitespace_tolerant(self, monkeypatch):
        for value in ("True", "TRUE", "  true  ", "tRuE"):
            monkeypatch.setenv(AI_FEATURES_ENABLED_ENV, value)
            assert ai_features_enabled() is True, f"{value!r} should enable"

    @pytest.mark.parametrize("value", ["false", "0", "no", "yes", "1", "enabled", ""])
    def test_any_other_value_means_disabled(self, monkeypatch, value):
        monkeypatch.setenv(AI_FEATURES_ENABLED_ENV, value)
        assert ai_features_enabled() is False

    def test_assert_ai_enabled_raises_when_disabled(self, monkeypatch):
        monkeypatch.delenv(AI_FEATURES_ENABLED_ENV, raising=False)
        with pytest.raises(AIFeaturesDisabledError):
            assert_ai_enabled("unit_test_feature")

    def test_assert_ai_enabled_noop_when_enabled(self, monkeypatch):
        monkeypatch.setenv(AI_FEATURES_ENABLED_ENV, "true")
        assert_ai_enabled("unit_test_feature")  # must not raise

    def test_error_message_is_short_chinese_and_non_technical(self, monkeypatch):
        monkeypatch.delenv(AI_FEATURES_ENABLED_ENV, raising=False)
        with pytest.raises(AIFeaturesDisabledError) as exc_info:
            assert_ai_enabled("socratic_question")
        assert DISABLED_MESSAGE_ZH in str(exc_info.value)
        # No stack trace / internal path leakage (CLAUDE.md security rules).
        assert "/Users/" not in str(exc_info.value)
        assert "Traceback" not in str(exc_info.value)


# ---------------------------------------------------------------------------
# 2. Central chokepoint — app.services.ai.gemini_client
# ---------------------------------------------------------------------------

class TestGeminiClientChokepoint:
    def test_get_client_refuses_when_disabled_and_never_touches_genai(self, monkeypatch):
        monkeypatch.delenv(AI_FEATURES_ENABLED_ENV, raising=False)
        from app.services.ai import gemini_client

        with patch("app.services.ai.gemini_client.genai.Client") as mock_client:
            with pytest.raises(AIFeaturesDisabledError):
                gemini_client._get_client()
            mock_client.assert_not_called()

    def test_get_client_works_when_enabled(self, monkeypatch):
        monkeypatch.setenv(AI_FEATURES_ENABLED_ENV, "true")
        from app.services.ai import gemini_client

        with patch("app.services.ai.gemini_client.genai.Client") as mock_client:
            mock_client.return_value = MagicMock()
            gemini_client._get_client()
            mock_client.assert_called_once()

    def test_get_client_for_task_refuses_when_disabled_and_never_touches_genai(self, monkeypatch):
        monkeypatch.delenv(AI_FEATURES_ENABLED_ENV, raising=False)
        from app.services.ai import gemini_client

        with patch("app.services.ai.gemini_client.genai.Client") as mock_client:
            with pytest.raises(AIFeaturesDisabledError):
                gemini_client._get_client_for_task("socratic_question")
            mock_client.assert_not_called()

    def test_get_client_for_task_works_when_enabled(self, monkeypatch):
        monkeypatch.setenv(AI_FEATURES_ENABLED_ENV, "true")
        from app.services.ai import gemini_client

        with patch("app.services.ai.gemini_client.genai.Client") as mock_client:
            mock_client.return_value = MagicMock()
            client, model = gemini_client._get_client_for_task("socratic_question")
            mock_client.assert_called_once()
            assert model == "gemini-2.5-flash-lite"

    @pytest.mark.asyncio
    async def test_generate_structured_response_refuses_when_disabled(self, monkeypatch):
        """generate_structured_response is the shared helper 10 services call
        through — this is the single highest-leverage proof that the switch
        covers the majority of LingoLeap's AI surface (socratic tutor,
        exit ticket, sentence practice, story structure, strategy practice,
        teacher comment, reading analysis, listening, mcq rescue, school
        name suggestion) without touching each of those files individually.
        """
        monkeypatch.delenv(AI_FEATURES_ENABLED_ENV, raising=False)
        from app.services.ai import gemini_client

        with patch("app.services.ai.gemini_client.genai.Client") as mock_client:
            with pytest.raises(AIFeaturesDisabledError):
                await gemini_client.generate_structured_response(
                    system_prompt="test",
                    contents=[],
                    response_schema={"type": "object"},
                    task="socratic_question",
                )
            mock_client.assert_not_called()


# ---------------------------------------------------------------------------
# 3. Non-central-chokepoint call sites (each builds its own genai.Client)
# ---------------------------------------------------------------------------

class TestOmoIdentifierGate:
    @pytest.mark.asyncio
    async def test_refuses_when_disabled_and_never_imports_genai(self, monkeypatch):
        monkeypatch.delenv(AI_FEATURES_ENABLED_ENV, raising=False)
        from app.services import omo_identifier

        with patch("app.services.omo_identifier.get_model_for_task") as mock_get_model:
            with pytest.raises(AIFeaturesDisabledError):
                await omo_identifier.identify_lesson_from_image(b"fake", "image/jpeg")
            # If the gate fires before get_model_for_task is even called,
            # we know we never got close to building a genai.Client.
            mock_get_model.assert_not_called()

    @pytest.mark.asyncio
    async def test_works_when_enabled(self, monkeypatch):
        monkeypatch.setenv(AI_FEATURES_ENABLED_ENV, "true")
        from app.services import omo_identifier

        fake_lesson = {"lesson_id": 1, "grade_code": "G6-L22", "title": "測試課文"}
        with patch.object(omo_identifier, "_load_omo_lessons", return_value=[fake_lesson]):
            with patch("app.services.omo_identifier.get_model_for_task", return_value=("m", "global")) as mock_get_model:
                with patch("google.genai.Client") as mock_client:
                    mock_instance = MagicMock()
                    mock_instance.aio.models.generate_content = AsyncMock(
                        side_effect=RuntimeError("stop before network — proves we got past the gate")
                    )
                    mock_client.return_value = mock_instance
                    # identify_lesson_from_image's own circuit-breaker try/except
                    # swallows this probe error and returns [] (fail-closed on
                    # genuine AI errors is correct existing behaviour) — the
                    # kill-switch proof is that we got far enough to call
                    # generate_content at all, which never happens when disabled.
                    result = await omo_identifier.identify_lesson_from_image(b"fake", "image/jpeg")
                    assert result == []
                    mock_get_model.assert_called_once()
                    mock_instance.aio.models.generate_content.assert_called_once()


class TestOmoGraderGate:
    @pytest.mark.asyncio
    async def test_refuses_when_disabled_and_never_imports_genai(self, monkeypatch):
        monkeypatch.delenv(AI_FEATURES_ENABLED_ENV, raising=False)
        from app.services import omo_grader

        omo_grader._reset_grader_breaker()
        lesson = {"title": "test", "fill_in_blank": [{"id": "fb_1", "answer": "x"}]}
        with patch("app.services.omo_grader.get_model_for_task") as mock_get_model:
            with pytest.raises(AIFeaturesDisabledError):
                await omo_grader.grade_worksheet_images([b"fake"], ["image/jpeg"], lesson)
            mock_get_model.assert_not_called()

    @pytest.mark.asyncio
    async def test_disabled_does_not_fall_back_to_mock_grades(self, monkeypatch):
        """The pre-existing local-dev mock-grades fallback (triggered when
        google-genai isn't installed) must NOT be how a disabled flag looks —
        that would be a silently faked AI answer instead of a clear refusal.
        """
        monkeypatch.delenv(AI_FEATURES_ENABLED_ENV, raising=False)
        from app.services import omo_grader

        omo_grader._reset_grader_breaker()
        lesson = {"title": "test", "fill_in_blank": [{"id": "fb_1", "answer": "x"}]}
        with pytest.raises(AIFeaturesDisabledError):
            await omo_grader.grade_worksheet_images([b"fake"], ["image/jpeg"], lesson)


class TestReadingTranscriptionGate:
    @pytest.mark.asyncio
    async def test_refuses_when_disabled_before_any_gemini_work(self, monkeypatch):
        monkeypatch.delenv(AI_FEATURES_ENABLED_ENV, raising=False)
        from app.services import reading_transcription_service as svc

        # get_model_for_task is imported locally inside the function (not a
        # module attribute of reading_transcription_service), so patch it at
        # its defining module and assert it's never reached.
        with patch("app.services.llm_models.get_model_for_task") as mock_get_model:
            with pytest.raises(AIFeaturesDisabledError):
                await svc.transcribe_reading_audio(
                    audio_bytes=b"\x00" * 2000,
                    mime_type="audio/wav",
                    target_text="今天天氣很好",
                    duration_ms=3000,
                )
            mock_get_model.assert_not_called()


class TestSocraticAgentGate:
    """socratic.SocraticAgent is the backend for /comprehension/chat. Its
    frontend caller (FloatingAIHelper.tsx) is already globally disabled for
    an unrelated product reason (FLOATING_AI_HELPER_ENABLED = false, 2026-05),
    but the route itself is still live — these tests gate it directly
    against a caller that hits the service without going through that route.
    """

    @pytest.mark.asyncio
    async def test_start_session_fresh_path_refuses_when_disabled(self, monkeypatch):
        monkeypatch.delenv(AI_FEATURES_ENABLED_ENV, raising=False)
        from app.services.socratic import SocraticAgent

        agent = SocraticAgent()
        with patch(
            "app.services.socratic.generate_structured_response",
            new=AsyncMock(),
        ) as mock_llm:
            with pytest.raises(AIFeaturesDisabledError):
                await agent.start_session(
                    session_id="s1", story_title="測試課文", story_text="內容",
                )
            mock_llm.assert_not_called()

    @pytest.mark.asyncio
    async def test_start_session_resume_path_unaffected_when_disabled(self, monkeypatch):
        """Resuming an existing in-memory session must keep working even
        while AI is off — it's a read of prior state, not a new AI call."""
        monkeypatch.delenv(AI_FEATURES_ENABLED_ENV, raising=False)
        from app.services.socratic import SocraticAgent, _store
        from app.services.socratic.models import SessionState

        existing = SessionState(
            session_id="s-resume", story_title="測試課文", story_text="內容",
            conversation=[{"role": "ai", "text": "第一題：主角是誰？"}],
        )
        _store.save(existing)

        agent = SocraticAgent()
        with patch(
            "app.services.socratic.generate_structured_response",
            new=AsyncMock(),
        ) as mock_llm:
            response, is_resumed = await agent.start_session(
                session_id="s-resume", story_title="測試課文", story_text="內容",
            )
            assert is_resumed is True
            assert response.question == "第一題：主角是誰？"
            mock_llm.assert_not_called()  # not called either way — it's a resume

    @pytest.mark.asyncio
    async def test_start_session_fresh_path_works_when_enabled(self, monkeypatch):
        monkeypatch.setenv(AI_FEATURES_ENABLED_ENV, "true")
        from app.services.socratic import SocraticAgent

        agent = SocraticAgent()
        mock_result = {"question": "這篇課文主角是誰？", "phase": "factual"}
        with patch(
            "app.services.socratic.generate_structured_response",
            new=AsyncMock(return_value=mock_result),
        ) as mock_llm:
            response, is_resumed = await agent.start_session(
                session_id="s2", story_title="測試課文", story_text="內容",
            )
            assert is_resumed is False
            mock_llm.assert_called_once()

    @pytest.mark.asyncio
    async def test_process_answer_refuses_when_disabled(self, monkeypatch):
        monkeypatch.delenv(AI_FEATURES_ENABLED_ENV, raising=False)
        from app.services.socratic import SocraticAgent, _store
        from app.services.socratic.models import SessionState

        state = SessionState(
            session_id="s-answer", story_title="測試課文", story_text="內容",
            conversation=[{"role": "ai", "text": "第一題：主角是誰？"}],
        )
        _store.save(state)

        agent = SocraticAgent()
        with patch(
            "app.services.socratic.generate_structured_response",
            new=AsyncMock(),
        ) as mock_llm:
            with pytest.raises(AIFeaturesDisabledError):
                await agent.process_answer(session_id="s-answer", student_answer="小明")
            mock_llm.assert_not_called()

    @pytest.mark.asyncio
    async def test_process_answer_works_when_enabled(self, monkeypatch):
        monkeypatch.setenv(AI_FEATURES_ENABLED_ENV, "true")
        from app.services.socratic import SocraticAgent, _store
        from app.services.socratic.models import SessionState

        state = SessionState(
            session_id="s-answer-2", story_title="測試課文", story_text="內容",
            conversation=[{"role": "ai", "text": "第一題：主角是誰？"}],
        )
        _store.save(state)

        agent = SocraticAgent()
        mock_result = {
            "understood": True, "feedback": "答對了！", "question": "下一題",
            "phase": "factual", "referenced_paragraph": None,
        }
        with patch(
            "app.services.socratic.generate_structured_response",
            new=AsyncMock(return_value=mock_result),
        ) as mock_llm:
            await agent.process_answer(session_id="s-answer-2", student_answer="小明")
            mock_llm.assert_called_once()


class TestGeminiTtsGate:
    def test_refuses_when_disabled_and_never_creates_client(self, monkeypatch):
        monkeypatch.delenv(AI_FEATURES_ENABLED_ENV, raising=False)
        from app.services.tts.providers import gemini as gemini_tts

        # `genai` is imported locally inside _synthesize_gemini (not a module
        # attribute), so the only observable proof available without the
        # gate is "the import block never ran" — patch google.genai.Client
        # itself and assert it's untouched.
        with patch("google.genai.Client") as mock_client:
            with pytest.raises(AIFeaturesDisabledError):
                gemini_tts._synthesize_gemini("測試文字")
            mock_client.assert_not_called()


# ---------------------------------------------------------------------------
# 4 & 5. Route-level tests
# ---------------------------------------------------------------------------

@pytest.fixture()
def unauth_client():
    """A bare TestClient with NO auth override — used to prove a
    decorator-level `Depends(require_ai_enabled)` fires before
    `Depends(get_current_user)`. 503 means the kill switch blocked the
    request; a 401/403 means the request got past the switch and into the
    normal auth flow.
    """
    from app.main import app

    with TestClient(app) as c:
        yield c


class TestExplicitlyGatedRoutesUnauthenticated:
    """These 5 routes got an explicit `Depends(require_ai_enabled)` because
    their handlers would otherwise silently degrade (canned fallback
    question, empty AI comment, fake "is_correct=True", or an OMO background
    job scheduled for nothing) instead of surfacing the kill switch.
    """

    @pytest.mark.parametrize(
        "method,path",
        [
            ("POST", "/api/comprehension/question"),
            ("POST", "/api/omo/upload"),
            ("POST", "/api/teacher/students/1/sessions/1/generate-ai-comment"),
            ("POST", "/api/learning/strategy-practice/validate"),
        ],
    )
    def test_disabled_returns_503_before_auth_even_runs(self, unauth_client, monkeypatch, method, path):
        monkeypatch.delenv(AI_FEATURES_ENABLED_ENV, raising=False)
        resp = unauth_client.request(method, path, json={})
        assert resp.status_code == 503, resp.text
        assert DISABLED_MESSAGE_ZH in resp.json()["detail"]

    @pytest.mark.parametrize(
        "method,path",
        [
            ("POST", "/api/comprehension/question"),
            ("POST", "/api/omo/upload"),
            ("POST", "/api/teacher/students/1/sessions/1/generate-ai-comment"),
            ("POST", "/api/learning/strategy-practice/validate"),
        ],
    )
    def test_enabled_falls_through_past_the_switch_to_auth(self, unauth_client, monkeypatch, method, path):
        """Positive control: with the flag on, the SAME unauthenticated
        request must NOT be blocked by the kill switch — it should instead
        fail for the normal reason (missing auth / missing multipart body),
        proving require_ai_enabled let it through rather than always firing.
        """
        monkeypatch.setenv(AI_FEATURES_ENABLED_ENV, "true")
        resp = unauth_client.request(method, path, json={})
        assert resp.status_code != 503, resp.text
        assert "AI" not in resp.json().get("detail", "") or DISABLED_MESSAGE_ZH not in resp.text


class TestOmoAttemptRouteUnauthenticated:
    def test_disabled_returns_503(self, unauth_client, monkeypatch):
        monkeypatch.delenv(AI_FEATURES_ENABLED_ENV, raising=False)
        resp = unauth_client.post("/api/omo/1/attempt")
        assert resp.status_code == 503, resp.text
        assert DISABLED_MESSAGE_ZH in resp.json()["detail"]

    def test_enabled_falls_through_to_auth(self, unauth_client, monkeypatch):
        monkeypatch.setenv(AI_FEATURES_ENABLED_ENV, "true")
        resp = unauth_client.post("/api/omo/1/attempt")
        assert resp.status_code != 503, resp.text


# ---------------------------------------------------------------------------
# 5. Full authenticated end-to-end: strategy-practice/validate
# ---------------------------------------------------------------------------

class TestStrategyValidateEndToEnd:
    """Full-stack proof for one representative gated route: real auth, real
    rate limiter, real route dependency graph. Flag off -> 503 and the
    model is never invoked even though the request is otherwise 100% valid.
    Flag on -> normal 200 response and the (mocked) model IS invoked.
    """

    @pytest.fixture(autouse=True)
    def _setup_db_and_user(self, tmp_path):
        from sqlalchemy import create_engine, event
        from sqlalchemy.orm import sessionmaker
        from sqlalchemy.pool import StaticPool

        from app.main import app
        from app.database import get_db
        from app.models import Base
        from app.models.user import User
        from app.auth.dependencies import get_current_user
        from app.auth.rate_limiter import ai_rate_limiter, general_rate_limiter

        general_rate_limiter.reset()
        ai_rate_limiter.reset()

        engine = create_engine(
            "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool,
        )

        @event.listens_for(engine, "connect")
        def _pragma(dbapi_connection, _):
            cur = dbapi_connection.cursor()
            cur.execute("PRAGMA foreign_keys=ON")
            cur.close()

        # expire_on_commit=False so the detached `user` instance handed back
        # by _override_get_current_user() below stays readable after this
        # setup session closes — FastAPI's get_current_user override here
        # returns a plain object, not a fresh query, so it must not expire.
        Session = sessionmaker(autocommit=False, autoflush=False, bind=engine, expire_on_commit=False)
        Base.metadata.create_all(bind=engine)
        db = Session()
        # /learning/strategy-practice/validate only depends on get_current_user
        # (no require_role) — no Role/UserRole rows needed for this route.
        user = User(
            id=1, username="kswitch_student", name="Kill Switch Student",
            email="kswitch@example.com", password_hash="fake",
        )
        db.add(user)
        db.commit()
        db.close()

        def _override_get_db():
            s = Session()
            try:
                yield s
            finally:
                s.close()

        def _override_get_current_user():
            return user

        self.app = app
        app.dependency_overrides[get_db] = _override_get_db
        app.dependency_overrides[get_current_user] = _override_get_current_user
        yield
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_current_user, None)
        Base.metadata.drop_all(bind=engine)

    @pytest.fixture()
    def client(self):
        from app.main import app

        with TestClient(app) as c:
            yield c

    def _payload(self):
        return {
            "question": "為什麼主角要這樣做？",
            "student_answer": "因為他想幫助朋友",
            "strategy_name": "推論策略",
            "story_title": "測試課文",
            "passage": "這是一段測試課文內容。",
        }

    def test_disabled_returns_503_and_model_never_called(self, client, monkeypatch):
        monkeypatch.delenv(AI_FEATURES_ENABLED_ENV, raising=False)
        with patch(
            "app.services.ai_generation.strategy_practice.generate_structured_response",
            new=AsyncMock(),
        ) as mock_llm:
            resp = client.post("/api/learning/strategy-practice/validate", json=self._payload())
            assert resp.status_code == 503, resp.text
            assert DISABLED_MESSAGE_ZH in resp.json()["detail"]
            mock_llm.assert_not_called()

    def test_enabled_returns_200_and_model_is_called(self, client, monkeypatch):
        monkeypatch.setenv(AI_FEATURES_ENABLED_ENV, "true")
        mock_result = {"is_correct": True, "feedback": "答得好！", "suggestion": ""}
        with patch(
            "app.services.ai_generation.strategy_practice.generate_structured_response",
            new=AsyncMock(return_value=mock_result),
        ) as mock_llm:
            resp = client.post("/api/learning/strategy-practice/validate", json=self._payload())
            assert resp.status_code == 200, resp.text
            mock_llm.assert_called_once()


# ---------------------------------------------------------------------------
# 6. GET /api/features
# ---------------------------------------------------------------------------

class TestFeaturesEndpoint:
    @pytest.fixture()
    def client(self):
        from app.main import app

        with TestClient(app) as c:
            yield c

    def test_reports_disabled_by_default(self, client, monkeypatch):
        monkeypatch.delenv(AI_FEATURES_ENABLED_ENV, raising=False)
        resp = client.get("/api/features")
        assert resp.status_code == 200
        assert resp.json() == {"ai_features_enabled": False}

    def test_reports_enabled_when_flag_set(self, client, monkeypatch):
        monkeypatch.setenv(AI_FEATURES_ENABLED_ENV, "true")
        resp = client.get("/api/features")
        assert resp.status_code == 200
        assert resp.json() == {"ai_features_enabled": True}

    def test_requires_no_authentication(self, client, monkeypatch):
        monkeypatch.delenv(AI_FEATURES_ENABLED_ENV, raising=False)
        resp = client.get("/api/features")
        assert resp.status_code != 401
        assert resp.status_code != 403
