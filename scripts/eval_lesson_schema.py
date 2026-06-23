#!/usr/bin/env python3
"""
eval_lesson_schema.py — Quantitative eval for DOCX → spotlight/keypoints schema pipeline.
Uses metrics defined in docs/issue-2205-eval-standard.md.

Usage:
    python3 scripts/eval_lesson_schema.py <lesson_id> <docx_path> [--schema-dir DIR]
    python3 scripts/eval_lesson_schema.py --dev
    python3 scripts/eval_lesson_schema.py --test
    python3 scripts/eval_lesson_schema.py --report
"""

import sys
import os
import re
import json
import argparse
import importlib.util
from pathlib import Path

import yaml

# ─── Load eval_keypoints_text_fidelity module ─────────────────────────────────

def load_text_fidelity_module():
    spec = importlib.util.spec_from_file_location(
        "ektf", Path(__file__).parent / "eval_keypoints_text_fidelity.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# ─── Load gen_lesson_intent module ────────────────────────────────────────────

def load_intent_module():
    spec = importlib.util.spec_from_file_location(
        "gli", Path(__file__).parent / "gen_lesson_intent.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# ─── Load build_lesson_schema module ──────────────────────────────────────────

def load_bls():
    spec = importlib.util.spec_from_file_location(
        "bls", Path(__file__).parent / "build_lesson_schema.py"
    )
    bls = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(bls)
    return bls


# ─── DEV / TEST sets ──────────────────────────────────────────────────────────

PRIV_BASE = Path("/Users/young/project/chinese-literacy-platform/private/curriculum-source")
DOCX_DIR_PROF = PRIV_BASE / "2026-05-01/自學教材兩個單元"
DOCX_DIR_SL = PRIV_BASE / "2026-05-01/1.L1-158新版完成學習單1150415/2-1學生版(L1~122)"

DEV_SET = [
    ("G6-L22", DOCX_DIR_PROF / "G6-L22小兵立大功：雞鳴狗盜的故事（摘要策略-問題.解決.結果結構）.docx"),
    ("G6-L23", DOCX_DIR_PROF / "G6-L23老鷹紅豆的故事（摘要策略-問題.解決結構找重點）.docx"),
    ("G6-L24", DOCX_DIR_PROF / "G6-L24白鯨救援（摘要策略-問題.解決結構找重點）.docx"),
    ("G6-L25", DOCX_DIR_PROF / "G6-L25全世界第一張股票的誕生（摘要策略-問題.解決結構找重點）.docx"),
    ("G7-L28", DOCX_DIR_PROF / "G7-L28看不見的兇手：以實驗破解肉湯腐敗之謎（圖文整合閱讀策略）.docx"),
    ("G7-L29", DOCX_DIR_PROF / "G7-L29四張圖看地球暖化（圖文整合閱讀策略）.docx"),
    ("G7-L30", DOCX_DIR_PROF / "G7-L30都是八哥為什麼命運不一樣（圖文表整合閱讀策略）.docx"),
]

TEST_SET = [
    ("G4-SL10", DOCX_DIR_SL / "4年級/G4-SL10美好的一天（推論策略-推論情緒和感受）.docx"),
    ("G4-SL13", DOCX_DIR_SL / "4年級/G4-SL13第一百碗麵（想法感受的換位思考）.docx"),
    ("G5-SL7",  DOCX_DIR_SL / "5年級/G5-SL7堅持到底的棒球人生──周思齊(後篇)（推論策略-觀點找支持理由）.docx"),
    ("G5-SL10", DOCX_DIR_SL / "5年級/G5-SL10從童工到大學教授之路（推論策略-從言行推論人物特質）.docx"),
    ("G5-SL26", DOCX_DIR_SL / "5年級/G5-SL26數字記憶的奧秘(課次待改)（用表格整理訊息-比較異同）.docx"),
    ("G6-SL3",  DOCX_DIR_SL / "6年級/G6-SL3昆蟲會思考嗎？（解決問題-以實驗觀察找答案）.docx"),
    ("G6-SL8",  DOCX_DIR_SL / "6年級/G6-SL8動物談情說愛的方式（摘要策略-從結構找小主題與細節）.docx"),
    ("G6-SL14", DOCX_DIR_SL / "6年級/G6-SL14植物獵人（自我提問-問重要的問題）.docx"),
    ("G7-SL9",  DOCX_DIR_SL / "7年級/G7-SL9吐瓦魯：逐漸被淹沒的島國（表達看法-4F思考法）.docx"),
    ("G7-SL17", DOCX_DIR_SL / "7年級/G7-SL17用科學方法伸張正義的神探（解決問題-科學探究法）.docx"),
    ("G7-SL19", DOCX_DIR_SL / "7年級/G7-SL19「背影」讀書會（自我提問-詰問作者的步驟）.docx"),
    ("G8-SL4",  DOCX_DIR_SL / "8年級/G8-SL4新奇!「植物肉」你聽過嗎（推論策略-由課文觀點找出支持理由）.docx"),
    ("G8-SL8",  DOCX_DIR_SL / "8年級/G8-SL8隱形的征服者（推論策略-找出一連串因果）.docx"),
    ("G9-SL9",  DOCX_DIR_SL / "9年級/G9-SL9力與美表現的競技體操（圖表繪製與判讀-圖文表綜合判讀）.docx"),
    ("文-SL5",  DOCX_DIR_SL / "文言文/文-SL5重義的荀巨伯（人稱代詞）.docx"),
]

DEFAULT_SCHEMA_DIR = Path(
    "/Users/young/project/chinese-literacy-platform-issue-2205"
    "/private/curriculum-source/_online-schema"
)


# ─── Overfit lint ──────────────────────────────────────────────────────────────

def overfit_lint(script_path: Path) -> dict:
    """
    Detect hardcoded lesson IDs or course-specific strings in DETECTOR logic.
    Two checks:
    1. Lines with detection logic (re.compile/search/if...in) containing lesson-specific strings.
    2. regex compile lines (LABEL_FAMILIES / SUPPLEMENTARY_MARKERS) containing proper-noun
       overfit words — story character names, place names that appear in < 3 courses.

    Anti-patterns caught:
    - Lesson IDs: G6-L22, G7-SL17 etc.
    - Story-specific proper nouns used in detection regexes: 孟嘗君, 白鯨, 八哥, 曹沖 etc.
    - Crime-specific structural labels in LABEL_FAMILIES: 案件, 案發, 辦案 (use 歷程/真相 instead)

    Exclusions:
    - Comment lines (#)
    - Docstrings (between triple-quotes)
    - Lookup tables / path dicts: LESSON_META, DOCX_DIR, LESSON_DOCX, .docx
    - argparse help strings
    - extract_nested_tables function body (handles specific table shapes, not detection)
    - get_lesson_story_text (reads lesson yaml, not detection)
    """
    # Pattern: lesson IDs or story-specific proper nouns that only appear in 1-2 courses
    specific_course_re = re.compile(
        # Lesson IDs
        r"G[0-9][-_][SL]*[0-9]"
        # Story-specific character / place names — add here if found in future
        r"|孟嘗君|雞鳴狗盜|白鯨救援|曹沖|吐瓦魯"
        r"|白狐裘|八哥命運"
        # Crime-specific labels that overfit detective courses
        r"|案發|辦案"
        # Chinese character names of supplementary-passage stories (single-story markers)
        r"|荀巨伯|孝子"
    )
    # Lines that count as detection / classification logic
    detection_logic_re = re.compile(
        r"\bre\.(compile|search|match|findall)\b|"
        r"\bif\b.+(in\b|==\b)|"
        r"\breturn\b.+[{\"']type"
    )
    # Also flag bare regex continuation strings (r"...") inside re.compile blocks
    # that contain banned words — these are multi-line compile constructs.
    regex_continuation_re = re.compile(r"""^\s*r["']""")

    hits = []
    in_multiline_string = False
    in_compile_block = False   # True when we're inside a multi-line re.compile(...)

    with open(script_path, encoding="utf-8") as f:
        for i, line in enumerate(f, 1):
            stripped = line.strip()

            # Skip comments
            if stripped.startswith("#"):
                continue

            # Track multiline strings (docstrings)
            if '"""' in stripped or "'''" in stripped:
                count = stripped.count('"""') + stripped.count("'''")
                if count % 2 != 0:
                    in_multiline_string = not in_multiline_string
                continue
            if in_multiline_string:
                continue

            # Skip pure lookup tables / path dicts / argparse
            if any(kw in stripped for kw in [
                "LESSON_META", "DOCX_DIR", "LESSON_DOCX", "help=",
                "extract_nested_tables", "get_lesson_story_text", "argparse", ".docx"
            ]):
                continue

            # Detect start/end of re.compile blocks (for multi-line regex strings)
            if re.search(r"\bre\.compile\s*\(", stripped):
                in_compile_block = True
            if in_compile_block and ")" in stripped and not re.search(r"\bre\.compile\s*\(", stripped):
                in_compile_block = False

            # Check: line has specific course string AND (detection logic OR compile continuation)
            has_banned = specific_course_re.search(stripped)
            if has_banned:
                is_detection_line = detection_logic_re.search(stripped)
                is_compile_continuation = (
                    in_compile_block and
                    regex_continuation_re.match(line)
                )
                if is_detection_line or is_compile_continuation:
                    hits.append(f"  line {i}: {stripped[:100]}")

    return {"pass": len(hits) == 0, "hits": hits}


# ─── Metrics computation ───────────────────────────────────────────────────────

def eval_keypoints(lesson_id: str, docx_path: Path, schema_dir: Path, bls) -> dict:
    """Compute keypoints metrics."""
    kp_path = schema_dir / f"{lesson_id}.keypoints.yml"
    if not kp_path.exists():
        return {"available": False, "note": "no keypoints.yml (expected for image_text/table_text)"}

    with open(kp_path, encoding="utf-8") as f:
        kp_schema = yaml.safe_load(f)

    raw_blocks = bls.extract_raw(str(docx_path))
    kp_table_raw = bls.find_keypoints_table(raw_blocks, lesson_id)

    if kp_table_raw is None:
        return {"available": False, "note": "find_keypoints_table returned None"}

    # Count actual DOCX data rows (exclude title row + header row + empty-label rows)
    # Title row = first row with single merged cell, no blanks
    # Header row = row with 提示/元素/重點 keywords
    # Empty-label row = row where col0 is empty and col1 has no blanks (right-aligned title variant)
    rows_raw = kp_table_raw["rows"]
    skip = 0
    if rows_raw:
        first_non_dup = [c for c in rows_raw[0]["cells"] if not c.get("dup")]
        if len(first_non_dup) == 1 and not bls.BLANK_RE.search(first_non_dup[0]["text"]):
            skip += 1  # title row
        elif (len(first_non_dup) >= 2 and
              not first_non_dup[0]["text"].strip() and
              not first_non_dup[0].get("has_blank") and
              not bls.BLANK_RE.search(first_non_dup[1]["text"])):
            skip += 1  # empty-label header variant: col0 empty, col1 is a right-aligned title
    if skip < len(rows_raw):
        next_row = rows_raw[skip]
        next_cells = [c for c in next_row["cells"] if not c.get("dup")]
        cell_texts = " ".join(c["text"] for c in next_cells)
        if re.search(r"提示|元素|重點|段落", cell_texts):
            skip += 1  # header row
    docx_rows = max(0, kp_table_raw["n_rows"] - skip)

    # Count schema rows (top-level + sub_rows)
    # P0 fix (issue #2210): for 2-column tables (columns=['label','value']), sub_rows
    # represent the SECOND COLUMN's content per row, not additional rows.
    # Counting 1+len(sub_rows) double-counts → row_recall > 1.0 for these tables.
    # Detection: columns == ['label', 'value'] (no 'sub_label' column).
    # For 3-column tables (columns include 'sub_label'), sub_rows are genuine nested
    # questions — keep the original 1+len(sub_rows) formula for those.
    #
    # P2 fix: nested ['label','value'] tables DO use sub_rows for genuine nested questions
    # (e.g. G5-L11 with 発展歷程 parent + 2 sub-rows). These must use 1+len(sub_rows).
    # Detection: columns == ['label','value'] AND structure == 'nested'
    # Flat ['label','value'] tables still use len(rows_out).
    #
    # P3 fix (issue #2212): for 3-column nested tables (columns include 'sub_label'),
    # a parent row whose label merges vertically in the DOCX (i.e. has sub_rows but
    # no own value) does NOT occupy an extra physical row — the sub_rows themselves
    # account for all rows under that label.
    # Correct formula: if row has sub_rows → count len(sub_rows) only (not 1+sub_rows).
    # If row has no sub_rows → count 1.
    # This fixes G6-L22 summary_pse nested table: 解決(6 sub_rows)=6, not 7.
    rows_out = kp_schema.get("keypoints", {}).get("rows", [])
    schema_columns = kp_schema.get("keypoints", {}).get("columns", [])
    schema_structure = kp_schema.get("keypoints", {}).get("structure", "flat")
    is_two_col_flat = schema_columns == ["label", "value"] and schema_structure == "flat"
    if is_two_col_flat:
        # sub_rows = second-column content only (P0 fix), not additional rows
        schema_row_count = len(rows_out)
    else:
        schema_row_count = sum(
            len(r["sub_rows"]) if r.get("sub_rows") else 1
            for r in rows_out
        )

    row_recall = schema_row_count / docx_rows if docx_rows > 0 else 0.0

    # Blank recall — count DOCX fill-in blanks, excluding:
    #   (a) blanks in the first row of the value column that look like instructions
    #       e.g. "【 】處填入原文，找不到原文時，再用自己的話寫。"
    #   (b) blanks in col0 that ARE the label itself (pure-label form: fullmatch 【...】)
    #       e.g. "【 經過   】" — these become schema label strings, not fill-in blanks
    #   Mixed col0 blanks (text + blank) are extracted as label_blanks by the build script
    #   and counted here like any other schema blank.
    INSTRUCTION_BLANK_RE = re.compile(r"【\s*】\s*[處填找寫]")  # 【 】處... pattern

    docx_blanks = 0
    rows_raw_for_blank = kp_table_raw["rows"]
    n_cols_raw = kp_table_raw["n_cols"]
    for r_idx, row in enumerate(rows_raw_for_blank):
        cells = [c for c in row["cells"] if not c.get("dup")]
        for c_idx, cell in enumerate(cells):
            txt = cell.get("text", "")
            if not txt:
                continue
            # Skip label-column cells (col0) whose blank IS the label (pure-label form)
            # Heuristic: cell is in col0 AND the entire text is just a blank (± whitespace)
            if c_idx == 0 and re.fullmatch(r"【[^】]*】", txt.strip()):
                continue
            # Skip instruction-style blanks: "【 】處填入原文 ..."
            if INSTRUCTION_BLANK_RE.search(txt):
                # Subtract 1 for the instruction blank itself, count any additional real blanks
                all_blanks = bls.BLANK_RE.findall(txt)
                # An instruction cell typically has exactly 1 blank which is the instruction
                docx_blanks += max(0, len(all_blanks) - 1)
                continue
            docx_blanks += len(bls.BLANK_RE.findall(txt))

    # Count schema blanks including hint-field blanks (hint_value tables like G8-L19)
    # and label_blanks (col0 embedded blanks extracted by the build script)
    def count_row_blanks(r):
        n = len(r.get("blanks", []))
        n += len(r.get("label_blanks", []))  # blanks extracted from col0 label with text
        # hint_value tables: col1 (hint) may contain fill-in blanks (e.g. paragraph numbers)
        hint = r.get("hint", "")
        if hint:
            n += len(bls.BLANK_RE.findall(hint))
        return n

    schema_blanks = sum(
        count_row_blanks(sr)
        for r in rows_out
        for sr in ([r] + r.get("sub_rows", []))
    )
    blank_recall = schema_blanks / docx_blanks if docx_blanks > 0 else 1.0

    # Nesting preserved
    # A 3+ col table can be either hint_value (flat with hint field) or nested (sub_rows).
    # Both are valid encodings of a 3-col table — check that the schema uses EITHER.
    # Use EFFECTIVE column count (max non-dup cells across data rows) not n_cols from DOCX,
    # because n_cols may include empty/style-only columns (e.g. G9-L14 has n_cols=3 but
    # all data rows only have 2 effective cells — true 2-col table with paragraph locators
    # embedded in col0).
    data_rows = kp_table_raw["rows"][1:]  # skip title row if any
    effective_cols = max(
        (len([c for c in row["cells"] if not c.get("dup")])
         for row in data_rows),
        default=1
    )
    has_multi_col_docx = effective_cols >= 3
    nesting_preserved = True
    if has_multi_col_docx:
        # Schema structure field tells us which encoding was used
        schema_cols = kp_schema.get("keypoints", {}).get("columns", [])
        has_sub_rows = any("sub_rows" in r for r in rows_out)
        has_hint_field = any("hint" in r for r in rows_out)
        # Accept: nested (sub_rows present) OR hint_value (hint field present) OR
        # flat with 3-col encoding (columns includes "paragraph" / "hint" / "sub_label")
        nesting_preserved = (
            has_sub_rows or
            has_hint_field or
            any(c in schema_cols for c in ("hint", "sub_label", "paragraph"))
        )

    # Label family
    sname, stype = bls.detect_strategy_from_filename(str(docx_path))
    label_family_correct = stype != "unknown"

    passed = (
        row_recall >= 0.95 and
        blank_recall >= 0.95 and
        nesting_preserved and
        label_family_correct
    )

    return {
        "available": True,
        "row_recall": round(row_recall, 3),
        "blank_recall": round(blank_recall, 3),
        "nesting_preserved": nesting_preserved,
        "label_family_correct": label_family_correct,
        "docx_rows": docx_rows,
        "schema_rows": schema_row_count,
        "docx_blanks": docx_blanks,
        "schema_blanks": schema_blanks,
        "pass": passed,
    }


def eval_spotlight(lesson_id: str, docx_path: Path, schema_dir: Path, bls) -> dict:
    """Compute spotlight metrics."""
    sp_path = schema_dir / f"{lesson_id}.spotlight.yml"
    if not sp_path.exists():
        return {"available": False, "note": "no spotlight.yml"}

    with open(sp_path, encoding="utf-8") as f:
        sp_schema = yaml.safe_load(f)

    if "error" in sp_schema.get("spotlight", {}):
        return {"available": False, "note": sp_schema["spotlight"]["error"]}

    blocks = sp_schema["spotlight"].get("blocks", [])

    # MCQ leakage
    mcq_re = re.compile(r"^[（(]\s*[A-Za-z]\s*[）)]\s*\d+[\.\、]")
    mcq_leakage = sum(
        1 for b in blocks
        if b.get("type") in ("single", "multi") and
        mcq_re.match(b.get("prompt", ""))
    )

    # Guide retained
    guide_count = sum(1 for b in blocks if b.get("type") == "guide")
    guide_retained = guide_count > 0

    # Answer recall
    qa_blocks = [b for b in blocks if b.get("type") in ("single", "multi")]
    null_count = sum(1 for b in qa_blocks if b.get("answer") is None)
    answer_recall = (len(qa_blocks) - null_count) / len(qa_blocks) if qa_blocks else 1.0
    null_rate = null_count / len(qa_blocks) if qa_blocks else 0.0

    # Figure asset recall
    figure_blocks = [b for b in blocks if b.get("type") == "figure"]
    figures_with_asset = sum(1 for b in figure_blocks if b.get("asset"))
    figure_asset_recall = figures_with_asset / len(figure_blocks) if figure_blocks else 1.0

    # Null answers
    null_answers = sp_schema["spotlight"].get("_null_answers", [])

    passed = (
        mcq_leakage == 0 and
        guide_retained and
        answer_recall >= 0.99
    )

    return {
        "available": True,
        "block_count": len(blocks),
        "guide_count": guide_count,
        "guide_retained": guide_retained,
        "qa_total": len(qa_blocks),
        "null_count": null_count,
        "answer_recall": round(answer_recall, 3),
        "null_rate": round(null_rate, 3),
        "figure_count": len(figure_blocks),
        "figure_asset_recall": round(figure_asset_recall, 3),
        "mcq_leakage": mcq_leakage,
        "null_answers": null_answers,
        "pass": passed,
    }


def eval_strategy(lesson_id: str, docx_path: Path, bls) -> dict:
    """Evaluate strategy detection."""
    sname, stype = bls.detect_strategy_from_filename(str(docx_path))
    return {
        "strategy_type": stype,
        "strategy_name": sname[:40],
        "unknown": stype == "unknown",
    }


def eval_lesson(
    lesson_id: str,
    docx_path: Path,
    schema_dir: Path,
    bls,
    *,
    include_text_fidelity: bool = False,
    include_intent_drift: bool = False,
) -> dict:
    """Full eval for one lesson."""
    if not Path(docx_path).exists():
        return {"lesson_id": lesson_id, "error": "DOCX not found"}

    kp = eval_keypoints(lesson_id, docx_path, schema_dir, bls)
    sp = eval_spotlight(lesson_id, docx_path, schema_dir, bls)
    st = eval_strategy(lesson_id, docx_path, bls)

    result = {
        "lesson_id": lesson_id,
        "strategy": st,
        "keypoints": kp,
        "spotlight": sp,
    }

    if include_text_fidelity:
        ektf_mod = load_text_fidelity_module()
        kp_tf = ektf_mod.eval_keypoints_text_fidelity(
            lesson_id=lesson_id,
            docx_path=docx_path,
            schema_dir=schema_dir,
            bls=bls,
        )
        result["keypoints_text_fidelity"] = kp_tf

    if include_intent_drift:
        gli_mod = load_intent_module()
        drift = gli_mod.check_intent_stale_from_files(lesson_id, Path(schema_dir))
        result["intent_drift"] = drift

    return result


# ─── Reporting ─────────────────────────────────────────────────────────────────

def print_eval_table(results: list, label: str):
    print(f"\n{'='*80}")
    print(f"{label} ({len(results)} lessons)")
    print(f"{'='*80}")
    print(f"{'ID':<12} {'Strategy type':<24} {'KP?':<5} {'SP?':<5} {'AR':<6} {'BLK_R':<7} {'MCQ'}")
    print("-" * 80)

    kp_pass = sp_pass = ar_total = ar_pass = 0
    unknown_types = []
    null_answer_lessons = []

    for r in results:
        if "error" in r:
            print(f"{r['lesson_id']:<12} ERROR: {r['error']}")
            continue

        kp = r["keypoints"]
        sp = r["spotlight"]
        st = r["strategy"]

        kp_str = "PASS" if kp.get("pass") else ("N/A" if not kp.get("available") else "FAIL")
        sp_str = "PASS" if sp.get("pass") else ("N/A" if not sp.get("available") else "FAIL")
        ar = sp.get("answer_recall", 1.0) if sp.get("available") else 1.0
        br = kp.get("blank_recall", 1.0) if kp.get("available") else 1.0
        mcq = sp.get("mcq_leakage", 0) if sp.get("available") else 0

        print(f"{r['lesson_id']:<12} {st['strategy_type']:<24} {kp_str:<5} {sp_str:<5} {ar:.2f}   {br:.2f}    {mcq}")

        if kp.get("pass"): kp_pass += 1
        if sp.get("pass"): sp_pass += 1
        if st["unknown"]: unknown_types.append(r["lesson_id"])
        if sp.get("available") and sp.get("null_count", 0) > 0:
            null_answer_lessons.append((r["lesson_id"], sp["null_count"]))

    valid = len([r for r in results if "error" not in r])
    kp_eligible = len([r for r in results if "error" not in r and r["keypoints"].get("available")])
    sp_eligible = len([r for r in results if "error" not in r and r["spotlight"].get("available")])

    print(f"\nKeypoints PASS:    {kp_pass}/{kp_eligible}")
    print(f"Spotlight PASS:    {sp_pass}/{sp_eligible}")
    print(f"Strategy unknown:  {len(unknown_types)}/{valid}")
    if unknown_types:
        print(f"  Unknown: {unknown_types}")
    if null_answer_lessons:
        print(f"Null answers:      {null_answer_lessons}")

    return {
        "total": valid,
        "kp_eligible": kp_eligible,
        "sp_eligible": sp_eligible,
        "kp_pass": kp_pass,
        "sp_pass": sp_pass,
        "unknown_count": len(unknown_types),
        "kp_rate": kp_pass / kp_eligible if kp_eligible > 0 else 1.0,
        "sp_rate": sp_pass / sp_eligible if sp_eligible > 0 else 1.0,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("lesson_id", nargs="?", help="Lesson ID (e.g., G6-L22)")
    parser.add_argument("docx_path", nargs="?", help="Path to DOCX file")
    parser.add_argument("--schema-dir", default=str(DEFAULT_SCHEMA_DIR), help="Schema output dir")
    parser.add_argument("--dev", action="store_true", help="Eval DEV set (7 professor lessons)")
    parser.add_argument("--test", action="store_true", help="Eval TEST set (15 held-out lessons)")
    parser.add_argument("--report", action="store_true", help="Full report (DEV + TEST + gap)")
    parser.add_argument("--all", action="store_true", help="Eval all discovered DOCX lessons")
    parser.add_argument(
        "--text-fidelity",
        action="store_true",
        help="Also run keypoints text fidelity check (Slice ②)",
    )
    parser.add_argument(
        "--check-intent-drift",
        action="store_true",
        help="Also check intent drift (Slice ③ drift-lock)",
    )
    args = parser.parse_args()

    bls = load_bls()
    schema_dir = Path(args.schema_dir)

    # Overfit lint always runs
    lint_result = overfit_lint(Path(__file__).parent / "build_lesson_schema.py")
    lint_status = "PASS" if lint_result["pass"] else "FAIL"
    print(f"\nOverfit lint: {lint_status}")
    if not lint_result["pass"]:
        for hit in lint_result["hits"]:
            print(hit)

    if args.all:
        import importlib.util
        batch_spec = importlib.util.spec_from_file_location(
            "batch", Path(__file__).parent / "batch_all_lessons.py"
        )
        batch = importlib.util.module_from_spec(batch_spec)
        batch_spec.loader.exec_module(batch)
        all_results = [
            eval_lesson(
                lid, path, schema_dir, bls,
                include_text_fidelity=args.text_fidelity,
                include_intent_drift=args.check_intent_drift,
            )
            for lid, path in batch.discover_lessons()
        ]
        kp_eligible = [r for r in all_results if r.get("keypoints", {}).get("available")]
        kp_pass = sum(1 for r in kp_eligible if r["keypoints"].get("pass"))
        kp_fail = [
            (r["lesson_id"], r["keypoints"])
            for r in all_results
            if r.get("keypoints", {}).get("available") and not r["keypoints"].get("pass")
        ]
        print(f"\n{'='*80}")
        print(f"ALL LESSONS ({len(all_results)})")
        print(f"{'='*80}")
        print(f"Keypoints PASS: {kp_pass}/{len(kp_eligible)}")
        print(f"Keypoints N/A:  {len(all_results) - len(kp_eligible)}")
        if kp_fail:
            print("FAILURES:")
            for lid, kp in kp_fail:
                print(f"  {lid}: row_recall={kp.get('row_recall')} blank_recall={kp.get('blank_recall')} label_family={kp.get('label_family_correct')}")
        return

    if args.lesson_id and args.docx_path:
        # Single lesson eval
        result = eval_lesson(
            args.lesson_id,
            Path(args.docx_path),
            schema_dir,
            bls,
            include_text_fidelity=args.text_fidelity,
            include_intent_drift=args.check_intent_drift,
        )
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return

    if args.dev or args.report:
        dev_results = [eval_lesson(lid, p, schema_dir, bls) for lid, p in DEV_SET]
        dev_stats = print_eval_table(dev_results, "DEV SET (Professor 7)")

    if args.test or args.report:
        test_results = [eval_lesson(lid, p, schema_dir, bls) for lid, p in TEST_SET]
        test_stats = print_eval_table(test_results, "TEST SET (Held-out 15)")

    if args.report:
        print(f"\n{'='*80}")
        print("GENERALIZATION ANALYSIS")
        print(f"{'='*80}")
        dev_kp_rate = dev_stats["kp_rate"]
        test_kp_rate = test_stats["kp_rate"]
        dev_sp_rate = dev_stats["sp_rate"]
        test_sp_rate = test_stats["sp_rate"]
        kp_gap = dev_kp_rate - test_kp_rate
        sp_gap = dev_sp_rate - test_sp_rate
        print(f"DEV  KP pass rate: {dev_kp_rate:.2f} | SP pass rate: {dev_sp_rate:.2f}")
        print(f"TEST KP pass rate: {test_kp_rate:.2f} | SP pass rate: {test_sp_rate:.2f}")
        print(f"generalization_gap (KP): {kp_gap:+.2f}", "  <-- OVERFIT WARNING" if kp_gap > 0.15 else "")
        print(f"generalization_gap (SP): {sp_gap:+.2f}", "  <-- OVERFIT WARNING" if sp_gap > 0.15 else "")
        print(f"Overfit lint: {lint_status}")


if __name__ == "__main__":
    main()
