"""Story Structure Lab — aggregate loader YAML, keypoints, structure API, QA gates."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

import yaml

from app.routes.stories import _format_yaml_structure_table, _sanitize_structure_for_client
from app.services.lesson_code_normalization import (
    catalog_to_parsed_code,
    normalize_manifest_code,
)
from app.services.lesson_loader import get_all_lessons, get_lesson_by_id

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
_SCRIPTS = _REPO_ROOT / "scripts"
if str(_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS))

from story_structure_qa_lib import (  # noqa: E402
    CHECKBOX_GAP_LESSONS,
    REPRESENTATIVE_LESSONS,
    LessonTier,
    PARSER_GAP_LESSONS,
    classify_lesson,
    gate_l3_mode_expectation,
    verify_interaction_profile_contract,
)

_SCHEMA_DIR = _REPO_ROOT / "private" / "curriculum-source" / "_online-schema"
_QA_REPORT_PATH = _SCHEMA_DIR / "story_structure_qa_report.json"
_PINNED_STORY_IDS = {item["story_id"] for item in REPRESENTATIVE_LESSONS}


def _load_qa_report() -> dict[str, Any] | None:
    if not _QA_REPORT_PATH.exists():
        return None
    try:
        return json.loads(_QA_REPORT_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def _qa_gates_for_story(story_id: int, report: dict[str, Any] | None) -> dict[str, Any]:
    if not report:
        return {}
    merged: dict[str, Any] = {}
    for row in report.get("per_lesson_docx") or []:
        if row.get("story_id") == story_id:
            merged.update(row.get("gates") or {})
    for row in report.get("staging") or []:
        if row.get("id") == story_id:
            merged.update(row.get("gates") or {})
    return merged


def _parsed_code_for_lesson(lesson: dict) -> str | None:
    catalog = normalize_manifest_code(lesson.get("grade_code") or lesson.get("lesson_code") or "")
    if not catalog:
        return None
    return catalog_to_parsed_code(catalog)


def _keypoints_path(parsed_code: str | None) -> Path | None:
    if not parsed_code:
        return None
    path = _SCHEMA_DIR / f"{parsed_code}.keypoints.yml"
    return path if path.exists() else None


def _read_keypoints(parsed_code: str | None) -> dict[str, Any] | None:
    path = _keypoints_path(parsed_code)
    if not path:
        return None
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f)


def _build_structure_views(lesson: dict) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    """Return (grading_structure_with_answers, client_sanitized_structure)."""
    if lesson.get("story_structure_table"):
        grading = _format_yaml_structure_table(lesson["story_structure_table"])
        client = _sanitize_structure_for_client(grading)
        return grading, client
    if lesson.get("story_structure_rows"):
        base = {"rows": lesson["story_structure_rows"]}
        client = _sanitize_structure_for_client(base)
        return base, client
    return None, None


def _classify_loader_lesson(lesson: dict, parsed_code: str | None) -> LessonTier:
    has_kp = bool(parsed_code and _keypoints_path(parsed_code))
    has_table = bool(lesson.get("story_structure_table"))
    has_ai = bool(lesson.get("story_structure_rows") and not has_table)
    return classify_lesson(
        grade_code=parsed_code or lesson.get("grade_code") or "",
        has_keypoints_yml=has_kp,
        has_structure_table=has_table,
        has_ai_rows=has_ai,
        docx_keypoints_available=has_kp or None,
    )


def _is_known_data_gap(tier: LessonTier, parsed_code: str | None, profile: dict[str, Any]) -> bool:
    if tier == LessonTier.PARSER_GAP:
        return True
    if parsed_code in CHECKBOX_GAP_LESSONS and profile.get("mode") == "display_only":
        return True
    return False


def _live_l3_qa(client_structure: dict[str, Any] | None, tier: LessonTier, parsed_code: str | None) -> dict[str, Any]:
    if not client_structure:
        return {"gate": "L3_live", "pass": False, "issues": ["no structure"]}
    issues = verify_interaction_profile_contract(client_structure)
    profile = client_structure.get("interaction_profile") or {}
    issues.extend(gate_l3_mode_expectation(tier, parsed_code or "", profile))
    return {"gate": "L3_live", "pass": len(issues) == 0, "issues": issues}


def build_lab_index() -> dict[str, Any]:
    report = _load_qa_report()
    lessons_out: list[dict[str, Any]] = []
    tier_counts: dict[str, int] = {}

    for lesson in get_all_lessons():
        story_id = lesson["id"]
        parsed_code = _parsed_code_for_lesson(lesson)
        catalog_code = lesson.get("grade_code") or lesson.get("lesson_code")
        tier = _classify_loader_lesson(lesson, parsed_code)
        tier_counts[tier.value] = tier_counts.get(tier.value, 0) + 1

        _, client = _build_structure_views(lesson)
        profile = (client or {}).get("interaction_profile") or {}
        qa_gates = _qa_gates_for_story(story_id, report)
        live_l3 = _live_l3_qa(client, tier, parsed_code)
        known_gap = _is_known_data_gap(tier, parsed_code, profile)
        overall_pass = (
            not known_gap
            and live_l3["pass"]
            and all(g.get("pass", True) for g in qa_gates.values())
        )

        lessons_out.append(
            {
                "story_id": story_id,
                "title": lesson.get("title") or "",
                "grade": lesson.get("grade"),
                "catalog_code": catalog_code,
                "parsed_code": parsed_code,
                "tier": tier.value,
                "has_structure_table": bool(lesson.get("story_structure_table")),
                "has_story_structure_rows": bool(lesson.get("story_structure_rows")),
                "has_keypoints_yml": bool(parsed_code and _keypoints_path(parsed_code)),
                "interaction_profile": profile,
                "qa_gates": {**qa_gates, "L3_live": live_l3},
                "known_data_gap": known_gap,
                "overall_pass": overall_pass,
                "pinned": story_id in _PINNED_STORY_IDS,
            }
        )

    lessons_out.sort(key=lambda x: (x.get("grade") or 0, x.get("catalog_code") or ""))

    return {
        "total": len(lessons_out),
        "tier_counts": tier_counts,
        "representative_lessons": list(REPRESENTATIVE_LESSONS),
        "qa_report_available": report is not None,
        "lessons": lessons_out,
    }


def build_lab_detail(story_id: int) -> dict[str, Any] | None:
    lesson = get_lesson_by_id(story_id)
    if not lesson:
        return None

    parsed_code = _parsed_code_for_lesson(lesson)
    catalog_code = lesson.get("grade_code") or lesson.get("lesson_code")
    tier = _classify_loader_lesson(lesson, parsed_code)
    grading, client = _build_structure_views(lesson)
    keypoints = _read_keypoints(parsed_code)
    report = _load_qa_report()
    qa_gates = _qa_gates_for_story(story_id, report)
    live_l3 = _live_l3_qa(client, tier, parsed_code)
    profile = (client or {}).get("interaction_profile") or {}
    known_gap = _is_known_data_gap(tier, parsed_code, profile)

    return {
        "story_id": story_id,
        "title": lesson.get("title") or "",
        "grade": lesson.get("grade"),
        "catalog_code": catalog_code,
        "parsed_code": parsed_code,
        "tier": tier.value,
        "pinned": story_id in _PINNED_STORY_IDS,
        "known_data_gap": known_gap,
        "yaml_table": lesson.get("story_structure_table"),
        "yaml_rows": lesson.get("story_structure_rows"),
        "keypoints": keypoints,
        "structure_grading": grading,
        "structure": client,
        "interaction_profile": (client or {}).get("interaction_profile"),
        "qa_gates": {**qa_gates, "L3_live": live_l3},
        "artifacts": {
            "has_keypoints_yml": bool(keypoints),
            "keypoints_path": str(_keypoints_path(parsed_code)) if parsed_code else None,
            "qa_report_available": report is not None,
        },
    }
