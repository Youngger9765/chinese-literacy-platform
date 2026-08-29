"""multi_text_parts / cross_text_banner / keypoints_followup_questions /
writing_practice have no entry — the last 4 modules on the NO_ENTRY list
(#2752 Phase 3, ceiling 8 → 0).

Same class of bug as Phase 1/2: `lesson_uid_loader.py`'s `MODULES` tuple never
read these files, so `load_lesson()` never even merged them into the lesson
dict — the row-dict-drops-the-key bug from Phase 1 is the SECOND layer here.
"""

from __future__ import annotations

# L0063 — multi-text (3 parts), keypoints_followup_questions in the L0063 shape
# (questions[] belonging to the keypoints table)
MULTI_TEXT_QUESTIONS_SHAPE_ID = 20063
# L0144 — multi-text (3 parts), cross_text_banner, keypoints_followup_questions
# in the DIFFERENT L0144 shape (items[] — 閱讀接力 relay guide)
MULTI_TEXT_RELAY_SHAPE_ID = 20144
# L0111 — multi-text (2 parts), no cross_text_banner / keypoints_followup_questions
MULTI_TEXT_ONLY_ID = 20111
# L0005 — regular single-text lesson with writing_practice (大題九)
WRITING_PRACTICE_ID = 20005
# A lesson with none of the four (negative control)
NEITHER_ID = 20001


def _get(story_id: int) -> dict:
    from app.services.lesson_loader import get_lesson_by_id

    story = get_lesson_by_id(story_id)
    assert story is not None, f"story {story_id} not found — fixture id drifted?"
    return story


def test_multi_text_parts_reaches_get_lesson_by_id():
    story = _get(MULTI_TEXT_QUESTIONS_SHAPE_ID)
    parts = story.get("multi_text_parts")
    assert parts, "multi_text_parts missing from get_lesson_by_id"
    assert len(parts) == 2, "L0063 is a 3-part lesson — part 1 lives in full_text_annotate, parts 2/3 here"
    assert parts[0].get("body", {}).get("paragraphs"), "part 2 lost its paragraphs"


def test_cross_text_banner_reaches_get_lesson_by_id():
    story = _get(MULTI_TEXT_RELAY_SHAPE_ID)
    banner = story.get("cross_text_banner")
    assert banner, "cross_text_banner missing from get_lesson_by_id"


def _followup_anywhere(story: dict) -> dict | None:
    """加碼題可能在頂層，也可能在它所屬的那一篇。

    ⚠️ #2930 之後「第一篇專屬」的加碼題移進那一篇了 —— 留在頂層的話，
       第 2、3 篇的重點表底下也會出現「請依據第一篇文章的內容」。
       所以這裡兩個地方都找；**這條鎖的是「形狀沒掉」，不是「在哪一層」**
       （在哪一層由 test_followup_never_vanishes_2964.py 管）。
    """
    top = story.get("keypoints_followup_questions")
    if top:
        return top
    for v in (story.get("repeat_rounds") or {}).values():
        if isinstance(v, dict) and v.get("keypoints_followup_questions"):
            return v["keypoints_followup_questions"]
    return None


def test_keypoints_followup_questions_reaches_get_lesson_by_id_both_shapes():
    q_shape = _followup_anywhere(_get(MULTI_TEXT_QUESTIONS_SHAPE_ID))
    assert q_shape and q_shape.get("questions"), "L0063's questions[] shape lost"

    relay_shape = _followup_anywhere(_get(MULTI_TEXT_RELAY_SHAPE_ID))
    assert relay_shape and relay_shape.get("items"), "L0144's items[] (閱讀接力) shape lost"


def test_writing_practice_reaches_get_lesson_by_id():
    story = _get(WRITING_PRACTICE_ID)
    wp = story.get("writing_practice")
    assert wp and wp.get("words"), "writing_practice lost its words"


def test_a_lesson_with_only_multi_text_parts_stays_that_way():
    story = _get(MULTI_TEXT_ONLY_ID)
    assert story.get("multi_text_parts")
    assert not story.get("cross_text_banner"), "L0111 has no cross_text_banner.yml — must not be invented"
    assert not story.get("keypoints_followup_questions"), "L0111 has no keypoints_followup_questions.yml"


def test_regular_lesson_without_any_of_the_four_is_unaffected():
    story = _get(NEITHER_ID)
    for mod in ("multi_text_parts", "cross_text_banner", "keypoints_followup_questions", "writing_practice"):
        assert not story.get(mod), f"{mod} leaked onto a lesson without that module"


def test_story_detail_schema_accepts_the_new_fields():
    from app.schemas.story import StoryDetail

    story = _get(MULTI_TEXT_RELAY_SHAPE_ID)
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
        multi_text_parts=story.get("multi_text_parts"),
        cross_text_banner=story.get("cross_text_banner"),
        keypoints_followup_questions=story.get("keypoints_followup_questions"),
        writing_practice=story.get("writing_practice"),
    )
    assert detail.multi_text_parts == story["multi_text_parts"]
    assert detail.cross_text_banner == story["cross_text_banner"]
