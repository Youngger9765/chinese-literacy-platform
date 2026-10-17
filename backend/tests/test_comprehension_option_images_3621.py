"""#3621: three comprehension (閱讀理解) MCQ questions (L0052/L0143/L0073) were
withheld from students because the correct option's text was blank in the
source worksheet — the real content is a drawing (「下列哪一張圖」), not text.

TDD (Kent Beck canon): this file is written FIRST, against the pre-fix
code, and is expected to be RED (see the module docstring in
`content_known_gaps.yaml`'s `image_options_only_captions` entry for the
pre-fix behaviour this locks against). Fixing #3621 must turn every test
below GREEN without special-casing any one lesson_uid in the test itself.

Two of the three (L0052, L0143) have real drawings recoverable from
`assets/figN.*` and are fully fixed here. L0073's four trend-line graphs
were never rendered into the source PDF (see `options_note` on that
question) and no fig file for them exists on disk — it is DOCUMENTED as a
remaining known gap in `content_known_gaps.yaml`, not silently dropped.
"""
from __future__ import annotations

from pathlib import Path

import yaml

from app.services.lesson_indexes import build_all_lessons
from app.services.live_quiz.round_types import choice as choice_round
from app.services.live_quiz.sources import comprehension as live_quiz_comprehension
from app.services.live_quiz.sources.base import QuizItem, QuizOption

LESSONS_ROOT = Path(__file__).resolve().parent.parent / "data" / "lessons"
KNOWN_GAPS_PATH = (
    Path(__file__).resolve().parent.parent
    / "data" / "curriculum_qa" / "content_known_gaps.yaml"
)


def _known_gaps() -> dict:
    return yaml.safe_load(KNOWN_GAPS_PATH.read_text(encoding="utf-8")) or {}


def _lesson_detail(uid: str) -> dict:
    for l in build_all_lessons():
        if l.get("lesson_uid") == uid:
            return l
    raise AssertionError(f"{uid} not found in build_all_lessons()")


class TestL0052Q3NowServed:
    """血藍鯨「哪一張圖最符合被漁具纏繞」— D (the answer) had blank text."""

    def test_question_is_present_with_non_null_answer(self):
        mcq_list = _lesson_detail("L0052").get("multiple_choice") or []
        matches = [q for q in mcq_list if "被漁具纏繞" in q["question"]]
        assert len(matches) == 1, "withheld (or duplicated) — expected exactly one"
        q = matches[0]
        assert q["answer"] == "D"

    def test_option_images_present_for_all_four_letters(self):
        mcq_list = _lesson_detail("L0052").get("multiple_choice") or []
        q = next(q for q in mcq_list if "被漁具纏繞" in q["question"])
        imgs = q.get("option_images")
        assert imgs is not None and len(imgs) == 4
        assert all(imgs), f"every option should carry an image, got {imgs}"
        # Each URL must point at the real uid-tree asset route, not GCS.
        assert all(u.startswith("/assets/lesson/L0052/") for u in imgs)
        # D (index 3) is the answer and is the entangled-whale drawing.
        assert imgs[3].endswith("fig13.jpeg")


class TestL0143Q1NowServed:
    """「下列哪一個圖是『血栓』」— A (the answer) had blank text."""

    def test_question_is_present_with_non_null_answer(self):
        mcq_list = _lesson_detail("L0143").get("multiple_choice") or []
        matches = [q for q in mcq_list if "血栓" in q["question"]]
        assert len(matches) == 1
        assert matches[0]["answer"] == "A"

    def test_option_images_present_for_all_four_letters(self):
        mcq_list = _lesson_detail("L0143").get("multiple_choice") or []
        q = next(q for q in mcq_list if "血栓" in q["question"])
        imgs = q.get("option_images")
        assert imgs is not None and len(imgs) == 4
        assert all(imgs)
        assert all(u.startswith("/assets/lesson/L0143/") for u in imgs)
        assert imgs[0].endswith("fig6.jpeg")  # A = the clot drawing = the answer


class TestL0073StaysHonestlyWithheld:
    """No source image exists for these four trend-line graphs (the PDF
    never rendered them — see `options_note` in the source yml). The
    question must stay withheld, not get a fabricated image."""

    def test_question_remains_absent(self):
        mcq_list = _lesson_detail("L0073").get("multiple_choice") or []
        matches = [q for q in mcq_list if "升上國中的新鮮感" in q["question"]]
        assert matches == [], (
            "L0073's graph question has no real source image yet — it must "
            "stay withheld, not be invented"
        )


class TestKnownGapsRegistryStaysHonest:
    """`content_known_gaps.yaml` must reflect exactly what's still missing
    — no more (silently dropping a real gap), no less (claiming an unfixed
    gap is resolved)."""

    def test_registry_only_lists_l0073_as_remaining(self):
        gaps = _known_gaps()["image_options_only_captions"]
        remaining = {l["lesson_uid"] for l in gaps["lessons"]}
        assert remaining == {"L0073"}, (
            f"L0052/L0143 should be off this list (fixed with real images); "
            f"got {remaining}"
        )
        assert gaps["count_lessons"] == 1


