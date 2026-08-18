"""重點朗讀取的是教授畫的那一段，不是推導分段的第 N 個 (#2720).

REPORTED by 靖杭 after the second edition landed: 「重點朗讀有判斷錯誤的情況」 — the
length was fixed by #2718, but the PARAGRAPH was still wrong.

WHY THIS FILE EXISTS AND #2718's DOES NOT COVER IT
--------------------------------------------------
`test_key_reading_extent_2683.py` asserts two things: the passage is one of the lesson's
own paragraphs, and the median length is not inflated. Both are **self-consistency**
properties. Measured against the first edition's hand-scanned passages, 14 of 34
judgeable lessons were serving the WRONG paragraph — and all 14 satisfied both
assertions, because a neighbouring paragraph is still one of the lesson's own paragraphs
and still a normal length. Eight of them additionally carried `verdict: confirmed`.

Nothing in the suite could go red for picking the wrong paragraph. That is what this
file adds, and it is the reason the bug survived a fix that was measured.

THE GROUND TRUTH IS NOT DERIVED FROM THE EXTRACTOR
--------------------------------------------------
`backend/data/key_reading_passages.yml` — 134 passages read off the printed first-edition
worksheets by hand (issue #2562), the ones the professor marked with ☞. That file has
been in the repo since #2571 and is byte-identical to 靖杭's 148 scan files for all 134
entries it covers, so it is the golden set and no new data has to be committed.

It is a REGRESSION golden set, not an answer key, and the difference matters:

  · it is the FIRST edition. 23 of the 53 comparable lessons had their text rewritten in
    the second, so most lessons cannot be judged by it at all — the assertion below is
    scoped to lessons where the golden passage still appears verbatim in the second
    edition's own body, and it says nothing about the rest.
  · a passage that appears in more than one lesson's body (《正太與小豬》 recurs across
    seven) cannot identify a lesson, so those are excluded rather than guessed.

WHAT WOULD MAKE THIS FILE PASS WRONGLY
--------------------------------------
Withholding everything. A lesson with no `key_reading.yml` falls back to reading the
whole text and is not asserted against here — that is deliberate (degraded beats wrong),
but it means precision alone can be gamed by writing nothing. `test_coverage_does_not_
collapse` is the other half of the vice.
"""

import os
import re
import sys
import unicodedata

import pytest
import yaml

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

DATA = os.path.join(os.path.dirname(__file__), "..", "data")
LESSONS = os.path.join(DATA, "lessons")
GOLDEN = os.path.join(DATA, "key_reading_passages.yml")


def _norm(s: str) -> str:
    """Fold width, drop whitespace, combining marks and variation selectors.

    Word stores variation selectors inside words (`納悶󠇡`), so two strings that read
    identically compare unequal without this. One of the golden passages carries one.
    """
    s = unicodedata.normalize("NFKC", s or "")
    return "".join(
        c for c in s
        if not c.isspace()
        and unicodedata.category(c) not in ("Cf", "Mn")
        and not (0xE0100 <= ord(c) <= 0xE01EF)
    )


def _latest_version(uid_dir: str) -> str | None:
    if not os.path.isdir(uid_dir):
        return None
    versions = sorted(
        d for d in os.listdir(uid_dir)
        if d.startswith("v") and os.path.isdir(os.path.join(uid_dir, d))
    )
    return os.path.join(uid_dir, versions[-1]) if versions else None


#: How many of `body.yml`'s paragraphs one PRINTED paragraph may span. Word splits a
#: paragraph at a manual line break in a handful of lessons, so the printed unit the
#: professor numbered is sometimes two stored ones — 《感情小日記1》 is 176 + 24
#: characters and serving only the first cuts it off mid-sentence. Bounded, because an
#: unbounded run is how a passage gets assembled to hit a length (#2712).
MAX_BODY_SPAN = 3


def _is_body_span(passage: str, paragraphs: list[str]) -> bool:
    """Is `passage` one stored paragraph, or a short run of consecutive ones?"""
    target = _norm(passage)
    normed = [_norm(p) for p in paragraphs]
    for i in range(len(normed)):
        acc = ""
        for j in range(i, min(i + MAX_BODY_SPAN, len(normed))):
            acc += normed[j]
            if acc == target:
                return True
            if len(acc) > len(target):
                break
    return False


def _lessons() -> list[tuple[str, list[str], str | None]]:
    """(uid, body paragraphs, written passage or None) for every lesson with a body."""
    out = []
    if not os.path.isdir(LESSONS):
        return out
    for uid in sorted(os.listdir(LESSONS)):
        vdir = _latest_version(os.path.join(LESSONS, uid))
        if vdir is None:
            continue
        bf = os.path.join(vdir, "body.yml")
        if not os.path.exists(bf):
            continue
        with open(bf, encoding="utf-8") as f:
            paras = (yaml.safe_load(f) or {}).get("paragraphs") or []
        if not paras:
            continue
        kf = os.path.join(vdir, "key_reading.yml")
        passage = None
        if os.path.exists(kf):
            with open(kf, encoding="utf-8") as f:
                doc = yaml.safe_load(f) or {}
            passage = doc.get("passage")
            # 二修教材為主: a lesson whose second-edition instruction names a different
            # paragraph than the first edition's printing is served from the second and
            # flagged. Asserting it against the first edition would assert against the
            # policy, so those are excluded here and covered by the test below instead.
            if ((doc.get("extraction_check") or {}).get("verdict")
                    == "disagrees_with_first_edition"):
                passage = None
        out.append((uid, paras, passage))
    return out


