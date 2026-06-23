"""
eval_keypoints_text_fidelity.py — Slice ②: text fidelity check for keypoints schema.

Detects false-pass cases where row/blank COUNT metrics pass but the actual
text content of individual cells is garbled, merged, or wrong.

Usage (as a module):
    from eval_keypoints_text_fidelity import eval_keypoints_text_fidelity

    result = eval_keypoints_text_fidelity(
        lesson_id="G6-L22",
        docx_path=Path("...G6-L22.docx"),
        schema_dir=Path("private/curriculum-source/_online-schema/"),
        bls=bls_module,
    )

For testing without a real DOCX, supply _schema_override and _docx_rows_override.
"""

import re
import unicodedata
from pathlib import Path
from typing import Optional, Any

import yaml


# ─── Normalization ────────────────────────────────────────────────────────────

def normalize_text(text: str) -> str:
    """
    Normalize text for comparison:
    1. NFKC (full-width ← ASCII, combines compatibility chars)
    2. Strip surrounding whitespace
    3. Collapse internal consecutive whitespace to single space
    4. Normalize full-width/half-width punctuation via NFKC (covered by step 1)
    """
    if not text:
        return ""
    text = unicodedata.normalize("NFKC", text)
    text = text.strip()
    text = re.sub(r"\s+", " ", text)
    return text


BLANK_RE = re.compile(r"【(.*?)】")


def extract_blanks_from_docx_text(text: str) -> list:
    """Extract answer strings from 【...】 patterns in a DOCX cell."""
    blanks = []
    for m in BLANK_RE.finditer(text):
        raw = m.group(1).strip()
        answer = re.sub(r"\s+", "", raw).replace("　", "")  # remove ideographic spaces
        blanks.append(answer)
    return blanks


def docx_text_to_template(text: str) -> str:
    """Replace 【...】 with __ to match schema template format."""
    return BLANK_RE.sub("__", text).strip()


# ─── Row matching helpers ─────────────────────────────────────────────────────

def _skip_header_rows(rows_raw: list) -> int:
    """
    Return the number of rows to skip (title + header rows), same logic as eval_keypoints.
    """
    import re as _re
    skip = 0
    if not rows_raw:
        return 0
    # Title row: single non-dup cell, no blanks
    first_non_dup = [c for c in rows_raw[0]["cells"] if not c.get("dup")]
    if len(first_non_dup) == 1 and not BLANK_RE.search(first_non_dup[0]["text"]):
        skip += 1
    elif (len(first_non_dup) >= 2 and
          not first_non_dup[0]["text"].strip() and
          not first_non_dup[0].get("has_blank") and
          not BLANK_RE.search(first_non_dup[1]["text"])):
        skip += 1  # empty-label header variant
    # Header row: contains 提示/元素/重點/段落 keywords
    if skip < len(rows_raw):
        next_row = rows_raw[skip]
        next_cells = [c for c in next_row["cells"] if not c.get("dup")]
        cell_texts = " ".join(c["text"] for c in next_cells)
        if _re.search(r"提示|元素|重點|段落", cell_texts):
            skip += 1
    return skip


def _flatten_schema_rows(rows_out: list, structure: str) -> list:
    """
    Flatten schema rows (including sub_rows) into a list of cell comparison specs.
    Each spec: {"row_idx": str, "field": str, "schema_text": str, "blanks": list}
    row_idx is like "0", "1_0", "1_1" (parent_subrow).
    """
    flat = []
    for i, row in enumerate(rows_out):
        if row.get("sub_rows"):
            for j, sr in enumerate(row["sub_rows"]):
                template = sr.get("template", "")
                blanks = sr.get("blanks", [])
                flat.append({
                    "row_idx": f"{i}_{j}",
                    "label": row.get("label", ""),
                    "sub_label": sr.get("sub_label", ""),
                    "field": "template",
                    "schema_text": template,
                    "blanks": blanks,
                })
        else:
            value = row.get("value", "")
            blanks = row.get("blanks", [])
            flat.append({
                "row_idx": str(i),
                "label": row.get("label", ""),
                "sub_label": "",
                "field": "value",
                "schema_text": value,
                "blanks": blanks,
            })
    return flat


def _flatten_docx_rows(rows_raw: list, skip: int) -> list:
    """
    Flatten DOCX rows (after skipping title/header) into a list of value-column texts.
    Each entry: {"value_text": str, "raw_row": dict}
    For nested tables, the value column is the last non-dup cell.
    For flat tables, it's cells[1].
    """
    flat = []
    for row in rows_raw[skip:]:
        cells = [c for c in row["cells"] if not c.get("dup")]
        if not cells:
            continue
        # Value column: last cell (works for both 2-col flat and 3-col nested)
        value_text = cells[-1]["text"] if cells else ""
        flat.append({"value_text": value_text, "cells": cells})
    return flat


# ─── Main fidelity function ───────────────────────────────────────────────────

