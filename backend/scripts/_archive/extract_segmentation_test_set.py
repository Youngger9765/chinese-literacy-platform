#!/usr/bin/env python3
"""Extract known-bad segmentation cases from tts-provenance.jsonl as test assertions.

Reads current (regex-split) provenance, identifies bug categories, and writes
`backend/tests/data/segmentation_test_set.json` as the acceptance contract for v2.

Categories:
1. orphan_close_bracket  — sentence starts with 」』）】》〉 (closing bracket leaked from prev)
2. cross_bracket_split   — prev ends with 「『 open, next starts with close (pair split across sentences)
3. short_no_context      — len <= 6 AND sentence is embedded in a longer paragraph (fragment)
4. unbalanced_brackets   — open/close count mismatch within a single sentence
5. near_max_length       — len >= 38 (likely force-split mid-thought at 40-char cap)

The v2 segmentation output (tts-provenance-v2.jsonl) must satisfy:
- category 1: count == 0
- category 2: count == 0
- category 3: count == 0 (short sentences only allowed if paragraph IS short)
- category 4: count == 0
- category 5: acceptable if semantically complete (LLM judgment; not a hard assertion)
"""
from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PROVENANCE = ROOT / "backend" / "data" / "tts-provenance.jsonl"
OUT = ROOT / "backend" / "tests" / "data" / "segmentation_test_set.json"

OPENING = set("「『（【《〈")
CLOSING = set("」』）】》〉")
TERMINATORS = set("。！？")
SHORT_THRESHOLD = 6
LONG_THRESHOLD = 38


def bracket_balance(text: str) -> str:
    stack: list[str] = []
    for ch in text:
        if ch in OPENING:
            stack.append(ch)
        elif ch in CLOSING:
            if stack:
                stack.pop()
            else:
                return "orphan_closing"
    return "orphan_opening" if stack else "ok"


def load_provenance() -> list[dict]:
    rows: list[dict] = []
    with PROVENANCE.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            rows.append(json.loads(line))
    return rows


def extract_cases(rows: list[dict]) -> dict:
    by_para: dict[tuple, list[dict]] = defaultdict(list)
    for r in rows:
        key = (r["lesson_id"], r["paragraph_idx"])
        by_para[key].append(r)
    for v in by_para.values():
        v.sort(key=lambda x: x["sentence_idx"])

    orphan_close: list[dict] = []
    cross_bracket: list[dict] = []
    short_no_ctx: list[dict] = []
    unbalanced: list[dict] = []
    near_max: list[dict] = []

    for (lid, pidx), entries in by_para.items():
        paragraph_text = entries[0].get("source_paragraph", "")
        para_len = len(paragraph_text)

        for i, e in enumerate(entries):
            txt = e["raw_text"]
            ln = len(txt)
            tag = {
                "lesson_id": lid,
                "paragraph_idx": pidx,
                "sentence_idx": e["sentence_idx"],
                "raw_text": txt,
                "length": ln,
                "source_paragraph": paragraph_text,
            }

            if txt and txt[0] in CLOSING:
                orphan_close.append(tag)

            if i + 1 < len(entries):
                nxt = entries[i + 1]["raw_text"]
                if bracket_balance(txt) == "orphan_opening" and nxt and nxt[0] in CLOSING:
                    cross_bracket.append({
                        **tag,
                        "next_sentence_idx": entries[i + 1]["sentence_idx"],
                        "next_raw_text": nxt,
                    })

            if ln <= SHORT_THRESHOLD and para_len > SHORT_THRESHOLD * 2:
                short_no_ctx.append(tag)

            if bracket_balance(txt) != "ok":
                unbalanced.append(tag)

            if ln >= LONG_THRESHOLD:
                near_max.append(tag)

    return {
        "orphan_close_bracket": orphan_close,
        "cross_bracket_split": cross_bracket,
        "short_no_context": short_no_ctx,
        "unbalanced_brackets": unbalanced,
        "near_max_length": near_max,
    }


def build_assertions(cases: dict) -> dict:
    return {
        "description": "Acceptance contract for v2 sentence segmentation. v2 output (tts-provenance-v2.jsonl) must satisfy these.",
        "source": "backend/data/tts-provenance.jsonl",
        "generated_from_total_sentences": None,
        "assertions": {
            "no_orphan_close_bracket": {
                "rule": "No sentence may start with 」』）】》〉",
                "current_violations": len(cases["orphan_close_bracket"]),
                "v2_requirement": 0,
            },
            "no_cross_bracket_split": {
                "rule": "No adjacent sentence pair where prev has unclosed 「 and next starts with 」",
                "current_violations": len(cases["cross_bracket_split"]),
                "v2_requirement": 0,
            },
            "no_short_no_context_fragment": {
                "rule": f"No sentence ≤ {SHORT_THRESHOLD} chars when its paragraph is > {SHORT_THRESHOLD * 2} chars",
                "current_violations": len(cases["short_no_context"]),
                "v2_requirement": 0,
            },
            "no_unbalanced_brackets": {
                "rule": "Every sentence must have matching 「」『』（）【】 pairs",
                "current_violations": len(cases["unbalanced_brackets"]),
                "v2_requirement": 0,
            },
            "near_max_length_soft": {
                "rule": f"Sentences ≥ {LONG_THRESHOLD} chars are soft-flagged; v2 must keep each ≤ 45 chars OR justify via LLM semantic completeness",
                "current_violations": len(cases["near_max_length"]),
                "v2_requirement": "soft",
            },
        },
        "cases": cases,
    }


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    rows = load_provenance()
    cases = extract_cases(rows)
    out = build_assertions(cases)
    out["generated_from_total_sentences"] = len(rows)

    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"Source: {PROVENANCE}")
    print(f"Total sentences scanned: {len(rows)}\n")
    print("Bug categories:")
    for name, items in cases.items():
        print(f"  {name}: {len(items)}")
    print(f"\nWrote: {OUT}")
    print(f"Size:  {OUT.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
