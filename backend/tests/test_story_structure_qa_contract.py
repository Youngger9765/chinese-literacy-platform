"""Contract tests for story_structure_qa_lib (L3 interaction_profile gates)."""

import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))
sys.path.insert(0, str(pathlib.Path(__file__).parent.parent.parent / "scripts"))

from app.routes.stories import _format_yaml_structure_table, _sanitize_structure_for_client
from story_structure_qa_lib import (
    LessonTier,
    classify_lesson,
    count_checkbox_cells_in_table,
    gate_l1_pass,
    gate_l3_mode_expectation,
    verify_interaction_profile_contract,
)


def test_profile_contract_mixed():
    structure = {
        "layout": "cards",
        "rows": [
            {"label": "主題", "value": "x", "interactive_type": "fill_blank"},
            {"label": "事實", "value": "y", "interactive_type": "checkbox", "options": ["a"]},
        ],
    }
    client = _sanitize_structure_for_client(structure)
    assert verify_interaction_profile_contract(client) == []
    assert client["interaction_profile"]["mode"] == "mixed"


# The four tests below loaded first-edition fixtures — `_parsed_2026-05-01/G6-L22.yml`,
# `L31.yml`, `G8-L13.yml`, `G7-L6.yml`. The re-ink deleted all of them, so all four had
# been skipping: green, and testing nothing (#2749). Each one stood for a shape, not for
# its lesson, and the shapes are in the served corpus — so that is where they read from
# now, and there is no fixture left to go missing.
def _served_tables():
    """(code, raw_table, client_structure) for every lesson serving a 重點表."""
    from app.services.lesson_loader import get_all_lessons

    out = []
    for lesson in get_all_lessons():
        table = lesson.get("story_structure_table")
        if not table:
            continue
        out.append((
            lesson.get("grade_code"),
            table,
            _sanitize_structure_for_client(_format_yaml_structure_table(table)),
        ))
    return out


def _has_blank_in_label(rows) -> bool:
    for row in rows:
        if row.get("blank_in_label"):
            return True
        if _has_blank_in_label(row.get("sub_rows") or []):
            return True
    return False


def test_psr_templates_are_recognised_in_the_served_corpus():
    """Was pinned to G6-L22 being `template_kind: psr`. The template kinds are a
    closed set the formatter assigns, so the check is that the set is still being
    assigned rather than collapsing to `generic` for everything."""
    kinds = {c["interaction_profile"].get("template_kind") for _, _, c in _served_tables()}
    assert "psr" in kinds, f"no lesson classified psr — template detection may be dead: {kinds}"
    assert len(kinds - {"generic"}) >= 2, f"template kinds collapsed to: {sorted(kinds)}"


def test_a_blank_inside_a_label_is_still_detected():
    """Was pinned to L31. A blank written into the row's label rather than its value
    is the case that needs `blank_in_label`; if detection breaks, the row renders as
    a heading and the student cannot fill it."""
    with_label_blanks = [code for code, _, c in _served_tables() if _has_blank_in_label(c["rows"])]
    assert with_label_blanks, "no lesson has blank_in_label — label-blank detection is dead"
    for code, _, c in _served_tables():
        if _has_blank_in_label(c["rows"]):
            assert c["interaction_profile"]["fill_blank_count"] >= 1, code


def test_checkbox_cells_and_the_profile_agree_lesson_by_lesson():
    """Was pinned to G8-L13. Stronger as a corpus-wide pairing: a table whose YAML
    holds □-marked option cells must produce a non-zero `checkbox_count`, and one
    that holds none must not invent any. Either half failing alone is a parser bug
    that a single-lesson assertion could sit next to without noticing."""
    served = _served_tables()
    disagree = [
        (code, count_checkbox_cells_in_table(table), c["interaction_profile"]["checkbox_count"])
        for code, table, c in served
        if bool(count_checkbox_cells_in_table(table))
        != bool(c["interaction_profile"]["checkbox_count"])
    ]
    assert disagree == [], f"YAML checkbox cells vs profile disagree: {disagree}"
    assert any(count_checkbox_cells_in_table(t) for _, t, _ in served), "no checkbox cells at all"


def test_gate_l1_label_family_warn_only():
    ok, issues = gate_l1_pass({
        "available": True,
        "row_recall": 1.0,
        "blank_recall": 1.0,
        "nesting_preserved": True,
        "label_family_correct": False,
    })
    assert ok is True
    assert any("WARN" in i for i in issues)


