"""Spec contracts for spotlight v2 block schemas (professor dev7).

Regression strategy (3 layers):
  1. Gold fingerprint — checked-in YAML must match gold_manifest.json byte-for-byte metrics
  2. Eval gates — guide_retained, answer_recall, mcq_leakage, struct validity
  3. Loader wiring — dev7 lesson codes expose spotlight_v2 on lesson dict

Run:
    cd backend && python -m pytest specs/test_spotlight_v2_spec.py -v
"""

import json

import pytest

from app.services.spotlight_contract import (
    DEV7_LESSONS,
    TEST15_CATALOG_CODES,
    TEST15_LESSONS,
    compare_to_gold,
    count_mcq_option_guides,
    eval_spotlight_v2,
    load_dev7_spotlight,
    load_gold_manifest,
    load_test15_gold_manifest,
    load_test15_spotlight,
    semantic_eval_spotlight,
    validate_block_structure,
)
from app.services.spotlight_v2_loader import is_spotlight_v2_lesson, load_spotlight_v2


@pytest.fixture(scope="module")
def gold_manifest() -> dict:
    return load_gold_manifest()


@pytest.fixture(scope="module")
def test15_gold_manifest() -> dict:
    return load_test15_gold_manifest()


@pytest.mark.parametrize("lesson_id", DEV7_LESSONS)
def test_dev7_fixture_exists(lesson_id: str):
    sp = load_dev7_spotlight(lesson_id)
    assert sp is not None, f"missing fixture {lesson_id}.spotlight.yml"
    assert sp.get("blocks"), f"{lesson_id}: empty blocks"


@pytest.mark.parametrize("lesson_id", DEV7_LESSONS)
def test_dev7_gold_fingerprint(lesson_id: str, gold_manifest: dict):
    sp = load_dev7_spotlight(lesson_id)
    result = compare_to_gold(lesson_id, sp, gold_manifest["lessons"][lesson_id])
    assert result["match"], f"{lesson_id} gold drift: {result.get('diffs')}"


@pytest.mark.parametrize("lesson_id", DEV7_LESSONS)
def test_dev7_eval_passes(lesson_id: str):
    sp = load_dev7_spotlight(lesson_id)
    ev = eval_spotlight_v2(sp, lesson_id)
    assert ev["guide_retained"], f"{lesson_id}: no guide blocks"
    assert ev["mcq_leakage"] == 0, f"{lesson_id}: MCQ leaked into spotlight"
    assert ev["answer_recall"] >= 0.99, f"{lesson_id}: null answers in single/multi"
    assert ev["pass"], f"{lesson_id}: struct/semantic errors {ev.get('struct_errors')} {ev.get('semantic')}"


def test_g6_l22_teaching_context_preserved():
    """G6-L22 must keep opening pedagogical guide (not flattened to MCQ-only)."""
    sp = load_dev7_spotlight("G6-L22")
    guides = [b for b in sp["blocks"] if b["type"] == "guide"]
    assert any("好故事" in g.get("text", "") for g in guides)
    assert any(b["type"] == "passage" for b in sp["blocks"])


def test_g6_l22_has_supplementary_passages():
    sp = load_dev7_spotlight("G6-L22")
    passages = [b for b in sp["blocks"] if b["type"] == "passage"]
    flat = " ".join(" ".join(p.get("paragraphs", [])) for p in passages)
    assert "孟嘗君" in flat or "大象" in flat


def test_g7_l29_mcq_options_not_guides():
    """G7-L29 had 80 guides / 1 single before MCQ coalesce fix."""
    sp = load_dev7_spotlight("G7-L29")
    sem = semantic_eval_spotlight("G7-L29", sp)
    assert sem["single_count"] >= 15
    assert count_mcq_option_guides(sp["blocks"]) == 0


def test_g6_l22_mengchang_story_has_interactive_singles():
    """孟嘗君 passage must be followed by ❶❷❸❹ singles, not static guide text."""
    sp = load_dev7_spotlight("G6-L22")
    blocks = sp["blocks"]
    pivot = next(
        i for i, b in enumerate(blocks)
        if b.get("type") == "guide" and "接下來，我們來看課文的故事" in b.get("text", "")
    )
    following = blocks[pivot + 1 : pivot + 8]
    assert following[0]["type"] == "passage"
    singles = [b for b in following if b["type"] == "single"]
    assert len(singles) >= 3
    assert any(
        any("孟嘗君" in opt for opt in (b.get("options") or []))
        for b in singles
    )


