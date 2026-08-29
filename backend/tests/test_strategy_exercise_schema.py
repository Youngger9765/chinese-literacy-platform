"""
Regression test for #1390: strategy_exercise Pydantic schema must accept both
dict (G6 摘要策略) and list (G7 圖文整合) formats.

Root cause: G7-L28~30 YAML uses `strategy_exercises` (list), which lesson_loader
maps to the `strategy_exercise` field. The schema previously declared
`Optional[dict]`, causing Pydantic validation error (500) for all G7 lessons.

Run with:
    cd backend && python -m pytest tests/test_strategy_exercise_schema.py -v
"""

import pytest
from app.schemas.story import StoryDetail


# Minimal valid StoryDetail data shared across tests
def _base_detail(**overrides) -> dict:
    base = {
        "id": 1,
        "title": "Test Story",
        "grade": "7",   # 分級軸是字串（文言文／品格教育不是年級）
        "grade_code": "G7",
        "genre": "說明文",
        "category": "圖文整合",
        "char_count": 500,
        "text_type": "單",
        "paragraphs": ["第一段文字", "第二段文字"],
        "strategy_exercise": None,
    }
    base.update(overrides)
    return base


class TestStrategyExerciseSchemaAcceptsNone:
    """Baseline: None is accepted (G6 摘要策略 without strategy_exercise)."""

    def test_none_accepted(self):
        detail = StoryDetail(**_base_detail(strategy_exercise=None))
        assert detail.strategy_exercise is None


class TestStrategyExerciseSchemaAcceptsDict:
    """G6 摘要策略 format: single dict with type/strategy_name/etc."""

    def test_dict_accepted(self):
        exercise_dict = {
            "type": "guided_steps",
            "strategy_name": "摘要策略",
            "instruction": "找出主角和主要事件",
            "steps": [
                {"prompt": "步驟一：找主角", "type": "free_text"},
                {"prompt": "步驟二：找主要事件", "type": "free_text"},
            ],
        }
        detail = StoryDetail(**_base_detail(strategy_exercise=exercise_dict))
        assert isinstance(detail.strategy_exercise, dict)
        assert detail.strategy_exercise["type"] == "guided_steps"


class TestStrategyExerciseSchemaAcceptsList:
    """G7 圖文整合 format: list of exercise items — regression test for #1390."""

    def test_empty_list_accepted(self):
        """G7-L28 has strategy_exercises: [] (empty list)."""
        detail = StoryDetail(**_base_detail(strategy_exercise=[]))
        assert detail.strategy_exercise == []

    def test_list_with_items_accepted(self):
        """G7-L29 / G7-L30: list with multiple exercise items and steps."""
        exercises = [
            {
                "exercise": "練習一",
                "description": "第一段 vs 圖一",
                "steps": [
                    {"step": "步驟❶", "description": "先讀文字——抓到重點"},
                    {"step": "步驟❷", "description": "再看圖——先讀懂這張圖"},
                    {"step": "步驟❸", "description": "回到文字——從圖中找對應的訊息"},
                    {"step": "步驟❹", "description": "整合文圖——把文和圖合起來想"},
                ],
            },
            {
                "exercise": "練習二",
                "description": "第二段 vs 圖二",
                "steps": [
                    {"step": "步驟❶", "description": "先讀文字"},
                    {"step": "步驟❷", "description": "再看圖"},
                ],
            },
        ]
        detail = StoryDetail(**_base_detail(strategy_exercise=exercises))
        assert isinstance(detail.strategy_exercise, list)
        assert len(detail.strategy_exercise) == 2
        assert detail.strategy_exercise[0]["exercise"] == "練習一"

    def test_list_with_empty_steps_accepted(self):
        """G7-L30 has some exercises with steps: [] (empty steps list)."""
        exercises = [
            {"exercise": "練習一", "description": "第一段 vs 圖一", "steps": []},
        ]
        detail = StoryDetail(**_base_detail(strategy_exercise=exercises))
        assert detail.strategy_exercise[0]["steps"] == []


class TestStrategyExerciseG7LessonIdsSimulated:
    """Simulate the exact data shape that lesson_loader returns for G7-L28/29/30."""

    def test_g7_l28_empty_list(self):
        """G7-L28: strategy_exercises: [] in YAML → strategy_exercise=[] in schema."""
        # lesson_loader does: "strategy_exercise": data.get("strategy_exercises")
        # G7-L28 YAML has: strategy_exercises: []
        detail = StoryDetail(**_base_detail(id=1108, strategy_exercise=[]))
        assert detail.strategy_exercise == []

    def test_g7_l29_multi_exercises(self):
        """G7-L29: strategy_exercises list with 5 exercises."""
        exercises = [
            {"exercise": f"練習{i}", "description": f"第{i}段 vs 圖{i}", "steps": []}
            for i in range(1, 6)
        ]
        detail = StoryDetail(**_base_detail(id=1109, strategy_exercise=exercises))
        assert len(detail.strategy_exercise) == 5

    def test_g7_l30_multi_exercises(self):
        """G7-L30: strategy_exercises list with 4 exercises."""
        exercises = [
            {"exercise": f"練習{i}", "description": f"第{i}段 vs 表{i}", "steps": []}
            for i in range(1, 5)
        ]
        detail = StoryDetail(**_base_detail(id=1110, strategy_exercise=exercises))
        assert len(detail.strategy_exercise) == 4
