from pydantic import BaseModel, Field, field_validator
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


class KeyReadingSchema(BaseModel):
    """重點朗讀（念順順）指定段落 — 學生只朗讀老師 ☞ 標的重點段，非全文。

    2026-07-20 教授審查決策。抽取見 skill lesson-reading-pipeline。缺此欄位時前端
    fallback 唸全文，故全欄 optional 以相容尚未抽取的課。
    """
    passage: str                            # snap 到句尾的顯示朗讀段
    start_text: Optional[str] = None        # ☞ 起點錨（QA/比對用）
    extent_chars: Optional[int] = None      # max 累計字數 = 老師標的範圍長度（不含標點）
    source: Optional[str] = None            # docx-extract / manual / fallback


class StoryIntroSchema(BaseModel):
    author: str
    background: str


class StoryListItem(BaseModel):
    """Lightweight schema for story list (no full content)."""
    id: int
    lesson_number: Optional[int] = None
    title: str
    grade: str = ""                  # "4".."9" / 文言文 / 品格教育
    grade_code: str
    # 課本順序（#2736）。圖書館以前按 `id`（＝抽取流水號）排，四年級第一課
    # 因此顯示成第 10 課。`lesson_seq` 是唯一一把尺，把三種系列（一般／文言文／
    # 體育生）排在同一條線上；`lesson_no` 為 None ＝ 課碼解不出課次，
    # 那種課依 UID 排在最後（Young 2026-08-19）。
    lesson_no: Optional[int] = None
    series: Optional[str] = None
    lesson_seq: Optional[int] = None
    genre: str = ""
    category: str = ""
    char_count: int = 0
    thumbnail_url: Optional[str] = None
    reading_strategy: Optional[str] = None
    reading_strategy_explained: Optional[str] = None
    has_key_reading: bool = False
    # 一份學習單多篇文章時（#2916），每一篇一筆：{slug, part, has_full, has_key}。
    # 單篇課是 None。清單就帶著，後台產 QR 清單才不必為 175 課各打一次詳情。
    part_rounds: Optional[list] = None
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
    key_reading: Optional[KeyReadingSchema] = None  # 重點朗讀指定段 (#2559)；缺→前端唸全文 fallback
    # 一課裡重複出現的大題，第 2 輪起（#2916）。key = slug（?p=<slug> 就圈起那一輪的全部模組），
    # value = {模組名: 該輪的內容}。第 1 輪仍住在上面各自的欄位裡，形狀一個字都沒改。
    # ⚠️ 這個欄位一定要宣告 —— response_model 只留宣告過的欄位，漏了就是
    #    loader 讀得到、API 回應裡沒有、學生看不到，而且不會有任何一道門紅
    #    （2026-08-19 已踩過同型：來源全對、九道門全綠、東西到不了學生面前）。
    repeat_rounds: Optional[dict] = None
    # 所有的重點朗讀 —— **一輪一個，不是一課一個**（#2916）。
    # 單篇課一筆、`slug` 是 None；一份多課的那 5 課一篇一筆。
    # 單數的 `key_reading` 保留指向第一輪，所以既有前端行為不變。
    key_readings: Optional[list] = None
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
    # manifest_sections: [{number: '二', name: '念順順', type: 'reading_timer'}, ...]
    manifest_sections: Optional[list[dict]] = None
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

    # 詞語複習的教師版找字表（#2860）。150 課抽了 grid + answer_paths，
    # 但這個 response 是逐欄位列舉的，沒列進來就整包掉在後端 ——
    # 前端因此一直用 story.vocabulary 自己隨機生格子，老師設計的那張表
    # 一課都沒到過學生面前，而且沒有任何錯誤訊息。
    vocab_review: Optional[dict] = None

    # 知識補給站（#2860）。同上：抽了 148 課，API 沒送。
    resources: Optional[dict] = None
    # 文言文專屬模組 (#2752). Untyped dict — each is the module's own shape (see
    # backend/data/lessons/*/v3/{classical_text,modern_translation,word_matching,
    # sentence_matching,self_challenge,intro_guide}.yml), passed straight through
    # from `lesson_uid_loader`'s already-unwrapped module dict. None for the ~9 in
    # 10 lessons that carry none of these files (this genre is the only source —
    # 白話 lessons never populate them).
    classical_text: Optional[dict] = None       # 原文＋注釋
    modern_translation: Optional[dict] = None   # 古文今譯（白話翻譯）
    word_matching: Optional[dict] = None        # 文白詞語比對（方框字填白話）
    sentence_matching: Optional[dict] = None    # 文白句子比對（8 句配對）
    self_challenge: Optional[dict] = None       # 自我挑戰（選做：另一段文章＋題組）
    intro_guide: Optional[dict] = None          # 導讀
    # 一般課也有的無編號元素 (#2752 Phase 2) — 印在「一 讀全文-做記號」之前，
    # 不掛在任何大題編號下。與上面 6 個文言文專屬模組同款式：untyped dict
    # 直接透傳，None 為誠實的「這課沒有這個」。
    goal_box: Optional[dict] = None              # 目標策略框（70 課）
    self_check_before_reading: Optional[dict] = None  # 讀前自我檢核（58 課）
    # 多文本合讀課 + 收尾書寫練習 (#2752 Phase 3)。
    multi_text_parts: Optional[list] = None        # 第 2/3 篇（4 課）
    cross_text_banner: Optional[dict] = None       # 跨課文習作／三篇合讀過場字（2 課）
    keypoints_followup_questions: Optional[dict] = None  # 第一篇專屬追問（2 課，兩種形狀）
    writing_practice: Optional[dict] = None        # 語詞書寫練習／難字挑戰（4 課）


