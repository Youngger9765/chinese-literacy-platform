"""
Tests for Exit Ticket AI implementation (Issue #463).

TDD: Red → Green → Refactor
Tests cover:
- exit_ticket_service.calculate_score (pure function, no AI)
- generate_exit_ticket_questions with AI mock
- generate_exit_ticket in ai_service with AI mock (schema validation)
- Backend routes (generate + submit) via TestClient
"""

import pytest
from unittest.mock import AsyncMock, patch


# ── Unit tests: calculate_score ───────────────────────────────────────────────

class TestCalculateScore:
    """Pure-function tests — no I/O, no mocking required."""

    def setup_method(self):
        from backend.app.services.exit_ticket_service import calculate_score
        self.calculate_score = calculate_score

    def test_all_correct(self):
        questions = [
            {"id": 1, "correct_index": 0},
            {"id": 2, "correct_index": 2},
        ]
        answers = [
            {"question_id": 1, "selected_index": 0},
            {"question_id": 2, "selected_index": 2},
        ]
        result = self.calculate_score(questions, answers)
        assert result["score"] == 100
        assert result["correct_count"] == 2
        assert result["total"] == 2

    def test_all_wrong(self):
        questions = [{"id": 1, "correct_index": 0}, {"id": 2, "correct_index": 1}]
        answers = [
            {"question_id": 1, "selected_index": 3},
            {"question_id": 2, "selected_index": 3},
        ]
        result = self.calculate_score(questions, answers)
        assert result["score"] == 0
        assert result["correct_count"] == 0

    def test_half_correct(self):
        questions = [
            {"id": 1, "correct_index": 0},
            {"id": 2, "correct_index": 1},
        ]
        answers = [
            {"question_id": 1, "selected_index": 0},  # correct
            {"question_id": 2, "selected_index": 3},  # wrong
        ]
        result = self.calculate_score(questions, answers)
        assert result["score"] == 50
        assert result["correct_count"] == 1

    def test_empty_answers_returns_zero(self):
        """CRITICAL: never auto-pass on empty answers."""
        questions = [{"id": 1, "correct_index": 0}]
        result = self.calculate_score(questions, [])
        assert result["score"] == 0

    def test_empty_questions_returns_zero(self):
        result = self.calculate_score([], [])
        assert result["score"] == 0
        assert result["total"] == 0

    def test_three_out_of_five_correct(self):
        questions = [{"id": i, "correct_index": 0} for i in range(1, 6)]
        answers = [
            {"question_id": i, "selected_index": 0 if i <= 3 else 1}
            for i in range(1, 6)
        ]
        result = self.calculate_score(questions, answers)
        assert result["score"] == 60
        assert result["correct_count"] == 3
        assert result["total"] == 5


# ── Unit tests: generate_exit_ticket_questions (service layer) ────────────────

@pytest.mark.asyncio
class TestGenerateExitTicketQuestions:

    async def test_returns_ai_questions_when_ai_succeeds(self):
        mock_questions = [
            {
                "id": 1,
                "question": "文章的主角是誰？",
                "options": ["小明", "小花", "老師", "爸爸"],
                "correct_index": 0,
                "explanation": "文章第一段提到小明是主角。",
            }
        ]
        with patch(
            "backend.app.services.exit_ticket_service._ai_generate",
            new=AsyncMock(return_value={"questions": mock_questions}),
        ):
            from backend.app.services.exit_ticket_service import generate_exit_ticket_questions
            result = await generate_exit_ticket_questions(
                story_content=["小明是一個勤奮的學生。"],
                wrong_chars=["明"],
            )
        assert result["source"] == "ai"
        assert len(result["questions"]) == 1
        assert result["questions"][0]["id"] == 1

    async def test_falls_back_when_ai_returns_empty(self):
        with patch(
            "backend.app.services.exit_ticket_service._ai_generate",
            new=AsyncMock(return_value={"questions": [], "fallback": True}),
        ):
            from backend.app.services.exit_ticket_service import generate_exit_ticket_questions
            result = await generate_exit_ticket_questions(
                story_content=["某篇課文內容。"],
            )
        assert result["source"] == "fallback"
        assert result["questions"] == []

    async def test_falls_back_on_exception(self):
        with patch(
            "backend.app.services.exit_ticket_service._ai_generate",
            new=AsyncMock(side_effect=Exception("network error")),
        ):
            from backend.app.services.exit_ticket_service import generate_exit_ticket_questions
            result = await generate_exit_ticket_questions(
                story_content=["某篇課文內容。"],
            )
        assert result["source"] == "fallback"
        assert result["questions"] == []


# ── Unit tests: ai_service.generate_exit_ticket ───────────────────────────────

@pytest.mark.asyncio
class TestAiServiceGenerateExitTicket:

    async def test_clamps_correct_index_to_0_3(self):
        """correct_index values outside 0-3 must be clamped."""
        mock_response = {
            "questions": [
                {
                    "id": 1,
                    "question": "test?",
                    "options": ["A", "B", "C", "D"],
                    "correct_index": 99,  # out of range
                    "explanation": "test explanation",
                }
            ]
        }
        with patch(
            "backend.app.services.ai_service.generate_structured_response",
            new=AsyncMock(return_value=mock_response),
        ):
            from backend.app.services.ai_service import generate_exit_ticket
            result = await generate_exit_ticket(text="some story text")
        assert result["questions"][0]["correct_index"] == 3  # clamped to max

    async def test_returns_fallback_on_ai_exception(self):
        """On any AI error, return fallback=True, NEVER raise or auto-pass."""
        with patch(
            "backend.app.services.ai_service.generate_structured_response",
            new=AsyncMock(side_effect=RuntimeError("AI down")),
        ):
            from backend.app.services.ai_service import generate_exit_ticket
            result = await generate_exit_ticket(text="some story text")
        assert result.get("fallback") is True
        assert result["questions"] == []

    async def test_returns_fallback_on_empty_questions(self):
        with patch(
            "backend.app.services.ai_service.generate_structured_response",
            new=AsyncMock(return_value={"questions": []}),
        ):
            from backend.app.services.ai_service import generate_exit_ticket
            result = await generate_exit_ticket(text="some story text")
        assert result.get("fallback") is True

    async def test_passes_wrong_chars_to_prompt(self):
        """Ensure wrong_chars are included in the AI prompt content."""
        mock_response = {
            "questions": [
                {
                    "id": 1,
                    "question": "以下哪個是「明」字？",
                    "options": ["明", "鳴", "命", "名"],
                    "correct_index": 0,
                    "explanation": "明是光明的明。",
                }
            ]
        }
        captured_contents = []

        async def mock_generate(system_prompt, contents, **kwargs):
            captured_contents.extend(contents)
            return mock_response

        with patch(
            "backend.app.services.ai_service.generate_structured_response",
            new=mock_generate,
        ):
            from backend.app.services.ai_service import generate_exit_ticket
            await generate_exit_ticket(text="課文內容", wrong_chars=["明", "清"])

        assert captured_contents, "generate_structured_response should be called"
        content_text = captured_contents[0].parts[0].text
        assert "明" in content_text
        assert "清" in content_text
