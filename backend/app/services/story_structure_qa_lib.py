"""Shared story-structure QA logic (see docs/qa/story-structure-verification-standard.md)."""

from __future__ import annotations

import re
from enum import Enum
from typing import Any

from app.services.story_structure_cell_parser import parse_checkbox_options

# Known parser gaps — empty after cell_to_structure_fields wired
PARSER_GAP_LESSONS = frozenset()

# Legacy: checkbox lessons that were display_only before parser fix
CHECKBOX_GAP_LESSONS = frozenset()

# Parsed YAML / DOCX lesson ids (not catalog grade_code — see REPRESENTATIVE_LESSONS)
SMOKE_LESSONS = ("G6-L22", "G7-L28", "G4-L1", "G4-L6", "G7-L6")

# Pinned lessons for Story Structure Lab + manual regression (parsed ↔ catalog ↔ story_id)
REPRESENTATIVE_LESSONS: tuple[dict[str, Any], ...] = (
    {
        "parsed_code": "G6-L22",
        "catalog_code": "G6-L22",
        "story_id": 1076,
        "note": "nested PSR + worksheet_table + fill_blank",
    },
    {
        "parsed_code": "G4-L1",
        "catalog_code": "G4-L1",
        "story_id": 1001,
        "note": "theme_facts + multi-row worksheet",
    },
    {
        "parsed_code": "G7-L6",
        "catalog_code": "G7-L06",
        "story_id": 31,
        "note": "label_blanks + worksheet_table fill_blank",
    },
    {
        "parsed_code": "G8-L13",
        "catalog_code": "G8-L10",
        "story_id": 1123,
        "note": "nested scientific + checkbox in value cells",
    },
    {
        "parsed_code": "G8-L14",
        "catalog_code": "G8-L11",
        "story_id": 1124,
        "note": "checkbox worksheet_table (same class as G8-L13)",
    },
    {
        "parsed_code": "G4-L6",
        "catalog_code": "G4-L6",
        "story_id": 1006,
        "note": "ai_fallback + mixed fill_blank/checkbox",
    },
    {
        "parsed_code": "G7-L28",
        "catalog_code": "G7-L28",
        "story_id": 1108,
        "note": "scientific inquiry + image_text DOM",
    },
)

IMAGE_TEXT_LESSONS = frozenset({"G7-L28", "G7-L29", "G7-L30"})


class LessonTier(str, Enum):
    DOCX_KEYPOINTS = "docx_keypoints"
    AI_FALLBACK = "ai_fallback"
    NO_KEYPOINTS_DOCX = "no_keypoints_docx"
    PARSER_GAP = "parser_gap"
    NO_STRUCTURE = "no_structure"


def classify_lesson(
    *,
    grade_code: str,
    has_keypoints_yml: bool,
    has_structure_table: bool,
    has_ai_rows: bool,
    docx_keypoints_available: bool | None = None,
) -> LessonTier:
    code = grade_code or ""
    if code in PARSER_GAP_LESSONS:
        return LessonTier.PARSER_GAP
    if has_structure_table and has_keypoints_yml:
        return LessonTier.DOCX_KEYPOINTS
    if has_structure_table:
        return LessonTier.DOCX_KEYPOINTS
    # Multi-text lessons (one DOCX → several curriculum slots, e.g. G4-L20-22)
    # parse to a compound YAML (G4-L20-22.yml), so the single-slot lookup
    # (expected_parsed_yaml_path("G4-L20")) returns None and has_structure_table
    # is False — even though the keypoints schema was extracted and the loader
    # serves a structure table at runtime. Keypoints availability, not the
    # presence of a single-slot parsed table on disk, decides whether the L1
    # 重點表 gate must run. Treat any lesson with an extracted keypoints schema
    # as DOCX_KEYPOINTS so its L1 verdict is recorded (no silent gate skip).
    if docx_keypoints_available is True:
        return LessonTier.DOCX_KEYPOINTS
    if has_ai_rows:
        return LessonTier.AI_FALLBACK
    if docx_keypoints_available is False:
        return LessonTier.NO_KEYPOINTS_DOCX
    return LessonTier.NO_STRUCTURE