def eval_keypoints_text_fidelity(
    lesson_id: str,
    docx_path,
    schema_dir,
    bls,
    *,
    _schema_override: Optional[dict] = None,
    _docx_rows_override: Optional[list] = None,
) -> dict:
    """
    Check that the text content of each keypoints schema cell matches the DOCX.

    Returns:
        {
            "available": bool,
            "text_fidelity": float,   # matched_cells / total_cells
            "mismatches": [...],      # list of per-cell mismatch dicts
            "pass": bool,             # True only if mismatches == []
        }

    For testing without a real DOCX, supply:
        _schema_override: pre-loaded keypoints schema dict
        _docx_rows_override: list of row dicts (same format as kp_table_raw["rows"])
    """
    # ── Load schema ───────────────────────────────────────────────────────────
    if _schema_override is not None:
        kp_schema = _schema_override
    else:
        kp_path = Path(schema_dir) / f"{lesson_id}.keypoints.yml"
        if not kp_path.exists():
            return {
                "available": False,
                "note": "no keypoints.yml",
                "text_fidelity": 0.0,
                "mismatches": [],
                "pass": False,
            }
        with open(kp_path, encoding="utf-8") as f:
            kp_schema = yaml.safe_load(f)

    rows_out = kp_schema.get("keypoints", {}).get("rows", [])
    structure = kp_schema.get("keypoints", {}).get("structure", "flat")

    if not rows_out:
        return {
            "available": False,
            "note": "schema has no rows",
            "text_fidelity": 1.0,
            "mismatches": [],
            "pass": True,
        }

    # ── Load DOCX rows ────────────────────────────────────────────────────────
    if _docx_rows_override is not None:
        docx_raw_rows = _docx_rows_override
        skip = 0  # caller provides data rows directly (no title/header)
    else:
        raw_blocks = bls.extract_raw(str(docx_path))
        kp_table_raw = bls.find_keypoints_table(raw_blocks, lesson_id)
        if kp_table_raw is None:
            return {
                "available": False,
                "note": "find_keypoints_table returned None",
                "text_fidelity": 0.0,
                "mismatches": [],
                "pass": False,
            }
        docx_raw_rows = kp_table_raw["rows"]
        skip = _skip_header_rows(docx_raw_rows)

    docx_flat = _flatten_docx_rows(docx_raw_rows, skip)
    schema_flat = _flatten_schema_rows(rows_out, structure)

    # ── Positional comparison ─────────────────────────────────────────────────
    mismatches = []
    total_cells = 0
    matched_cells = 0

    n_pairs = min(len(schema_flat), len(docx_flat))

    for idx in range(n_pairs):
        s = schema_flat[idx]
        d = docx_flat[idx]

        docx_value_text = d["value_text"]
        schema_text = s["schema_text"]
        blanks = s["blanks"]
        field = s["field"]
        row_idx = s["row_idx"]
        label = s["label"]

        # ── Compare template/value text (blanks replaced with __) ────────────
        docx_as_template = normalize_text(docx_text_to_template(docx_value_text))
        schema_normalized = normalize_text(schema_text)
        total_cells += 1

        if docx_as_template == schema_normalized:
            matched_cells += 1
        else:
            mismatches.append({
                "row": row_idx,
                "label": label,
                "field": field,
                "match": False,
                "schema_text": schema_normalized,
                "docx_text": docx_as_template,
                "diff": _short_diff(schema_normalized, docx_as_template),
            })

        # ── Compare blank answers ─────────────────────────────────────────────
        docx_blanks = extract_blanks_from_docx_text(docx_value_text)
        for b_idx, blank_spec in enumerate(blanks):
            schema_answer = blank_spec.get("answer") or ""
            schema_answer_norm = normalize_text(str(schema_answer))
            total_cells += 1

            if b_idx < len(docx_blanks):
                docx_answer = normalize_text(docx_blanks[b_idx])
                # Handle multi-answer (slash-separated): accept if any part matches
                if _answers_match(schema_answer_norm, docx_answer):
                    matched_cells += 1
                else:
                    mismatches.append({
                        "row": row_idx,
                        "label": label,
                        "field": f"answer[{b_idx}]",
                        "match": False,
                        "schema_text": schema_answer_norm,
                        "docx_text": docx_answer,
                        "diff": _short_diff(schema_answer_norm, docx_answer),
                    })
            else:
                # DOCX has fewer blanks than schema expects
                mismatches.append({
                    "row": row_idx,
                    "label": label,
                    "field": f"answer[{b_idx}]",
                    "match": False,
                    "schema_text": schema_answer_norm,
                    "docx_text": "<missing>",
                    "diff": "blank not found in DOCX",
                })

    text_fidelity = matched_cells / total_cells if total_cells > 0 else 1.0

    return {
        "available": True,
        "text_fidelity": round(text_fidelity, 4),
        "total_cells_checked": total_cells,
        "matched_cells": matched_cells,
        "mismatches": mismatches,
        "pass": len(mismatches) == 0,
    }


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _answers_match(schema_answer: str, docx_answer: str) -> bool:
    """
    Allow slash-separated alternatives: "天亮／提前開啟" means either is acceptable.
    Also normalize variations of slash character.
    """
    # Normalize slash variants
    schema_parts = re.split(r"[/／]", schema_answer)
    schema_parts = [p.strip() for p in schema_parts if p.strip()]
    docx_parts = re.split(r"[/／]", docx_answer)
    docx_parts = [p.strip() for p in docx_parts if p.strip()]

    # Accept if any schema part matches any docx part
    for sp in schema_parts:
        for dp in docx_parts:
            if sp == dp:
                return True
    return False


def _short_diff(a: str, b: str, max_len: int = 80) -> str:
    """Short human-readable diff string."""
    if a == b:
        return ""
    # Find first differing character
    for i, (ca, cb) in enumerate(zip(a, b)):
        if ca != cb:
            start = max(0, i - 10)
            snippet_a = a[start:start + max_len]
            snippet_b = b[start:start + max_len]
            return f"first diff at char {i}: schema='{snippet_a}' docx='{snippet_b}'"
    # One is longer
    shorter_len = min(len(a), len(b))
    return f"schema({len(a)}chars) vs docx({len(b)}chars), same first {shorter_len} chars"
