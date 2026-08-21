"""Corpus-wide audit of the keypoints-table (重點表) module — issue TBD.

Walks every lesson's *served* structure (same functions the API calls:
``_format_yaml_structure_table`` + ``_sanitize_structure_for_client``) and
flags three defect classes found first on L0011 (story 20011):

  A) single-blank fill_blank fields — the frontend's `answerKey` write path
     (InlineWorksheetContent) always suffixes a blank index, but the read
     path (tallyCell / pushFillBlankAnswers) drops the suffix when there is
     exactly one blank. Every such field can never count as "answered" and
     is submitted as an empty string for grading. This is a *frontend* bug
     but the count here is "how many fields are exposed to it", which sets
     the blast radius.
  B) checkbox cells whose value still carries "第X個空格" — the sentence had
     two or more blanks, each with its own small option set, and got
     collapsed into ONE flat checkbox list, so the options are unlabeled
     and the sentence context disappears from the table entirely.
  C) checkbox cells whose value says "單選" (single-select) but render as
     an unconstrained multi-select checkbox group (no single-select
     enforcement exists anywhere in `CheckboxCell`).

Usage:
    PYTHONPATH=. python scripts/audit_keypoints_table_defects.py [--json out.json]

Must run inside backend/ with the project's venv (imports app.*).
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.routes.stories import _format_yaml_structure_table, _sanitize_structure_for_client  # noqa: E402
from app.services.lesson_loader import search_lessons  # noqa: E402

_BLANK_RE = re.compile(r"【([^】]*)】")
_INSTRUCTION_WORDS = ("單選", "多選", "複選", "勾選", "打勾")
_INLINE_SLOT_RE = re.compile(r"第[一二三四五六七八九十\d]+個空格")


def _count_real_blanks(text: str) -> int:
    return sum(
        1 for m in _BLANK_RE.finditer(text or "")
        if not any(w in m.group(1) for w in _INSTRUCTION_WORDS)
    )


def _is_single_select_instruction(text: str) -> bool:
    return "單選" in (text or "") and "多選" not in (text or "") and "複選" not in (text or "")


def _walk(rows: list[dict]):
    """Yield (row_label, cell_dict, is_sub) for every leaf cell (row or sub_row)."""
    for row in rows or []:
        sub_rows = row.get("sub_rows") or []
        if sub_rows:
            for sub in sub_rows:
                yield row.get("label"), sub, True
        else:
            yield None, row, False


def audit_lesson(story: dict) -> dict:
    table = story.get("story_structure_table")
    findings = {
        "lesson_id": story.get("id"),
        "title": story.get("title"),
        "bug_a_single_blank_fields": [],
        "bug_b_inline_choice_swallowed": [],
        "bug_c_single_select_as_multi": [],
        "inline_choice_fields": [],
    }
    if not table:
        findings["has_table"] = False
        return findings
    findings["has_table"] = True

    formatted = _format_yaml_structure_table(table)
    served = _sanitize_structure_for_client(formatted)

    for section_label, cell, is_sub in _walk(served.get("rows") or []):
        label = cell.get("label") or section_label or "(no label)"
        itype = cell.get("interactive_type")
        value = cell.get("value") or ""

        if itype == "fill_blank":
            n = _count_real_blanks(value) or (len(cell.get("blank_hints") or []) or 1)
            if n <= 1:
                findings["bug_a_single_blank_fields"].append(label)

        elif itype == "checkbox":
            if _INLINE_SLOT_RE.search(value):
                findings["bug_b_inline_choice_swallowed"].append(
                    {"label": label, "options": cell.get("options")}
                )
            if _is_single_select_instruction(value) and cell.get("select_mode") != "single":
                findings["bug_c_single_select_as_multi"].append(
                    {"label": label, "options": cell.get("options")}
                )

        elif itype == "inline_choice":
            # #2776 fix landed: sentences with per-blank option groups are now
            # their own type instead of being flattened into a checkbox. Not
            # a defect bucket — counted separately so the "before" and
            # "after" runs of this script are directly comparable.
            findings.setdefault("inline_choice_fields", []).append(
                {"label": label, "blanks": cell.get("blanks")}
            )

    return findings


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", type=Path, default=None)
    args = parser.parse_args()

    lessons = search_lessons()
    results = [audit_lesson(story) for story in lessons]

    with_table = [r for r in results if r["has_table"]]
    a_count = sum(1 for r in with_table if r["bug_a_single_blank_fields"])
    a_fields = sum(len(r["bug_a_single_blank_fields"]) for r in with_table)
    b_count = sum(1 for r in with_table if r["bug_b_inline_choice_swallowed"])
    b_cells = sum(len(r["bug_b_inline_choice_swallowed"]) for r in with_table)
    c_count = sum(1 for r in with_table if r["bug_c_single_select_as_multi"])
    c_cells = sum(len(r["bug_c_single_select_as_multi"]) for r in with_table)

    print(f"lessons total={len(results)} with_story_structure_table={len(with_table)}")
    print(f"BUG A (single-blank field, denominator/submit key mismatch): "
          f"{a_count} 課 / {a_fields} 處")
    print(f"BUG B (inline-choice sentence swallowed into flat checkbox): "
          f"{b_count} 課 / {b_cells} 處")
    print(f"BUG C (單選 instruction rendered as unconstrained multi-select): "
          f"{c_count} 課 / {c_cells} 處")

    if args.json:
        args.json.write_text(json.dumps(results, ensure_ascii=False, indent=2))
        print(f"wrote {args.json}")


if __name__ == "__main__":
    main()
