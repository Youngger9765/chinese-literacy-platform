#!/usr/bin/env python3
"""
build_lesson_schema.py  —  issue #2205 experiment
Converts raw DOCX lesson worksheets into spotlight.yml + keypoints.yml schemas.

Usage:
    python3 scripts/build_lesson_schema.py <lesson_id> <docx_path> [--output-dir DIR]

Output:
    private/curriculum-source/_online-schema/<lesson>.spotlight.yml
    private/curriculum-source/_online-schema/<lesson>.keypoints.yml
"""
import sys, json, re, os, argparse
from pathlib import Path
import yaml  # pip install pyyaml

import docx
from docx.oxml.table import CT_Tbl
from docx.oxml.text.paragraph import CT_P
from docx.table import Table
from docx.text.paragraph import Paragraph

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
SCAFFOLD_RE = re.compile(r"計時|裁判|還要多加練習|哇嗚|超級厲害|影片連結|我的表現|秒以下|秒以上")
MCQ_RE = re.compile(r"^[（(]\s*[A-Za-zＡ-Ｚ]\s*[）)]\s*\d+[\.\、]")
BLANK_RE = re.compile(r"【(.*?)】")


# ── DOCX raw extraction (reuses extract_docx_blocks.py logic) ──────────────

def cell_grid(tc):
    tcPr = tc.find(f"{W}tcPr")
    span, vmerge = 1, None
    if tcPr is not None:
        gs = tcPr.find(f"{W}gridSpan")
        if gs is not None:
            span = int(gs.get(f"{W}val", "1"))
        vm = tcPr.find(f"{W}vMerge")
        if vm is not None:
            vmerge = vm.get(f"{W}val", "continue")
    return span, vmerge


def table_cells(tbl):
    rows = []
    for ri, row in enumerate(tbl.rows):
        cells = []
        seen = set()
        for ci, cell in enumerate(row.cells):
            tc = cell._tc
            if id(tc) in seen:
                cells.append({"col": ci, "text": cell.text.strip(), "dup": True})
                continue
            seen.add(id(tc))
            span, vmerge = cell_grid(tc)
            cells.append({
                "col": ci,
                "text": cell.text.strip(),
                "gridspan": span,
                "vmerge": vmerge,
                "has_blank": bool(BLANK_RE.search(cell.text)),
            })
        rows.append({"row": ri, "cells": cells})
    return {"n_rows": len(tbl.rows), "n_cols": len(tbl.columns), "rows": rows}


def img_count(el_or_doc):
    el = el_or_doc._element if hasattr(el_or_doc, "_element") else el_or_doc.element
    blips = el.findall(".//{http://schemas.openxmlformats.org/drawingml/2006/main}blip")
    return len(blips)


def extract_raw(path):
    d = docx.Document(path)
    out = []
    ti = 0
    for child in d.element.body.iterchildren():
        if isinstance(child, CT_P):
            p = Paragraph(child, d)
            t = p.text.strip()
            if not t:
                continue
            out.append({"kind": "p", "style": p.style.name, "text": t})
        elif isinstance(child, CT_Tbl):
            tbl = Table(child, d)
            flat = " ".join(c.text for r in tbl.rows for c in r.cells)
            is_scaffold = bool(SCAFFOLD_RE.search(flat))
            rec = {"kind": "table", "index": ti, "scaffold": is_scaffold,
                   "images": img_count(tbl), **table_cells(tbl)}
            out.append(rec)
            ti += 1
    return out


# ── Helper: parse blanks from cell text ────────────────────────────────────

def parse_blanks(text):
    """Return list of {answer, hint} dicts from 【...】 patterns in text."""
    blanks = []
    for m in BLANK_RE.finditer(text):
        raw = m.group(1).strip()
        # Clean whitespace and slash variants
        answer = re.sub(r"\s+", "", raw).replace("　", "")
        if answer:
            blanks.append({"answer": answer, "hint": ""})
        else:
            blanks.append({"answer": None, "hint": ""})
    return blanks


def remove_blanks(text):
    """Replace 【...】 with __ placeholder."""
    return BLANK_RE.sub("__", text).strip()


# ── KEYPOINTS extraction ───────────────────────────────────────────────────

