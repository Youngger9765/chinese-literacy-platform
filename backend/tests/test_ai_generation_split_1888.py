"""
TDD tests for ai_generation.py split (Issue #1888).

Three characterization tests that must:
1. PASS on current monolithic ai_generation.py (green before refactor)
2. PASS after split into ai_generation/ submodule (regression guard)

Tests cover the three specific post-processing / fallback rules called out in the issue.
"""

import pytest
from unittest.mock import AsyncMock, patch


# ── Test 1: exit_ticket_clamps_correct_index_and_fails_closed_on_empty_questions ────────

@pytest.mark.asyncio
class TestExitTicketClampAndFallback:
    """correct_index clamping + fail-closed on empty questions — no auto-pass."""

    async def test_clamps_correct_index_out_of_range_to_3(self):
        """correct_index=99 must clamp to max=3 (0-indexed 4-option MCQ)."""
        mock_response = {
            "questions": [
                {
                    "id": 1,
                    "question": "測試題？",
                    "options": ["A", "B", "C", "D"],
                    "correct_index": 99,
                    "explanation": "說明",
                }
            ]
        }
        with patch(
            "app.services.ai_generation.exit_ticket.generate_structured_response",
            new=AsyncMock(return_value=mock_response),
        ):
            from app.services.ai_generation import generate_exit_ticket
            result = await generate_exit_ticket(text="課文內容")
        assert result["questions"][0]["correct_index"] == 3

    async def test_clamps_negative_correct_index_to_0(self):
        """correct_index=-5 must clamp to 0."""
        mock_response = {
            "questions": [
                {
                    "id": 1,
                    "question": "測試題？",
                    "options": ["A", "B", "C", "D"],
                    "correct_index": -5,
                    "explanation": "說明",
                }
            ]
        }
        with patch(
            "app.services.ai_generation.exit_ticket.generate_structured_response",
            new=AsyncMock(return_value=mock_response),
        ):
            from app.services.ai_generation import generate_exit_ticket
            result = await generate_exit_ticket(text="課文內容")
        assert result["questions"][0]["correct_index"] == 0

    async def test_fails_closed_on_empty_questions_list(self):
        """AI returns empty questions → fallback=True, NEVER auto-pass."""
        with patch(
            "app.services.ai_generation.exit_ticket.generate_structured_response",
            new=AsyncMock(return_value={"questions": []}),
        ):
            from app.services.ai_generation import generate_exit_ticket
            result = await generate_exit_ticket(text="課文內容")
        assert result.get("fallback") is True
        assert result["questions"] == []

    async def test_fails_closed_on_ai_exception(self):
        """AI throws → fallback=True, questions=[], NEVER raise to caller."""
        with patch(
            "app.services.ai_generation.exit_ticket.generate_structured_response",
            new=AsyncMock(side_effect=RuntimeError("AI down")),
        ):
            from app.services.ai_generation import generate_exit_ticket
            result = await generate_exit_ticket(text="課文內容")
        assert result.get("fallback") is True
        assert result["questions"] == []

    async def test_no_auto_pass_on_missing_questions_key(self):
        """AI returns dict without 'questions' key → fallback, not auto-pass."""
        with patch(
            "app.services.ai_generation.exit_ticket.generate_structured_response",
            new=AsyncMock(return_value={}),
        ):
            from app.services.ai_generation import generate_exit_ticket
            result = await generate_exit_ticket(text="課文內容")
        assert result["questions"] == []
        assert result.get("fallback") is True


# ── Test 2: validate_student_sentence_clears_suggestion_when_correct ─────────

