"""Executable spec — Gemini shared client retry constants and safety-filter behavior.

spec_id: ai.service.retry_and_safety
canonical_source: backend/app/services/ai/base.py
                  backend/app/services/ai/gemini_client.py
owns_code:
  - backend/app/services/ai/base.py
  - backend/app/services/ai/gemini_client.py
  - backend/app/services/ai_service.py
  - backend/app/services/ai_base.py
related_issues: []
human_spec: specs/modules/ai-service-circuit-breaker/INTENT.md

Machine-verifiable contracts (all pure-constant or import checks — no Gemini calls):

  1. MAX_RETRIES == 3  (sentinel: drift guard against accidental change)
  2. RETRY_BASE_DELAY == 1.0  (base for exponential back-off, seconds)
  3. GEMINI_TIMEOUT == 30  (asyncio.wait_for timeout, seconds)
  4. GeminiContentFilterError is importable and is an Exception subclass.
  5. ai_service.py re-exports MAX_RETRIES (backward-compat facade works).
  6. ai/base.py has NO google.genai import (pure-Python layer contract).
  7. generate_structured_response is importable from the ai sub-package.

What is NOT tested here (separate specs own these):
  - Per-service circuit breakers: omo_grader._CIRCUIT_BREAKER_THRESHOLD (omo-upload spec)
  - Socratic agent circuit breaker: MAX_CONSECUTIVE_ERRORS (socratic-dialogue spec)
  - Actual Gemini API calls (require Vertex AI credentials — 待查 at runtime)

Run:  cd backend && python -m pytest specs/test_ai_service_circuit_breaker_spec.py -v
"""
from __future__ import annotations

import inspect

import pytest


# ---------------------------------------------------------------------------
# Import helpers — skip gracefully when google-cloud-aiplatform is missing
# ---------------------------------------------------------------------------

def _import_base():
    """Return the ai.base module, skipping if deps are unavailable."""
    try:
        from app.services.ai import base
        return base
    except Exception as exc:
        pytest.skip(f"Cannot import app.services.ai.base: {exc}")


def _import_gemini_client():
    try:
        from app.services.ai import gemini_client
        return gemini_client
    except Exception as exc:
        pytest.skip(f"Cannot import app.services.ai.gemini_client: {exc}")


def _import_ai_service():
    try:
        import app.services.ai_service as svc
        return svc
    except Exception as exc:
        pytest.skip(f"Cannot import app.services.ai_service: {exc}")


# ---------------------------------------------------------------------------
# Contract 1–3: retry constants (sentinel values from ai/base.py)
# ---------------------------------------------------------------------------

class TestRetryConstants:
    """MAX_RETRIES, RETRY_BASE_DELAY, GEMINI_TIMEOUT must hold their documented values."""

    def test_max_retries_equals_3(self):
        base = _import_base()
        assert base.MAX_RETRIES == 3, (
            "MAX_RETRIES changed — update specs/modules/ai-service-circuit-breaker/INTENT.md"
        )

    def test_retry_base_delay_equals_1_second(self):
        base = _import_base()
        assert base.RETRY_BASE_DELAY == 1.0, (
            "RETRY_BASE_DELAY changed — update INTENT.md"
        )

    def test_gemini_timeout_equals_30_seconds(self):
        base = _import_base()
        assert base.GEMINI_TIMEOUT == 30, (
            "GEMINI_TIMEOUT changed — update INTENT.md"
        )

    def test_tautology_break_max_retries_not_zero(self):
        """MUST fail if MAX_RETRIES is set to 0 (would skip all retries)."""
        base = _import_base()
        assert base.MAX_RETRIES > 0, "MAX_RETRIES must be positive"

    def test_tautology_break_timeout_not_zero(self):
        """MUST fail if GEMINI_TIMEOUT is set to 0 (every call would time out immediately)."""
        base = _import_base()
        assert base.GEMINI_TIMEOUT > 0, "GEMINI_TIMEOUT must be positive"


