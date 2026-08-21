"""TDD contract: canonical spotlight block model (role × interaction × eval).

G6-L22 (小兵立大功) is the vertical-slice acceptance lesson.
Run: cd backend && python -m pytest specs/test_spotlight_block_model_spec.py -v
"""

from __future__ import annotations

import pytest

from app.services.spotlight_block_model import (
    ALLOWED_ROLE_INTERACTION,
    G6_L22_ACCEPTANCE,
    canonical_fingerprint,
    eval_g6_l22_acceptance,
    normalize_block,
    normalize_spotlight_blocks,
    validate_canonical_block,
)
from app.services.spotlight_contract import load_dev7_spotlight
from app.services.spotlight_v2_loader import load_spotlight_v2


# ── normalize (legacy type → canonical) ─────────────────────────────────────


def test_normalize_guide_stays_guide():
    c = normalize_block({"type": "guide", "text": "好故事，大家都愛看。"})
    assert c["role"] == "guide"
    assert c.get("interaction") is None


def test_normalize_section_header_from_guide_or_free_text():
    c = normalize_block({"type": "guide", "text": "1.讓我們來看課文另一個故事"})
    assert c["role"] == "section"
    assert c.get("interaction") is None

    c2 = normalize_block({"type": "free_text", "prompt": "2.進階挑戰：大象有多重？"})
    assert c2["role"] == "section"


def test_normalize_bridge_phrase():
    c = normalize_block({"type": "guide", "text": "接下來，我們來看課文的故事"})
    assert c["role"] == "bridge"


def test_normalize_single_to_exercise_select_one():
    c = normalize_block({
        "type": "single",
        "prompt": "❶主角是誰？",
        "options": ["秦昭王", "孟嘗君"],
        "answer": "孟嘗君",
    })
    assert c["role"] == "exercise"
    assert c["interaction"] == "select_one"
    assert c["eval"] == "exact"
    assert c["answer"]["kind"] == "choice_text"
    assert c["answer"]["value"] == "孟嘗君"


def test_normalize_fill_blank_from_free_text_with_brackets():
    c = normalize_block({
        "type": "free_text",
        "prompt": "❸問題如何「解決」？孟嘗君的食客【　　　】，引來附近公雞也一起叫。",
        "answer": "模仿雞叫",
    })
    assert c["role"] == "exercise"
    assert c["interaction"] == "fill_blank"
    assert c["eval"] == "normalized"
    assert c["answer"]["value"] == "模仿雞叫"


def test_normalize_passage_and_figure():
    c = normalize_block({
        "type": "passage",
        "source": "supplementary",
        "paragraphs": ["孟嘗君連夜逃到函谷關。"],
    })
    assert c["role"] == "passage"
    assert c["interaction"] is None

    f = normalize_block({"type": "figure", "referent": "image", "asset": "fig1.png"})
    assert f["role"] == "figure"


# ── validate (illegal combos rejected) ──────────────────────────────────────


@pytest.mark.parametrize(
    "block, err_substr",
    [
        ({"role": "exercise", "interaction": None}, "interaction"),
        ({"role": "section", "interaction": "select_one", "stem": "x"}, "section"),
        (
            {
                "role": "exercise",
                "interaction": "select_one",
                "stem": "Q",
                "eval": "exact",
                "answer": {"kind": "choice_text", "value": "a", "options": ["a"]},
            },
            "options",
        ),
        (
            {
                "role": "exercise",
                "interaction": "fill_blank",
                "stem": "【】",
                "eval": "exact",
                "answer": {"kind": "text", "value": ""},
            },
            "answer",
        ),
    ],
)
def test_validate_rejects_illegal_combos(block: dict, err_substr: str):
    errors = validate_canonical_block(block)
    assert any(err_substr in e for e in errors)


def test_allowed_combos_cover_all_interactions():
    interactions = {i for _, i in ALLOWED_ROLE_INTERACTION if i is not None}
    assert "select_one" in interactions
    assert "fill_blank" in interactions
    assert "free_write" in interactions


# ── G6-L22 professor acceptance (vertical slice) ───────────────────────────


@pytest.fixture
def g6_l22_blocks() -> list[dict]:
    sp = load_dev7_spotlight("G6-L22")
    assert sp is not None
    return sp["blocks"]


@pytest.mark.skip(


    reason="G6-L22 是一修的垂直切片驗收課，其 fixture 與 DEV7 名單隨一修刪除（#2683）；block model 的通則契約已改由 specs/test_spotlight_v2_spec.py 對 143 課真語料覆蓋"


)


def test_g6_l22_fixture_loads():
    assert load_spotlight_v2("G6-L22") is not None


@pytest.mark.skip(


    reason="G6-L22 是一修的垂直切片驗收課，其 fixture 與 DEV7 名單隨一修刪除（#2683）；block model 的通則契約已改由 specs/test_spotlight_v2_spec.py 對 143 課真語料覆蓋"


)


