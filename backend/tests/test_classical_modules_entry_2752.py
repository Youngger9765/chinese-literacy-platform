"""文言文六個模組現在連 API 都送不到 (#2752 Phase G/G2).

WHY
---
`module_entry_gate.py` 抓到 L0155 這類文言文課有 7 個模組、2704 個漢字在畫面上
一步都到不了。三層都要補才叫「送得到」：

    lesson_uid_loader.load_lesson()      已經讀進來（MODULES tuple 早就列了這 6 個）
    lesson_indexes._uid_tree_lessons()   ← 組 row dict 時這 6 個 key 不在白名單，
                                            overlay loop `if k in row` 靜默丟掉
    schemas/story.py StoryDetail         ← 沒宣告這些欄位
    routes/stories.py                    ← 組 response 時沒填

這支測試釘住第二、三層：`get_lesson_by_id` 回傳的 dict（route 實際讀的那個）
要帶得到這 6 個模組的內容，而且 `StoryDetail` 要吃得下、序列化後看得到。

還釘住 `step_sequence`：uid tree 的 row 目前完全沒帶這個 key，所以全部 175 課
現在都預設吃 `DEFAULT_STEP_SEQUENCE`（前端 stepConfig.ts 的 fallback）。
文言文課要把新模組排進學習流程，後端必須先給出一份含新 step id 的 step_sequence。
"""

from __future__ import annotations

# L0155「不流血的戰爭」— 有全部 6 個目標模組（含 intro_guide，這課少數幾個有導讀的）
CLASSICAL_UID = "L0155"
CLASSICAL_ID = 20155  # 20000 + int(uid[1:])

# L0158「不量田」— 沒有 intro_guide / self_challenge，驗證「缺的模組保持缺，不能被補假資料」
CLASSICAL_NO_INTRO_UID = "L0158"
CLASSICAL_NO_INTRO_ID = 20158

# 一般白話課（非文言文），驗證這次改動不能動到其他 165 課的既有行為
REGULAR_ID = 20001  # L0001，白話課


def _get(story_id: int) -> dict:
    from app.services.lesson_loader import get_lesson_by_id

    story = get_lesson_by_id(story_id)
    assert story is not None, f"story {story_id} not found — fixture id drifted?"
    return story


def test_classical_lesson_carries_all_six_target_modules():
    story = _get(CLASSICAL_ID)
    for mod in (
        "classical_text",
        "modern_translation",
        "word_matching",
        "sentence_matching",
        "self_challenge",
        "intro_guide",
    ):
        assert story.get(mod), f"{mod} missing from get_lesson_by_id({CLASSICAL_ID}) — dropped before the route"

    # Content actually matches the raw YAML, not just "truthy" — spot-check one field
    # per module so a wiring bug that swaps two modules' content is also caught.
    assert story["classical_text"].get("paragraphs"), "classical_text lost its paragraphs"
    assert story["modern_translation"].get("paragraphs"), "modern_translation lost its paragraphs"
    assert story["word_matching"].get("items"), "word_matching lost its items"
    assert story["sentence_matching"].get("segments"), "sentence_matching lost its segments"
    assert story["self_challenge"].get("passage"), "self_challenge lost its passage"
    assert story["intro_guide"].get("text"), "intro_guide lost its text"


def test_a_missing_module_stays_missing_not_faked():
    """L0158 has no intro_guide / self_challenge on disk — the fix must not invent one."""
    story = _get(CLASSICAL_NO_INTRO_ID)
    assert not story.get("intro_guide"), "intro_guide should be absent for L0158 (no source file)"
    assert not story.get("self_challenge"), "self_challenge should be absent for L0158 (no source file)"
    # But the modules it DOES have must still come through.
    assert story.get("classical_text")
    assert story.get("word_matching")
    assert story.get("sentence_matching")


def test_classical_lesson_gets_a_step_sequence_with_the_new_steps():
    story = _get(CLASSICAL_ID)
    seq = story.get("step_sequence")
    assert seq, "classical lesson has no step_sequence — new modules have no route to reach the student"
    for step_id in ("classical-text", "classical-word-matching", "classical-sentence-matching", "classical-self-challenge"):
        assert step_id in seq, f"{step_id} missing from step_sequence: {seq}"
    # classical-self-challenge must come after comprehension per the worksheet order
    # (大題五 閱讀理解 → 大題六 自我挑戰，優先選做題排最後).
    assert seq.index("comprehension") < seq.index("classical-self-challenge")


def test_regular_lesson_is_unaffected():
    """This change must be additive-only for the 165 non-文言文 lessons."""
    story = _get(REGULAR_ID)
    for mod in ("classical_text", "modern_translation", "word_matching", "sentence_matching", "self_challenge", "intro_guide"):
        assert not story.get(mod), f"{mod} leaked onto a regular (non-classical) lesson"
    # A regular lesson keeps falling back to DEFAULT_STEP_SEQUENCE (frontend behavior
    # unchanged) — backend must not invent a step_sequence for it.
    assert not story.get("step_sequence"), "regular lesson should not get an invented step_sequence"


def test_story_detail_schema_accepts_the_new_fields():
    """Mirrors what routes/stories.py builds — a field StoryDetail rejects 500s a student."""
    from app.schemas.story import StoryDetail

    story = _get(CLASSICAL_ID)
    detail = StoryDetail(
        id=story["id"],
        lesson_number=story["lesson_number"],
        title=story["title"],
        grade=story["grade"],
        grade_code=story["grade_code"],
        genre=story["genre"],
        category=story["category"],
        char_count=story["char_count"],
        thumbnail_url=story["thumbnail_url"],
        reading_strategy=story["reading_strategy"],
        paragraphs=story["paragraphs"],
        vocabulary=story["vocabulary"],
        fill_in_blank=story["fill_in_blank"],
        multiple_choice=story["multiple_choice"],
        reading_benchmark=story["reading_benchmark"],
        text_type=story["text_type"],
        source_file=story["source_file"],
        step_sequence=story.get("step_sequence"),
        classical_text=story.get("classical_text"),
        modern_translation=story.get("modern_translation"),
        word_matching=story.get("word_matching"),
        sentence_matching=story.get("sentence_matching"),
        self_challenge=story.get("self_challenge"),
        intro_guide=story.get("intro_guide"),
    )
    assert detail.classical_text == story["classical_text"]
    assert detail.step_sequence == story["step_sequence"]
