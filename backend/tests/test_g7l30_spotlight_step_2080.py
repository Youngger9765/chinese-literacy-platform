"""Regression test for #2080 — G7-L30 學習單對應 / 內容 三項檢查修正.

Fixes:
- A: 閱讀聚光燈 (reading-strategy) had only skeleton step descriptions, no
     questions. The structured version (select + free_text with answers) lived
     orphaned in `_reparsed_2026-05-02/spotlight_structured/G7-L30.json` and was
     never loaded. Backfilled into the singular `strategy_exercise:` block.
- B: removed the spurious `story-structure` step (圖文整合 lesson has no
     問題/解決/結果 chapter on the paper worksheet).
- C: removed the parsing-noise fill_in_blank (a video-description fragment,
     `answer: 外來種`, `sentence: None`).

These assert the LOADED lesson (via build_all_lessons), i.e. what the platform
actually serves — not just the raw YAML — so a future re-parse / loader change
that regresses any of them is caught.

Run:
    cd backend && python -m pytest tests/test_g7l30_spotlight_step_2080.py -v
"""

import pytest

from app.services.lesson_indexes import build_all_lessons


@pytest.fixture(scope="module")
def g7l30() -> dict:
    lesson = next(
        (x for x in build_all_lessons() if x.get("lesson_code") == "G7-L30"),
        None,
    )
    assert lesson is not None, "G7-L30 missing from lesson catalog"
    return lesson


# ---------------------------------------------------------------------------
# A — 聚光燈含填充+選擇題（不是只剩步驟敘述）
# ---------------------------------------------------------------------------

class TestSpotlightHasQuestions:
    def test_strategy_exercise_is_guided_steps_dict(self, g7l30):
        se = g7l30.get("strategy_exercise")
        assert isinstance(se, dict), (
            f"strategy_exercise should be a guided_steps dict, got {type(se).__name__} "
            "(skeleton list = the #2080 bug)"
        )
        assert se.get("type") == "guided_steps"

    def test_steps_contain_real_questions_not_just_descriptions(self, g7l30):
        steps = g7l30["strategy_exercise"].get("steps") or []
        assert steps, "strategy_exercise.steps must not be empty"
        # Every step must be a real question (select / free_text), NOT the old
        # skeleton shape ({exercise, description, steps}).
        typed = [s for s in steps if s.get("type") in ("select", "free_text")]
        assert len(typed) == len(steps), (
            "every spotlight step must be a select/free_text question; "
            f"got {len(typed)}/{len(steps)} typed"
        )

    def test_has_both_select_and_free_text(self, g7l30):
        steps = g7l30["strategy_exercise"]["steps"]
        kinds = {s.get("type") for s in steps}
        assert "select" in kinds, "spotlight should include 選擇題 (select)"
        assert "free_text" in kinds, "spotlight should include 填充/開放題 (free_text)"

    def test_select_steps_have_options_and_valid_answer(self, g7l30):
        for s in g7l30["strategy_exercise"]["steps"]:
            if s.get("type") != "select":
                continue
            opts = s.get("options") or []
            assert len(opts) >= 2, f"select step needs >=2 options: {s.get('prompt')!r}"
            ans = s.get("answer")
            assert isinstance(ans, int) and 0 <= ans < len(opts), (
                f"select step answer index out of range: prompt={s.get('prompt')!r} "
                f"answer={ans} options={len(opts)}"
            )

    def test_no_leftover_skeleton_shape(self, g7l30):
        # The skeleton list items had keys {exercise, description, steps}; none
        # of those should survive as a step.
        for s in g7l30["strategy_exercise"]["steps"]:
            assert "exercise" not in s, "skeleton 'exercise' key leaked into steps"


# ---------------------------------------------------------------------------
# B — step_sequence 無多餘 story-structure
# ---------------------------------------------------------------------------

class TestStepSequence:
    def test_no_story_structure_step(self, g7l30):
        seq = g7l30.get("step_sequence") or []
        assert "story-structure" not in seq, (
            "G7-L30 是圖文整合課，紙本無 story-structure 章節，step_sequence 不該有它"
        )

    def test_has_core_steps_in_order(self, g7l30):
        seq = g7l30.get("step_sequence") or []
        # 紙本 4 章節對應：reading-annotation(讀全文) / knowledge-station /
        # reading-strategy(聚光燈) / comprehension(閱讀理解)，最後 report
        for step in ["reading-annotation", "knowledge-station", "reading-strategy",
                     "comprehension", "report"]:
            assert step in seq, f"step_sequence 缺 {step}"
        assert seq[-1] == "report", "最後一步必須是 report"
        # comprehension 必須在 report 之前
        assert seq.index("comprehension") < seq.index("report")


# ---------------------------------------------------------------------------
# C — fill_in_blank 雜訊已清除
# ---------------------------------------------------------------------------

class TestFillInBlankNoiseRemoved:
    def test_no_noise_fill_in_blank(self, g7l30):
        fb = g7l30.get("fill_in_blank")
        # loader 把空 list 正規化為 None / [] 皆可接受 — 重點是沒有那筆
        # sentence=None / answer=外來種 的影片描述雜訊
        items = fb or []
        for item in items:
            assert item.get("answer") != "外來種" or item.get("sentence"), (
                "parsing-noise fill_in_blank (video-description fragment) still present"
            )
        # G7-L30 本就無真正填空題，清乾淨後應為空
        assert not items, f"G7-L30 should have no fill_in_blank after noise removal, got {items}"