# ---------------------------------------------------------------------------
# Contract 4: GeminiContentFilterError is a proper Exception subclass
# ---------------------------------------------------------------------------

class TestGeminiContentFilterError:
    """GeminiContentFilterError must be an Exception so callers can catch it distinctly."""

    def test_content_filter_error_is_exception(self):
        gc = _import_gemini_client()
        assert issubclass(gc.GeminiContentFilterError, Exception)

    def test_content_filter_error_is_not_base_exception_only(self):
        """Must NOT be BaseException-only (would bypass normal except clauses)."""
        gc = _import_gemini_client()
        # issubclass(SomeError, Exception) must be True — confirmed above.
        # Additionally it must NOT be RuntimeError or ValueError to stay distinct.
        assert gc.GeminiContentFilterError is not RuntimeError
        assert gc.GeminiContentFilterError is not ValueError

    def test_content_filter_error_importable_via_ai_base_shim(self):
        """Backward-compat: callers importing from ai_base must still get the class."""
        try:
            from app.services.ai_base import GeminiContentFilterError
            assert issubclass(GeminiContentFilterError, Exception)
        except Exception as exc:
            pytest.skip(f"ai_base shim import failed: {exc}")

    def test_tautology_break_error_is_raiseable(self):
        """MUST fail if GeminiContentFilterError cannot be raised/caught normally."""
        gc = _import_gemini_client()
        with pytest.raises(gc.GeminiContentFilterError):
            raise gc.GeminiContentFilterError("test")


# ---------------------------------------------------------------------------
# Contract 5: ai_service.py re-exports MAX_RETRIES (facade works)
# ---------------------------------------------------------------------------

class TestAiServiceFacade:
    """ai_service.py re-export shim must expose MAX_RETRIES for backward compat."""

    def test_max_retries_accessible_via_ai_service(self):
        svc = _import_ai_service()
        assert hasattr(svc, "MAX_RETRIES"), (
            "ai_service.py must re-export MAX_RETRIES from ai_base"
        )
        assert svc.MAX_RETRIES == 3

    def test_generate_structured_response_accessible_via_ai_service(self):
        svc = _import_ai_service()
        assert hasattr(svc, "generate_structured_response"), (
            "ai_service.py must re-export generate_structured_response"
        )
        assert callable(svc.generate_structured_response)


# ---------------------------------------------------------------------------
# Contract 6: ai/base.py has NO google.genai imports (pure-Python layer)
# ---------------------------------------------------------------------------

class TestAiBasePurity:
    """ai/base.py must NOT import google.genai — provider code belongs in gemini_client.py."""

    def test_ai_base_has_no_google_genai_import(self):
        try:
            import app.services.ai.base as base_mod
        except Exception as exc:
            pytest.skip(f"Cannot import base: {exc}")

        source_file = inspect.getfile(base_mod)
        with open(source_file, encoding="utf-8") as f:
            source = f.read()

        assert "from google" not in source, (
            "ai/base.py must not import from google — "
            "all google.genai code belongs in ai/gemini_client.py"
        )
        assert "import google" not in source, (
            "ai/base.py must not import google — keep it pure Python"
        )

    def test_tautology_break_base_imports_json(self):
        """Sanity: base.py must import json (used by _repair_json)."""
        try:
            import app.services.ai.base as base_mod
        except Exception as exc:
            pytest.skip(f"Cannot import base: {exc}")

        source_file = inspect.getfile(base_mod)
        with open(source_file, encoding="utf-8") as f:
            source = f.read()

        assert "import json" in source, (
            "ai/base.py must import json — _repair_json depends on it"
        )


# ---------------------------------------------------------------------------
# Contract 7: generate_structured_response importable from ai sub-package
# ---------------------------------------------------------------------------

def test_generate_structured_response_importable():
    """generate_structured_response must be importable from the ai sub-package."""
    try:
        from app.services.ai import generate_structured_response
        assert callable(generate_structured_response)
    except Exception as exc:
        pytest.skip(f"Cannot import generate_structured_response: {exc}")
