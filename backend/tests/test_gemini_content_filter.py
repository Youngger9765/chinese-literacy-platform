"""
Unit tests for Gemini content filter / safety refusal handling (Issue #526).

Tests cover:
- _check_safety_filter raises GeminiContentFilterError when candidates is empty
- _check_safety_filter raises GeminiContentFilterError when finish_reason == SAFETY
- _check_safety_filter raises GeminiContentFilterError when block_reason is set
- _check_safety_filter passes through for normal responses
- generate_structured_response propagates GeminiContentFilterError immediately (no retry)
- generate_socratic_question raises GeminiContentFilterError when safety filter fires
- CONTENT_FILTER_FRIENDLY_MSG is defined and non-empty
"""

# These patched app.services.ai_service._get_client, which is wrong twice over:
# ai_service is a re-export shim, and neither function under test calls
# _get_client — both resolve their client through _get_client_for_task, which
# respects TASK_MODELS. So the mock never intervened and every test here hit
# the live Vertex AI endpoint (6 outbound connections in one run).
import asyncio
import sys
import os
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest

from app.services.ai_service import (
    CONTENT_FILTER_FRIENDLY_MSG,
    GeminiContentFilterError,
    _check_safety_filter,
    generate_structured_response,
    generate_socratic_question,
)


# ---------------------------------------------------------------------------
# Helpers to build mock Gemini response objects
# ---------------------------------------------------------------------------


def _make_response(
    *,
    candidates=True,
    finish_reason="FinishReason.STOP",
    block_reason=None,
    text='{"key": "value"}',
):
    """Build a minimal mock of a Gemini GenerateContentResponse."""
    response = MagicMock()

    if candidates:
        candidate = MagicMock()
        candidate.finish_reason = finish_reason
        response.candidates = [candidate]
    else:
        response.candidates = []

    # prompt_feedback
    feedback = MagicMock()
    feedback.block_reason = block_reason
    response.prompt_feedback = feedback

    response.text = text
    return response


# ---------------------------------------------------------------------------
# _check_safety_filter unit tests
# ---------------------------------------------------------------------------


class TestCheckSafetyFilter:
    """Unit tests for the _check_safety_filter helper."""

    def test_empty_candidates_raises(self):
        """No candidates = prompt-level block; must raise GeminiContentFilterError."""
        response = _make_response(candidates=False, block_reason=None)
        with pytest.raises(GeminiContentFilterError):
            _check_safety_filter(response)

    def test_empty_candidates_with_block_reason_raises(self):
        """No candidates with explicit block_reason still raises."""
        response = _make_response(candidates=False, block_reason="HARM_CATEGORY_DANGEROUS")
        with pytest.raises(GeminiContentFilterError):
            _check_safety_filter(response)

    def test_finish_reason_safety_raises(self):
        """finish_reason containing 'SAFETY' must raise GeminiContentFilterError."""
        response = _make_response(finish_reason="FinishReason.SAFETY")
        with pytest.raises(GeminiContentFilterError):
            _check_safety_filter(response)

    def test_finish_reason_safety_short_raises(self):
        """Plain string 'SAFETY' also triggers the filter."""
        response = _make_response(finish_reason="SAFETY")
        with pytest.raises(GeminiContentFilterError):
            _check_safety_filter(response)

    def test_block_reason_set_raises(self):
        """prompt_feedback.block_reason set to a non-unspecified value should raise."""
        response = _make_response(
            finish_reason="FinishReason.STOP",
            block_reason="HARM_CATEGORY_SEXUALLY_EXPLICIT",
        )
        with pytest.raises(GeminiContentFilterError):
            _check_safety_filter(response)

    def test_normal_response_passes(self):
        """Normal STOP response with no block_reason should not raise."""
        response = _make_response(finish_reason="FinishReason.STOP", block_reason=None)
        # Should not raise
        _check_safety_filter(response)

    def test_max_tokens_response_passes(self):
        """MAX_TOKENS finish_reason is not a safety issue — should not raise."""
        response = _make_response(finish_reason="FinishReason.MAX_TOKENS", block_reason=None)
        _check_safety_filter(response)

    def test_block_reason_unspecified_passes(self):
        """BLOCK_REASON_UNSPECIFIED means no block — should not raise."""
        response = _make_response(
            finish_reason="FinishReason.STOP",
            block_reason="BLOCK_REASON_UNSPECIFIED",
        )
        _check_safety_filter(response)

    def test_block_reason_zero_passes(self):
        """block_reason == '0' is the numeric unspecified value — should not raise."""
        response = _make_response(finish_reason="FinishReason.STOP", block_reason="0")
        _check_safety_filter(response)

    def test_block_reason_none_passes(self):
        """block_reason == None means no block — should not raise."""
        response = _make_response(finish_reason="FinishReason.STOP", block_reason=None)
        _check_safety_filter(response)

    def test_error_message_is_descriptive(self):
        """The raised error should include the finish_reason for debugging."""
        response = _make_response(finish_reason="FinishReason.SAFETY")
        with pytest.raises(GeminiContentFilterError, match="SAFETY"):
            _check_safety_filter(response)