class StoryListResponse(BaseModel):
    stories: list[StoryListItem]
    total: int
    grades: list[str]  # "4".."9" + 文言文 / 品格教育


def _grade_as_str(v):
    """Accept a year sent as a number and store it as the string it means.

    The axis is a string because 文言文 and 品格教育 are not years, but a caller
    that has always sent `grade: 6` is not wrong — rejecting it would break every
    existing admin client for a representation detail.
    """
    return str(v) if isinstance(v, int) else v


# ── Admin CRUD schemas ───────────────────────────────────────────────────────

class StoryCreateRequest(BaseModel):
    """Request body for creating a new story (writes a new YAML file)."""
    lesson_number: int = Field(..., ge=1, description="Unique lesson number")
    title: str = Field(..., min_length=1, max_length=200)
    # "4".."9" plus 文言文 / 品格教育 — the classification axis is a STRING.
    # It was `int Field(ge=4, le=9)`; the second edition added two collections
    # that are not year groups, and a lesson in either one made this raise
    # (the admin list 500ed on the first 文言文 row it reached).
    grade: str = Field(..., min_length=1, max_length=10)
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

    _coerce_grade = field_validator("grade", mode="before")(_grade_as_str)



class StoryUpdateRequest(BaseModel):
    """Request body for updating an existing story. All fields optional."""
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    # "4".."9" plus 文言文 / 品格教育 — the classification axis is a STRING.
    # It was `int Field(ge=4, le=9)`; the second edition added two collections
    # that are not year groups, and a lesson in either one made this raise
    # (the admin list 500ed on the first 文言文 row it reached).
    grade: Optional[str] = Field(default=None, min_length=1, max_length=10)
    grade_code: Optional[str] = Field(default=None, min_length=1, max_length=10)
    genre: Optional[str] = Field(default=None, min_length=1, max_length=20)
    text_type: Optional[str] = Field(default=None, max_length=10)
    reading_strategy: Optional[str] = None
    reading_strategy_explained: Optional[str] = None
    paragraphs: Optional[list[str]] = Field(default=None, min_length=1)
    vocabulary: Optional[list[VocabItemSchema]] = None
    fill_in_blank: Optional[list[dict]] = None
    multiple_choice: Optional[list[dict]] = None
    reading_benchmark: Optional[ReadingBenchmarkSchema] = None
    source_file: Optional[str] = Field(default=None, max_length=200)

    _coerce_grade = field_validator("grade", mode="before")(_grade_as_str)



class StoryAdminListItem(BaseModel):
    """Admin story list item — lighter than StoryDetail, includes metadata."""
    lesson_number: int
    title: str
    # "4".."9" plus 文言文 / 品格教育 — the classification axis is a STRING.
    # It was `int Field(ge=4, le=9)`; the second edition added two collections
    # that are not year groups, and a lesson in either one made this raise
    # (the admin list 500ed on the first 文言文 row it reached).
    grade: str
    grade_code: str
    genre: str
    text_type: str
    paragraph_count: int
    char_count: int
    reading_strategy: Optional[str] = None
    reading_strategy_explained: Optional[str] = None
    source_file: Optional[str] = None

    _coerce_grade = field_validator("grade", mode="before")(_grade_as_str)



class StoryAdminListResponse(BaseModel):
    stories: list[StoryAdminListItem]
    total: int
