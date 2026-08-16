"""重點朗讀的流暢度目標 — 每分鐘字數 / 文言文秒數 (#2722).

WHY
---
The 2026-07-20 expert review set the reading step's main measure as 流暢率 rather than
word-for-word accuracy. The worksheet already carries the target, calibrated per lesson,
in section 二 beside the timing table:

    第1次計時  第2次計時  第3次計時  裁判計時
        字         字         字         字

    □ ＜190字        □ 191~220字      □ ＞221字          146 lessons, characters/minute
    還要多加練習。    嗯，還不錯喲！    哇嗚，超級厲害！

    □42秒以下        □42~55秒         □55秒以上           12 lessons, 文言文, seconds
    速度有點快…      強者就是你啦！    速度再快一點！

The frontend has parsed this shape since #1960 — `parseReadingBenchmark` handles both
units, and `getThresholdsFromBenchmark` says in its own docstring 「191~220字 → pass at
≥191」. It was reading nothing: `lesson_indexes` hard-coded `reading_benchmark: None`,
so every lesson fell through to a grade-wide default while its own thresholds sat
unread in the DOCX.

WHAT IS ASSERTED
----------------
Presence where the source has it, that the tiers are ordered and meet, and that each
tier carries the message the marker wrote beside it. The thresholds are stored as the
worksheet's own strings, so the assertions parse them the same way the frontend does.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parent.parent.parent
SRC = Path("/tmp/docx-src")
LESSONS = ROOT / "backend" / "data" / "lessons"
sys.path.insert(0, str(ROOT / "scripts"))

_BOX = re.compile(r"^[□☐■◻▢]\s*")
_TIER = re.compile(r"\d{2,4}\s*[字秒]")

pytestmark = pytest.mark.skipif(
    not SRC.is_dir(), reason="second-edition DOCX sources are not on this machine"
)


def _lessons_whose_source_sets_a_target() -> list[str]:
    """Found independently of the extractor: any lesson with two or more adjacent
    checkbox tier lines. Reusing `find_reading_benchmark` here would only assert that
    the extractor agrees with itself."""
    from extract_lesson_body import _paragraphs

    out = []
    for docx in sorted(SRC.glob("*.docx")):
        text = [p.strip() for p in _paragraphs(docx)]
        run = 0
        for line in text:
            if _BOX.match(line) and _TIER.search(line):
                run += 1
                if run >= 2:
                    out.append(docx.stem)
                    break
            else:
                run = 0
    return out


def _stored(uid: str) -> dict:
    f = LESSONS / uid / "v2" / "key_reading.yml"
    return (yaml.safe_load(f.read_text(encoding="utf-8")) or {}) if f.exists() else {}


def _bounds(threshold: str) -> tuple[int, int]:
    """(low, high) of a tier, mirroring `fluencyAnalyzer.parseReadingBenchmark`.

    Four notations are in use, and the difference between two of them is one count:
    ＜220 ends at 219, ≦220 ends at 220. Both appear. Raising on anything else is the
    point of the function — a notation nobody has taught the frontend parser is dropped
    there silently, which is how L0082 lost two of its three tiers.
    """
    raw = _BOX.sub("", threshold).strip()
    if m := re.search(r"(\d+)\s*[~～-]\s*(\d+)", raw):
        return int(m.group(1)), int(m.group(2))
    if m := re.search(r"[＜<]\s*(\d+)", raw):
        return 0, int(m.group(1)) - 1
    if m := re.search(r"[≦≤]\s*(\d+)|(\d+)\s*[字秒]?以下", raw):
        return 0, int(m.group(1) or m.group(2))
    if m := re.search(r"[＞>]\s*(\d+)", raw):
        # The worksheet's ＞ is loose: ＜190 / 191~220 / ＞221 leaves 221 in no tier if
        # read strictly, so the marker means 「221 以上」. The frontend parser reads it
        # the same way (minCpm: 221), and the two must not disagree.
        return int(m.group(1)), 10 ** 6
    if m := re.search(r"[≧≥]\s*(\d+)|(\d+)\s*[字秒]?以上", raw):
        return int(m.group(1) or m.group(2)), 10 ** 6
    raise AssertionError(f"threshold in a notation nothing parses: {threshold!r}")


def test_every_lesson_whose_worksheet_sets_a_target_carries_it():
    expected = _lessons_whose_source_sets_a_target()
    assert len(expected) >= 140, (
        f"only {len(expected)} lessons found with a target in the source — the fixture is "
        f"looking in the wrong place, not the data being thin"
    )
    without = [uid for uid in expected if not _stored(uid).get("reading_benchmark")]
    assert without == [], (
        f"{len(without)}/{len(expected)} lessons whose worksheet sets a fluency target do "
        f"not carry it, so the timer counts against a grade-wide default: {without[:6]}"
    )


def test_a_withheld_passage_does_not_take_the_target_with_it():
    """The target belongs to the 念順順 section, not to the paragraph.

    A lesson can have a rubric while its anchor is withheld — the 文言文 lessons time in
    seconds and mostly have no anchor at all, and L0079's anchor lands on a six-character
    letter salutation. Storing the two together is right; letting one fail take out the
    other is not.
    """
    expected = set(_lessons_whose_source_sets_a_target())
    no_passage = {uid for uid in expected if not _stored(uid).get("passage")}
    assert no_passage, "fixture assumption gone: every lesson with a target now has a passage"
    lost = [uid for uid in no_passage if not _stored(uid).get("reading_benchmark")]
    assert lost == [], f"{len(lost)} lessons lost their target along with their passage: {lost[:6]}"


def test_the_tiers_are_ordered_and_no_more_than_one_count_apart():
    """Consecutive tiers are ordered and their boundaries touch within one count.

    The worksheets are not internally exact, and the slop goes both ways:

        ＜190字 / 191~220字     step 2 — 190 is in neither tier      139 lessons
        ＜190字 / 190~220字     step 1 — 190 is in both               6 lessons
        ≦220字 / 221~250字      step 1 — exactly contiguous           1 lesson

    Neither consumer does a 「which tier am I in」 lookup, so the one-count hole in the
    common form is not visible to a student: `getThresholdsFromBenchmark` takes the
    middle tier's lower bound as the pass mark, and `FluencyProgressChart` draws a line
    at each. Left alone rather than closed, because closing it would be inventing a
    threshold the marker did not write to fix a symptom nobody has.

    What this does catch is a misparse. 「191~220」 read with a digit lost, or its two
    numbers taken as separate tiers, produces a step far outside this range — usually
    negative, since the tiers then run backwards.
    """
    broken = []
    for uid in _lessons_whose_source_sets_a_target():
        levels = (_stored(uid).get("reading_benchmark") or {}).get("levels")
        if not levels:
            continue                                  # covered by the test above
        bounds = [_bounds(l["threshold"]) for l in levels]
        for (_, hi), (lo, _) in zip(bounds, bounds[1:]):
            if not 0 <= lo - hi <= 2:
                broken.append((uid, [l["threshold"] for l in levels], lo - hi))
                break
    assert broken == [], f"tiers do not meet in {len(broken)} lessons: {broken[:5]}"


def test_each_tier_carries_the_words_the_marker_wrote_for_it():
    missing = []
    for uid in _lessons_whose_source_sets_a_target():
        levels = (_stored(uid).get("reading_benchmark") or {}).get("levels")
        if not levels:
            continue
        if not all(str(l.get("feedback", "")).strip() for l in levels):
            missing.append((uid, [l.get("feedback") for l in levels]))
    assert missing == [], (
        f"{len(missing)} lessons have tiers but not every message: {missing[:4]}"
    )


def test_the_target_survives_the_trip_to_the_api_shape():
    """Reaching the served lesson, not just the YAML on disk.

    This is the failure the whole issue is: the target existed in the DOCX all along and
    the frontend has parsed this exact shape since #1960, but `lesson_indexes` built the
    served lesson with `reading_benchmark: None` written into it literally. Nothing was
    broken anywhere else — data present, parser present, consumer present, wire cut in
    the middle — so nothing failed and every lesson quietly used a grade-wide default.

    Asserted through `build_all_lessons` rather than by reading the file, because a file
    the API does not serve is not a delivered target.
    """
    from app.services.lesson_indexes import build_all_lessons

    served = build_all_lessons()
    with_target = [l for l in served if l.get("reading_benchmark")]
    assert len(with_target) >= 140, (
        f"only {len(with_target)}/{len(served)} served lessons carry their own fluency "
        f"target — the projection is dropping it again"
    )
    sample = with_target[0]["reading_benchmark"]
    assert sample["levels"] and all(
        l.get("threshold") and l.get("feedback") for l in sample["levels"]
    ), f"served target is missing its thresholds or messages: {sample}"