# ---------------------------------------------------------------------------
# generate_structured_response: safety filter propagates without retry
# ---------------------------------------------------------------------------


class TestGenerateStructuredResponseContentFilter:
    """generate_structured_response must propagate GeminiContentFilterError immediately."""

    @pytest.mark.asyncio
    async def test_safety_filter_raises_immediately(self):
        """When Gemini returns a SAFETY response, GeminiContentFilterError is raised."""
        mock_response = _make_response(finish_reason="FinishReason.SAFETY")

        with patch("app.services.ai.gemini_client._get_client_for_task") as mock_client_factory:
            mock_client = MagicMock()
            mock_client.models.generate_content.return_value = mock_response
            # _get_client_for_task returns (client, model_name), not a bare client.
            mock_client_factory.return_value = (mock_client, "gemini-2.5-flash-lite")

            with pytest.raises(GeminiContentFilterError):
                await generate_structured_response(
                    system_prompt="test",
                    contents=[],
                    response_schema={"type": "OBJECT", "properties": {}},
                )

    @pytest.mark.asyncio
    async def test_safety_filter_not_retried(self):
        """Safety filter must NOT trigger retries — generate_content called exactly once."""
        mock_response = _make_response(finish_reason="FinishReason.SAFETY")

        with patch("app.services.ai.gemini_client._get_client_for_task") as mock_client_factory:
            mock_client = MagicMock()
            mock_client.models.generate_content.return_value = mock_response
            # _get_client_for_task returns (client, model_name), not a bare client.
            mock_client_factory.return_value = (mock_client, "gemini-2.5-flash-lite")

            with pytest.raises(GeminiContentFilterError):
                await generate_structured_response(
                    system_prompt="test",
                    contents=[],
                    response_schema={"type": "OBJECT", "properties": {}},
                )

            # Should have been called exactly once, not retried 3 times
            assert mock_client.models.generate_content.call_count == 1

    @pytest.mark.asyncio
    async def test_empty_candidates_raises_immediately(self):
        """Empty candidates (prompt-level block) raises GeminiContentFilterError."""
        mock_response = _make_response(candidates=False)

        with patch("app.services.ai.gemini_client._get_client_for_task") as mock_client_factory:
            mock_client = MagicMock()
            mock_client.models.generate_content.return_value = mock_response
            # _get_client_for_task returns (client, model_name), not a bare client.
            mock_client_factory.return_value = (mock_client, "gemini-2.5-flash-lite")

            with pytest.raises(GeminiContentFilterError):
                await generate_structured_response(
                    system_prompt="test",
                    contents=[],
                    response_schema={"type": "OBJECT", "properties": {}},
                )

    @pytest.mark.asyncio
    async def test_normal_response_succeeds(self):
        """Normal response still works correctly after adding the safety check."""
        mock_response = _make_response(
            finish_reason="FinishReason.STOP",
            text='{"answer": "hello"}',
        )

        with patch("app.services.ai.gemini_client._get_client_for_task") as mock_client_factory:
            mock_client = MagicMock()
            mock_client.models.generate_content.return_value = mock_response
            # _get_client_for_task returns (client, model_name), not a bare client.
            mock_client_factory.return_value = (mock_client, "gemini-2.5-flash-lite")

            result = await generate_structured_response(
                system_prompt="test",
                contents=[],
                response_schema={"type": "OBJECT", "properties": {}},
            )
            assert result == {"answer": "hello"}