def count_interactive_types(rows: list[dict]) -> tuple[int, int, int]:
    """Return (fill_blank, checkbox, display) counts including sub_rows."""
    fill_blank = checkbox = display = 0

    def tally(row: dict) -> None:
        nonlocal fill_blank, checkbox, display
        itype = row.get("interactive_type")
        if itype == "fill_blank":
            fill_blank += 1
        elif itype == "checkbox":
            checkbox += 1
        else:
            display += 1

    for row in rows:
        subs = row.get("sub_rows") or []
        if subs:
            for sub in subs:
                tally(sub)
        else:
            tally(row)
    return fill_blank, checkbox, display


def derive_mode(fill_blank: int, checkbox: int) -> str:
    if fill_blank and checkbox:
        return "mixed"
    if fill_blank:
        return "fill_blank"
    if checkbox:
        return "checkbox"
    return "display_only"


def verify_interaction_profile_contract(structure: dict) -> list[str]:
    """L3: interaction_profile must match rows; answers must not leak."""
    errors: list[str] = []
    rows = structure.get("rows") or []
    if not rows:
        errors.append("rows empty")
        return errors

    profile = structure.get("interaction_profile")
    if not profile:
        errors.append("missing interaction_profile")
        return errors

    fb, cb, _disp = count_interactive_types(rows)
    expected_mode = derive_mode(fb, cb)

    if profile.get("mode") != expected_mode:
        errors.append(f"profile.mode {profile.get('mode')} != {expected_mode}")
    if profile.get("fill_blank_count") != fb:
        errors.append(f"fill_blank_count {profile.get('fill_blank_count')} != {fb}")
    if profile.get("checkbox_count") != cb:
        errors.append(f"checkbox_count {profile.get('checkbox_count')} != {cb}")

    layout = structure.get("layout")
    expected_layout = profile.get("layout")
    if layout and expected_layout and layout != expected_layout:
        errors.append(f"layout {layout} != profile.layout {expected_layout}")

    # Answer leak check
    answer_pat = re.compile(r"【\s*[^】\s　][^】]*】")

    def check_value(val: str, ctx: str) -> None:
        if answer_pat.search(val or ""):
            errors.append(f"answer leak in {ctx}")

    for i, row in enumerate(rows):
        if row.get("interactive_type") == "fill_blank":
            check_value(str(row.get("value") or ""), f"rows[{i}].value")
            if row.get("blank_in_label"):
                check_value(str(row.get("label") or ""), f"rows[{i}].label")
        for j, sub in enumerate(row.get("sub_rows") or []):
            if sub.get("interactive_type") == "fill_blank":
                check_value(str(sub.get("value") or ""), f"rows[{i}].sub_rows[{j}].value")
                if sub.get("blank_in_label"):
                    check_value(str(sub.get("label") or ""), f"rows[{i}].sub_rows[{j}].label")

    return errors


def count_checkbox_cells_in_table(table: list | None) -> int:
    """Count YAML cells that parse as checkbox (□ + circled option numbers)."""
    if not table:
        return 0
    count = 0
    for row in table:
        if not isinstance(row, list):
            continue
        for cell in row:
            if isinstance(cell, str) and parse_checkbox_options(cell):
                count += 1
    return count


def gate_l1_pass(keypoints_eval: dict) -> tuple[bool, list[str]]:
    if not keypoints_eval.get("available"):
        return True, ["N/A no docx keypoints table"]
    issues: list[str] = []
    if keypoints_eval.get("row_recall", 0) < 0.95:
        issues.append(f"row_recall={keypoints_eval.get('row_recall')}")
    if keypoints_eval.get("blank_recall", 0) < 0.95:
        issues.append(f"blank_recall={keypoints_eval.get('blank_recall')}")
    if not keypoints_eval.get("nesting_preserved"):
        issues.append("nesting_preserved=false")
    if not keypoints_eval.get("label_family_correct"):
        issues.append("WARN label_family_correct=false")
    hard = [x for x in issues if not x.startswith("WARN")]
    return len(hard) == 0, issues