class TestClassLevelSweepEveryOptionHasTextOrImage:
    """Every comprehension option across all 175 lessons must have SOME
    content a student can act on: text, or an image, or (for the single
    documented exception) be registered in content_known_gaps.yaml.

    Positive control: the sweep must actually visit at least one
    image-only option (L0052/L0143) — a sweep that silently skips every
    lesson (e.g. an empty glob) would vacuously "pass" without checking
    anything, which is worse than no test at all.
    """

    def test_every_option_has_text_image_or_documented_gap(self):
        gaps = _known_gaps()["image_options_only_captions"]
        documented_gap_uids = {l["lesson_uid"] for l in gaps["lessons"]}

        undocumented_violations: list[str] = []
        image_options_seen = 0

        for lesson in build_all_lessons():
            uid = lesson["lesson_uid"]
            for q in (lesson.get("multiple_choice") or []):
                options = q.get("options") or []
                option_images = q.get("option_images") or [None] * len(options)
                for idx, text in enumerate(options):
                    img = option_images[idx] if idx < len(option_images) else None
                    if img:
                        image_options_seen += 1
                    if not str(text or "").strip() and not img:
                        if uid not in documented_gap_uids:
                            undocumented_violations.append(
                                f"{uid} option[{idx}] of {q['question']!r}"
                            )

        assert undocumented_violations == [], (
            "Found comprehension option(s) with neither text nor image, "
            f"and not registered as a known gap: {undocumented_violations}"
        )
        assert image_options_seen > 0, (
            "Positive control failed: swept 0 image-backed options — the "
            "sweep itself is broken (or the fix regressed), not just quiet"
        )


class TestLiveQuizComprehensionSourceIncludesImageQuestion:
    """#3610 withheld this exact question from the live-quiz / PK pool
    because its answer option's text was blank. It must now be served
    WITH an image, not just un-withheld as blank text."""

    def test_l0052_image_question_included_with_image_option(self):
        lesson = {
            "title": "小藍鯨的最後旅程",
            "version_id": "v3",
            "comprehension": {
                "questions": [
                    {
                        "index": 3,
                        "stem": "根據第三段，哪一張圖最符合小藍鯨生前被漁具纏繞的情況？",
                        "answer": "D",
                        "options": {"A": "藍鯨骨骼標本", "B": "鯊魚", "C": "藍鯨", "D": ""},
                        "option_images": {
                            "A": "fig10.jpeg", "B": "fig11.jpeg",
                            "C": "fig12.jpeg", "D": "fig13.jpeg",
                        },
                    },
                ]
            },
        }
        items = live_quiz_comprehension.generate_items("L0052", lesson)
        assert len(items) == 1, "the image-backed question must not be withheld"
        item = items[0]
        d_option = next(o for o in item.options if o.key == "D")
        assert d_option.image == "/assets/lesson/L0052/fig13.jpeg"
        assert d_option.text == ""

    def test_question_with_neither_text_nor_image_still_withheld(self):
        lesson = {
            "title": "t", "version_id": "v3",
            "comprehension": {"questions": [
                {"index": 1, "stem": "沒有圖也沒有字的題？", "answer": "C",
                 "options": {"A": "甲", "B": "乙", "C": "", "D": "丁"}},
            ]},
        }
        assert live_quiz_comprehension.generate_items("L0001", lesson) == []


class TestShuffleDisplayPositionsPreservesImage:
    """The per-game shuffle in `choice.py` rebuilds each option dict from
    scratch (security #1a: never ship the source letter unshuffled). That
    rebuild must carry `.image` through — dropping it here would silently
    undo the fix two layers up from where it's easy to notice."""

    def test_shuffled_options_keep_their_image_field(self):
        item = QuizItem(
            source_module="comprehension",
            lesson_uid="L0052",
            lesson_title="t",
            stem="q",
            options=[
                QuizOption(key="A", text="甲"),
                QuizOption(key="B", text="乙"),
                QuizOption(key="C", text="丙"),
                QuizOption(key="D", text="", image="/assets/lesson/L0052/fig13.jpeg"),
            ],
            correct_key="D",
        )
        options, correct_key = choice_round._shuffle_display_positions(item, __import__("random").Random(1))
        shuffled_correct = next(o for o in options if o["key"] == correct_key)
        assert shuffled_correct.get("image") == "/assets/lesson/L0052/fig13.jpeg"
        # A non-image option must NOT grow a spurious image key.
        non_answer = [o for o in options if o["key"] != correct_key]
        assert all("image" not in o for o in non_answer)