# ---------------------------------------------------------------------------
# generate_socratic_question: safety filter handled
# ---------------------------------------------------------------------------


class TestGenerateSocraticQuestionContentFilter:
    """generate_socratic_question must raise GeminiContentFilterError on safety block."""

    @pytest.mark.asyncio
    async def test_safety_filter_raises(self):
        """Safety block in generate_socratic_question raises GeminiContentFilterError."""
        mock_response = _make_response(finish_reason="FinishReason.SAFETY")

        with patch("app.services.ai_comprehension._get_client_for_task") as mock_client_factory:
            mock_client = MagicMock()
            mock_client.models.generate_content.return_value = mock_response
            # _get_client_for_task returns (client, model_name), not a bare client.
            mock_client_factory.return_value = (mock_client, "gemini-2.5-flash-lite")

            with pytest.raises(GeminiContentFilterError):
                await generate_socratic_question(
                    story_title="測試課文",
                    story_text="這是一篇測試課文的內容。",
                    conversation=[],
                )

    @pytest.mark.asyncio
    async def test_empty_candidates_raises(self):
        """Empty candidates in generate_socratic_question raises GeminiContentFilterError."""
        mock_response = _make_response(candidates=False)

        with patch("app.services.ai_comprehension._get_client_for_task") as mock_client_factory:
            mock_client = MagicMock()
            mock_client.models.generate_content.return_value = mock_response
            # _get_client_for_task returns (client, model_name), not a bare client.
            mock_client_factory.return_value = (mock_client, "gemini-2.5-flash-lite")

            with pytest.raises(GeminiContentFilterError):
                await generate_socratic_question(
                    story_title="測試課文",
                    story_text="這是一篇測試課文的內容。",
                    conversation=[],
                )

    @pytest.mark.asyncio
    async def test_normal_question_returned(self):
        """Normal response returns the question text correctly."""
        mock_response = _make_response(
            finish_reason="FinishReason.STOP",
            text="課文中的主角做了什麼事？",
        )

        with patch("app.services.ai_comprehension._get_client_for_task") as mock_client_factory:
            mock_client = MagicMock()
            mock_client.models.generate_content.return_value = mock_response
            # _get_client_for_task returns (client, model_name), not a bare client.
            mock_client_factory.return_value = (mock_client, "gemini-2.5-flash-lite")

            result = await generate_socratic_question(
                story_title="測試課文",
                story_text="這是一篇測試課文的內容。",
                conversation=[],
            )
            assert result == "課文中的主角做了什麼事？"


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------


class TestContentFilterConstants:
    """Verify the friendly message constant is properly defined."""

    def test_friendly_message_defined(self):
        """CONTENT_FILTER_FRIENDLY_MSG must be a non-empty string."""
        assert isinstance(CONTENT_FILTER_FRIENDLY_MSG, str)
        assert len(CONTENT_FILTER_FRIENDLY_MSG) > 0

    def test_friendly_message_in_chinese(self):
        """Friendly message should contain Chinese characters for student readability."""
        # Check for at least one CJK character (U+4E00–U+9FFF)
        has_chinese = any("\u4e00" <= ch <= "\u9fff" for ch in CONTENT_FILTER_FRIENDLY_MSG)
        assert has_chinese, f"Expected Chinese in message: {CONTENT_FILTER_FRIENDLY_MSG!r}"

    def test_gemini_content_filter_error_is_exception(self):
        """GeminiContentFilterError must be a proper Exception subclass."""
        err = GeminiContentFilterError("test")
        assert isinstance(err, Exception)
        assert str(err) == "test"