def find_keypoints_table(blocks, lesson_id):
    """
    Find the keypoints table (重點表) in the document.
    Heuristic: non-scaffold table with 問題/解決/結果/研究 labels and/or 【】 blanks.
    Also matches 研究問題/實驗/結論 format (L28).
    """
    KEYPOINTS_LABELS = re.compile(
        r"問題|解決|結果|迴響|研究問題|新說法|假說|實驗|驗證|結論|研究影響|元素|提示|重點"
    )
    # Labels that strongly indicate a structured keypoints table (NOT just guide text)
    STRUCTURAL_LABELS = re.compile(r"問題|解決|結果|研究問題|實驗|驗證|結論|迴響")

    # Collect all non-scaffold tables that contain keypoint labels
    candidates = []
    for b in blocks:
        if b["kind"] != "table" or b.get("scaffold"):
            continue
        # Must be multi-row and multi-column (excludes 1x1 guide boxes)
        if b["n_rows"] < 2 or b["n_cols"] < 2:
            continue
        flat = " ".join(
            c["text"] for row in b["rows"]
            for c in row["cells"] if not c.get("dup")
        )
        label_count = len(KEYPOINTS_LABELS.findall(flat))
        structural_count = len(STRUCTURAL_LABELS.findall(flat))
        has_blank = bool(BLANK_RE.search(flat))
        # Must have structural labels (問題/解決/結果/etc.) AND blanks (fill-in cells)
        # This distinguishes keypoints table from vocab-application table
        if structural_count >= 2 and has_blank:
            # Score = structural label count + bonus for blanks + bonus for n_rows
            score = structural_count * 10 + (5 if has_blank else 0) + b["n_rows"]
            candidates.append((score, b))

    if not candidates:
        return None
    # Pick the one with highest score
    candidates.sort(key=lambda x: -x[0])
    return candidates[0][1]


