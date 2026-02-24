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
    reading_benchmark: Optional[ReadingBenchmarkSchema] = None
    text_type: str = "單"
    source_file: Optional[str] = None


class StoryListResponse(BaseModel):
    stories: list[StoryListItem]
    total: int
    grades: list[int]  # available grades for filter UI