def test_g7_l6_classified_docx_keypoints():
    tier = classify_lesson(
        grade_code="G7-L6",
        has_keypoints_yml=True,
        has_structure_table=True,
        has_ai_rows=False,
    )
    assert tier == LessonTier.DOCX_KEYPOINTS


def _source_answerables(node) -> int:
    """How many things the *source* keypoints.yml asks the student to supply.

    Counted from the extracted module, never from the served table — feeding the
    served `fill_blank_count` back in as "what the source had" makes the #2273 rule
    `docx_blanks > 0 and mode == display_only` unreachable: a collapse zeroes both
    sides at once and the assertion passes through the exact regression it is for.
    """
    total = 0
    if isinstance(node, dict):
        for key, value in node.items():
            key = str(key)
            if key in ("blanks",) and isinstance(value, list):
                total += len(value)
            elif key == "options" and value:
                total += 1
            elif key.endswith(("_blanks", "_choices")) and isinstance(value, list):
                total += len(value)
            else:
                total += _source_answerables(value)
    elif isinstance(node, list):
        for value in node:
            total += _source_answerables(value)
    return total


def test_a_lesson_whose_source_has_answerables_never_serves_read_only():
    """Was pinned to G7-L6 with a hand-written `docx_blanks=5`. That is the #2273
    rule — a source with blanks may not render read-only — and it holds for every
    lesson, so it is checked against every lesson, with the blank count read from
    the source module rather than from the output being judged.

    This is the rule that went red on 2026-08-17, alone, when the column-shaped
    tables collapsed into empty display rows that no student could answer.
    """
    from app.services.lesson_uid_loader import load_all

    source = {l["lesson_uid"]: l.get("keypoints") for l in load_all()}
    from app.services.lesson_loader import get_all_lessons

    uid_by_code = {l.get("grade_code"): l.get("lesson_uid") for l in get_all_lessons()}

    served = _served_tables()
    assert served, "no lesson serves a 重點表 at all"
    failures = []
    for code, table, c in served:
        profile = c["interaction_profile"]
        issues = gate_l3_mode_expectation(
            LessonTier.DOCX_KEYPOINTS,
            code,
            profile,
            docx_blanks=_source_answerables(source.get(uid_by_code.get(code))),
            yaml_checkbox_cells=count_checkbox_cells_in_table(table),
        )
        if issues:
            failures.append((code, issues))
    assert failures == [], f"source has answerables but the table serves read-only: {failures}"


def test_gate_l3_checkbox_markers_fail_when_profile_missing():
    table = [["步驟", "提示", "①正確 □②干擾"]]
    issues = gate_l3_mode_expectation(
        LessonTier.DOCX_KEYPOINTS,
        "G8-L13",
        {"mode": "display_only", "checkbox_count": 0},
        yaml_checkbox_cells=count_checkbox_cells_in_table(table),
    )
    assert "docx has checkbox markers but checkbox_count is 0" in issues


def test_gate_l3_checkbox_markers_pass_when_profile_matches():
    table = [["步驟", "提示", "①正確 □②干擾"]]
    issues = gate_l3_mode_expectation(
        LessonTier.DOCX_KEYPOINTS,
        "G8-L13",
        {"mode": "checkbox", "checkbox_count": 1},
        yaml_checkbox_cells=count_checkbox_cells_in_table(table),
    )
    assert issues == []


def test_l5_issues_retriable_session_flake():
    from story_structure_qa_lib import l5_issues_retriable

    assert l5_issues_retriable(["missing data-story-structure-table", "worksheet_table but zero tr"])
    assert l5_issues_retriable(["redirected to login"])
    assert not l5_issues_retriable(["missing data-comprehension-lesson-text"])
    assert not l5_issues_retriable([])


def test_http_retry_wait_s_respects_retry_after():
    from story_structure_qa_lib import STRUCTURE_HTTP_BACKOFF_S, http_retry_wait_s

    assert http_retry_wait_s(0) == STRUCTURE_HTTP_BACKOFF_S[0]
    assert http_retry_wait_s(0, retry_after="90") == 90.0
    assert http_retry_wait_s(len(STRUCTURE_HTTP_BACKOFF_S)) is None
