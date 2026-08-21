"""老師打的勾透過「哪個選項沒有框」洩漏答案 (#2555).

WHAT #2555 REPORTED, AND WHAT IT ACTUALLY IS
--------------------------------------------
Reported as 「勾選題選項文字殘留『□』字元」 — residue to be stripped. It is the opposite:
the 「□」 is the CORRECT character and the problem is the options that do NOT have one.

The worksheets hold two different things:

    literal 「□」 in <w:t>                    an UNCHECKED box, 726 in the first 30 lessons
    <w:sym w:font="Wingdings" w:char="F0FE">  a CHECKED box ☑, the marker's answer

`_paragraphs` reads `<w:t>` only, so the ☑ produces no character at all. The option the
teacher checked therefore arrives with NOTHING in front of it while its siblings keep
their 「□」:

    （單選）□①驕傲地奪得銀牌     ②以微小差距與金牌擦身而過   ← ② is the answer
    比賽時受傷了，他選擇（單選）①積極的面對與復健   □②放棄跑步  ← ① is the answer

1805 checked boxes across 157 of 175 lessons. Every checkbox exercise on the platform
tells the student which option to pick, by the absence of a box.

THE FIX AND ITS BOUND
---------------------
Emit 「□」 for the checked glyph too, so every option looks the same. Which option was
checked is NOT recorded here — that is worth having and is a separate change; making the
answer unreadable is the part that has to land first.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent.parent
SRC = Path("/tmp/docx-src")
LESSONS = ROOT / "backend" / "data" / "lessons"
sys.path.insert(0, str(ROOT / "scripts"))

#: An option marker: a circled digit, optionally preceded by a box.
_OPTION = re.compile(r"(□?)\s*([①②③④⑤⑥⑦⑧⑨])")

pytestmark = pytest.mark.skipif(
    not SRC.is_dir(), reason="second-edition DOCX sources are not on this machine"
)


def _mixed_groups(text: str) -> list[str]:
    """Lines where some options carry a box and others do not.

    A line with no boxes at all is fine — plenty of lists use circled digits without
    being checkbox exercises. A line where they ALL have one is fine. The leak is the
    mixture, because the odd one out is the marker's answer.
    """
    out = []
    for line in text.splitlines():
        marks = _OPTION.findall(line)
        if len(marks) < 2:
            continue
        boxed = {bool(m[0]) for m in marks}
        if len(boxed) > 1:
            out.append(line.strip()[:60])
    return out


def test_the_checked_glyph_reaches_the_text_as_a_box():
    """Read straight from the source, so this fails on the extractor and not on stale data."""
    from extract_lesson_body import _paragraphs, read_runs

    checked = [d for d in sorted(SRC.glob("*.docx"))
               if any(r.get("sym") == ("Wingdings", "F0FE")
                      for p in read_runs(d) for r in p)]
    assert len(checked) >= 100, (
        f"only {len(checked)} lessons have a checked box — the fixture is looking in the "
        f"wrong place, not the data being thin"
    )

    leaking = []
    for docx in checked:
        mixed = _mixed_groups("\n".join(_paragraphs(docx)))
        if mixed:
            leaking.append((docx.stem, mixed[0]))
    assert leaking == [], (
        f"{len(leaking)}/{len(checked)} lessons have an option group where one option has "
        f"no box — that one is the marker's answer: {leaking[:4]}"
    )


#: Mixed in the SOURCE, with no checked glyph anywhere in the paragraph — the worksheet
#: itself gives some options a box and others none, so there is nothing for the extractor
#: to have dropped. Named rather than tolerated by a threshold, so a change that leaks
#: MORE lessons fails instead of hiding under a bar. Settling what these three should
#: look like needs the printed worksheet.
#:
#:     L0019  ①就有保送升學的機會。□②就想回家。
#:     L0167  ⑥自信　□⑦好奇
#:     L0067  a prose instruction line that happens to contain ❹ and 「(勾選」
SOURCE_IS_MIXED = {"L0019", "L0167", "L0067"}


def test_no_served_module_shows_a_mixed_option_group():
    """The same invariant on what actually reaches a student."""
    leaking = []
    for uid_dir in sorted(LESSONS.iterdir()):
        if not uid_dir.is_dir():
            continue
        for module in ("keypoints", "spotlight", "sections", "body"):
            f = uid_dir / "v2" / f"{module}.yml"
            if not f.exists():
                continue
            mixed = _mixed_groups(f.read_text(encoding="utf-8"))
            if mixed and uid_dir.name not in SOURCE_IS_MIXED:
                leaking.append((uid_dir.name, module, mixed[0]))
                break
    assert leaking == [], (
        f"{len(leaking)} lessons serve an option group with a missing box: {leaking[:4]}"
    )