def extract_keypoints(table, lesson_id):
    """
    Extract the keypoints table into structured schema.
    Handles: flat 2-col, nested 3-col, segment-locator (問題/（N）format).
    """
    rows_raw = table["rows"]
    n_cols = table["n_cols"]

    # Detect structure type
    # 1. nested = 3-col with shared parent label (vmerge spans multiple sub-label rows)
    # 2. hint_value = 3-col with header "元素|提示|重點" = each row independent (G6-L25/L24 style)
    # 3. flat = 2-col with label | value
    # 4. locator = label cell contains paragraph number

    # Check for hint_value format: first data row has "元素" or "提示" or "重點" in header
    is_hint_value = False
    if n_cols >= 3 and rows_raw:
        header_flat = " ".join(
            c["text"] for c in rows_raw[0]["cells"] if not c.get("dup")
        )
        if re.search(r"提示|元素|重點|段落", header_flat):
            is_hint_value = True

    # Check nested: 3-col where first col labels repeat across rows (vmerge)
    # This is G6-L22 style: 解決 spans rows 2-7
    is_nested = False
    if n_cols >= 3 and not is_hint_value:
        # Nested if any non-dup label cell has vmerge=restart AND same label repeats next row
        label_texts = []
        for row in rows_raw:
            cells = [c for c in row["cells"] if not c.get("dup")]
            if len(cells) >= 3:
                label_texts.append(cells[0]["text"].strip())
        if len(label_texts) >= 3:
            # Check for repeated label values (sign of vmerge)
            from collections import Counter
            label_counts = Counter(t for t in label_texts if t)
            if any(v > 1 for v in label_counts.values()):
                is_nested = True

    # Check for segment locator pattern (e.g., "問題\n/（1.2  ）")
    locate_paragraph = False
    for row in rows_raw:
        cells = [c for c in row["cells"] if not c.get("dup")]
        if cells:
            first_text = cells[0]["text"]
            if re.search(r"[/／]\s*[（(]", first_text):
                locate_paragraph = True
                break

    # Determine columns
    if is_hint_value:
        columns = ["label", "hint", "value"]
    elif is_nested:
        columns = ["label", "sub_label", "value"]
    elif locate_paragraph:
        columns = ["label", "paragraph", "value"]
    else:
        columns = ["label", "value"]

    # Parse rows
    rows_out = []
    current_label = None
    current_sub_rows = []
    title_row = None

    def flush_current():
        if current_label and current_sub_rows:
            rows_out.append({
                "label": current_label,
                "sub_rows": current_sub_rows
            })

    # Check if first row is a title row (single merged cell spanning all cols)
    first_row = rows_raw[0] if rows_raw else None
    start_idx = 0
    if first_row:
        non_dup = [c for c in first_row["cells"] if not c.get("dup")]
        if len(non_dup) == 1 and not BLANK_RE.search(non_dup[0]["text"]):
            title_row = non_dup[0]["text"]
            start_idx = 1

    # Check if second row is a header row (提示/元素/重點 etc.)
    header_row = None
    if start_idx < len(rows_raw):
        row = rows_raw[start_idx]
        non_dup = [c for c in row["cells"] if not c.get("dup")]
        cell_texts = [c["text"] for c in non_dup]
        header_keywords = {"提示", "重點", "元素", "段落"}
        if any(kw in t for kw in header_keywords for t in cell_texts):
            header_row = cell_texts
            start_idx += 1

    for row in rows_raw[start_idx:]:
        cells = [c for c in row["cells"] if not c.get("dup")]
        if not cells:
            continue

        if is_hint_value and n_cols >= 3 and len(cells) >= 3:
            # hint_value format: label/paragraph | hint | value
            label_cell = cells[0]
            hint_cell = cells[1]
            value_cell = cells[2]

            label_raw = label_cell["text"].strip()
            hint_text = hint_cell["text"].strip()
            value_text = value_cell["text"].strip()

            # Extract paragraph locator from label
            para_loc = None
            label_clean = label_raw
            m = re.search(r"[/／]\s*[（(]?([\d\.\s,，、\-]+)[）)]?", label_raw)
            if m:
                para_loc = m.group(1).strip()
                label_clean = re.sub(r"\n?[/／]\s*[（(]?[\d\.\s,，、\-]+[）)]?", "", label_raw).strip()
            label_clean = clean_label(label_clean)

            if label_clean:
                blanks = parse_blanks(value_text)
                row_entry = {
                    "label": label_clean,
                    "hint": hint_text,
                    "value": remove_blanks(value_text) if blanks else value_text,
                    "blanks": blanks,
                }
                if para_loc:
                    row_entry["paragraph"] = para_loc
                rows_out.append(row_entry)

        elif not is_hint_value and n_cols >= 3 and len(cells) >= 3:
            # Nested 3-col: label | sub_label | value
            label_cell = cells[0]
            sub_label_cell = cells[1]
            value_cell = cells[2]

            label_text = clean_label(label_cell["text"])
            sub_label_text = sub_label_cell["text"].strip()
            value_text = value_cell["text"].strip()

            # Detect label change: only when label_text is non-empty AND different from current
            # (python-docx returns vmerge=restart for ALL rows of a merged cell,
            #  so we can't rely on vmerge to detect continuation — use text identity instead)
            if label_text and label_text != current_label:
                flush_current()
                current_sub_rows = []
                current_label = label_text

            if sub_label_text:
                # This is a sub-row
                blanks = parse_blanks(value_text)
                template = remove_blanks(value_text) if blanks else value_text
                sub_row = {
                    "sub_label": sub_label_text,
                    "template": template,
                    "blanks": blanks,
                }
                current_sub_rows.append(sub_row)
            else:
                # Direct value under label (no sub_label)
                blanks = parse_blanks(value_text)
                if current_label:
                    # If we already have sub_rows, this is a flat addendum; handle separately
                    if not current_sub_rows:
                        rows_out.append({
                            "label": current_label,
                            "value": remove_blanks(value_text) if blanks else value_text,
                            "blanks": blanks,
                        })
                        current_label = None

        else:
            # 2-col (or 3-col with merged col1): label | value
            # (occurs for 問題/結果 rows in a 3-col nested table when col1 is dup)
            # Must flush any pending nested group first
            if current_label and current_sub_rows:
                flush_current()
                current_sub_rows = []
                current_label = None

            label_cell = cells[0]
            value_cell = cells[1] if len(cells) > 1 else None

            label_raw = label_cell["text"].strip()
            value_text = value_cell["text"].strip() if value_cell else ""

            # Extract paragraph locator if present
            para_loc = None
            label_clean = label_raw
            if locate_paragraph:
                m = re.search(r"[/／]\s*[（(]([\d\.\s,，、\-]+)[）)]", label_raw)
                if m:
                    para_loc = m.group(1).strip()
                    label_clean = re.sub(r"\n?[/／]\s*[（(][\d\.\s,，、\-]+[）)]", "", label_raw).strip()

            label_clean = clean_label(label_clean)

            if label_clean:
                blanks = parse_blanks(value_text)
                row_entry = {
                    "label": label_clean,
                    "value": remove_blanks(value_text) if blanks else value_text,
                    "blanks": blanks,
                }
                if para_loc:
                    row_entry["paragraph"] = para_loc
                rows_out.append(row_entry)

    # Flush last nested group
    if current_label and current_sub_rows:
        flush_current()

    # Determine structure
    has_sub_rows = any("sub_rows" in r for r in rows_out)
    structure = "nested" if has_sub_rows else "flat"

    schema = {
        "keypoints": {
            "lesson": lesson_id,
            "structure": structure,
            "columns": columns,
            "rows": rows_out,
        }
    }
    if title_row:
        schema["keypoints"]["title"] = title_row
    if locate_paragraph:
        schema["keypoints"]["locate_paragraph"] = True

    return schema


