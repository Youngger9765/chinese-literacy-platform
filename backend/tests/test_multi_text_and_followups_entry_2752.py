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


def test_keypoints_followup_questions_reaches_get_lesson_by_id_both_shapes():
    q_shape = _get(MULTI_TEXT_QUESTIONS_SHAPE_ID).get("keypoints_followup_questions")
    assert q_shape and q_shape.get("questions"), "L0063's questions[] shape lost"

    relay_shape = _get(MULTI_TEXT_RELAY_SHAPE_ID).get("keypoints_followup_questions")
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


def test_multi_text_lessons_step_sequence_reaches_keypoints_table_and_comprehension():
    """The data-layer tests above prove the content reaches get_lesson_by_id — this
    proves the STEP that renders it is actually in step_sequence, which is a
    different layer module_entry_gate.py cannot see (it only checks whether a
    module's data exists somewhere, not whether the step containing it survived
    into the per-lesson step_sequence the frontend stepper actually iterates).

    All four 多文本合讀 lessons (L0029/L0063/L0137/L0144) print 大題五 as
    「文章重點整理」 and 大題七 as 「綜合閱讀理解」 — worksheet-print variants of
    「文章重點表」/「閱讀理解」 that `_SECTION_TO_STEP`'s exact-match dict did not
    recognize, so `keypoints-table` and `comprehension` were silently absent from
    every one of these lessons' step_sequence even though `story_structure_table`,
    `multiple_choice`, and (for L0063/L0144) `keypoints_followup_questions` are all
    populated. Confirmed via real browser: L0063's own stepper nav (before this fix)
    jumped straight from 閱讀聚光燈 to 語詞複習 with no 文章重點表/閱讀理解 stop —
    the content a student could reach by URL was unreachable from the UI at all.
    """
    from app.services.lesson_indexes import CLASSICAL_STEP_SEQUENCE

    for lid in (20029, MULTI_TEXT_QUESTIONS_SHAPE_ID, 20137, MULTI_TEXT_RELAY_SHAPE_ID):
        seq = _get(lid).get("step_sequence") or []
        assert "keypoints-table" in seq, f"lesson {lid}: keypoints-table missing from step_sequence {seq}"
        assert "comprehension" in seq, f"lesson {lid}: comprehension missing from step_sequence {seq}"
        # additive-only guard, same invariant as test_classical_modules_entry_2752.py's
        # test_regular_lesson_is_unaffected — these are 白話 multi-text lessons, not
        # 文言文, so none of the four classical-only steps should ever appear here.
        classical_only_steps = {
            "classical-text", "classical-sentence-matching", "classical-word-matching", "classical-self-challenge",
        }
        assert classical_only_steps < set(CLASSICAL_STEP_SEQUENCE), "fixture drifted from lesson_indexes.py's actual step ids"
        leaked = classical_only_steps & set(seq)
        assert not leaked, f"lesson {lid}: classical-only step(s) {leaked} leaked in: {seq}"


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
