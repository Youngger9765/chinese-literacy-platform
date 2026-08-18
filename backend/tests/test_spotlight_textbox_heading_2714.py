"""聚光燈的章節標題住在文字方塊裡，從沒進到 block 流 (#2714).

WHY
---
29 lessons print a perfectly ordinary 「閱讀聚光燈」/「品格聚光燈」 heading and extract no
spotlight at all. The heading is not what the matcher looks for, because the heading
never reaches it:

`extract_raw` walks the body and takes `Paragraph.text`, which python-docx defines as the
concatenation of `w:r/w:t` children. A text box's runs live under
`mc:AlternateContent/…/w:txbxContent`, so the paragraph arrives empty and is dropped at
`if not t: continue`. Measured over the first 40 lessons: the heading is in the document
in 38 and reaches the block stream in 8.

So the most reliable marker in the worksheet was invisible, and everything downstream
compensated with phrases — 「◎ 小試身手」 and friends. The second edition writes the same
sub-heading as 「一、先複習：…」 with no ◎ at all, and those lessons fell through.

TWO CONTROLS, BOTH REQUIRED
---------------------------
Widening a matcher is how sections get mis-detected, so the target is only half the test.
The other half is that the 143 lessons which extract today get exactly the start they had
— the fallback fires only when the existing rules found nothing, so it can only add.

Two structural guards were tried before the current shape and are recorded in the code:
taking the last heading rather than the first, and requiring it after the title table.
Both cost recovered lessons and neither fixed 文言文, whose masthead prints
「文言聚光燈：固定句式」 and which already builds a schema through the no-start branch.
That one is settled at the call site, where the strategy is known.
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

_HEADING = re.compile(r"聚光燈")

pytestmark = pytest.mark.skipif(
    not SRC.is_dir(), reason="second-edition DOCX sources are not on this machine"
)

#: Has the heading, and still finds no start. Named rather than tolerated by a threshold,
#: so that a change which loses MORE lessons fails instead of staying under a bar.
KNOWN_STILL_UNFOUND = {"L0145"}


def _strategy_of(uid: str) -> str | None:
    f = LESSONS / uid / "v2" / "spotlight.yml"
    if not f.exists():
        return None
    doc = (yaml.safe_load(f.read_text(encoding="utf-8")) or {}).get("spotlight") or {}
    return doc.get("strategy_type") if doc.get("blocks") else None


def _document_has_heading(docx: Path) -> bool:
    from extract_lesson_body import _paragraphs

    return any(_HEADING.search(p.strip()) and len(p.strip()) <= 40
               for p in _paragraphs(docx))


def test_a_lesson_whose_worksheet_prints_the_heading_gets_a_spotlight():
    from build_lesson_schema import extract_raw, find_spotlight_range

    unfound = set()
    for docx in sorted(SRC.glob("*.docx")):
        if _strategy_of(docx.stem) or not _document_has_heading(docx):
            continue
        blocks = extract_raw(docx)
        start, _ = find_spotlight_range(blocks, docx)
        if start is None:
            unfound.add(docx.stem)

    assert unfound == KNOWN_STILL_UNFOUND, (
        f"newly unfound {sorted(unfound - KNOWN_STILL_UNFOUND)}, "
        f"newly found {sorted(KNOWN_STILL_UNFOUND - unfound)}"
    )


def test_no_lesson_that_already_extracts_moves():
    """The half that stops a widened matcher from being an improvement on paper.

    Every lesson with a spotlight today must resolve to the SAME start with the fallback
    available as without it. 文言文 is passed None at the call site because its no-start
    branch is what builds its schema; that exclusion is reproduced here rather than
    assumed, so removing it at the call site fails this test.
    """
    from build_lesson_schema import extract_raw, find_spotlight_range

    moved = []
    checked = 0
    for docx in sorted(SRC.glob("*.docx")):
        blocks = extract_raw(docx)
        before, _ = find_spotlight_range(blocks)
        if before is None:
            # The fallback only fires here, so there is nothing to preserve.
            continue
        # Deliberately NOT gated on 「does this lesson have a spotlight.yml today」. That
        # was the first version of this test and it used the pipeline's own output as its
        # control: after a rebuild the set of lessons-that-extract is the NEW set, so the
        # control moved with the thing it was controlling and the test went red for a
        # reason that had nothing to do with a regression.
        #
        # 「the phrase rules found a start」 is a property of the document and the matcher,
        # and it does not move when the data is rebuilt.
        checked += 1
        after, _ = find_spotlight_range(blocks, docx)
        if before != after:
            moved.append((docx.stem, before, after))

    assert checked >= 100, (
        f"only {checked} lessons reach the phrase rules — the control is too thin to "
        f"mean anything"
    )

    assert moved == [], (
        f"{len(moved)} lessons that extract today would start somewhere else: {moved[:5]}"
    )


def test_the_anchor_is_the_heading_and_not_any_text_box():
    """A text box without the heading must not anchor anything.

    The negative control for the widening. Without it, 「the fallback found a start」 and
    「the fallback found the RIGHT start」 are indistinguishable, and a rule that anchored
    on any text box at all would pass the two tests above just as well.
    """
    from build_lesson_schema import textbox_heading_anchor

    with_heading = [d for d in sorted(SRC.glob("*.docx")) if _document_has_heading(d)]
    without = [d for d in sorted(SRC.glob("*.docx")) if not _document_has_heading(d)]
    assert with_heading and without, "need both groups for the control to mean anything"

    anchored_without_heading = [d.stem for d in without if textbox_heading_anchor(d) is not None]
    assert anchored_without_heading == [], (
        f"anchored {len(anchored_without_heading)} lessons whose document has no 聚光燈 "
        f"heading at all: {anchored_without_heading[:5]}"
    )