def clean_label(text):
    """Normalize label text (strip whitespace, newlines)."""
    return re.sub(r"\s+", "", text).strip()


# ── SPOTLIGHT extraction ───────────────────────────────────────────────────

def detect_strategy_type(lesson_id, blocks):
    """Detect strategy type from lesson ID and document content."""
    lesson_num = int(re.search(r"L(\d+)", lesson_id).group(1))
    if lesson_num <= 27:
        # G6 lessons: summary PSE strategy
        return "summary_pse"
    else:
        # G7 lessons: image/table text integration
        full_text = " ".join(
            b["text"] for b in blocks if b["kind"] == "p"
        )
        if "表" in full_text and "圖" in full_text:
            return "table_text"
        return "image_text"


def find_spotlight_range(blocks):
    """
    Return (start_idx, end_idx) of spotlight section in blocks list.
    Spotlight = after vocab-application table (T#3/T#4 typically),
    before the 5-MCQ section.
    """
    # Find MCQ start: first paragraph matching （X）N. pattern
    mcq_start = None
    for i, b in enumerate(blocks):
        if b["kind"] == "p" and MCQ_RE.match(b["text"]):
            mcq_start = i
            break

    # Find spotlight start:
    # Look for the guide/intro block that precedes the exercises.
    # Heuristics: large content table (T#4 style) or ◎小試身手 / 步驟❶ paragraph
    spotlight_start = None

    for i, b in enumerate(blocks):
        if b["kind"] == "p":
            txt = b["text"]
            if re.match(r"[◎※]\s*(小試身手|閱讀聚光燈|前一課|許多文章|這篇故事|步驟[❶①])", txt):
                spotlight_start = i
                break
            if re.match(r"步驟[❶①]", txt):
                spotlight_start = i
                break
        elif b["kind"] == "table" and not b.get("scaffold"):
            # The guide intro table (1x1, has content) just before exercises
            if b["n_rows"] <= 2 and b["n_cols"] == 1:
                flat = " ".join(
                    c["text"] for row in b["rows"] for c in row["cells"]
                )
                if re.search(r"步驟|主角|問題|故事|聚光燈|圖文|閱讀", flat):
                    spotlight_start = i
                    break

    end_idx = mcq_start if mcq_start is not None else len(blocks)

    return spotlight_start, end_idx