def gate_l3_mode_expectation(
    tier: LessonTier,
    grade_code: str,
    profile: dict,
    docx_blanks: int | None = None,
    yaml_checkbox_cells: int | None = None,
) -> list[str]:
    """Extra L3 rules per tier."""
    errors: list[str] = []
    mode = profile.get("mode")
    checkbox_count = profile.get("checkbox_count") or 0
    if tier == LessonTier.PARSER_GAP:
        if mode != "display_only":
            errors.append(f"parser_gap expected display_only, got {mode}")
        return errors
    if tier == LessonTier.AI_FALLBACK:
        if mode == "display_only":
            errors.append("ai_fallback should be interactive")
        return errors
    if tier == LessonTier.DOCX_KEYPOINTS:
        if grade_code in PARSER_GAP_LESSONS:
            return errors
        if docx_blanks and docx_blanks > 0 and mode == "display_only":
            errors.append("docx has blanks but mode is display_only")
        if yaml_checkbox_cells and yaml_checkbox_cells > 0 and checkbox_count == 0:
            errors.append("docx has checkbox markers but checkbox_count is 0")
    return errors


def expected_ui_dom(profile: dict) -> dict[str, bool]:
    """L5: which DOM checks apply for this profile."""
    mode = profile.get("mode", "display_only")
    return {
        "require_table": True,
        "require_interactive": mode in ("fill_blank", "checkbox", "mixed"),
        "require_lesson_text": False,  # set per-lesson for image_text
        "allow_zero_tr": profile.get("layout") == "cards",
    }


def ui_pass_from_dom(state: dict, profile: dict, *, require_lesson_text: bool = False) -> tuple[bool, list[str]]:
    issues: list[str] = []
    if state.get("login"):
        issues.append("redirected to login")
    if state.get("err"):
        issues.append("load error banner")
    if state.get("loading"):
        issues.append("still loading")
    if not state.get("hasTable"):
        issues.append("missing data-story-structure-table")

    exp = expected_ui_dom(profile)
    if require_lesson_text and not state.get("hasLessonText"):
        issues.append("missing data-comprehension-lesson-text")

    if exp["require_interactive"]:
        if not state.get("hasInteractive") and not state.get("hasCheckbox"):
            issues.append("missing interactive element")

    if not exp["allow_zero_tr"] and profile.get("layout") == "worksheet_table":
        if state.get("rowCount", 0) == 0:
            issues.append("worksheet_table but zero tr")

    return len(issues) == 0, issues


# L5 browser session flakes: empty DOM after silent relogin failure (issue #2307)
L5_SESSION_FLAKE_ISSUES = frozenset(
    {
        "redirected to login",
        "load error banner",
        "still loading",
        "missing data-story-structure-table",
        "missing interactive element",
        "worksheet_table but zero tr",
    }
)


def l5_issues_retriable(issues: list[str]) -> bool:
    """True when L5 FAIL is likely stale browse session, not lesson data."""
    return bool(issues) and any(i in L5_SESSION_FLAKE_ISSUES for i in issues)


# Staging GET /structure returns 429 when AI cache-miss rate limit trips (5/min)
STRUCTURE_HTTP_RETRY_CODES = frozenset({429, 503})
STRUCTURE_HTTP_BACKOFF_S = (2, 5, 15, 30, 65)


def http_retry_wait_s(attempt: int, *, retry_after: str | None = None) -> float | None:
    """Seconds to wait before retry attempt index (0-based), or None if exhausted."""
    if attempt >= len(STRUCTURE_HTTP_BACKOFF_S):
        return None
    wait = float(STRUCTURE_HTTP_BACKOFF_S[attempt])
    if retry_after:
        try:
            wait = max(wait, float(retry_after))
        except ValueError:
            pass
    return wait


def summarize_gate(gate: str, passed: bool, issues: list[str]) -> dict[str, Any]:
    return {"gate": gate, "pass": passed, "issues": issues}
