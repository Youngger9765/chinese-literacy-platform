"""閱讀寶貝 API 回應 schema（#3780 第一階段）。

對應 docs/design/reading-babies/game-design.md §4（寶貝卡）、
docs/design/reading-babies/ability-indicators.md §5（老師端三個畫面）。
"""
from typing import Literal

from pydantic import BaseModel, Field


# ── 學生端 ──────────────────────────────────────────────────────────────────

class NextStepResponse(BaseModel):
    station: str
    station_label: str | None = None
    building: str | None = None
    indicator_code: str

    model_config = {"from_attributes": True}


class LessonGrowthResponse(BaseModel):
    lesson_uid: str
    title: str | None = None
    ability_family: str | None = None
    ability_family_name: str | None = None
    stage: Literal["not_encountered", "basic", "intermediate", "advanced"]
    assessable_total: int
    assessable_passed: int
    progress_ratio: float
    fragments_count: int
    next_step: NextStepResponse | None = None
    all_cleared: bool

    model_config = {"from_attributes": True}


class ReadingBabyAtlasResponse(BaseModel):
    student_id: int
    total_lessons: int
    total_fragments: int
    babies: list[LessonGrowthResponse]


class ReadingBabyCardResponse(LessonGrowthResponse):
    """單課寶貝卡——跟圖鑑裡的一格同一個 schema，只是單獨拿出來給
    `GET /learning/students/{id}/reading-babies/{lesson_uid}` 用。"""


# ── 老師端 ──────────────────────────────────────────────────────────────────

IndicatorStatus = Literal[
    "not_assigned", "insufficient_data", "only_participated", "not_achieved", "achieved", "transferable"
]


class IndicatorCellResponse(BaseModel):
    student_id: int
    indicator_code: str
    status: IndicatorStatus
    passed_lesson_count: int
    total_items: int

    model_config = {"from_attributes": True}


class ClassroomIndicatorHeatmapResponse(BaseModel):
    classroom_id: int
    indicator_codes: list[str]
    student_ids: list[int]
    cells: list[IndicatorCellResponse]
    note: str = Field(
        default="課綱對照為草稿，待老師審核",
        description="ability-indicators.md §7 要求固定標示的審核狀態提醒",
    )


class EvidenceDetailResponse(BaseModel):
    lesson_uid: str
    lesson_title: str | None
    station: str
    quality_passed: bool
    quality_score: float | None
    items_total: int | None
    items_first_try_correct: int | None
    cpm: float | None
    accuracy: float | None
    source_ref: dict | None
    created_at: str

    model_config = {"from_attributes": True}


class IndicatorEvidenceDetailResponse(BaseModel):
    student_id: int
    indicator_code: str
    evidence: list[EvidenceDetailResponse]