def classify_block(b, idx, all_blocks, strategy_type):
    """
    Classify a single raw block (paragraph or table) into a spotlight block dict.
    Returns None if the block should be skipped.
    """
    if b["kind"] == "p":
        txt = b["text"]

        # Skip self-check section
        if re.match(r"[◎※]\s*自我檢核", txt):
            return None
        if re.match(r"□\s*\d+\.", txt):  # self-check items
            return None
        if re.match(r"如果[四五六七八]項都打勾", txt):
            return None
        if re.match(r"請你(勾選|自己|自我)", txt):
            return None

        # Guide block detection
        guide_markers = [
            r"^[◎※]\s*",                    # starts with ◎ or ※
            r"^小祕訣",                       # tip
            r"^步驟[❶❷❸❹①②③④]",            # step markers
            r"^練習[一二三四五]",              # practice labels
            r"前一課我們",                     # intro reference
            r"許多文章裡的圖",                 # guide intro
            r"這篇故事.*說明文",               # guide intro
            r"^(一|二|三|四|五|六|七)[、\.]", # numbered sections
            r"^現在請你",
            r"^再回頭看",
        ]
        for pat in guide_markers:
            if re.search(pat, txt):
                return {"type": "guide", "text": txt}

        # Self-check checkbox items — skip
        if re.match(r"^□\s*\d+\.", txt) or re.match(r"^□\s*[我]", txt):
            return {"type": "self_check_item", "_skip": True}

        # Self-check block header
        if re.match(r"^[◎※]?\s*自我檢核|^請你勾選", txt):
            return None

        # Detect questions
        # Pattern: ❶❷❸❹ (large bullets) = numbered exercise question
        # Pattern: 1. 2. etc. with actual question text
        # Pattern: (1) style
        exercise_q_re = re.compile(r"^[❶❷❸❹]\s*|^\d+[\.\、]\s*[^（\(]|^\(\d+\)")

        if exercise_q_re.match(txt):
            # Could be a question prompt or guide instruction
            # Check if it has options on following lines — we handle inline options
            return _classify_question_para(txt, strategy_type)

        # Numbered option in List Paragraph style
        if b.get("style") == "List Paragraph":
            return {"type": "passage_line", "_text": txt}

        # Default: guide text
        return {"type": "guide", "text": txt}

    elif b["kind"] == "table" and not b.get("scaffold"):
        flat = " ".join(
            c["text"] for row in b["rows"] for c in row["cells"] if not c.get("dup")
        )

        # Fill table (重點表) — reference only in spotlight
        if re.search(r"問題|解決|結果|研究問題|新說法|研究影響", flat) and \
           b["n_cols"] >= 2 and BLANK_RE.search(flat):
            return {"type": "fill_table", "_ref": "keypoints"}

        # Figure / data table with images
        if b["images"] > 0:
            return {"type": "figure", "referent": "image",
                    "asset": None, "bind_paragraph": None}

        # Vocab application table (2xN with vocab words) — skip
        if b["n_rows"] <= 3 and b["n_cols"] >= 4:
            return None

        # Single guide box (1x1)
        if b["n_rows"] <= 2 and b["n_cols"] == 1:
            cell_text = b["rows"][0]["cells"][0]["text"] if b["rows"] else ""
            if re.search(r"步驟|主角|故事|圖文|聚光燈|閱讀", cell_text):
                return {"type": "guide", "text": cell_text}

        # Data table (表一/表二) — figure with table referent
        if b["n_cols"] >= 2 and b["n_rows"] >= 3:
            return {"type": "figure", "referent": "table",
                    "asset": None, "bind_paragraph": None}

        return None

    return None


def _classify_question_para(txt, strategy_type):
    """Classify a paragraph that looks like a question."""
    # Detect options inline (□ markers)
    has_options = bool(re.search(r"□|①②③|[A-D]\.", txt))

    # Detect answer (no □ before it, or explicit marking)
    # For now: return as single/free_text, answer extraction done in post-process
    if has_options:
        return {"type": "single", "prompt": txt, "options": [], "answer": None,
                "_needs_answer_extraction": True}
    else:
        return {"type": "free_text", "prompt": txt}


def merge_passage_lines(blocks):
    """
    Merge consecutive passage_line items into passage blocks.
    Also detects supplementary passages (孟嘗君/大象/曹沖 = not lesson text).
    """
    SUPPLEMENTARY_MARKERS = re.compile(
        r"孟嘗君|白狐裘|曹沖|大象|讓我們來看|課文另一個|進階挑戰"
    )

    merged = []
    passage_buf = []
    is_supplementary = False

    def flush_passage():
        if passage_buf:
            source = "supplementary" if is_supplementary else "lesson_text"
            merged.append({
                "type": "passage",
                "source": source,
                "paragraphs": list(passage_buf),
            })
            passage_buf.clear()

    for b in blocks:
        if b is None:
            continue
        if b.get("_skip"):
            continue
        if b.get("type") == "passage_line":
            if not passage_buf:
                # Check context from preceding guide blocks
                # Look for supplementary markers in recent blocks
                for prev in reversed(merged[-3:]):
                    if prev.get("type") == "guide" and SUPPLEMENTARY_MARKERS.search(prev.get("text", "")):
                        is_supplementary = True
                        break
                else:
                    is_supplementary = False
            passage_buf.append(b["_text"])
        else:
            if passage_buf:
                flush_passage()
            merged.append(b)
    flush_passage()
    return merged


