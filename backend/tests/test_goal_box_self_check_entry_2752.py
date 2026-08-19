"""goal_box / self_check_before_reading have no entry — same class of bug as
the six 文言文 modules (#2752 Phase 1), bigger blast radius (#2752 Phase 2).

WHY
---
`module_entry_gate.py` found these two on the still-outstanding NO_ENTRY list:
`goal_box` (70 課, 目標策略 badge printed near the title) and
`self_check_before_reading` (58 課, a "before you start reading, check these
off" reminder for 大題一 讀全文-做記號). Neither reaches the student — and this
time it is even more upstream than the classical-text bug: these two module
names are not even in `lesson_uid_loader.py`'s `MODULES` tuple, so
`load_lesson()` never reads the files into the merged lesson dict at all. The
row-dict-drops-the-key bug from Phase 1 is the SECOND layer here, not the
first.

Unlike the 10 文言文 lessons, this covers ~70/58 of the 175 lessons — a
regular-lesson-type change, not a single-genre one.
"""

from __future__ import annotations

# L0049 — has goal_box, no self_check_before_reading
GOAL_BOX_ONLY_ID = 20049
# L0073 — has self_check_before_reading, no goal_box
SELF_CHECK_ONLY_ID = 20073
# L0084/L0107/L0109 have both (per earlier corpus scan) — L0107 for the intentional
# single-item / no-instruction-line variant
BOTH_ID = 20107
# A lesson with neither (regular lesson, negative control)
NEITHER_ID = 20001


def _get(story_id: int) -> dict:
    from app.services.lesson_loader import get_lesson_by_id

    story = get_lesson_by_id(story_id)
    assert story is not None, f"story {story_id} not found — fixture id drifted?"
    return story


def test_goal_box_reaches_get_lesson_by_id():
    story = _get(GOAL_BOX_ONLY_ID)
    gb = story.get("goal_box")
    assert gb, "goal_box missing from get_lesson_by_id — dropped before the route"
    assert gb.get("strategy_line"), "goal_box lost its strategy_line"


def test_self_check_before_reading_reaches_get_lesson_by_id():
    story = _get(SELF_CHECK_ONLY_ID)
    sc = story.get("self_check_before_reading")
    assert sc, "self_check_before_reading missing from get_lesson_by_id"
    assert sc.get("items"), "self_check_before_reading lost its items"


def test_a_lesson_missing_one_of_the_two_stays_missing_not_faked():
    goal_box_only = _get(GOAL_BOX_ONLY_ID)
    assert not goal_box_only.get("self_check_before_reading"), (
        "L0049 has no self_check_before_reading.yml on disk — must not be invented"
    )
    self_check_only = _get(SELF_CHECK_ONLY_ID)
    assert not self_check_only.get("goal_box"), (
        "L0073 has no goal_box.yml on disk — must not be invented"
    )


def test_a_lesson_with_both_carries_both():
    story = _get(BOTH_ID)
    assert story.get("goal_box")
    assert story.get("self_check_before_reading")


def test_regular_lesson_without_either_module_is_unaffected():
    story = _get(NEITHER_ID)
    assert not story.get("goal_box")
    assert not story.get("self_check_before_reading")


def test_story_detail_schema_accepts_the_new_fields():
    from app.schemas.story import StoryDetail

    story = _get(BOTH_ID)
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
        goal_box=story.get("goal_box"),
        self_check_before_reading=story.get("self_check_before_reading"),
    )
    assert detail.goal_box == story["goal_box"]
    assert detail.self_check_before_reading == story["self_check_before_reading"]
