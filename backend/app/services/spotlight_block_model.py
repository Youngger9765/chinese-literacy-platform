"""
spotlight_block_model.py — canonical block taxonomy (role × interaction × eval).

Legacy YAML uses flat ``type`` (guide/single/free_text). This module normalizes
to a testable contract and encodes professor acceptance for G6-L22.
"""

from __future__ import annotations

import re
from collections import Counter
from typing import Any

# role × interaction pairs that are legal (interaction None = non-exercise)
ALLOWED_ROLE_INTERACTION: frozenset[tuple[str, str | None]] = frozenset({
    ("guide", None),
    ("section", None),
    ("bridge", None),
    ("passage", None),
    ("figure", None),
    ("meta", None),
    ("exercise", "select_one"),
    ("exercise", "select_many"),
    ("exercise", "fill_blank"),
    ("exercise", "free_write"),
    ("exercise", "highlight"),
    ("exercise", "match"),
    ("exercise", "ordering"),
    ("exercise", "acknowledge"),
})

SECTION_HEADER_RE = re.compile(r"^\d+\.\s*(讓我們來看|進階挑戰|請)")
SECTION_MARKER_RE = re.compile(r"^[◎※]\s*")
BRIDGE_RE = re.compile(r"^接下來，我們來看")
TEMPLATE_GUIDE_RE = re.compile(r"^[❶❷❸❹].*[❷❸❹]")  # multi-question template row
OPTION_IN_GUIDE_RE = re.compile(r"^□")

G6_L22_ACCEPTANCE = {
    "opening_guide": "好故事",
    "crow_example": "例一：烏鴉喝水",
    "mengchang_rooster": {
        "bridge": "接下來，我們來看課文的故事",
        "passage_keywords": ("函谷關", "雞鳴"),
        "exercise_count": 4,
    },
    "trial_section": "小試身手",
    "second_story_header": "1.讓我們來看課文另一個故事",
    "advanced_section": "2.進階挑戰：大象有多重？",
}

# Answer gold — keyed by passage anchor → {circled: expected answer substring}
G6_L22_ANSWER_GOLD: dict[str, dict[str, str]] = {
    "烏鴉": {"❶": "烏鴉", "❷": "喝不到水", "❸": "丟小石頭", "❹": "順利喝到水"},
    "函谷關": {"❶": "孟嘗君", "❷": "天沒亮", "❸": "模仿雞叫", "❹": "成功出關"},
    "白狐裘": {"❶": "孟嘗君", "❷": "白狐裘", "❸": "偷", "❹": "放了孟嘗君"},
    "大象": {"❶": "曹沖", "❷": "沒辦法秤", "❸": "水位線", "❹": "知道大象的重量"},
}

ANSWER_LEAK_IN_PROMPT_RE = re.compile(
    r"[？?]\s*.+(?:秤|喝到水|偷|出關).+。"
)


def _section_text(block: dict[str, Any]) -> str:
    return (block.get("text") or block.get("prompt") or block.get("stem") or "").strip()


def normalize_block(legacy: dict[str, Any]) -> dict[str, Any]:
    """Map legacy spotlight block → canonical {role, interaction, eval, ...}."""
    btype = legacy.get("type", "unknown")
    text = _section_text(legacy)

    if btype == "guide":
        if BRIDGE_RE.search(text):
            return {"role": "bridge", "text": text, "eval": "none", "layout": "callout"}
        if SECTION_HEADER_RE.match(text) or SECTION_MARKER_RE.match(text):
            return {"role": "section", "text": text, "eval": "none", "layout": "section_heading"}
        return {"role": "guide", "text": text, "eval": "none", "layout": "callout"}

    if btype == "passage":
        return {
            "role": "passage",
            "interaction": None,
            "paragraphs": legacy.get("paragraphs") or [],
            "source": legacy.get("source") or "unknown",
            "eval": "none",
            "layout": "reading_card",
        }

    if btype == "figure":
        return {
            "role": "figure",
            "interaction": None,
            "referent": legacy.get("referent"),
            "asset": legacy.get("asset"),
            "bind_paragraph": legacy.get("bind_paragraph"),
            "eval": "none",
            "layout": "figure_card",
        }

    if btype == "fill_table":
        return {"role": "meta", "meta_kind": "fill_table", "eval": "none", "layout": "bridge"}

    if btype == "self_check":
        return {
            "role": "exercise",
            "interaction": "acknowledge",
            "items": legacy.get("items") or [],
            "eval": "none",
            "layout": "checkbox_list",
        }

    if btype == "free_text":
        if SECTION_HEADER_RE.match(text):
            return {"role": "section", "text": text, "eval": "none", "layout": "section_heading"}
        if "【" in text and "】" in text:
            return {
                "role": "exercise",
                "interaction": "fill_blank",
                "stem": text,
                "eval": "normalized",
                "answer": {
                    "kind": "text",
                    "value": legacy.get("answer") or "",
                },
                "layout": "fill_inline",
            }
        return {
            "role": "exercise",
            "interaction": "free_write",
            "stem": text,
            "eval": "self_report" if not legacy.get("answer") else "normalized",
            "answer": {"kind": "text", "value": legacy.get("answer")} if legacy.get("answer") else None,
            "layout": "text_area",
        }

    if btype in ("single", "multi"):
        options = legacy.get("options") or []
        return {
            "role": "exercise",
            "interaction": "select_many" if btype == "multi" else "select_one",
            "stem": legacy.get("prompt") or text,
            "eval": "exact",
            "answer": {
                "kind": "choice_text",
                "value": legacy.get("answer"),
                "options": options,
            },
            "layout": "mcq_card",
        }

    return {"role": "guide", "text": text or f"[{btype}]", "eval": "none", "layout": "callout"}


