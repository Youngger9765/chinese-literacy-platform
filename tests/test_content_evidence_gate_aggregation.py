"""
tests/test_content_evidence_gate_aggregation.py

#2561 blocker fix — bidirectional proof for summarize_cells()/compute_fail_reasons()
in scripts/content_evidence_gate.py.

Why this test exists (and why it stubs L3/figure rows instead of running live):
this sandbox has no `browse` binary and no `playwright`, so the L3 (staging
render) layer cannot be exercised here. Because summarize_cells()'s precedence
treats "unknown" as dominating "known_gap", any `--no-l3` run against live
staging forces every cell's L3 status to "unknown" (L3_SKIPPED) and therefore
can NEVER show known_gap_cells>0 or overall_status="pass" — see the real
`--no-l3` demo runs under qa/content-evidence/2026-08-14-worker-a-demo-*/,
where the G4-L02 known_gap L1 row is masked into an "unknown" cell for exactly
this reason.

To prove the known_gap-vs-fail precedence fix without faking a live PASS, this
test feeds REAL L1/figure rows (verbatim from the two live-staging demo runs
above — a genuinely broken lesson G4-L24/story 1024 with a real
L1_BASE_TEXT_QUALITY defect, and a genuinely known-gap-only lesson G4-L02/
story 2 with a real KNOWN_CONTENT_GAP_NO_SPOTLIGHT_SOURCE tag) plus a clearly
labeled SYNTHETIC L3="pass" row standing in for the unavailable browse
binary. The figure rows are also stubbed to "pass" here because the real
figure_asset_audit rows for BOTH lessons independently came back "unknown"
(http-403 on GCS asset fetch) in this sandbox — an environment/auth artifact
(no signed-URL credentials here), not a content difference between the good
and bad lesson, so it is neutralized to isolate the known_gap fix under test.

This is a stand-in for the unavailable L3 layer, not a claim that G4-L02 or
G4-L24 have been visually verified on staging in this session.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))

from content_evidence_gate import summarize_cells, compute_fail_reasons


# ─── Real L1 rows, verbatim from live-staging demo runs ─────────────────────
# qa/content-evidence/2026-08-14-worker-a-demo-bad-G4-L24-lesson/l1_results.jsonl
L1_BAD_LESSON_G4_L24 = [
    {
        "cell_id": "1024:reading-strategy",
        "status": "fail",
        "failure_codes": ["L1_BASE_TEXT_QUALITY"],
    },
    {
        "cell_id": "1024:story-structure",
        "status": "fail",
        "failure_codes": ["L1_BASE_TEXT_QUALITY"],
    },
]

# qa/content-evidence/2026-08-14-worker-a-demo-good-G4-L02-lesson/l1_results.jsonl
L1_KNOWN_GAP_LESSON_G4_L02 = [
    {
        "cell_id": "2:reading-strategy",
        "status": "known_gap",
        "failure_codes": ["KNOWN_CONTENT_GAP_NO_SPOTLIGHT_SOURCE"],
    },
    {
        "cell_id": "2:story-structure",
        "status": "pass",
        "failure_codes": [],
    },
]


def _synthetic_l3_pass(cell_ids: list[str]) -> list[dict]:
    """Stand-in for the unavailable browse binary (see module docstring)."""
    return [
        {
            "cell_id": cid,
            "status": "pass",
            "screenshot": {"bytes": 12345},
            "render": {"console_error_count": 0},
        }
        for cid in cell_ids
    ]


def _synthetic_fig_pass(cell_ids: list[str]) -> list[dict]:
    """Neutralizes the sandbox-only GCS 403 artifact (see module docstring)."""
    return [
        {"cell_id": cid, "status": "pass", "blacklist_md5_hits": []}
        for cid in cell_ids
    ]


def test_known_gap_only_lesson_reaches_overall_pass():
    """The core #2561 fix: a lesson whose only non-pass cell is a documented,
    reason-tagged known_gap must reach overall_status=pass once L1/L3/figure
    otherwise agree. Before the fix, content_evidence_gate.py appended a
    `known_gap_cells=N` fail_reason unconditionally, while
    content_evidence_ship_gate.sh already treated known_gap as non-blocking —
    the contradiction made PASS mathematically unreachable for any lesson
    with a documented gap (42 such lessons existed at the time)."""
    cell_ids = [row["cell_id"] for row in L1_KNOWN_GAP_LESSON_G4_L02]
    summary = summarize_cells(
        L1_KNOWN_GAP_LESSON_G4_L02,
        _synthetic_l3_pass(cell_ids),
        _synthetic_fig_pass(cell_ids),
    )
    assert summary["known_gap_cells"] == 1
    assert summary["pass_cells"] == 1
    assert summary["fail_cells"] == 0
    assert summary["unknown_cells"] == 0

    fail_reasons = compute_fail_reasons(summary, expected_cells=2)
    assert fail_reasons == []


def test_lesson_with_real_l1_defect_stays_fail_even_with_clean_l3():
    """Red-for-known-bad: a lesson with a real L1_BASE_TEXT_QUALITY failure
    must fail overall_status regardless of downstream L3/figure results —
    known_gap non-blocking must never leak into masking a genuine defect."""
    cell_ids = [row["cell_id"] for row in L1_BAD_LESSON_G4_L24]
    summary = summarize_cells(
        L1_BAD_LESSON_G4_L24,
        _synthetic_l3_pass(cell_ids),
        _synthetic_fig_pass(cell_ids),
    )
    assert summary["fail_cells"] == 2
    assert summary["known_gap_cells"] == 0

    fail_reasons = compute_fail_reasons(summary, expected_cells=2)
    assert any("fail_cells=2" in r for r in fail_reasons)


def test_cell_both_known_gap_and_broken_surfaces_as_fail_not_known_gap():
    """Precedence contract: fail > unknown > known_gap > pass. A cell that is
    BOTH a documented known_gap on one layer AND genuinely broken on another
    layer must never be reported as known_gap (that would let the
    non-blocking known_gap policy fake a pass on a real defect)."""
    cell_ids = ["999:reading-strategy"]
    l1_rows = [
        {
            "cell_id": "999:reading-strategy",
            "status": "known_gap",
            "failure_codes": ["KNOWN_CONTENT_GAP_NO_SPOTLIGHT_SOURCE"],
        }
    ]
    l3_rows = [
        {
            "cell_id": "999:reading-strategy",
            "status": "fail",
            "screenshot": {"bytes": 12345},
            "render": {"console_error_count": 1},
        }
    ]
    fig_rows = _synthetic_fig_pass(cell_ids)

    summary = summarize_cells(l1_rows, l3_rows, fig_rows)
    assert summary["fail_cells"] == 1
    assert summary["known_gap_cells"] == 0

    fail_reasons = compute_fail_reasons(summary, expected_cells=1)
    assert fail_reasons != []


def test_l3_skipped_unknown_dominates_known_gap():
    """Documents why a live `--no-l3` run can never show known_gap_cells>0:
    unknown dominates known_gap in the precedence order, so skipping L3
    (as this sandbox must, absent the browse binary) masks known_gap cells
    into "unknown" rather than surfacing them. This is why the real
    live-staging demo runs alone are insufficient proof of the fix and this
    synthetic-L3 test is needed to complete it."""
    cell_ids = [row["cell_id"] for row in L1_KNOWN_GAP_LESSON_G4_L02]
    l3_skipped_rows = [
        {
            "cell_id": cid,
            "status": "unknown",
            "failure_codes": ["L3_SKIPPED"],
            "screenshot": {"bytes": 0},
            "render": {"console_error_count": 0},
        }
        for cid in cell_ids
    ]
    summary = summarize_cells(
        L1_KNOWN_GAP_LESSON_G4_L02,
        l3_skipped_rows,
        _synthetic_fig_pass(cell_ids),
    )
    assert summary["known_gap_cells"] == 0
    # Both cells get L3_SKIPPED, so both are masked into "unknown" (not just
    # the one that was known_gap) — matches the real demo run's
    # {"unknown_cells": 2, "known_gap_cells": 0} for this exact lesson.
    assert summary["unknown_cells"] == 2

    fail_reasons = compute_fail_reasons(summary, expected_cells=2)
    assert any("unknown_cells=2" in r for r in fail_reasons)


def test_cell_count_mismatch_fails_even_when_all_cells_pass():
    """Fail-closed on missing/extra cells (e.g. a story_id typo silently
    dropping a lesson from the run) must still block, independent of the
    known_gap fix."""
    cell_ids = [row["cell_id"] for row in L1_KNOWN_GAP_LESSON_G4_L02]
    summary = summarize_cells(
        L1_KNOWN_GAP_LESSON_G4_L02,
        _synthetic_l3_pass(cell_ids),
        _synthetic_fig_pass(cell_ids),
    )
    fail_reasons = compute_fail_reasons(summary, expected_cells=3)
    assert any("cell_count" in r for r in fail_reasons)