@pytest.mark.asyncio
class TestValidateStudentSentenceClearsSuggestion:
    """When AI returns is_correct=True, suggestion must be cleared to '' defensively."""

    async def test_clears_suggestion_when_model_says_correct_but_includes_suggestion(self):
        """Model should not include suggestion when correct, but if it does we clear it."""
        mock_response = {
            "is_correct": True,
            "feedback": "造句非常棒！",
            "suggestion": "可以試試用更豐富的詞彙",  # model violated the prompt
        }
        with patch(
            "app.services.ai_generation.sentence_practice.generate_structured_response",
            new=AsyncMock(return_value=mock_response),
        ):
            from app.services.ai_generation import validate_student_sentence
            result = await validate_student_sentence(
                word="來源",
                student_sentence="這個故事的來源很有趣。",
                story_title="課文",
            )
        assert result["is_correct"] is True
        assert result["suggestion"] == ""

    async def test_preserves_suggestion_when_incorrect(self):
        """When is_correct=False, suggestion must be preserved unchanged."""
        mock_response = {
            "is_correct": False,
            "feedback": "再試試看！",
            "suggestion": "試試：這條河的來源是高山上的冰雪。",
        }
        with patch(
            "app.services.ai_generation.sentence_practice.generate_structured_response",
            new=AsyncMock(return_value=mock_response),
        ):
            from app.services.ai_generation import validate_student_sentence
            result = await validate_student_sentence(
                word="來源",
                student_sentence="來源好",
                story_title="課文",
            )
        assert result["is_correct"] is False
        assert result["suggestion"] == "試試：這條河的來源是高山上的冰雪。"

    async def test_suggestion_empty_string_when_model_omits_it_and_correct(self):
        """Model returns is_correct=True with empty suggestion → stays empty."""
        mock_response = {
            "is_correct": True,
            "feedback": "很好！",
            "suggestion": "",
        }
        with patch(
            "app.services.ai_generation.sentence_practice.generate_structured_response",
            new=AsyncMock(return_value=mock_response),
        ):
            from app.services.ai_generation import validate_student_sentence
            result = await validate_student_sentence(
                word="來源",
                student_sentence="這本書的來源是圖書館。",
                story_title="課文",
            )
        assert result["is_correct"] is True
        assert result["suggestion"] == ""


# ── Test 3: grade_story_structure_handles_fill_blank_checkbox_and_display_rows ─

class TestGradeStoryStructureScoringRules:
    """Scoring rules: fill_blank fuzzy match, checkbox exact set, display skipped."""

    def _make_structure(self):
        return {
            "rows": [
                {
                    "label": "主角",
                    "value": "戴資穎",
                    "interactive_type": "fill_blank",
                    "hint": "課文主角是誰？",
                },
                {
                    "label": "事例",
                    "value": "",
                    "interactive_type": "display",  # not graded
                    "sub_rows": [
                        {
                            "label": "背景",
                            "value": "台灣羽球選手",
                            "interactive_type": "checkbox",
                            "options": ["台灣羽球選手", "中國排球選手", "日本網球選手"],
                            "correct_options": [0],
                        }
                    ],
                },
                {
                    "label": "主題",
                    "value": "堅持不懈的精神",
                    "interactive_type": "fill_blank",
                    "hint": "課文想告訴我們什麼？",
                },
            ]
        }

    @pytest.mark.asyncio
    async def test_fill_blank_exact_match_scores_correct(self):
        """fill_blank row with exact match → correct=True."""
        from app.services.ai_generation import grade_story_structure
        structure = self._make_structure()
        answers = [{"row_index": 0, "value": "戴資穎"}]
        result = await grade_story_structure(structure, answers)
        assert result["results"][0]["correct"] is True
        assert result["score"] == 100

    @pytest.mark.asyncio
    async def test_fill_blank_nickname_match_scores_correct(self):
        """fill_blank row with nickname (小戴 for 戴資穎) → correct via fuzzy match."""
        from app.services.ai_generation import grade_story_structure
        structure = self._make_structure()
        story_text = "小戴是台灣最有名的羽球選手，她的全名是戴資穎。"
        answers = [{"row_index": 0, "value": "小戴"}]
        result = await grade_story_structure(structure, answers, story_text=story_text)
        assert result["results"][0]["correct"] is True

    @pytest.mark.asyncio
    async def test_display_rows_are_skipped_not_graded(self):
        """display interactive_type rows must not appear in results."""
        from app.services.ai_generation import grade_story_structure
        structure = self._make_structure()
        # Answer the display row directly — it should be silently skipped
        answers = [{"row_index": 1, "value": "任意答案"}]
        result = await grade_story_structure(structure, answers)
        assert result["results"] == []
        # score is 0/0 = 0 when no gradable rows
        assert result["score"] == 0

    @pytest.mark.asyncio
    async def test_checkbox_sub_row_correct_set_match(self):
        """checkbox sub_row with exact selected_options match → correct=True."""
        from app.services.ai_generation import grade_story_structure
        structure = self._make_structure()
        answers = [{"row_index": 1, "sub_row_index": 0, "selected_options": [0]}]
        result = await grade_story_structure(structure, answers)
        assert result["results"][0]["correct"] is True
        assert result["score"] == 100

    @pytest.mark.asyncio
    async def test_checkbox_sub_row_wrong_set_returns_correct_answer_text(self):
        """checkbox sub_row with wrong selected_options → correct=False + feedback with correct text."""
        from app.services.ai_generation import grade_story_structure
        structure = self._make_structure()
        answers = [{"row_index": 1, "sub_row_index": 0, "selected_options": [1]}]
        result = await grade_story_structure(structure, answers)
        r = result["results"][0]
        assert r["correct"] is False
        assert "台灣羽球選手" in r["feedback"]

    @pytest.mark.asyncio
    async def test_mixed_answers_score_proportional(self):
        """Two gradable rows: 1 correct fill_blank + 1 correct checkbox → score=100."""
        from app.services.ai_generation import grade_story_structure
        structure = self._make_structure()
        answers = [
            {"row_index": 0, "value": "戴資穎"},           # fill_blank correct
            {"row_index": 1, "sub_row_index": 0, "selected_options": [0]},  # checkbox correct
        ]
        result = await grade_story_structure(structure, answers)
        assert result["score"] == 100
        assert len(result["results"]) == 2

    @pytest.mark.asyncio
    async def test_fill_blank_wrong_answer_scores_zero(self):
        """fill_blank with wrong answer → correct=False, feedback shows reference answer."""
        from app.services.ai_generation import grade_story_structure
        structure = self._make_structure()
        answers = [{"row_index": 0, "value": "錯誤答案"}]
        result = await grade_story_structure(structure, answers)
        assert result["results"][0]["correct"] is False
        assert result["score"] == 0
        assert "戴資穎" in result["results"][0]["feedback"]