def extract_single_options(blocks, raw_blocks, spotlight_start, spotlight_end):
    """
    Post-process: for single/multi blocks that need answer extraction,
    find the answer by looking at which option lacks a □ marker.
    Uses the original raw paragraph sequence.
    """
    # Build a lookup of raw text in spotlight range
    raw_paras = [b["text"] for b in raw_blocks[spotlight_start:spotlight_end]
                 if b["kind"] == "p"]

    for b in blocks:
        if b.get("type") not in ("single", "multi"):
            continue
        if not b.get("_needs_answer_extraction"):
            continue

        prompt = b["prompt"]
        # Find this prompt in raw_paras
        try:
            pi = next(i for i, t in enumerate(raw_paras) if t == prompt or t.startswith(prompt[:20]))
        except StopIteration:
            continue

        # Collect option lines after prompt
        options = []
        answer = None
        for j in range(pi + 1, min(pi + 10, len(raw_paras))):
            line = raw_paras[j]
            # Stop at next question or guide marker
            if re.match(r"^[❶❷❸❹◎步驟練習]", line):
                break
            # Parse options from single line (multiple □ items)
            opts_in_line = re.split(r"\s*□\s*", line)
            # The item WITHOUT □ prefix is the answer; items WITH □ are distractors
            for opt in opts_in_line:
                opt = opt.strip()
                if not opt:
                    continue
                if line.startswith(opt):
                    # First item = no □ → answer
                    answer = opt
                    options.append(opt)
                else:
                    options.append(opt)
            if options:
                break

        b["options"] = options if options else None
        b["answer"] = answer
        del b["_needs_answer_extraction"]

    return blocks


def extract_self_check(raw_blocks, spotlight_start, spotlight_end):
    """Extract self-check items from the spotlight range."""
    items = []
    in_self_check = False
    for b in raw_blocks[spotlight_start:spotlight_end]:
        if b["kind"] != "p":
            continue
        if re.match(r"[◎※]\s*自我檢核", b["text"]):
            in_self_check = True
            continue
        if in_self_check:
            m = re.match(r"□\s*\d+\.(.*)", b["text"])
            if m:
                items.append(m.group(1).strip())
            elif re.match(r"如果[四五六七八]項", b["text"]):
                break
    return items


def build_spotlight_schema(lesson_id, blocks, raw_blocks, strategy_type, strategy_name):
    """Build the full spotlight schema dict."""
    spotlight_start, spotlight_end = find_spotlight_range(blocks)

    if spotlight_start is None:
        return {"spotlight": {"lesson": lesson_id, "error": "spotlight range not found"}}

    spotlight_blocks_raw = blocks[spotlight_start:spotlight_end]

    # Classify each block
    classified = []
    for b in spotlight_blocks_raw:
        result = classify_block(b, None, blocks, strategy_type)
        if result is not None:
            classified.append(result)

    # Merge passage lines
    classified = merge_passage_lines(classified)

    # Post-process answer extraction
    classified = extract_single_options(classified, raw_blocks, spotlight_start, spotlight_end)

    # Extract self-check items and add as block
    self_check_items = extract_self_check(raw_blocks, spotlight_start, spotlight_end)
    if self_check_items:
        classified.append({"type": "self_check", "items": self_check_items})

    # Clean up internal markers
    final_blocks = [b for b in classified if not b.get("_skip")]
    for b in final_blocks:
        b.pop("_ref", None)

    # Count nulls for answer tracking
    null_answers = [
        f"block[{i}].{b.get('type')}: {b.get('prompt', '')[:40]}"
        for i, b in enumerate(final_blocks)
        if b.get("type") in ("single", "multi") and b.get("answer") is None
    ]

    schema = {
        "spotlight": {
            "lesson": lesson_id,
            "strategy_name": strategy_name,
            "strategy_type": strategy_type,
            "blocks": final_blocks,
        }
    }

    if null_answers:
        schema["spotlight"]["_null_answers"] = null_answers

    return schema


# ── Main pipeline ──────────────────────────────────────────────────────────

