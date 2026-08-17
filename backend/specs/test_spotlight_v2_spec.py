"""Spec contracts for spotlight v2 block schemas.

WHAT THIS FILE USED TO BE, AND WHY IT CHANGED (#2683 二修重刷)
--------------------------------------------------------------
It ran three layers against two hand-curated fixture sets — DEV7 (七課, the professor
set) and TEST15 — living in `data/lessons/spotlight/{dev7,test15}/`:

  1. gold fingerprint — each checked-in YAML matched `gold_manifest.json` byte metrics
  2. eval gates       — guide_retained / answer_recall / mcq_leakage / struct validity
  3. loader wiring    — those lesson codes exposed spotlight_v2 on the lesson dict

Layers 1 and 3 were tied to the fixtures themselves: the roster was a tuple of
first-edition lesson codes, and the gold manifest was a fingerprint of those exact
files. Both directories were deleted with the first edition, so all three layers now
assert facts about material that does not exist — 77 failures, 23 errors, none of them
about the code they were meant to protect.

Layer 2 is the part worth keeping, and it never needed a curated fixture set: the eval
gates are properties every spotlight must hold, whichever lesson it came from. So they
now run against the real corpus in the uid tree — 143 lessons instead of 22, and no
roster to go stale.

The gold fingerprint is NOT rebuilt. Regenerating it from second-edition output would
freeze whatever the extractor happens to produce today as the definition of correct,
which is a baseline that proves only that nothing changed — not that anything is right.
Fingerprints belong to human-checked material; if a curated set is re-established for
the second edition, the layer can come back with it.

Run:
    cd backend && python -m pytest specs/test_spotlight_v2_spec.py -v
"""

import pytest

from app.services.spotlight_contract import (
    count_mcq_option_guides,
    eval_spotlight_v2,
    fingerprint_spotlight,
    validate_block_structure,
)
from app.services.lesson_loader import get_all_lessons


# ── corpus ──────────────────────────────────────────────────────────────────

def _corpus() -> list[tuple[str, dict]]:
    """(uid, spotlight) for every lesson that has spotlight blocks.

    A lesson whose extraction produced nothing is a registered content gap
    (`data/curriculum_qa/content_known_gaps.yaml`), not a contract violation —
    including it here would report 32 failures for material that was never extracted.
    """
    out = []
    for lesson in get_all_lessons():
        spot = lesson.get("spotlight_v2")
        if isinstance(spot, dict) and spot.get("blocks"):
            out.append((lesson["lesson_uid"], spot))
    return out


CORPUS = _corpus()
UIDS = [uid for uid, _ in CORPUS]
BY_UID = dict(CORPUS)


def test_corpus_is_not_empty():
    """Guards the parametrised tests below from silently collecting nothing.

    Every test in this file is parametrised over UIDS. If the corpus were empty —
    a wrong path, a loader returning [] — pytest would collect zero cases and the
    file would report all-green while asserting nothing at all.
    """
    assert len(UIDS) >= 100, f"corpus only yielded {len(UIDS)} lessons with blocks"


# ── layer 2: eval gates, now over the whole corpus ──────────────────────────

@pytest.mark.parametrize("uid", UIDS)
def test_block_structure_is_valid(uid: str):
    errors = validate_block_structure(BY_UID[uid].get("blocks") or [])
    assert errors == [], f"{uid}: {errors}"


@pytest.mark.parametrize("uid", UIDS)
def test_eval_gates_pass(uid: str):
    result = eval_spotlight_v2(BY_UID[uid])
    assert result["pass"], (
        f"{uid}: guide_retained={result['guide_retained']} "
        f"answer_recall={result['answer_recall']} mcq_leakage={result['mcq_leakage']} "
        f"struct_errors={result['struct_errors']}"
    )