def test_g6_l22_acceptance_passes(g6_l22_blocks: list[dict]):
    """Professor intent: guide → passage+exercise loops, not static answers in guide."""
    result = eval_g6_l22_acceptance(g6_l22_blocks)
    assert result["pass"], f"G6-L22 acceptance failures: {result['failures']}"


@pytest.mark.skip(


    reason="G6-L22 是一修的垂直切片驗收課，其 fixture 與 DEV7 名單隨一修刪除（#2683）；block model 的通則契約已改由 specs/test_spotlight_v2_spec.py 對 143 課真語料覆蓋"


)


def test_g6_l22_mengchang_segment_structure(g6_l22_blocks: list[dict]):
    canonical = normalize_spotlight_blocks(g6_l22_blocks)
    fp = canonical_fingerprint(canonical)

    assert fp["guide_count"] >= 3
    assert fp["passage_count"] >= 3
    assert fp["exercise_count"] >= 10

    meng = G6_L22_ACCEPTANCE["mengchang_rooster"]
    idx = next(
        i for i, b in enumerate(canonical)
        if b.get("role") == "bridge" and meng["bridge"] in (b.get("text") or "")
    )
    following = canonical[idx + 1 : idx + 8]
    roles = [b["role"] for b in following]
    assert roles[0] == "passage"
    exercises = [b for b in following if b["role"] == "exercise"]
    assert len(exercises) >= 4
    interactions = [b["interaction"] for b in exercises[:4]]
    assert interactions.count("select_one") >= 3
    assert "fill_blank" in interactions


@pytest.mark.skip(


    reason="G6-L22 是一修的垂直切片驗收課，其 fixture 與 DEV7 名單隨一修刪除（#2683）；block model 的通則契約已改由 specs/test_spotlight_v2_spec.py 對 143 課真語料覆蓋"


)


def test_g6_l22_no_option_lines_in_guide_role(g6_l22_blocks: list[dict]):
    canonical = normalize_spotlight_blocks(g6_l22_blocks)
    for i, b in enumerate(canonical):
        if b["role"] not in ("guide", "bridge", "section"):
            continue
        text = (b.get("text") or b.get("stem") or "").strip()
        assert not text.startswith("□"), f"block[{i}] guide-like role has □ option: {text[:40]}"


@pytest.mark.skip(


    reason="G6-L22 是一修的垂直切片驗收課，其 fixture 與 DEV7 名單隨一修刪除（#2683）；block model 的通則契約已改由 specs/test_spotlight_v2_spec.py 對 143 課真語料覆蓋"


)


def test_g6_l22_answer_gold(g6_l22_blocks: list[dict]):
    from app.services.spotlight_block_model import eval_g6_l22_answers

    result = eval_g6_l22_answers(g6_l22_blocks)
    assert result["pass"], f"answer gold failures: {result['failures']}"


@pytest.mark.skip(


    reason="G6-L22 是一修的垂直切片驗收課，其 fixture 與 DEV7 名單隨一修刪除（#2683）；block model 的通則契約已改由 specs/test_spotlight_v2_spec.py 對 143 課真語料覆蓋"


)


def test_g6_l22_four_exercises_per_passage(g6_l22_blocks: list[dict]):
    from app.services.spotlight_block_model import eval_g6_l22_segments

    result = eval_g6_l22_segments(g6_l22_blocks)
    assert result["pass"], f"segment failures: {result['failures']}"


@pytest.mark.skip(


    reason="G6-L22 是一修的垂直切片驗收課，其 fixture 與 DEV7 名單隨一修刪除（#2683）；block model 的通則契約已改由 specs/test_spotlight_v2_spec.py 對 143 課真語料覆蓋"


)


def test_g6_l22_crow_first_question_is_mcq(g6_l22_blocks: list[dict]):
    idx = next(
        i for i, b in enumerate(g6_l22_blocks)
        if b.get("type") == "passage" and "烏鴉" in " ".join(b.get("paragraphs") or [])
    )
    first = g6_l22_blocks[idx + 1]
    assert first.get("type") == "single"
    assert first.get("answer") == "烏鴉"


# ── batch dev7 (after G6-L22 green) ─────────────────────────────────────────


@pytest.mark.parametrize("lesson_id", ["G6-L23", "G6-L24", "G6-L25", "G7-L28", "G7-L29", "G7-L30"])
@pytest.mark.skip(
    reason="G6-L22 是一修的垂直切片驗收課，其 fixture 與 DEV7 名單隨一修刪除（#2683）；block model 的通則契約已改由 specs/test_spotlight_v2_spec.py 對 143 課真語料覆蓋"
)
def test_dev7_canonical_normalize_valid(lesson_id: str):
    sp = load_dev7_spotlight(lesson_id)
    assert sp is not None
    canonical = normalize_spotlight_blocks(sp["blocks"])
    errors: list[str] = []
    for i, b in enumerate(canonical):
        errors.extend(f"block[{i}]: {e}" for e in validate_canonical_block(b))
    assert not errors, errors[:5]
