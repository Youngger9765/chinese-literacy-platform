"""Spotlight QA manifest for admin curriculum dashboard (dev7 + loader)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from app.services.spotlight_contract import (
    DEV7_LESSONS,
    compare_to_gold,
    eval_spotlight_v2,
    load_dev7_spotlight,
    load_gold_manifest,
)

_QA_ROOT = Path(__file__).resolve().parent.parent.parent / "data" / "curriculum_qa"
_MANIFEST = _QA_ROOT / "spotlight_manifest.json"


def build_spotlight_manifest() -> dict[str, Any]:
    gold = load_gold_manifest()
    lessons_out: list[dict[str, Any]] = []
    pass_count = 0

    for lesson_id in DEV7_LESSONS:
        spotlight = load_dev7_spotlight(lesson_id)
        if spotlight is None:
            lessons_out.append({
                "lesson_id": lesson_id,
                "overall_pass": False,
                "error": "missing spotlight yaml",
            })
            continue

        eval_result = eval_spotlight_v2(spotlight, lesson_id=lesson_id)
        gold_cmp = compare_to_gold(lesson_id, spotlight, gold["lessons"].get(lesson_id))
        overall = bool(eval_result.get("pass") and gold_cmp.get("match"))
        if overall:
            pass_count += 1

        lessons_out.append({
            "lesson_id": lesson_id,
            "strategy_type": spotlight.get("strategy_type"),
            "block_count": eval_result.get("block_count"),
            "overall_pass": overall,
            "eval": {
                "pass": eval_result.get("pass"),
                "guide_retained": eval_result.get("guide_retained"),
                "answer_recall": eval_result.get("answer_recall"),
                "mcq_leakage": eval_result.get("mcq_leakage"),
                "struct_errors": eval_result.get("struct_errors"),
                "semantic": eval_result.get("semantic"),
                "acceptance": eval_result.get("acceptance"),
            },
            "gold": {
                "match": gold_cmp.get("match"),
                "diffs": gold_cmp.get("diffs"),
            },
            "type_histogram": eval_result.get("type_histogram"),
        })

    return {
        "schema_version": 1,
        "lessons": lessons_out,
        "summary": {
            "total": len(lessons_out),
            "pass": pass_count,
            "fail": len(lessons_out) - pass_count,
        },
    }


def load_spotlight_manifest() -> dict[str, Any]:
    if _MANIFEST.exists():
        return json.loads(_MANIFEST.read_text(encoding="utf-8"))
    return build_spotlight_manifest()


def get_spotlight_lesson(lesson_id: str) -> dict[str, Any] | None:
    manifest = load_spotlight_manifest()
    for lesson in manifest.get("lessons") or []:
        if lesson.get("lesson_id") == lesson_id:
            spotlight = load_dev7_spotlight(lesson_id)
            return {**lesson, "spotlight": spotlight}
    return None