def _golden_passages() -> list[str]:
    with open(GOLDEN, encoding="utf-8") as f:
        doc = yaml.safe_load(f) or {}
    return [
        e["passage"].strip()
        for e in (doc.get("passages") or {}).values()
        if e and e.get("passage")
    ]


def _judgeable() -> list[tuple[str, str, str | None]]:
    """(uid, golden passage, written passage) for lessons the golden set can judge.

    A lesson is judgeable when exactly one golden passage appears verbatim as one of its
    body paragraphs — which is also what makes the pairing safe without a lesson code.
    """
    lessons = _lessons()
    goldens = [_norm(g) for g in _golden_passages()]
    # A golden passage belonging to more than one lesson identifies none of them.
    owners: dict[str, list[int]] = {g: [] for g in goldens}
    for i, (_uid, paras, _p) in enumerate(lessons):
        normed = {_norm(p) for p in paras}
        for g in goldens:
            if g in normed:
                owners[g].append(i)

    out = []
    for g, idxs in owners.items():
        if len(idxs) != 1:
            continue
        uid, _paras, written = lessons[idxs[0]]
        out.append((uid, g, _norm(written) if written else None))
    return out


def test_written_passages_are_the_paragraph_the_professor_marked():
    """The assertion #2718's suite could not make.

    Scoped to lessons the golden set can judge. A withheld lesson (no key_reading.yml)
    is not a failure here — it reads the whole text, which is degraded but honest.
    """
    judgeable = _judgeable()
    if not judgeable:
        pytest.skip("no lesson body overlaps the golden set — nothing to judge")

    written = [(uid, g, w) for uid, g, w in judgeable if w is not None]
    wrong = [(uid, g[:24], w[:24]) for uid, g, w in written if w != g]
    assert wrong == [], (
        f"{len(wrong)}/{len(written)} 課服務的不是教授畫的那一段。"
        f"錨點是紙本印的段號，不是 body.yml 的索引 —— 見 scripts/extract_key_reading.py。"
        f"前 3 筆 (uid, 教授的, 系統的): {wrong[:3]}"
    )


def test_coverage_does_not_collapse():
    """Withholding everything would satisfy the assertion above. It must not.

    The bound is deliberately loose — it is a floor against a regression that empties the
    feature, not a target. Withholding is the correct response to a worksheet whose
    numbering cannot be read, and how many of those exist is a property of the教材.
    """
    lessons = _lessons()
    if not lessons:
        pytest.skip("no lesson bodies present")
    served = sum(1 for _uid, _paras, p in lessons if p)
    assert served >= 0.15 * len(lessons), (
        f"只有 {served}/{len(lessons)} 課有重點朗讀段落。"
        f"withhold 是對讀不出段號的學習單的正確反應，但全部 withhold 等於功能消失"
    )


def test_no_passage_is_served_outside_its_own_body():
    """#1208 / #2698 recurrence lock: a passage from another lesson.

    Cheap, and it is the failure that reaches a student most visibly — 《十秒的背後》,
    about a sprinter, once served a passage about giving up a bus seat.

    Reads every written passage, including the ones the test above excludes: whichever
    edition a passage came from, it has to be THIS lesson's text.
    """
    stray = []
    for uid in sorted(os.listdir(LESSONS)) if os.path.isdir(LESSONS) else []:
        vdir = _latest_version(os.path.join(LESSONS, uid))
        if vdir is None or not os.path.exists(os.path.join(vdir, "body.yml")):
            continue
        with open(os.path.join(vdir, "body.yml"), encoding="utf-8") as f:
            paras = (yaml.safe_load(f) or {}).get("paragraphs") or []
        kf = os.path.join(vdir, "key_reading.yml")
        if not os.path.exists(kf):
            continue
        with open(kf, encoding="utf-8") as f:
            passage = (yaml.safe_load(f) or {}).get("passage")
        if passage and not _is_body_span(passage, paras):
            stray.append(uid)
    assert stray == [], f"這些課的重點朗讀段落不在自己的課文裡: {stray}"


def test_first_edition_disagreements_are_all_listed():
    """A flag nobody reads is not a safeguard.

    The 二修為主 policy writes a passage the first edition contradicts. That is a
    decision, not an accident — so every such lesson must appear in the review list a
    human works from, or the decision quietly becomes a silent difference.
    """
    listed = set()
    path = os.path.join(
        os.path.dirname(__file__), "..", "..",
        "docs", "curriculum", "key-reading-disagrees-first-edition.md")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            listed = set(re.findall(r"\bL\d{4}\b", f.read()))

    flagged = set()
    for uid in sorted(os.listdir(LESSONS)) if os.path.isdir(LESSONS) else []:
        vdir = _latest_version(os.path.join(LESSONS, uid))
        kf = os.path.join(vdir, "key_reading.yml") if vdir else None
        if not kf or not os.path.exists(kf):
            continue
        with open(kf, encoding="utf-8") as f:
            doc = yaml.safe_load(f) or {}
        if ((doc.get("extraction_check") or {}).get("verdict")
                == "disagrees_with_first_edition"):
            flagged.add(uid)

    assert flagged <= listed, (
        f"這些課採用了二修段落、與一修衝突，但沒有列進待確認清單: "
        f"{sorted(flagged - listed)}")
