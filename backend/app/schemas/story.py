from pydantic import BaseModel, Field
from typing import Optional


class VocabItemSchema(BaseModel):
    word: str
    definition: str
    note: Optional[str] = None


class ReadingBenchmarkLevel(BaseModel):
    threshold: str
    feedback: str


class ReadingBenchmarkSchema(BaseModel):
    levels: list[ReadingBenchmarkLevel]


class StoryIntroSchema(BaseModel):
    author: str
    background: str


class StoryListItem(BaseModel):
    """Lightweight schema for story list (no full content)."""
    id: int
    lesson_number: Optional[int] = None
    title: str
    grade: int
    grade_code: str
    genre: str
    category: str
    char_count: int
    thumbnail_url: Optional[str] = None
    reading_strategy: Optional[str] = None
    intro: Optional[StoryIntroSchema] = None

    model_config = {"from_attributes": True}


class StoryDetail(StoryListItem):
    """Full schema for single story detail."""
    paragraphs: list[str]
    vocabulary: Optional[list[VocabItemSchema]] = None
    fill_in_blank: Optional[list[dict]] = None
    multiple_choice: Optional[list[dict]] = None
    vocab_bank: Optional[dict] = None  # letter → word mapping for fill_in_blank (#615)
    knowledge_video_url: Optional[str] = None  # ⑨ 知識補給站 YouTube URL (#615)
    reading_benchmark: Optional[ReadingBenchmarkSchema] = None
    text_type: str = "單"
    source_file: Optional[str] = None
    strategy_exercise: Optional[dict] = None  # 閱讀策略練習 (#943)
    # Schema-driven step composition (#1374): per-lesson step order from YAML.
    # None means frontend uses DEFAULT_STEP_SEQUENCE fallback.
    step_sequence: Optional[list[str]] = None


class StoryListResponse(BaseModel):
    stories: list[StoryListItem]
    total: int
    grades: list[int]  # available grades for filter UI


# ── Admin CRUD schemas ───────────────────────────────────────────────────────

class StoryCreateRequest(BaseModel):
    """Request body for creating a new story (writes a new YAML file)."""
    lesson_number: int = Field(..., ge=1, description="Unique lesson number")
    title: str = Field(..., min_length=1, max_length=200)
    grade: int = Field(..., ge=4, le=9)
    grade_code: str = Field(..., min_length=1, max_length=10)
    genre: str = Field(..., min_length=1, max_length=20)
    text_type: str = Field(default="單", max_length=10)
    reading_strategy: Optional[str] = Field(default=None, max_length=200)
    paragraphs: list[str] = Field(..., min_length=1)
    vocabulary: Optional[list[VocabItemSchema]] = None
    fill_in_blank: Optional[list[dict]] = None
    multiple_choice: Optional[list[dict]] = None
    reading_benchmark: Optional[ReadingBenchmarkSchema] = None
    source_file: Optional[str] = Field(default=None, max_length=200)


class StoryUpdateRequest(BaseModel):
    """Request body for updating an existing story. All fields optional."""
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    grade: Optional[int] = Field(default=None, ge=4, le=9)
    grade_code: Optional[str] = Field(default=None, min_length=1, max_length=10)
    genre: Optional[str] = Field(default=None, min_length=1, max_length=20)
    text_type: Optional[str] = Field(default=None, max_length=10)
    reading_strategy: Optional[str] = None
    paragraphs: Optional[list[str]] = Field(default=None, min_length=1)
    vocabulary: Optional[list[VocabItemSchema]] = None
    fill_in_blank: Optional[list[dict]] = None
    multiple_choice: Optional[list[dict]] = None
    reading_benchmark: Optional[ReadingBenchmarkSchema] = None
    source_file: Optional[str] = Field(default=None, max_length=200)


class StoryAdminListItem(BaseModel):
    """Admin story list item — lighter than StoryDetail, includes metadata."""
    lesson_number: int
    title: str
    grade: int
    grade_code: str
    genre: str
    text_type: str
    paragraph_count: int
    char_count: int
    reading_strategy: Optional[str] = None
    source_file: Optional[str] = None


class StoryAdminListResponse(BaseModel):
    stories: list[StoryAdminListItem]
    total: int
