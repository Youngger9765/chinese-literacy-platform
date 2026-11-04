"""TDD RED tests for the LLM school-name suggestion fallback (#3804 §4.2).

Mocks generate_structured_response — no real Gemini call in CI (same
pattern as tests/test_ai_generation_split_1888.py). Covers the
llm-endpoint-hardening rules that apply to a short, cheap generation task:
Rule 3 (input cap, checked BEFORE the LLM call), Rule 6 (fail-closed on any
exception — this is an enhancement, not a correctness gate, so "fail
closed" here means "no suggestions", not "crash the search").
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from unittest.mock import AsyncMock, patch

from app.services.moe_school_suggest import MAX_QUERY_CHARS, suggest_school_names


@pytest.mark.asyncio
class TestSuggestSchoolNames:
    async def test_returns_suggestions_from_llm_response(self):
        mock_response = {
            "suggestions": [
                {"school_name": "大安國小", "reason": "發音與字形相近"},
                {"school_name": "大同國小", "reason": "字形相近"},
            ]
        }
        with patch(
            "app.services.moe_school_suggest.generate_structured_response",
            new=AsyncMock(return_value=mock_response),
        ):
            result = await suggest_school_names("大按國xiao")
        assert result == mock_response["suggestions"]

    async def test_fails_closed_on_llm_exception_returns_empty_list(self):
        with patch(
            "app.services.moe_school_suggest.generate_structured_response",
            new=AsyncMock(side_effect=RuntimeError("Gemini down")),
        ):
            result = await suggest_school_names("某查詢字串")
        assert result == []

    async def test_fails_closed_when_response_missing_suggestions_key(self):
        with patch(
            "app.services.moe_school_suggest.generate_structured_response",
            new=AsyncMock(return_value={}),
        ):
            result = await suggest_school_names("某查詢字串")
        assert result == []

    async def test_rejects_oversized_query_without_calling_llm(self):
        mock_llm = AsyncMock(return_value={"suggestions": [{"school_name": "x", "reason": "y"}]})
        with patch("app.services.moe_school_suggest.generate_structured_response", new=mock_llm):
            result = await suggest_school_names("x" * (MAX_QUERY_CHARS + 1))
        assert result == []
        mock_llm.assert_not_called()

    async def test_rejects_empty_query_without_calling_llm(self):
        mock_llm = AsyncMock(return_value={"suggestions": []})
        with patch("app.services.moe_school_suggest.generate_structured_response", new=mock_llm):
            result = await suggest_school_names("")
        assert result == []
        mock_llm.assert_not_called()

    async def test_calls_llm_with_the_registered_task_name(self):
        mock_llm = AsyncMock(return_value={"suggestions": []})
        with patch("app.services.moe_school_suggest.generate_structured_response", new=mock_llm):
            await suggest_school_names("某查詢字串")
        _args, kwargs = mock_llm.call_args
        assert kwargs["task"] == "school_name_suggest"

    async def test_includes_the_selected_county_in_the_prompt_when_given(self):
        """#3817 — when the caller already selected a county, the LLM
        should be told, so its first guess is more likely to stay in that
        county. (The actual correctness guarantee is the deterministic
        DB filter in the route, not this prompt wording — see its test.)"""
        mock_llm = AsyncMock(return_value={"suggestions": []})
        with patch("app.services.moe_school_suggest.generate_structured_response", new=mock_llm):
            await suggest_school_names("大按國xiao", county="台北市")
        _args, kwargs = mock_llm.call_args
        contents = kwargs["contents"]
        prompt_text = contents[0].parts[0].text
        assert "台北市" in prompt_text

    async def test_omits_county_from_the_prompt_when_not_given(self):
        mock_llm = AsyncMock(return_value={"suggestions": []})
        with patch("app.services.moe_school_suggest.generate_structured_response", new=mock_llm):
            await suggest_school_names("某查詢字串")
        _args, kwargs = mock_llm.call_args
        contents = kwargs["contents"]
        prompt_text = contents[0].parts[0].text
        assert "縣市" not in prompt_text