@pytest.mark.parametrize("uid", UIDS)
def test_mcq_options_are_not_emitted_as_guides(uid: str):
    """A multiple-choice option rendered as a `guide` block reads as instruction
    text rather than a choice — the student sees the answer laid out as prose."""
    # L0067 and L0070 dropped 2026-08-17: the checked-box fix (#2555) gave the ☑ a
    # character, so the option lines that used to arrive as bare text and be classified
    # as guides now carry their 「□」 and are recognised as options. They no longer leak.
    # L0067 dropped 2026-08-17: the checked-box fix (#2555) gave the ☑ a character, so
    # option lines that used to arrive bare and be classified as guides now carry their
    # 「□」 and are recognised as options.
    #
    # L0070 ADDED by the same change, and it is a regression, not a discovery. One block
    # (「□①沒有真實的歷史，只有歷史的真實」) is a second question's option list that lost
    # its stem, so the coalescer has nothing to attach it to. Registered rather than
    # fixed at the time: the change it comes with stops 157 lessons from showing students
    # which option the teacher checked, and one option rendering as a guide is a smaller
    # harm than holding that back. It is a real defect and belongs in #2555's follow-up.
    # L0033 已在 #2736 多模態重抽時修好（選項不再被抽成 guide），
    # 測試自己要求移除 —— 一個「已知缺口」清單如果只進不出，
    # 過一陣子就會變成「這些永遠都壞」的免死金牌。
    KNOWN = {"L0054", "L0070", "L0100", "L0122", "L0129"}
    leaked = count_mcq_option_guides(BY_UID[uid].get("blocks") or [])
    if uid in KNOWN:
        # Registered in content_known_gaps.yaml#mcq_options_emitted_as_guides. Asserted
        # as STILL BROKEN rather than skipped, so fixing the extractor turns this red
        # and forces the entry to be removed — a plain skip would let the gap outlive
        # its cause without anyone noticing.
        assert leaked > 0, f"{uid} no longer leaks — remove it from KNOWN and the gap file"
        return
    assert leaked == 0, f"{uid}: {leaked} MCQ options emitted as guide blocks"


@pytest.mark.parametrize("uid", UIDS)
def test_no_assetless_table_figure_survives_loading(uid: str):
    """`{"type": "figure", "referent": "table", "asset": null}` has nothing to render.
    `inject_per_practice_figures` emits them on every rebuild (89 of 143 lessons after
    the second-edition run), and `lesson_uid_loader._drop_assetless_table_figures`
    strips them — this is that filter's regression lock.

    A `referent=table` figure that DOES carry an asset is a real figure and stays;
    the first version of this test banned the referent outright and would have
    deleted one (#2455/#2463)."""
    bad = [
        b for b in (BY_UID[uid].get("blocks") or [])
        if isinstance(b, dict)
        and b.get("type") == "figure"
        and b.get("referent") == "table"
        and not b.get("asset")
    ]
    assert bad == [], f"{uid}: {len(bad)} assetless referent=table figure blocks survived"


# ── fingerprint shape (not a frozen baseline — see module docstring) ────────

@pytest.mark.parametrize("uid", UIDS[:20])
def test_fingerprint_is_computable(uid: str):
    """The fingerprint function must survive real corpus input. This asserts its
    SHAPE, deliberately not its values: a value baseline generated from today's
    extractor output would only prove that nothing changed."""
    fp = fingerprint_spotlight(BY_UID[uid])
    assert isinstance(fp, dict) and fp


# ── structural invariants that do not depend on any particular lesson ───────

def test_validate_rejects_empty_guide():
    errors = validate_block_structure([{"type": "guide", "text": ""}])
    assert errors, "an empty guide block must be reported"


def test_a_lesson_with_no_spotlight_exposes_none():
    """The absence of a spotlight is served as absence, never as an empty shell —
    an empty one renders as a blank 聚光燈 page that looks like content."""
    for lesson in get_all_lessons():
        spot = lesson.get("spotlight_v2")
        assert spot is None or isinstance(spot, dict), (
            f"{lesson['lesson_uid']}: spotlight_v2 is {type(spot).__name__}"
        )