LESSON_META = {
    "G6-L22": {
        "strategy_name": "摘要策略：問題．解決．結果結構",
        "strategy_type": "summary_pse",
        "title": "小兵立大功：雞鳴狗盜的故事",
    },
    "G6-L23": {
        "strategy_name": "摘要策略：問題．解決結構找重點",
        "strategy_type": "summary_pse",
        "title": "老鷹紅豆的故事",
    },
    "G6-L24": {
        "strategy_name": "摘要策略：問題．解決結構找重點",
        "strategy_type": "summary_pse",
        "title": "白鯨救援：一場人與自然的協奏曲",
    },
    "G6-L25": {
        "strategy_name": "摘要策略：問題．解決結構找重點（段落定位版）",
        "strategy_type": "summary_pse",
        "title": "全世界第一張股票的誕生",
    },
    "G7-L28": {
        "strategy_name": "圖文整合閱讀策略（初階）",
        "strategy_type": "image_text",
        "title": "看不見的兇手：以實驗破解肉湯腐敗之謎",
    },
    "G7-L29": {
        "strategy_name": "圖文整合閱讀策略（進階）",
        "strategy_type": "image_text",
        "title": "四張圖看地球暖化",
    },
    "G7-L30": {
        "strategy_name": "圖文表整合閱讀策略",
        "strategy_type": "table_text",
        "title": "都是八哥，為什麼命運不一樣？",
    },
}


def process_lesson(lesson_id, docx_path, output_dir):
    print(f"\n{'='*60}")
    print(f"Processing {lesson_id} : {Path(docx_path).name}")
    print('='*60)

    # Extract raw blocks
    raw_blocks = extract_raw(docx_path)

    meta = LESSON_META.get(lesson_id, {})
    strategy_name = meta.get("strategy_name", "未知策略")
    strategy_type = meta.get("strategy_type", "unknown")

    # 1. Build keypoints schema
    kp_table = find_keypoints_table(raw_blocks, lesson_id)
    if kp_table:
        kp_schema = extract_keypoints(kp_table, lesson_id)
        kp_path = Path(output_dir) / f"{lesson_id}.keypoints.yml"
        with open(kp_path, "w", encoding="utf-8") as f:
            yaml.dump(kp_schema, f, allow_unicode=True, default_flow_style=False,
                     sort_keys=False)
        print(f"[keypoints] Written to {kp_path}")
        print(f"  Rows: {len(kp_schema['keypoints']['rows'])}")
        print(f"  Structure: {kp_schema['keypoints']['structure']}")
        blank_count = sum(
            len(r.get("blanks", [])) + sum(len(sr.get("blanks", [])) for sr in r.get("sub_rows", []))
            for r in kp_schema["keypoints"]["rows"]
        )
        print(f"  Blanks found: {blank_count}")
    else:
        print(f"[keypoints] WARNING: No keypoints table found for {lesson_id}")
        kp_schema = None

    # 2. Build spotlight schema
    sp_schema = build_spotlight_schema(lesson_id, raw_blocks, raw_blocks, strategy_type, strategy_name)
    sp_path = Path(output_dir) / f"{lesson_id}.spotlight.yml"
    with open(sp_path, "w", encoding="utf-8") as f:
        yaml.dump(sp_schema, f, allow_unicode=True, default_flow_style=False,
                 sort_keys=False)
    print(f"[spotlight] Written to {sp_path}")
    blocks_list = sp_schema["spotlight"].get("blocks", [])
    print(f"  Blocks: {len(blocks_list)}")
    block_types = {}
    for b in blocks_list:
        bt = b.get("type", "unknown")
        block_types[bt] = block_types.get(bt, 0) + 1
    for bt, cnt in block_types.items():
        print(f"    {bt}: {cnt}")

    null_answers = sp_schema["spotlight"].get("_null_answers", [])
    if null_answers:
        print(f"  [!] {len(null_answers)} answer(s) need manual fill:")
        for na in null_answers:
            print(f"      {na}")

    return kp_schema, sp_schema


def main():
    parser = argparse.ArgumentParser(description="Build lesson schema from DOCX")
    parser.add_argument("lesson_id", help="Lesson ID e.g. G6-L22")
    parser.add_argument("docx_path", help="Path to DOCX file")
    parser.add_argument("--output-dir", default="private/curriculum-source/_online-schema",
                       help="Output directory for YAML files")
    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)

    if not os.path.exists(args.docx_path):
        print(f"ERROR: {args.docx_path} not found", file=sys.stderr)
        sys.exit(1)

    process_lesson(args.lesson_id, args.docx_path, args.output_dir)


if __name__ == "__main__":
    main()