@pytest.mark.parametrize("lesson_id", DEV7_LESSONS)
def test_loader_exposes_spotlight_v2(lesson_id: str):
    assert is_spotlight_v2_lesson(lesson_id)
    loaded = load_spotlight_v2(lesson_id)
    assert loaded is not None
    assert loaded.get("strategy_type")


def test_non_dev7_lesson_returns_none():
    assert not is_spotlight_v2_lesson("G4-L1")
    assert load_spotlight_v2("G4-L1") is None


@pytest.mark.parametrize("catalog_code", sorted(TEST15_CATALOG_CODES))
def test_test15_loader_exposes_spotlight_v2(catalog_code: str):
    assert is_spotlight_v2_lesson(catalog_code)
    loaded = load_spotlight_v2(catalog_code)
    assert loaded is not None
    assert loaded.get("strategy_type")
    assert loaded.get("blocks")


@pytest.mark.parametrize("fixture_id", TEST15_LESSONS)
def test_test15_fixture_exists(fixture_id: str):
    sp = load_test15_spotlight(fixture_id)
    assert sp is not None, f"missing fixture {fixture_id}.spotlight.yml"
    assert sp.get("blocks"), f"{fixture_id}: empty blocks"


@pytest.mark.parametrize("fixture_id", TEST15_LESSONS)
def test_test15_gold_fingerprint(fixture_id: str, test15_gold_manifest: dict):
    sp = load_test15_spotlight(fixture_id)
    result = compare_to_gold(
        fixture_id,
        sp,
        test15_gold_manifest["lessons"][fixture_id],
    )
    assert result["match"], f"{fixture_id} gold drift: {result.get('diffs')}"


@pytest.mark.parametrize("fixture_id", TEST15_LESSONS)
def test_test15_eval_passes(fixture_id: str):
    sp = load_test15_spotlight(fixture_id)
    ev = eval_spotlight_v2(sp, fixture_id)
    assert ev["guide_retained"], f"{fixture_id}: no guide blocks"
    assert ev["mcq_leakage"] == 0, f"{fixture_id}: MCQ leaked into spotlight"
    assert ev["answer_recall"] >= 0.99, f"{fixture_id}: null answers in single/multi"
    assert ev["pass"], (
        f"{fixture_id}: struct/semantic errors "
        f"{ev.get('struct_errors')} {ev.get('semantic')}"
    )


def test_g4_l10_catalog_code_loads_test15_fixture():
    loaded = load_spotlight_v2("G4-L10")
    assert loaded is not None
    assert "美好的一天" in " ".join(
        " ".join(b.get("paragraphs") or [])
        for b in loaded.get("blocks") or []
        if b.get("type") == "passage"
    ) or any(
        "情緒" in (b.get("text") or "")
        for b in loaded.get("blocks") or []
        if b.get("type") == "guide"
    )


def test_g8_l3b_maps_to_test15_plant_meat_fixture():
    loaded = load_spotlight_v2("G8-L3b")
    assert loaded is not None
    guides = [b.get("text", "") for b in loaded["blocks"] if b["type"] == "guide"]
    assert any("植物肉" in g for g in guides)


def test_layer1_g6_l03_lesson_dict_has_spotlight_v2():
    from app.services.lesson_loader import get_lesson_by_code

    lesson = get_lesson_by_code("G6-L03")
    assert lesson is not None
    sp = lesson.get("spotlight_v2")
    assert sp is not None
    assert sp.get("strategy_type") == "scientific_inquiry"


def test_validate_rejects_empty_guide():
    errors = validate_block_structure([{"type": "guide", "text": "  "}])
    assert any("guide missing text" in e for e in errors)


def test_gold_manifest_covers_all_dev7(gold_manifest: dict):
    assert set(gold_manifest["lessons"].keys()) == set(DEV7_LESSONS)


def test_test15_gold_manifest_covers_all_test15(test15_gold_manifest: dict):
    assert set(test15_gold_manifest["lessons"].keys()) == set(TEST15_LESSONS)


def test_catalog_manifest_matches_files_if_present():
    from pathlib import Path

    from app.services.spotlight_contract import CATALOG_DIR, CATALOG_MANIFEST, load_catalog_spotlight

    if not CATALOG_MANIFEST.exists():
        pytest.skip("catalog not promoted yet")
    manifest = json.loads(CATALOG_MANIFEST.read_text(encoding="utf-8"))
    codes = manifest.get("lessons") or []
    assert len(codes) >= 80, f"expected bulk catalog, got {len(codes)}"
    sample = codes[0]
    sp = load_catalog_spotlight(sample)
    assert sp is not None and sp.get("blocks"), sample
    assert (CATALOG_DIR / f"{sample}.spotlight.yml").exists()
