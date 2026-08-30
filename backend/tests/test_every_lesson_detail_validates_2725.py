"""每一課的詳情都要通過 schema — 不能有課打不開 (#2725).

WHY
---
#2722 added a `key_reading.yml` carrying only a fluency target to the eleven lessons
whose passage is withheld. `_key_reading()` gates on `passage`, so the index built from
it was correct — but the detail route does not read that index. It reads the raw merged
lesson from `lesson_uid_loader.load_lesson`, where `key_reading` is the YAML as written,
`passage: None` and all. `KeyReadingSchema.passage` is a required `str`.

Result: eleven lessons returned 500 on staging. Every test was green, because every test
asked the extractor and the index, and neither is what the route serves.

    GET /api/stories/20079 → 500
    key_reading.passage  Input should be a valid string [input_value=None]

THE LOCK
--------
Not「那十一課要好」— 「每一課都要能打開」. A per-lesson schema check over all 175 catches
any future field that is valid in the YAML and invalid in the response, whichever module
introduces it. It runs against `get_lesson_by_id`, which is the function the route calls.
"""

from __future__ import annotations

import pytest


def _story_ids() -> list[int]:
    from app.services.lesson_loader import get_all_lessons

    return [l["id"] for l in get_all_lessons() if l.get("id")]


def test_every_lesson_detail_passes_its_response_schema():
    """The shape the route builds, validated for all 175 lessons.

    Built the same way `GET /api/stories/{id}` builds it, so a field that the YAML
    allows and the response model rejects fails here rather than as a 500 in front of
    a student.
    """
    from pydantic import ValidationError

    from app.routes.stories import StoryDetail
    from app.services.lesson_loader import get_lesson_by_id

    broken: list[tuple[int, str]] = []
    for sid in _story_ids():
        story = get_lesson_by_id(sid)
        if not story:
            broken.append((sid, "get_lesson_by_id returned nothing"))
            continue
        kr = story.get("key_reading")
        try:
            StoryDetail(
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
                intro=story.get("intro"),
                paragraphs=story["paragraphs"],
                vocabulary=story["vocabulary"],
                fill_in_blank=story["fill_in_blank"],
                multiple_choice=story["multiple_choice"],
                vocab_bank=story.get("vocab_bank"),
                knowledge_video_url=story.get("knowledge_video_url"),
                video_links=story.get("video_links"),
                reading_benchmark=story["reading_benchmark"],
                key_reading=kr,
                text_type=story["text_type"],
                source_file=story["source_file"],
            )
        except (ValidationError, KeyError) as exc:
            broken.append((sid, str(exc)[:120]))

    assert broken == [], (
        f"{len(broken)}/{len(_story_ids())} lessons cannot be served — a student opening "
        f"one of these gets a 500: {broken[:5]}"
    )


def test_a_lesson_with_a_target_but_no_passage_still_serves_the_target():
    """The eleven that caused it, from the other direction.

    Dropping `key_reading` when it has no passage is the fix; dropping the target with it
    would be a silent regression of #2722 that the test above cannot see, because a
    lesson serving nothing validates perfectly.
    """
    from app.services.lesson_loader import get_all_lessons

    from app.services.lesson_uid_loader import load_lesson

    lessons = get_all_lessons()

    # ⚠️ 2026-08-28（#2964）改寫。原本斷言「至少 8 課有目標但沒 passage」——
    #    二修之後**來源資料裡這種課是 0 課**（文言文那批連秒數型目標一起沒了），
    #    所以那個數字現在無法成立。
    #
    #    ⛔ 不把門檻調低讓它過 —— 那是為了讓門變綠而改斷言。
    #    改成鎖**機制**：只要來源有「benchmark 但沒 passage」的課，
    #    row 就必須把目標留下來（丟掉 key_reading 是對的，連目標一起丟才是 #2722）。
    #    來源目前是 0 課，這條就等於在等資料回來時自動生效。
    #
    #    內容缺口另記：文言文的秒數型流暢率目標在二修時遺失（#2964 記錄）。
    by_uid = {l.get("lesson_uid"): l for l in lessons}
    should_keep = []
    for uid in by_uid:
        raw = load_lesson(uid) or {}
        kr = raw.get("key_reading")
        if isinstance(kr, dict) and kr.get("benchmark") and not kr.get("passage"):
            should_keep.append(uid)

    lost = [u for u in should_keep if not by_uid[u].get("reading_benchmark")]
    assert not lost, (
        f"這幾課的來源有 benchmark 但沒 passage，而 row 把目標一起丟了：{lost}\n"
        "丟掉 key_reading 是對的（沒有段落可念），連目標一起丟就是 #2722 regress。")


def test_the_benchmark_survives_for_the_lessons_that_do_have_one():
    """正向對照 —— 上面那條在 should_keep 是空集合時會空過。

    這條確保「目標會被送出去」這件事本身是活的：
    來源有 benchmark 的課，row 就要有。
    """
    from app.services.lesson_uid_loader import load_lesson
    from app.services.lesson_loader import get_all_lessons

    lessons = get_all_lessons()
    by_uid = {l.get("lesson_uid"): l for l in lessons}
    served = [u for u, row in by_uid.items() if row.get("reading_benchmark")]
    assert len(served) >= 100, (
        f"只有 {len(served)} 課的 reading_benchmark 有值 —— "
        "門檻整批沒送出去，每一課都會退回年級預設（#2722 regress）")