# ── Backward-compat: verify re-exports still work after split ─────────────────

class TestBackwardCompatImports:
    """After split, ai_generation.py must still export all public names."""

    def test_exit_ticket_functions_importable_from_ai_generation(self):
        from app.services.ai_generation import generate_exit_ticket, grade_exit_ticket
        assert callable(generate_exit_ticket)
        assert callable(grade_exit_ticket)

    def test_sentence_practice_functions_importable_from_ai_generation(self):
        from app.services.ai_generation import (
            generate_example_sentences,
            validate_student_sentence,
        )
        assert callable(generate_example_sentences)
        assert callable(validate_student_sentence)

    def test_story_structure_functions_importable_from_ai_generation(self):
        from app.services.ai_generation import (
            generate_story_structure,
            grade_story_structure,
        )
        assert callable(generate_story_structure)
        assert callable(grade_story_structure)

    def test_teacher_comment_importable_from_ai_generation(self):
        from app.services.ai_generation import generate_teacher_comment
        assert callable(generate_teacher_comment)

    def test_schemas_importable_from_ai_generation(self):
        from app.services.ai_generation import (
            EXIT_TICKET_SCHEMA,
            EXAMPLE_SENTENCES_SCHEMA,
            SENTENCE_VALIDATION_SCHEMA,
            STORY_STRUCTURE_SCHEMA,
        )
        assert isinstance(EXIT_TICKET_SCHEMA, dict)
        assert isinstance(EXAMPLE_SENTENCES_SCHEMA, dict)
        assert isinstance(SENTENCE_VALIDATION_SCHEMA, dict)
        assert isinstance(STORY_STRUCTURE_SCHEMA, dict)

    def test_ai_service_still_exports_generation_functions(self):
        """ai_service.py wildcard re-export must still work."""
        from app.services.ai_service import (
            generate_exit_ticket,
            validate_student_sentence,
            generate_story_structure,
            generate_teacher_comment,
        )
        assert callable(generate_exit_ticket)
        assert callable(validate_student_sentence)
        assert callable(generate_story_structure)
        assert callable(generate_teacher_comment)
