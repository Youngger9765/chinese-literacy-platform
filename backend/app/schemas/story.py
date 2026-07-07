from pydantic import BaseModel, Field
from typing import Optional, Union


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
    knowledge_video_url: Optional[str] = None  # ⑨ 知識補給站 — first video URL only (#615, legacy)
    # Full video list (#1683): catalog has multiple videos per lesson; KnowledgeStation renders all.
    # Each item: {title: '影片1', url: 'https://...'}
    video_links: Optional[list[dict]] = None
    reading_benchmark: Optional[ReadingBenchmarkSchema] = None
    text_type: str = "單"
    source_file: Optional[str] = None
    strategy_exercise: Optional[Union[dict, list]] = None  # 閱讀策略練習 (#943); list for multi-exercise lessons (G7 圖文整合)
    # Block-sequence spotlight v2 (#2205): guide/passage/single blocks in order
    spotlight_v2: Optional[dict] = None
    # Schema-driven step composition (#1374): per-lesson step order from YAML.
    # None means frontend uses DEFAULT_STEP_SEQUENCE fallback.
    step_sequence: Optional[list[str]] = None
    # Plugin-pattern dispatch fields (#1404):
    # canonical strategy type → backend strategy_prompts/{type}/ dispatch
    reading_strategy_type: str = "general"
    # frontend ComprehensionChat layout variant: 'standard' | 'graphic-text' | 'graphic-chart'
    layout_mode: str = "standard"
    # Image gallery for graphic-text layout (#1341)
    # Each image: {filename, size_bytes, image_hash, content_type, caption?, figure_label?}
    # figure_label (#2085): the REAL 圖N title baked into the image pixels
    # (e.g. '圖一'). Array order is NOT figure order — pairing must use this label.
    # Untyped dict passes the field straight through from YAML.
    images: list[dict] = []
    # 學習單 section ordering + intro metadata (#1434)
    # worksheet_section_order: [{number: '二', name: '念順順', type: 'reading_timer'}, ...]
    worksheet_section_order: Optional[list[dict]] = None
    # worksheet_intro: {step_label, target_strategy, instructions, level_label, lesson_label, authors}
    worksheet_intro: Optional[dict] = None
    # lesson_intro: real course introduction (#1443)
    # source: 'docx_explanation' | 'docx_guide' | 'excel'
    # {source, text, unit_topic?, strategy_title?}
    lesson_intro: Optional[dict] = None
    # Public PDF URL of the original 紙本學習單 docx (#1444)
    # Hosted at gs://lingoleap-assets/worksheets/{lesson_code}.pdf
    worksheet_pdf_url: Optional[str] = None
    # Public docx URL for lessons where soffice PDF conversion produces broken output (#2073)
    # When present, frontend shows a download link instead of the broken PDF iframe.
    # Hosted at gs://lingoleap-assets/worksheets/{lesson_code}.docx
    worksheet_docx_url: Optional[str] = None
    # Tables extracted from 紙本學習單 PDF (#1685).
    # Each item: {id, title, headers: list[str], rows: list[{cells: list[str], section?: str}],
    #             section_label_col?: str, notes?: list[str]}
    # Used by 圖文表整合 lessons (G7-L28, G7-L30) where docx → yml parser dropped
    # table row data; frontend renders via TableDisplay component with zoom modal.
    tables: Optional[list[dict]] = None
    # Story structure scaffold for StoryStructure step (#1683 item 4):
    # story_structure_table — docx-parsed list-of-lists (ground truth for G7 graphic-text lessons)
    # story_structure_rows — AI-generated dict rows (richer, with checkbox support)
    # Both None for lessons without this step; StoryStructure endpoint uses whichever is present.
    story_structure_table: Optional[list] = None
    story_structure_rows: Optional[list] = None
    # Typed lesson_content contract (閱讀聚光燈 EDD refactor, DARK — handoff §4-#2).
    # PURELY ADDITIVE, nullable, TRAILING. Populated at runtime by
    # lesson_content_loader.get_lesson_content(story) ONLY when the backend
    # LESSON_RENDERER_V1 flag is ON and a spotlight_v2 source exists; otherwise None.
    # The frontend consumes it via LessonSchema.safeParse and renders through the unified
    # LessonRenderer (falling back to its storyToLesson stopgap when null). Emitting the
    # null key when flag OFF is harmless to legacy consumers (they never read this field).
    lesson_content: Optional[dict] = None


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
