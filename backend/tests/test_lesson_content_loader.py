"""Regression lock for lesson_content supply (#2683 二修重刷).

WHAT CHANGED AND WHY THESE TESTS LOOK DIFFERENT
-----------------------------------------------
The previous version of this file locked the behaviour of three layers that the
second-edition re-ink removed: the `_ai_lessons` override, the `_parsed_2026-05-01`
hydration, and the `catalog_to_parsed_code` re-binding with its 張冠李戴 guard. All
three keyed off `grade_code` — a lesson's POSITION in the catalogue — which is exactly
what the renumber changes. Measured before removal: `_parsed` supplied 0/175 lessons,
`_ai_lessons` 0/175, and the offset table still rewrote 11 codes using first-edition
numbering. Stripping them left all 139 servable lessons byte-identical (md5
2b22b3fd9db… on both sides), which is the evidence that they were dead.

So what is worth locking now is different: identity comes from the uid tree, and a
lesson with no extractable blocks must serve *null*, not an empty shell. The old
failure mode — a title mismatch quietly yielding a hollow lesson — is the one thing
this file exists to keep from coming back.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services import lesson_content_loader as L  # noqa: E402


@pytest.fixture(autouse=True)
def _clean_caches():
    L._reset_caches_for_test()
    yield
    L._reset_caches_for_test()


def _story(**over):
    s = {
        "id": 90001,
        "title": "測試課文",
        "grade_code": "G4-L1",
        "lesson_uid": "L0001",
        # Shape copied from a real data/lessons/<uid>/v2/spotlight.yml: a passage
        # carries `paragraphs`, not `text`, and the spotlight itself has no title.
        "spotlight_v2": {
            "lesson": "G4-L1",
            "strategy_name": "找時間詞",
            "strategy_type": "摘要策略",
            "blocks": [
                {"type": "guide", "text": "◎ 小試身手："},
                {"type": "passage", "source": "unknown", "paragraphs": ["一段課文。"]},
            ],
        },
    }
    s.update(over)
    return s


# ── flag + shape gating ────────────────────────────────────────────────────

def test_flag_off_serves_nothing(monkeypatch):
    monkeypatch.setenv("LESSON_RENDERER_V1", "false")
    assert L.get_lesson_content(_story()) is None


def test_flag_defaults_on(monkeypatch):
    monkeypatch.delenv("LESSON_RENDERER_V1", raising=False)
    assert L.get_lesson_content(_story()) is not None


def test_no_spotlight_source_serves_nothing():
    assert L.get_lesson_content(_story(spotlight_v2=None)) is None
    assert L.get_lesson_content(_story(spotlight_v2={})) is None


def test_not_a_dict_serves_nothing():
    assert L.get_lesson_content("nope") is None  # type: ignore[arg-type]


# ── the invariant that the old two-layer merge violated ────────────────────

def test_empty_blocks_serves_null_not_an_empty_shell():
    """32 lessons extract to zero spotlight blocks. They must serve null so the
    frontend falls back, NEVER an empty lesson that renders as a blank page —
    that hollow-shell behaviour is precisely what the re-ink set out to kill.
    Registered honestly in curriculum_qa/content_known_gaps.yaml."""
    story = _story(spotlight_v2={"lesson": "G4-L1", "title": "空的", "blocks": []})
    assert L.get_lesson_content(story) is None


def test_display_title_wins_over_spotlight_title():
    """The title the student sees comes from the lesson's own identity file, not
    from whatever the extraction happened to transcribe."""
    story = _story(title="正式課名")
    assert L.get_lesson_content(story)["title"] == "正式課名"


def test_adapter_failure_is_swallowed_not_raised():
    """Fail-closed: a supply gap must never propagate into get_story."""
    story = _story(spotlight_v2={"blocks": "not-a-list"})
    assert L.get_lesson_content(story) is None


# ── caching ────────────────────────────────────────────────────────────────

def test_result_is_cached_per_story_id():
    story = _story()
    first = L.get_lesson_content(story)
    assert L.get_lesson_content(story) is first  # same object, not a rebuild


def test_cache_is_keyed_by_id_not_by_content():
    """Two stories with the same id must not be conflated across a reset."""
    a = L.get_lesson_content(_story(title="甲"))
    L._reset_caches_for_test()
    b = L.get_lesson_content(_story(title="乙"))
    assert a["title"] == "甲" and b["title"] == "乙"


# ── the removed layers must stay removed ───────────────────────────────────

def test_no_legacy_layer_references_remain():
    """A guard against someone reintroducing a grade_code-keyed content binding.

    These three names are not merely unused — each one re-derived a lesson's content
    from its catalogue POSITION, which is mutable. Reintroducing any of them would
    reopen the class of defect (#2683) this whole effort closed.
    """
    # Strip the module docstring first — it *names* these layers to explain why
    # they went away, and that explanation is the reason this test can stay short.
    src = Path(L.__file__).read_text(encoding="utf-8")
    src = re.sub(r'^"""".*?"""|^""".*?"""', "", src, count=1, flags=re.S)
    for banned in ("_ai_lessons", "_parsed_2026-05-01", "catalog_to_parsed_code"):
        assert banned not in src, f"{banned} 又出現在 loader 裡 — 位置不能當內容鍵"


# ── 二修 payload shape: identity outside the payload, partial lessons withheld ─

def _second_edition_story(blocks):
    """The shape lesson_uid_loader actually hands over: the `spotlight:` wrapper is
    stripped, only `section_no` survives, and the uid lives on the story — there is no
    `spotlight.lesson`. Until this was fixed every one of 172 lessons raised here."""
    return _story(
        lesson_uid="L0042",
        lesson_code="G5-L3",
        spotlight_v2={"section_no": "六", "strategy_name": "找線索", "blocks": blocks},
    )


def test_second_edition_payload_is_served_with_uid_identity():
    lc = L.get_lesson_content(_second_edition_story([
        {"type": "guide", "text": "◎小試身手："},
        {"type": "single", "prompt": "哪一個？", "options": {1: "甲", 2: "乙"}, "answer": 2},
    ]))
    assert lc is not None
    assert (lc["id"], lc["lesson_code"]) == ("L0042", "G5-L3")
    (ex,) = [b for b in lc["blocks"] if b["type"] == "exercise"]
    step = ex["question"]["steps"][0]
    assert (step["options"], step["answer"]) == (["甲", "乙"], 1)


def test_no_correct_answer_question_is_served_not_withheld():
    """沒有標準答案的題目以前會讓整課回 null；現在帶旗標供應、作答即完成。"""
    lc = L.get_lesson_content(_second_edition_story([
        {"type": "single", "prompt": "你自己呢？", "options": {1: "甲", 2: "乙"}, "no_correct_answer": True},
    ]))
    assert lc is not None
    (ex,) = [b for b in lc["blocks"] if b["type"] == "exercise"]
    step = ex["question"]["steps"][0]
    assert step["no_correct_answer"] is True and "answer" not in step  # exclude_none drops the null


def test_uncarriable_content_is_served_as_read_only_generic():
    lc = L.get_lesson_content(_second_edition_story([
        {"type": "single", "prompt": "選項印在圖裡", "answer": "D"},
    ]))
    assert lc is not None
    assert [b["type"] for b in lc["blocks"]] == ["generic"]


def test_a_block_that_cannot_even_be_drawn_is_withheld():
    """No partial lessons: a source block with nothing drawable (not even a mapping) keeps the
    whole lesson off lesson_content rather than silently missing a piece."""
    assert L.get_lesson_content(_second_edition_story([
        {"type": "single", "prompt": "哪一個？", "options": {1: "甲", 2: "乙"}, "answer": 2},
        42,
    ])) is None