def normalize_spotlight_blocks(blocks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [normalize_block(b) for b in blocks]


def validate_canonical_block(block: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    role = block.get("role")
    interaction = block.get("interaction")
    pair = (role, interaction)
    if pair not in ALLOWED_ROLE_INTERACTION:
        errors.append(f"illegal role×interaction: {pair}")

    if role == "section" and interaction is not None:
        errors.append("section must not have interaction")

    if role == "passage":
        if not block.get("paragraphs"):
            errors.append("passage missing paragraphs")

    if role == "exercise":
        has_stem = bool(block.get("stem") or block.get("text"))
        has_items = bool(block.get("items"))
        if not has_stem and not (interaction == "acknowledge" and has_items):
            errors.append("exercise missing stem")
        eval_mode = block.get("eval", "none")
        answer = block.get("answer") or {}
        if interaction == "select_one":
            opts = answer.get("options") or []
            if len(opts) < 2:
                errors.append("select_one needs >=2 options")
            if eval_mode in ("exact", "normalized") and not answer.get("value"):
                errors.append("select_one missing answer.value")
        if interaction == "fill_blank" and eval_mode in ("exact", "normalized"):
            if not answer.get("value"):
                errors.append("fill_blank missing answer.value")

    return errors


def canonical_fingerprint(blocks: list[dict[str, Any]]) -> dict[str, Any]:
    hist = dict(sorted(Counter(b.get("role", "?") for b in blocks).items()))
    interactions = [
        b.get("interaction") for b in blocks if b.get("role") == "exercise"
    ]
    return {
        "role_histogram": hist,
        "role_sequence": [b.get("role") for b in blocks],
        "interaction_sequence": interactions,
        "guide_count": hist.get("guide", 0),
        "passage_count": hist.get("passage", 0),
        "exercise_count": sum(1 for b in blocks if b.get("role") == "exercise"),
        "section_count": hist.get("section", 0),
    }


def _find_bridge_index(canonical: list[dict[str, Any]], bridge_text: str) -> int | None:
    for i, b in enumerate(canonical):
        if b.get("role") == "bridge" and bridge_text in (b.get("text") or ""):
            return i
    return None


def _passage_contains(paragraphs: list[str], keywords: tuple[str, ...]) -> bool:
    flat = " ".join(paragraphs)
    return all(k in flat for k in keywords)


def _passage_anchor(paragraphs: list[str]) -> str | None:
    flat = " ".join(paragraphs)
    for anchor in G6_L22_ANSWER_GOLD:
        if anchor in flat:
            return anchor
    return None


def _block_answer_text(block: dict[str, Any]) -> str:
    btype = block.get("type")
    if btype in ("single", "multi"):
        return str(block.get("answer") or "")
    if btype == "free_text":
        return str(block.get("answer") or "")
    return ""


def _circled_from_prompt(block: dict[str, Any]) -> str | None:
    stem = block.get("prompt") or block.get("text") or ""
    m = re.match(r"^([❶❷❸❹])", stem.strip())
    return m.group(1) if m else None


def eval_g6_l22_answers(legacy_blocks: list[dict[str, Any]]) -> dict[str, Any]:
    """Verify MCQ/fill answers match professor gold (substring match)."""
    failures: list[str] = []
    current_anchor: str | None = None

    for i, block in enumerate(legacy_blocks):
        if block.get("type") == "passage":
            current_anchor = _passage_anchor(block.get("paragraphs") or [])

        if block.get("type") not in ("single", "multi", "free_text"):
            continue

        circled = _circled_from_prompt(block)
        if not circled or not current_anchor:
            continue

        gold_map = G6_L22_ANSWER_GOLD.get(current_anchor, {})
        expected_sub = gold_map.get(circled)
        if not expected_sub:
            continue

        actual = _block_answer_text(block)
        if expected_sub not in actual.replace(" ", ""):
            failures.append(
                f"block[{i}] {current_anchor} {circled}: "
                f"expected contains {expected_sub!r}, got {actual!r}"
            )

        prompt = (block.get("prompt") or "").strip()
        if block.get("type") == "free_text" and "【" not in prompt:
            if ANSWER_LEAK_IN_PROMPT_RE.search(prompt):
                failures.append(f"block[{i}]: answer leaked in prompt: {prompt[:50]}")

        if block.get("type") == "single":
            opts = block.get("options") or []
            if any(o.strip() in {".", "。", ""} for o in opts):
                failures.append(f"block[{i}]: invalid placeholder option")

    return {"pass": len(failures) == 0, "failures": failures}


def eval_g6_l22_segments(legacy_blocks: list[dict[str, Any]]) -> dict[str, Any]:
    """Each passage segment must be followed by 4 PSE exercises (❶❷❸❹)."""
    failures: list[str] = []
    i = 0
    while i < len(legacy_blocks):
        block = legacy_blocks[i]
        if block.get("type") != "passage":
            i += 1
            continue
        anchor = _passage_anchor(block.get("paragraphs") or [])
        if not anchor:
            i += 1
            continue
        following = legacy_blocks[i + 1 : i + 12]
        exercises = [
            b for b in following
            if b.get("type") in ("single", "multi", "free_text")
            and _circled_from_prompt(b)
        ]
        circled = [_circled_from_prompt(b) for b in exercises[:4]]
        if len(exercises) < 4:
            failures.append(f"{anchor}: need 4 exercises after passage, got {len(exercises)}")
        elif circled[:4] != ["❶", "❷", "❸", "❹"]:
            failures.append(f"{anchor}: expected ❶❷❸❹ sequence, got {circled[:4]}")
        if anchor == "烏鴉" and exercises and exercises[0].get("type") != "single":
            failures.append("烏鴉 ❶ must be select_one (single), not free_text")
        i += 1
    return {"pass": len(failures) == 0, "failures": failures}


def eval_g6_l22_acceptance(legacy_blocks: list[dict[str, Any]]) -> dict[str, Any]:
    """
    Professor acceptance for 小兵立大功 (summary_pse vertical slice).

    Checks pedagogical structure, not pixel-perfect DOCX match.
    """
    failures: list[str] = []
    canonical = normalize_spotlight_blocks(legacy_blocks)
    fp = canonical_fingerprint(canonical)

    guides = [b for b in canonical if b["role"] == "guide"]
    if not any(G6_L22_ACCEPTANCE["opening_guide"] in (g.get("text") or "") for g in guides):
        failures.append("missing opening guide (好故事)")

    if not any(G6_L22_ACCEPTANCE["crow_example"] in _section_text(b) for b in canonical):
        failures.append("missing 例一：烏鴉喝水 section")

    meng = G6_L22_ACCEPTANCE["mengchang_rooster"]
    midx = _find_bridge_index(canonical, meng["bridge"])
    if midx is None:
        failures.append(f"missing bridge: {meng['bridge']}")
    else:
        following = canonical[midx + 1 : midx + 8]
        if not following or following[0]["role"] != "passage":
            failures.append("mengchang: expected passage immediately after bridge")
        elif not _passage_contains(
            following[0].get("paragraphs") or [], meng["passage_keywords"]
        ):
            failures.append("mengchang passage missing 函谷關/雞鳴 keywords")
        else:
            exercises = [b for b in following if b["role"] == "exercise"]
            if len(exercises) < meng["exercise_count"]:
                failures.append(
                    f"mengchang: need {meng['exercise_count']} exercises, got {len(exercises)}"
                )
            elif "fill_blank" not in [e.get("interaction") for e in exercises]:
                failures.append("mengchang: ❸ fill_blank (模仿雞叫) missing")

    if not any(
        G6_L22_ACCEPTANCE["trial_section"] in _section_text(b) for b in canonical
    ):
        failures.append("missing ◎小試身手 section")

    if not any(
        G6_L22_ACCEPTANCE["second_story_header"] in _section_text(b) for b in canonical
    ):
        failures.append("missing second story section header")

    for i, b in enumerate(canonical):
        if b["role"] not in ("guide", "bridge", "section"):
            continue
        t = _section_text(b)
        if OPTION_IN_GUIDE_RE.match(t):
            failures.append(f"block[{i}]: option line in guide-like role: {t[:30]}")

    if fp["exercise_count"] < 10:
        failures.append(f"too few exercises: {fp['exercise_count']} < 10")

    answer_eval = eval_g6_l22_answers(legacy_blocks)
    if not answer_eval["pass"]:
        failures.extend(answer_eval["failures"])

    segment_eval = eval_g6_l22_segments(legacy_blocks)
    if not segment_eval["pass"]:
        failures.extend(segment_eval["failures"])

    return {
        "pass": len(failures) == 0,
        "failures": failures,
        "fingerprint": fp,
        "answers": answer_eval,
        "segments": segment_eval,
    }
