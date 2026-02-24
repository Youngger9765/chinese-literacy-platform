from pydantic import BaseModel
from typing import Optional


class VocabItemSchema(BaseModel):
    word: str
    definition: str
    note: Optional[str] = None


class StoryIntroSchema(BaseModel):
    author: str
    background: str


class StoryListItem(BaseModel):
    id: int
    lesson_number: int
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
    paragraphs: list[str]
    vocabulary: Optional[list[VocabItemSchema]] = None
    fill_in_blank: Optional[list[dict]] = None
    multiple_choice: Optional[list[dict]] = None
    reading_benchmark: Optional[dict] = None
    text_type: str
    source_file: Optional[str] = None

    model_config = {"from_attributes": True}


class StoryListResponse(BaseModel):
    stories: list[StoryListItem]
    total: int
    grades: list[int]
