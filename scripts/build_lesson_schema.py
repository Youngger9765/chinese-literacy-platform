#!/usr/bin/env python3
"""
build_lesson_schema.py  —  issue #2205 experiment
Converts raw DOCX lesson worksheets into spotlight.yml + keypoints.yml schemas.
Also extracts embedded images and data tables as assets.

Usage:
    python3 scripts/build_lesson_schema.py <lesson_id> <docx_path> [--output-dir DIR]
    python3 scripts/build_lesson_schema.py --all [--output-dir DIR]

Output:
    private/curriculum-source/_online-schema/<lesson>.spotlight.yml
    private/curriculum-source/_online-schema/<lesson>.keypoints.yml
    private/curriculum-source/_online-schema/assets/<lesson>/fig1.png ...
    private/curriculum-source/_online-schema/assets/<lesson>/table1.json ...
"""
import sys, json, re, os, argparse, zipfile, shutil
from pathlib import Path
import yaml  # pip install pyyaml

import docx
from docx.oxml.table import CT_Tbl
from docx.oxml.text.paragraph import CT_P
from docx.table import Table
from docx.text.paragraph import Paragraph
from lxml import etree

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
SCAFFOLD_RE = re.compile(r"計時|裁判|還要多加練習|哇嗚|超級厲害|影片連結|我的表現|秒以下|秒以上")
MCQ_RE = re.compile(r"^[（(]\s*[A-Za-zＡ-Ｚ]\s*[）)]\s*\d+[\.\、]")
BLANK_RE = re.compile(r"【(.*?)】")
MCQ_PROMPT_RE = re.compile(r"（單選）|\(單選\)|（複選）|\(複選\)|（多選）|\(多選\)|三選二|二選一")
OPTION_LINE_RE = re.compile(r"^[①②③④⑤⑥⑦⑧⑨⑩]|^□\s*[①②③④⑤⑥⑦⑧⑨⑩]|^□[^步驟小祕訣練習※]")
GUIDE_HEADER_RE = re.compile(
    r"^步驟[❶❷❸❹①②③④]|^小祕訣|^小提醒|^練習[一二三四五六七八九十]|^說明：|^前一課|^※|^[◎※]\s*自我檢核"
)


def is_option_line(text: str) -> bool:
    """True when a paragraph is an MCQ option line (①… or □②…), not teaching guide."""
    t = (text or "").strip()
    if not t or GUIDE_HEADER_RE.match(t):
        return False
    if MCQ_PROMPT_RE.search(t) and not t.startswith("□") and not OPTION_LINE_RE.match(t):
        # Question stem ending with （單選）— handled as prompt, not option
        return False
    if t.startswith("□"):
        return True
    if re.match(r"^[①②③④⑤⑥⑦⑧⑨⑩]", t):
        return True
    return False


def parse_option_line(text: str) -> tuple[str, bool]:
    """Return (clean_option_text, is_distractor). Distractor lines start with □."""
    t = (text or "").strip()
    is_dist = t.startswith("□")
    t = re.sub(r"^□\s*", "", t)
    t = re.sub(r"^[①②③④⑤⑥⑦⑧⑨⑩]\s*", "", t)
    return t.strip(), is_dist


def split_inline_box_options(text: str) -> list[tuple[str, bool]] | None:
    """
    Parse a single guide line with multiple □-separated options.
    Returns list of (text, is_distractor) or None if not an option line.
    """
    t = (text or "").strip()
    if GUIDE_HEADER_RE.match(t):
        return None

    # □①distractor  ②answer — line starts with box, second circled option is answer
    if t.startswith("□") and len(re.findall(r"[①②③④⑤]", t)) >= 2:
        rest = re.sub(r"^□\s*", "", t)
        chunks = re.findall(r"([①②③④⑤])\s*([^①②③④⑤]+)", rest)
        if len(chunks) >= 2:
            parsed: list[tuple[str, bool]] = []
            for idx, (_, body) in enumerate(chunks):
                body = body.strip()
                if body:
                    parsed.append((body, idx == 0))
            if len(parsed) >= 2:
                return parsed

    if "□" not in t:
        return None
    parts = re.split(r"\s*□\s*", t)
    out: list[tuple[str, bool]] = []
    for i, part in enumerate(parts):
        part = part.strip()
        if not part:
            continue
        clean = re.sub(r"^[①②③④⑤]\s*", "", part).strip()
        if not clean:
            continue
        out.append((clean, i > 0 or (i == 0 and t.startswith("□"))))
    if len(out) < 2:
        return None
    if t.startswith("□"):
        return [(p, True) for p, _ in out]
    return [(out[0][0], False)] + [(p, True) for p, _ in out[1:]]


def _is_mcq_prompt_block(block: dict) -> bool:
    if block.get("type") == "free_text":
        return bool(MCQ_PROMPT_RE.search(block.get("prompt", "")))
    if block.get("type") == "single":
        return bool(block.get("_needs_answer_extraction")) or bool(
            MCQ_PROMPT_RE.search(block.get("prompt", ""))
        )
    if block.get("type") == "guide":
        return bool(MCQ_PROMPT_RE.search(block.get("text", "")))
    return False


def _prompt_text(block: dict) -> str:
    if block.get("type") == "guide":
        return block.get("text", "")
    return block.get("prompt", "")


def _append_options_from_block(
    block: dict,
    options: list[str],
    answer: str | None,
) -> str | None:
    """Extract MCQ options from guide / _option_line block into running lists."""
    if block.get("type") not in ("guide", "_option_line"):
        return answer
    gtext = block.get("text", "")
    inline = split_inline_box_options(gtext)
    if inline:
        for opt_text, is_dist in inline:
            if opt_text:
                options.append(opt_text)
                if not is_dist and answer is None:
                    answer = opt_text
        return answer
    if is_option_line(gtext):
        opt_text, is_dist = parse_option_line(gtext)
        if opt_text:
            options.append(opt_text)
            if not is_dist and answer is None:
                answer = opt_text
    return answer


def _collect_option_run(blocks: list, start: int) -> tuple[list[str], str | None, int]:
    options: list[str] = []
    answer: str | None = None
    j = start
    while j < len(blocks):
        nxt = blocks[j]
        ntype = nxt.get("type")
        if ntype in ("guide", "_option_line"):
            gtext = nxt.get("text", "").strip()
            if ntype == "guide" and GUIDE_HEADER_RE.match(gtext):
                break
            if not is_option_line(gtext) and not split_inline_box_options(gtext):
                break
        else:
            break
        answer = _append_options_from_block(nxt, options, answer)
        j += 1
    return options, answer, j


def coalesce_mcq_option_blocks(blocks: list) -> list:
    """
    Merge free_text/guide question prompts + following option lines into single blocks.
    Fixes G7-L29-style misclassification where ①/□② lines became guide blocks.
    """
    out: list = []
    i = 0
    while i < len(blocks):
        b = blocks[i]

        if _is_mcq_prompt_block(b):
            prompt = _prompt_text(b)
            options: list[str] = []
            answer = None
            j = i + 1

            run_opts, run_ans, j = _collect_option_run(blocks, j)
            options.extend(run_opts)
            if answer is None:
                answer = run_ans

            if len(options) >= 2:
                out.append({
                    "type": "single",
                    "prompt": prompt,
                    "options": options,
                    "answer": answer or options[0],
                })
                i = j
                continue

        # Question (free_text or short guide) + following ①/□ option lines
        if (
            b.get("type") in ("guide", "_option_line")
            and out
            and is_option_line(b.get("text", ""))
        ):
            prev = out[-1]
            prev_prompt = ""
            if prev.get("type") == "free_text":
                prev_prompt = prev.get("prompt", "")
            elif prev.get("type") == "guide":
                prev_text = prev.get("text", "").strip()
                if (
                    ("？" in prev_text or "?" in prev_text)
                    and not GUIDE_HEADER_RE.match(prev_text)
                    and not MCQ_PROMPT_RE.search(prev_text)
                ):
                    prev_prompt = prev_text
            if prev_prompt and ("？" in prev_prompt or "?" in prev_prompt):
                options, answer, j = _collect_option_run(blocks, i)
                if len(options) >= 2:
                    out.pop()
                    out.append({
                        "type": "single",
                        "prompt": prev_prompt,
                        "options": options,
                        "answer": answer or options[0],
                    })
                    i = j
                    continue

        # Standalone inline multi-option guide (G6-L22 ❷/❸ style) after free_text without （單選）
        if (
            b.get("type") == "guide"
            and i > 0
            and out
            and out[-1].get("type") == "free_text"
            and not MCQ_PROMPT_RE.search(out[-1].get("prompt", ""))
        ):
            inline = split_inline_box_options(b.get("text", ""))
            if inline and len(inline) >= 2:
                prev = out.pop()
                options = []
                answer = None
                for opt_text, is_dist in inline:
                    options.append(opt_text)
                    if not is_dist and answer is None:
                        answer = opt_text
                out.append({
                    "type": "single",
                    "prompt": prev.get("prompt", ""),
                    "options": options,
                    "answer": answer or options[0],
                })
                i += 1
                continue

        if b.get("type") == "_option_line":
            # Orphan option line — keep as guide fallback
            out.append({"type": "guide", "text": b.get("text", "")})
        else:
            out.append(b)
        i += 1

    return out

DOCX_DIR = "/Users/young/project/chinese-literacy-platform/private/curriculum-source/2026-05-01/自學教材兩個單元"
LESSON_DOCX = {
    "G6-L22": f"{DOCX_DIR}/G6-L22小兵立大功：雞鳴狗盜的故事（摘要策略-問題.解決.結果結構）.docx",
    "G6-L23": f"{DOCX_DIR}/G6-L23老鷹紅豆的故事（摘要策略-問題.解決結構找重點）.docx",
    "G6-L24": f"{DOCX_DIR}/G6-L24白鯨救援（摘要策略-問題.解決結構找重點）.docx",
    "G6-L25": f"{DOCX_DIR}/G6-L25全世界第一張股票的誕生（摘要策略-問題.解決結構找重點）.docx",
    "G7-L28": f"{DOCX_DIR}/G7-L28看不見的兇手：以實驗破解肉湯腐敗之謎（圖文整合閱讀策略）.docx",
    "G7-L29": f"{DOCX_DIR}/G7-L29四張圖看地球暖化（圖文整合閱讀策略）.docx",
    "G7-L30": f"{DOCX_DIR}/G7-L30都是八哥為什麼命運不一樣（圖文表整合閱讀策略）.docx",
}


# ── DOCX raw extraction ─────────────────────────────────────────────────────

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
    blips = el.findall(f".//{{{A_NS}}}blip")
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


# ── Asset extraction ────────────────────────────────────────────────────────

def extract_assets(docx_path, lesson_id, asset_dir, lesson_meta):
    """
    Extract embedded images from DOCX in document order.
    Returns list of asset info dicts: {seq, filename, docx_file, role, bind_context}

    For G7 image-text lessons, the main course-content table (T#1) contains:
    - Sub-images that are the 圖一/圖二/圖三/圖四 referenced in exercises
    - These are extracted in XML blip order = document display order

    For G7-L30, T#1 also contains nested 表一/表二 which are extracted as JSON.

    Excluded from assets:
    - Images appearing in the cover/header table (T#1 first cell header row)
    - Images in scaffold (影片連結) tables
    - Decorative images (small QR codes, logos, etc.)
    """
    strategy_type = lesson_meta.get("strategy_type", "")
    asset_dir = Path(asset_dir)
    asset_dir.mkdir(parents=True, exist_ok=True)

    assets = []

    with zipfile.ZipFile(docx_path, 'r') as z:
        # Build relationship map: rId -> media filename
        rels_xml = z.read('word/_rels/document.xml.rels')
        rels_tree = etree.fromstring(rels_xml)
        rel_map = {}
        for rel in rels_tree:
            rid = rel.get('Id')
            target = rel.get('Target')
            if target and 'media' in target:
                rel_map[rid] = target  # e.g. "media/image4.jpeg"

        doc_xml = z.read('word/document.xml')
        doc_tree = etree.fromstring(doc_xml)
        body = doc_tree.find(f'.//{{{W[1:-1]}}}body')

        # Walk body to collect image embed refs with context
        # Track: (doc_order, element_tag, context_text, rId, filename)
        doc_order = 0
        img_records = []

        for child in body:
            raw_tag = child.tag.split('}')[-1] if '}' in child.tag else child.tag
            blips = child.findall(f".//{{{A_NS}}}blip")

            # Get context text for this element
            paras = child.findall(f".//{{{W[1:-1]}}}p")
            context_text = ""
            for p in paras:
                runs = p.findall(f".//{{{W[1:-1]}}}t")
                text = ''.join(r.text or '' for r in runs).strip()
                if text:
                    context_text = text[:80]
                    break

            is_scaffold = SCAFFOLD_RE.search(context_text) is not None

            if blips:
                for blip in blips:
                    embed = blip.get(f'{{{R_NS}}}embed')
                    if embed and embed in rel_map:
                        media_path = rel_map[embed]
                        img_records.append({
                            "doc_order": doc_order,
                            "element_tag": raw_tag,
                            "context": context_text,
                            "rId": embed,
                            "media_path": media_path,
                            "is_scaffold": is_scaffold,
                        })
            doc_order += 1

        # Filter: exclude logos (image1.png = level badge), scaffold tables, MCQ decorations
        EXCLUDED_CONTEXTS = re.compile(r"Level \d|請根據文章內容，選出|選出最適合的答案")

        course_imgs = [
            r for r in img_records
            if not r["is_scaffold"]
            and not EXCLUDED_CONTEXTS.search(r["context"])
        ]

        # For G7 image-text lessons, further filter: only include images
        # that appear in the main course content table (T#1, doc_order=4)
        # and the section-divider images (二/三/四 markers at doc_order ~7,136...)
        if strategy_type in ("image_text", "table_text"):
            # Find the main course table (has 圖一/圖二 context or is T#1 with images)
            # Include images from:
            # 1. doc_order == 4 (T#1 main course table with the actual figures)
            # 2. Section images: context starts with 二/三/四 (single char section markers)
            section_marker_re = re.compile(r"^[二三四五六]$")
            course_imgs = [
                r for r in course_imgs
                if (
                    r["doc_order"] == 4  # T#1 main course content table
                    or section_marker_re.match(r["context"])
                    or (r["element_tag"] == "p" and re.match(r"^[二三四]", r["context"]))
                )
            ]

        # Extract and save images
        fig_counter = 1
        for rec in course_imgs:
            src_path = f"word/{rec['media_path']}"
            ext = Path(rec['media_path']).suffix or '.png'
            dest_name = f"fig{fig_counter}{ext}"
            dest_path = asset_dir / dest_name

            with z.open(src_path) as src, open(dest_path, 'wb') as dst:
                shutil.copyfileobj(src, dst)

            assets.append({
                "seq": fig_counter,
                "filename": dest_name,
                "context": rec["context"],
                "rId": rec["rId"],
            })
            fig_counter += 1

    # For G7-L30: also extract nested tables (表一/表二) as JSON
    if lesson_id == "G7-L30":
        table_assets = extract_nested_tables_g7l30(docx_path, asset_dir)
        assets.extend(table_assets)

    return assets


def extract_nested_tables_g7l30(docx_path, asset_dir):
    """Extract 表一 and 表二 from G7-L30 as structured JSON assets."""
    table_assets = []
    d = docx.Document(docx_path)
    ti = 0
    for child in d.element.body.iterchildren():
        if isinstance(child, CT_Tbl):
            tbl = Table(child, d)
            if ti == 1:  # T#1 = main course content table
                # Nested tables are in cell[2,1] (course text column)
                # Avoid duplication from merged cell — use cell[2,1]
                try:
                    cell = tbl.rows[2].cells[1]
                except IndexError:
                    break

                nested_tbls = cell._tc.findall(f'.//{W}tbl')
                for nt_idx, nt in enumerate(nested_tbls):
                    table_num = nt_idx + 1
                    rows_nt = nt.findall(f'{W}tr')
                    table_data = []
                    notes = []

                    for ri, row in enumerate(rows_nt):
                        tc_els = row.findall(f'.//{W}tc')
                        seen = set()
                        row_data = []
                        for tc in tc_els:
                            tc_id = id(tc)
                            if tc_id in seen:
                                row_data.append(None)  # merged cell placeholder
                                continue
                            seen.add(tc_id)
                            cell_text = ''.join(
                                run.text or ''
                                for run in tc.findall(f'.//{W}t')
                            ).strip()
                            row_data.append(cell_text)

                        # Filter out all-None rows
                        if any(c is not None and c != '' for c in row_data):
                            table_data.append(row_data)

                        # Extract footnotes (rows starting with 註)
                        flat_text = ' '.join(c for c in row_data if c)
                        if re.match(r'[（(]?[註注]\d', flat_text):
                            notes.append(flat_text)

                    dest_name = f"table{table_num}.json"
                    dest_path = Path(asset_dir) / dest_name
                    json_data = {
                        "table_num": table_num,
                        "n_rows": len(table_data),
                        "n_cols": max((len(r) for r in table_data), default=0),
                        "rows": table_data,
                        "notes": notes,
                    }
                    with open(dest_path, 'w', encoding='utf-8') as f:
                        json.dump(json_data, f, ensure_ascii=False, indent=2)

                    table_assets.append({
                        "seq": f"table{table_num}",
                        "filename": dest_name,
                        "context": f"表{table_num}",
                        "type": "data_table",
                    })
            ti += 1

    return table_assets


# ── Helper: parse blanks from cell text ────────────────────────────────────

def parse_blanks(text):
    """Return list of {answer, hint} dicts from 【...】 patterns in text.
    Excludes instruction blanks of the form 【 】處填入原文 / 【 】填入... which are
    meta-annotations, not student fill-in slots.
    """
    # Instruction blank: empty/whitespace 【】 followed by action word
    INSTRUCTION_BLANK_RE = re.compile(r"【\s*】\s*[處填找寫]")
    if INSTRUCTION_BLANK_RE.search(text):
        # This cell is an instruction cell — skip all blanks in it
        return []
    blanks = []
    for m in BLANK_RE.finditer(text):
        raw = m.group(1).strip()
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
    Find the keypoints table (文章重點表 / 聚光燈重點表) in the document.

    Detection strategy uses STRUCTURAL FEATURES, not lesson-specific strings:

    1. Required: non-scaffold, n_rows >= 2, n_cols >= 2 (not a 1x1 guide box)
    2. Required: contains 【...】 blanks (fill-in cells = definitive keypoints signal)
    3. Scoring by label-family match in first column:
       - 摘要/PSE family: 問題, 解決, 結果, 迴響
       - 敘事人物 family: 主角, 主題, 特質, 事例, 家庭, 背景, 翻身, 體會, 心得,
                          起因, 經過, 結果, 結論
       - 研究/科探 family: 研究問題, 假說, 實驗, 驗證, 結論, 歷程, 真相
       - 比較/觀點 family: 危機, 因應, 挑戰, 作者反思, 4F, 總結
       - 大主題/小主題 family: 大主題, 小主題, 段落, 第N段
       - Hint_value family: 元素, 提示, 重點, 段落定位

    Bias AWAY from: vocab-application tables (2-3 rows × 4+ cols with vocab code slots)
    """
    # First-column label families (for scoring — not required)
    # Rules: use structural/semantic labels that generalise across many courses.
    # Do NOT add story-specific proper nouns (character names, case titles, etc.)
    # — those overfit to a single course and hurt generalization.
    LABEL_FAMILIES = re.compile(
        # PSE / summary
        r"問題|解決|迴響|研究問題|新說法|假說"
        # Narrative / character
        r"|主角|主題|特質|事例|家庭|背景|翻身|體會|心得|起因|經過"
        # Scientific inquiry / causal sequence
        # NOTE: 案件/案發/辦案 removed — crime-specific proper labels, not structural.
        # Tables containing these labels are selected via blank-density scoring instead.
        r"|實驗|驗證|研究影響|歷程|真相"
        # Comparison / opinion
        r"|危機|因應|挑戰|作者反思|總結|目的|原因|影響|方法"
        # Topic-based
        r"|大主題|小主題|第\\d段|段落|細節"
        # hint_value
        r"|元素|提示|重點|結果|結論"
    )

    candidates = []
    for b in blocks:
        if b["kind"] != "table" or b.get("scaffold"):
            continue
        if b["n_rows"] < 2 or b["n_cols"] < 2:
            continue

        flat = " ".join(
            c["text"] for row in b["rows"]
            for c in row["cells"] if not c.get("dup")
        )
        has_blank = bool(BLANK_RE.search(flat))
        if not has_blank:
            continue

        # Exclude vocab-application tables: few rows × many cols (e.g., 2x6, 3x8)
        if b["n_rows"] <= 3 and b["n_cols"] >= 5:
            continue

        # Count label-family matches in first column only
        first_col_text = " ".join(
            row["cells"][0]["text"]
            for row in b["rows"]
            if row["cells"] and not row["cells"][0].get("dup")
        )
        label_hits = len(LABEL_FAMILIES.findall(first_col_text))
        blank_count = len(BLANK_RE.findall(flat))

        # Scoring: label hits + blank density + row count
        # A table with 0 label hits but many blanks can still qualify (e.g., comparison tables)
        score = label_hits * 10 + min(blank_count, 20) + b["n_rows"]
        candidates.append((score, b))

    if not candidates:
        return None
    candidates.sort(key=lambda x: -x[0])
    return candidates[0][1]


def extract_keypoints(table, lesson_id):
    """
    Extract the keypoints table into structured schema.
    Handles:
      - nested: 3-col with shared parent label (G6-L22 問題/解決/結果)
      - hint_value: 3-col with header 元素/提示/重點 (G6-L24/L25)
      - flat: 2-col with label | value (G6-L23, G7-L28)
      - locate_paragraph: label cell contains paragraph locator /（N.M）
    """
    rows_raw = table["rows"]
    n_cols = table["n_cols"]

    # Detect hint_value format: header row contains 提示/元素/重點/段落
    is_hint_value = False
    if n_cols >= 3 and rows_raw:
        header_flat = " ".join(
            c["text"] for c in rows_raw[0]["cells"] if not c.get("dup")
        )
        if re.search(r"提示|元素|重點|段落", header_flat):
            is_hint_value = True

    # Detect nested: 3-col where first col label text repeats across rows
    # (Use text identity, NOT vmerge — python-docx reports vmerge=restart for ALL rows)
    is_nested = False
    if n_cols >= 3 and not is_hint_value:
        label_texts = []
        for row in rows_raw:
            cells = [c for c in row["cells"] if not c.get("dup")]
            if len(cells) >= 3:
                label_texts.append(cells[0]["text"].strip())
        if len(label_texts) >= 3:
            from collections import Counter
            label_counts = Counter(t for t in label_texts if t)
            if any(v > 1 for v in label_counts.values()):
                is_nested = True

    # Detect segment locator pattern (e.g., "問題\n/（1.2）")
    locate_paragraph = False
    for row in rows_raw:
        cells = [c for c in row["cells"] if not c.get("dup")]
        if cells and re.search(r"[/／]\s*[（(]", cells[0]["text"]):
            locate_paragraph = True
            break

    # Determine column semantics
    if is_hint_value:
        columns = ["label", "hint", "value"]
    elif is_nested:
        columns = ["label", "sub_label", "value"]
    elif locate_paragraph:
        columns = ["label", "paragraph", "value"]
    else:
        columns = ["label", "value"]

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

    # Check for title row (single merged cell, no blanks)
    first_row = rows_raw[0] if rows_raw else None
    start_idx = 0
    if first_row:
        non_dup = [c for c in first_row["cells"] if not c.get("dup")]
        if len(non_dup) == 1 and not BLANK_RE.search(non_dup[0]["text"]):
            title_row = non_dup[0]["text"]
            start_idx = 1

    # Check for header row (提示/元素/重點 etc.)
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
            # hint_value: col0=label(+locator), col1=hint, col2=value
            label_raw = cells[0]["text"].strip()
            hint_text = cells[1]["text"].strip()
            value_text = cells[2]["text"].strip()

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
            # For tables with 4+ columns, join all cells[2:] to avoid dropping extra cols
            label_text = clean_label(cells[0]["text"])
            sub_label_text = cells[1]["text"].strip()
            # Join all value columns (cells[2:]) — handles 4/5/6-col tables
            value_text = " ".join(c["text"].strip() for c in cells[2:] if c["text"].strip())

            # Detect label change by TEXT IDENTITY (not vmerge — unreliable in python-docx)
            if label_text and label_text != current_label:
                flush_current()
                current_sub_rows = []
                current_label = label_text

            # Extract blanks from sub_label column too (e.g. "【第一】\n困難" label cells)
            sub_label_blanks = parse_blanks(sub_label_text)
            # Strip blanks from sub_label to get clean display label
            sub_label_clean = remove_blanks(sub_label_text) if sub_label_blanks else sub_label_text

            if sub_label_text:
                blanks = sub_label_blanks + parse_blanks(value_text)
                template = remove_blanks(value_text)
                current_sub_rows.append({
                    "sub_label": sub_label_clean,
                    "template": template,
                    "blanks": blanks,
                })
            else:
                blanks = parse_blanks(value_text)
                if current_label and not current_sub_rows:
                    rows_out.append({
                        "label": current_label,
                        "value": remove_blanks(value_text) if blanks else value_text,
                        "blanks": blanks,
                    })
                    current_label = None

        else:
            # 2-col (or 3-col with merged col1): label | value
            # MUST flush pending nested group first to preserve order
            if current_label and current_sub_rows:
                flush_current()
                current_sub_rows = []
                current_label = None

            label_raw = cells[0]["text"].strip()
            value_text = cells[1]["text"].strip() if len(cells) > 1 else ""

            para_loc = None
            label_clean = label_raw
            if locate_paragraph:
                m = re.search(r"[/／]\s*[（(]([\d\.\s,，、\-]+)[）)]", label_raw)
                if m:
                    para_loc = m.group(1).strip()
                    label_clean = re.sub(r"\n?[/／]\s*[（(][\d\.\s,，、\-]+[）)]", "", label_raw).strip()

            # Extract blanks embedded in the label column (col0) when the cell has both text
            # and fill-in slots (e.g. "睡眠的\n【 好處  】" or "仍待解決的問題：\n1.女性運動員的【努力/成就】").
            # Pure-label blanks (fullmatch 【...】) are already used as the label text; skip those.
            label_blanks = []
            if not re.fullmatch(r"【[^】]*】", label_clean.strip()):
                raw_label_blanks = parse_blanks(label_clean)
                if raw_label_blanks:
                    label_blanks = raw_label_blanks
                    label_clean = remove_blanks(label_clean)

            label_clean = clean_label(label_clean)

            if label_clean:
                blanks = parse_blanks(value_text)
                row_entry = {
                    "label": label_clean,
                    "value": remove_blanks(value_text) if blanks else value_text,
                    "blanks": blanks,
                }
                if label_blanks:
                    row_entry["label_blanks"] = label_blanks
                if para_loc:
                    row_entry["paragraph"] = para_loc
                rows_out.append(row_entry)

    # Flush last nested group
    if current_label and current_sub_rows:
        flush_current()

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

def find_spotlight_range(blocks):
    """
    Return (start_idx, end_idx) of spotlight section in blocks list.
    Spotlight = after vocab-application table (T#3/T#4 typically),
    before the 5-MCQ section.
    """
    # MCQ start: first paragraph matching （X）N. pattern
    mcq_start = None
    for i, b in enumerate(blocks):
        if b["kind"] == "p" and MCQ_RE.match(b["text"]):
            mcq_start = i
            break

    # Spotlight start heuristics
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
            if b["n_rows"] <= 2 and b["n_cols"] == 1:
                flat = " ".join(
                    c["text"] for row in b["rows"] for c in row["cells"]
                )
                if re.search(r"步驟|主角|問題|故事|聚光燈|圖文|閱讀|大主題|小主題|說明文|主旨", flat):
                    spotlight_start = i
                    break

    end_idx = mcq_start if mcq_start is not None else len(blocks)
    return spotlight_start, end_idx


def is_substantive_narrative(text):
    """
    Returns True if text looks like a substantive narrative passage
    (not a question, not an option, not a guide instruction).
    Used to catch Normal-style supplementary passages (e.g., 大象故事).
    Rules:
    - Length > 40 chars (excludes short prompts)
    - Does NOT start with □/①②③ (option markers)
    - Does NOT start with numeric question patterns
    - Does NOT start with guide markers (◎/※/步驟/練習)
    - Does NOT look like an MCQ question
    """
    if len(text) < 40:
        return False
    if re.match(r"^[□①②③④⑤]", text):
        return False
    if re.match(r"^\d+[\.\、]\s*[^（\(]", text):
        return False
    if re.match(r"^[❶❷❸❹◎※]", text):
        return False
    if re.match(r"^(步驟|練習|小祕訣|小提醒|如果[四五六七])", text):
        return False
    if MCQ_RE.match(text):
        return False
    # Looks like narrative (long text without markers = passage)
    return True


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
        if re.match(r"□\s*\d+\.", txt):
            return None
        if re.match(r"如果[四五六七八]項都打勾", txt):
            return None
        if re.match(r"請你(勾選|自己|自我)", txt):
            return None

        # Guide block detection
        guide_markers = [
            r"^[◎※]\s*",
            r"^小祕訣",
            r"^小提醒",
            r"^步驟[❶❷❸❹①②③④]",
            r"^練習[一二三四五]",
            r"前一課我們",
            r"許多文章裡的圖",
            r"這篇故事.*說明文",
            r"^(一|二|三|四|五|六|七)[、\.]",
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

        # Detect questions with option markers
        exercise_q_re = re.compile(r"^[❶❷❸❹]\s*|^\d+[\.\、]\s*[^（\(]|^\(\d+\)")
        if exercise_q_re.match(txt):
            return _classify_question_para(txt, strategy_type)

        # List Paragraph style = passage line (G6 lessons)
        if b.get("style") == "List Paragraph":
            return {"type": "passage_line", "_text": txt}

        # Normal-style substantive narrative = passage line
        # This catches 大象故事 and similar supplementary passages
        # that use Normal style instead of List Paragraph
        if b.get("style") == "Normal" and is_substantive_narrative(txt):
            return {"type": "passage_line", "_text": txt}

        # Default: guide text — but MCQ option lines are not guides
        if is_option_line(txt):
            return {"type": "_option_line", "text": txt}
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
                    "asset": None, "bind_paragraph": None, "_needs_asset_bind": True}

        # Vocab application table (2xN with vocab words) — skip
        if b["n_rows"] <= 3 and b["n_cols"] >= 4:
            return None

        # Single guide box (1x1)
        if b["n_rows"] <= 2 and b["n_cols"] == 1:
            cell_text = b["rows"][0]["cells"][0]["text"] if b["rows"] else ""
            if re.search(r"步驟|主角|故事|圖文|聚光燈|閱讀", cell_text):
                return {"type": "guide", "text": cell_text}

        # B5: trait-inference match table (文中線索 | 人物特質)
        # Detected by: 2 cols, first col header contains 線索/文中/事件/言行,
        # second col header contains 特質/人物特質/情緒/推論
        if b["n_cols"] == 2 and b["n_rows"] >= 2:
            header_row = b["rows"][0] if b["rows"] else None
            if header_row:
                cells = [c for c in header_row["cells"] if not c.get("dup")]
                if len(cells) >= 2:
                    col0 = cells[0]["text"]
                    col1 = cells[1]["text"]
                    is_trait_match = (
                        re.search(r"線索|文中|事件|言行|行動|行為", col0) and
                        re.search(r"特質|情緒|感受|推論|人物|心理", col1)
                    )
                    if is_trait_match:
                        return {"type": "match",
                                "match_type": "trait_inference",
                                "col_left": col0,
                                "col_right": col1,
                                "rows": [
                                    {"left": row["cells"][0]["text"].strip(),
                                     "right": row["cells"][1]["text"].strip()}
                                    for i, row in enumerate(b["rows"]) if i > 0
                                    if not row["cells"][0].get("dup")
                                ]}

        # Data table (表一/表二) — figure with table referent
        if b["n_cols"] >= 2 and b["n_rows"] >= 3:
            return {"type": "figure", "referent": "table",
                    "asset": None, "bind_paragraph": None, "_needs_asset_bind": True}

        return None

    return None


def _classify_question_para(txt, strategy_type):
    """
    Classify a paragraph that looks like a question.
    If the paragraph contains inline options (□-separated), extract answer immediately.
    Format: "❶question？ □distractor1　answer　□distractor2"
    """
    has_inline_options = bool(re.search(r"□", txt))

    if has_inline_options:
        # Try to extract answer inline (same paragraph contains all options)
        options = []
        answer = None

        if not txt.startswith("□"):
            parts = re.split(r"\s*□\s*", txt)
            for k, part in enumerate(parts):
                part_stripped = part.strip()
                if not part_stripped:
                    continue
                if k == 0:
                    # Could be "question？" or "question？ answer" (answer before first □)
                    # Split at question mark
                    q_split = re.split(r"[？?]", part_stripped, maxsplit=1)
                    if len(q_split) > 1 and q_split[1].strip():
                        clean = q_split[1].strip()
                        answer = clean
                        options.append(clean)
                    # else: pure question, no inline answer
                else:
                    # After □: may have multiple tokens (first=distractor, rest=answer)
                    sub_tokens = re.split(r"[　\s]+", part_stripped)
                    sub_tokens = [t.strip() for t in sub_tokens if t.strip()]
                    if sub_tokens:
                        dist = re.sub(r"^[①②③④⑤\d]+[\.\、]?\s*", "", sub_tokens[0])
                        options.append(dist or sub_tokens[0])
                        for tok in sub_tokens[1:]:
                            clean_tok = re.sub(r"^[①②③④⑤\d]+[\.\、]?\s*", "", tok).strip()
                            if clean_tok and "□" not in tok:
                                if answer is None:
                                    answer = clean_tok
                                options.append(clean_tok)

        if options or answer:
            return {"type": "single", "prompt": txt,
                    "options": options or None, "answer": answer}
        # Fall through to deferred extraction
        return {"type": "single", "prompt": txt, "options": [], "answer": None,
                "_needs_answer_extraction": True}

    else:
        if (
            re.match(r"^\d+\.", txt)
            and "【" not in txt
            and len(txt) < 80
            and re.search(r"(讓我們來看|進階挑戰|請你|小試身手)", txt)
        ):
            return {"type": "guide", "text": txt}
        return {"type": "free_text", "prompt": txt}


PSE_CIRCLED_RE = re.compile(r"^[❶❷❸❹]")
EXAMPLE_HEADER_RE = re.compile(r"^例[一二三四五六七八九十\d]+[：:]")
STORY_PIVOT_RE = re.compile(r"^接下來，我們來看課文的故事")


def _parse_pse_mcq_line(line: str) -> dict | None:
    """Parse ❶❷❸❹ summary-PSE line into single or free_text block."""
    line = line.strip()
    m = re.match(r"^([❶❷❸❹])\s*(.+)$", line)
    if not m:
        return None
    circled, body = m.group(1), m.group(2).strip()

    if "【" in body and "】" in body:
        bm = re.search(r"【\s*([^】]+?)\s*】", body)
        answer_hint = bm.group(1).strip() if bm else None
        prompt_body = re.sub(r"【[^】]+】", "【　　　】", body)
        block: dict = {"type": "free_text", "prompt": f"{circled}{prompt_body}"}
        if answer_hint and re.sub(r"\s+", "", answer_hint):
            block["answer"] = answer_hint
        return block

    prompt = f"{circled}{body}"
    options: list[str] = []
    answer: str | None = None
    rest = ""

    if re.search(r"[？?]", body):
        q_text, rest = re.split(r"[？?]", body, maxsplit=1)
        prompt = f"{circled}{q_text.strip()}？"
        rest = rest.strip()
    else:
        rest = body

    if "□" in rest or "□" in body:
        opt_text = rest if rest else body
        if "？" in body and not rest:
            opt_text = body.split("？", 1)[-1].strip()
        if opt_text.strip().startswith("□"):
            inner = re.sub(r"^□\s*", "", opt_text.strip())
            tokens = [t.strip() for t in re.split(r"[　\s]+", inner) if t.strip()]
            if len(tokens) >= 2:
                return {
                    "type": "single",
                    "prompt": prompt,
                    "options": tokens[:2],
                    "answer": tokens[1],
                }
        parts = re.split(r"\s*□\s*", opt_text)
        for i, part in enumerate(parts):
            part = part.strip()
            if not part:
                continue
            clean = re.sub(r"^[①②③④⑤]\s*", "", part).strip()
            if not clean:
                continue
            if i == 0 and not opt_text.strip().startswith("□"):
                answer = clean
            options.append(clean)
    elif rest:
        chunks = [c.strip() for c in re.split(r"[　\s]{2,}", rest) if c.strip()]
        for i, ch in enumerate(chunks):
            if i == 0:
                answer = ch
            options.append(ch)

    if len(options) >= 2:
        return {
            "type": "single",
            "prompt": prompt,
            "options": options,
            "answer": answer or options[0],
        }
    return {"type": "free_text", "prompt": prompt}


def _pse_line_is_interactive(line: str) -> bool:
    """True when a ❶ line is an exercise (not the intro's four-question template)."""
    s = line.strip()
    if not PSE_CIRCLED_RE.match(s):
        return False
    if len(re.findall(r"[❶❷❸❹]", s)) > 1:
        return False
    if "□" in s or "【" in s:
        return True
    if re.search(r"[？?]", s):
        after = re.split(r"[？?]", s, maxsplit=1)
        if len(after) > 1:
            tail = after[1].strip()
            if tail and not PSE_CIRCLED_RE.match(tail):
                return True
    return False


def split_pse_guide_text(text: str) -> list:
    """Split mega guide cells into guide + passage + interactive PSE blocks (G6-L22)."""
    lines = [ln for ln in text.replace("\r\n", "\n").split("\n") if ln.strip()]
    out: list = []
    guide_buf: list[str] = []
    passage_buf: list[str] = []
    mode = "guide"

    def flush_guide() -> None:
        nonlocal guide_buf
        joined = "\n".join(guide_buf).strip()
        if joined:
            out.append({"type": "guide", "text": joined})
        guide_buf = []

    def flush_passage() -> None:
        nonlocal passage_buf
        paras = [" ".join(p.split()) for p in passage_buf if p.strip()]
        if paras:
            out.append({"type": "passage", "source": "supplementary", "paragraphs": paras})
        passage_buf = []

    for line in lines:
        stripped = line.strip()
        if PSE_CIRCLED_RE.match(stripped):
            flush_guide()
            flush_passage()
            if _pse_line_is_interactive(stripped):
                parsed = _parse_pse_mcq_line(stripped)
                if parsed:
                    out.append(parsed)
            else:
                guide_buf.append(stripped)
            mode = "guide"
            continue

        if STORY_PIVOT_RE.match(stripped) or EXAMPLE_HEADER_RE.match(stripped):
            flush_passage()
            flush_guide()
            guide_buf.append(stripped)
            mode = "passage"
            continue

        if mode == "passage" or line.startswith("    "):
            if guide_buf:
                flush_guide()
            passage_buf.append(stripped)
            mode = "passage"
            continue

        flush_passage()
        guide_buf.append(stripped)
        mode = "guide"

    flush_guide()
    flush_passage()
    return out


def expand_embedded_pse_guides(blocks: list) -> list:
    out: list = []
    for b in blocks:
        if b.get("type") != "guide":
            out.append(b)
            continue
        text = b.get("text", "")
        if text.count("❶") >= 2 or (STORY_PIVOT_RE.search(text) and "❶" in text):
            out.extend(split_pse_guide_text(text))
        else:
            out.append(b)
    return out


def get_lesson_story_text(lesson_id):
    """
    Return the list of story text lines for a lesson.
    Used to detect source=lesson_text vs source=supplementary.
    Reads from backend/data/lessons/ YAML files.
    """
    # Try to find and load the lesson YAML
    lessons_dir = Path("/Users/young/project/chinese-literacy-platform-issue-2205/backend/data/lessons")
    if not lessons_dir.exists():
        return []

    # Search for matching lesson YAML
    lesson_num = re.search(r"L(\d+)", lesson_id)
    if not lesson_num:
        return []
    l_num = lesson_num.group(1)

    candidates = list(lessons_dir.glob(f"*L{l_num}*.yml")) + list(lessons_dir.glob(f"*L{l_num}*.yaml"))
    if not candidates:
        return []

    import yaml as pyyaml
    story_lines = []
    try:
        with open(candidates[0], 'r', encoding='utf-8') as f:
            data = pyyaml.safe_load(f)
        # Extract story text from various possible keys
        for key in ('story_text', 'content', 'text', 'paragraphs'):
            if key in data:
                val = data[key]
                if isinstance(val, list):
                    story_lines.extend(str(v) for v in val)
                elif isinstance(val, str):
                    story_lines.append(val)
    except Exception:
        pass

    return story_lines


def merge_passage_lines(blocks, lesson_id=None):
    """
    Merge consecutive passage_line items into passage blocks.
    Improved source detection:
    1. Check preceding guide blocks for supplementary markers
    2. For lesson_text detection: check if passage text appears in lesson story text

    Handles both List Paragraph style AND Normal-style narrative passages
    (the latter identified by is_substantive_narrative() in classify_block).
    """
    # Structural markers that signal a supplementary passage section.
    # Use generic heading phrases only — do NOT add story-specific proper nouns
    # (character names like 孟嘗君/曹沖 etc.) — they overfit to individual courses.
    # The is_lesson_text() check below handles the primary lesson_text/supplementary split.
    SUPPLEMENTARY_MARKERS = re.compile(
        r"讓我們來看|課文另一個|進階挑戰|以下是一篇|延伸閱讀|另一則故事"
    )

    # Load lesson story text for source=lesson_text detection
    story_lines = get_lesson_story_text(lesson_id) if lesson_id else []

    def is_lesson_text(text):
        """Check if text is a substring of the lesson story text."""
        if not story_lines:
            return False
        for line in story_lines:
            if text and len(text) > 10 and text in line:
                return True
        return False

    merged = []
    passage_buf = []
    is_supplementary = None  # None = undecided

    def flush_passage():
        if passage_buf:
            # Determine source
            if is_supplementary is True:
                source = "supplementary"
            elif any(is_lesson_text(t) for t in passage_buf):
                source = "lesson_text"
            else:
                # Default: if a supplementary marker appeared near this passage,
                # mark as supplementary; otherwise unknown (use "unknown" not "lesson_text")
                source = "supplementary" if is_supplementary else "unknown"
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
                # Determine source from preceding context
                recent_guide_texts = [
                    prev.get("text", "") for prev in reversed(merged[-5:])
                    if prev.get("type") == "guide"
                ]
                if any(SUPPLEMENTARY_MARKERS.search(t) for t in recent_guide_texts):
                    is_supplementary = True
                else:
                    is_supplementary = False
            passage_buf.append(b["_text"])
        else:
            if passage_buf:
                flush_passage()
                is_supplementary = None
            merged.append(b)

    if passage_buf:
        flush_passage()

    return merged


def extract_single_options(blocks, raw_blocks, spotlight_start, spotlight_end):
    """
    Post-process: for single/multi blocks that need answer extraction.
    Answer = option WITHOUT □/方框 prefix.

    Supported formats (in priority order):
    1. Inline mixed: "①answer text  □②distractor text" on one line
    2. Same-line □-split: "answer  □distractor  □distractor" — first split item is answer
    3. Multi-line: lines after prompt; lines NOT starting with □ are answer candidates,
       lines starting with □ are distractors. Handles "1.text" vs "□2.text" pattern.
    4. Circled-number lines: ① = answer, □② = distractor
    """
    raw_paras = [b["text"] for b in raw_blocks[spotlight_start:spotlight_end]
                 if b["kind"] == "p"]

    for b in blocks:
        if b.get("type") not in ("single", "multi"):
            continue
        if not b.get("_needs_answer_extraction"):
            continue

        prompt = b["prompt"]
        try:
            pi = next(i for i, t in enumerate(raw_paras) if t == prompt or t.startswith(prompt[:20]))
        except StopIteration:
            del b["_needs_answer_extraction"]
            continue

        options = []
        answer = None

        for j in range(pi + 1, min(pi + 15, len(raw_paras))):
            line = raw_paras[j]
            # Stop at next question or major guide marker
            if re.match(r"^[❶❷❸❹◎步驟練習]", line):
                break
            # Stop at self-check
            if re.match(r"^[◎※]\s*自我檢核|^如果[四五六七八]項", line):
                break

            # --- Pattern 1: inline mixed (①answer  □②distractor) ---
            # Check for circled-num without □ mixed with □+circled on same line
            inline_no_box = re.findall(r"(?<!\□)([①②③④⑤])\s*([^□①②③④⑤\n]{2,}?)(?=\s*□|$)", line)
            inline_with_box = re.findall(r"□([①②③④⑤])\s*([^□①②③④⑤\n]+)", line)
            if inline_no_box and "□" in line:
                # The circled item without □ is the answer
                opt_num, opt_text = inline_no_box[0]
                opt_text = opt_text.strip()
                if opt_text:
                    answer = opt_text
                    options.append(opt_text)
                for _, dt in inline_with_box:
                    options.append(dt.strip())
                break

            # --- Pattern 2: □-separated on one line ---
            if "□" in line and not line.startswith("□"):
                # Format like: "❶prompt　□distractor1　answer　□distractor2"
                # OR: "answer　□distractor1　□distractor2"
                # First, strip leading question/prompt (up to first □ or option marker)
                parts = re.split(r"\s*□\s*", line)
                # parts[0] = text before first □ (may be prompt or answer)
                # parts[1..] = text after each □ (may contain multiple tokens if full-width space)
                for k, part in enumerate(parts):
                    part_stripped = part.strip()
                    if not part_stripped:
                        continue
                    # Strip leading question prompt from part[0] if it has a question mark
                    if k == 0:
                        if "？" in part_stripped or "?" in part_stripped:
                            # This is the question, not an option — skip
                            continue
                        clean = re.sub(r"^[①②③④⑤❶❷❸❹\d]+[\.\、\s]*", "", part_stripped).strip()
                        if clean:
                            answer = clean
                            options.append(clean)
                    else:
                        # After □: may have multiple tokens separated by full-width spaces
                        # First token is the distractor, remaining tokens are answers
                        sub_tokens = re.split(r"[　\s]+", part_stripped)
                        sub_tokens = [t.strip() for t in sub_tokens if t.strip()]
                        if sub_tokens:
                            # First sub-token is the distractor (after □)
                            dist = re.sub(r"^[①②③④⑤\d]+[\.\、]?\s*", "", sub_tokens[0])
                            options.append(dist or sub_tokens[0])
                            # Remaining sub-tokens (if any) after full-width space = answers
                            for tok in sub_tokens[1:]:
                                clean_tok = re.sub(r"^[①②③④⑤\d]+[\.\、]?\s*", "", tok).strip()
                                # Only treat as answer if it doesn't contain □
                                if clean_tok and "□" not in tok:
                                    if answer is None:
                                        answer = clean_tok
                                    options.append(clean_tok)
                if options:
                    break

            # --- Pattern 3: multi-line, no-□ line = answer, □-line = distractor ---
            if not line.startswith("□") and not re.match(r"^[◎※步驟練習❶❷❸❹]", line):
                # Could be an answer line
                clean = re.sub(r"^[①②③④⑤\d]+[\.\、]?\s*", "", line).strip()
                if clean:
                    if answer is None:
                        answer = clean
                    options.append(clean)
            elif line.startswith("□"):
                clean_opt = re.sub(r"^□\s*[①②③④⑤\d]+[\.\、]?\s*", "", line).strip()
                options.append(clean_opt if clean_opt else line[1:].strip())

        b["options"] = options if options else None
        b["answer"] = answer
        del b["_needs_answer_extraction"]

    return blocks


def bind_assets_to_figures(blocks, assets):
    """
    Bind extracted asset filenames to figure blocks in the spotlight.
    Figure blocks are assigned assets in document order (sequential binding).
    For G7 lessons: the figures in T#1 correspond to 圖一/圖二/圖三/圖四 in order.
    For G7-L30: tables are bound to data_table assets.
    """
    if not assets:
        return blocks

    # Separate image assets and table assets
    image_assets = [a for a in assets if not a.get("type") == "data_table"]
    table_assets = [a for a in assets if a.get("type") == "data_table"]

    img_idx = 0
    tbl_idx = 0

    for b in blocks:
        if not b.get("_needs_asset_bind"):
            continue

        if b.get("referent") == "image" and img_idx < len(image_assets):
            b["asset"] = image_assets[img_idx]["filename"]
            b["bind_paragraph"] = image_assets[img_idx].get("context", "")
            img_idx += 1
        elif b.get("referent") == "table" and tbl_idx < len(table_assets):
            b["asset"] = table_assets[tbl_idx]["filename"]
            b["bind_paragraph"] = table_assets[tbl_idx].get("context", "")
            tbl_idx += 1

        b.pop("_needs_asset_bind", None)

    return blocks


# Chinese number → int mapping for 圖一/圖二/圖三/圖四 etc.
_CHINESE_NUM = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8}


def inject_per_practice_figures(blocks, assets, strategy_type):
    """
    For image_text / table_text lessons (G7-L28 through G7-L30):
    inject per-practice figure blocks immediately BEFORE each
    「練習N：第N段 vs 圖N/表N」guide block.

    Rules:
    - Only injects if there are multiple image assets (≥2) OR table assets
    - Reads the Chinese figure/table number from the guide text
      e.g. "練習一：第一段 vs 圖一" → 圖一 → fig1.png
           "練習二：第二段 vs 圖二" → 圖二 → fig2.png
           "練習三：課文 vs 表一"   → 表一 → table1.json
    - The existing opening figure block (full-page overview) is KEPT
    - Does NOT inject if guide already has a figure sibling nearby
    - Section-marker images (fig with context='二'/'三'...) are excluded;
      only substantive images (fig1..figN up to len(image_assets)-len(section imgs))
      are available for per-practice injection

    Returns modified blocks list (new list, no in-place mutation).
    """
    if strategy_type not in ("image_text", "table_text"):
        return blocks

    image_assets = [a for a in assets if not a.get("type") == "data_table"]
    table_assets = [a for a in assets if a.get("type") == "data_table"]

    # Heuristic: section-marker images are small (< 20KB based on real data).
    # Substantive figures are larger. But we don't have size info here — instead,
    # rely on context: section markers have single-char context ('二', '三', '四').
    section_marker_re = re.compile(r"^[二三四五六]$")
    substantive_imgs = [
        a for a in image_assets
        if not section_marker_re.match(a.get("context", ""))
    ]

    # If only 1 substantive image, the opening figure block covers it; nothing to inject
    if len(substantive_imgs) < 2 and not table_assets:
        return blocks

    # Build lookup: figure number → asset filename
    # substantive_imgs[0] = 圖一, [1] = 圖二, etc.
    fig_by_num = {}  # int → filename
    for i, a in enumerate(substantive_imgs):
        fig_by_num[i + 1] = a["filename"]

    tbl_by_num = {}  # int → filename
    for i, a in enumerate(table_assets):
        tbl_by_num[i + 1] = a["filename"]

    # Pattern: "練習N：... vs 圖N" or "練習N：... vs 表N"
    PRACTICE_FIGURE_RE = re.compile(
        r"練習[一二三四五六].*(?:vs|VS|和|對照|配)\s*圖([一二三四五六])"
    )
    PRACTICE_TABLE_RE = re.compile(
        r"練習[一二三四五六].*(?:vs|VS|和|對照|配)\s*表([一二三四五六])"
    )

    new_blocks = []
    for b in blocks:
        if b.get("type") == "guide":
            text = b.get("text", "")
            injected = False

            # Check for 圖N binding
            m = PRACTICE_FIGURE_RE.search(text)
            if m:
                fig_num = _CHINESE_NUM.get(m.group(1), 0)
                filename = fig_by_num.get(fig_num)
                if filename:
                    # Avoid double-inject: check previous block isn't already a figure
                    if not (new_blocks and new_blocks[-1].get("type") == "figure"):
                        new_blocks.append({
                            "type": "figure",
                            "referent": "image",
                            "asset": filename,
                            "bind_paragraph": text,
                        })
                        injected = True

            # Check for 表N binding
            if not injected:
                m2 = PRACTICE_TABLE_RE.search(text)
                if m2:
                    tbl_num = _CHINESE_NUM.get(m2.group(1), 0)
                    filename = tbl_by_num.get(tbl_num)
                    if filename:
                        if not (new_blocks and new_blocks[-1].get("type") == "figure"):
                            new_blocks.append({
                                "type": "figure",
                                "referent": "table",
                                "asset": filename,
                                "bind_paragraph": text,
                            })

        new_blocks.append(b)

    return new_blocks


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


def build_spotlight_schema(lesson_id, blocks, raw_blocks, strategy_type, strategy_name, assets=None):
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

    # Merge passage lines (with improved lesson_text vs supplementary detection)
    classified = merge_passage_lines(classified, lesson_id=lesson_id)

    # Post-process answer extraction (improved multi-pattern detection)
    classified = extract_single_options(classified, raw_blocks, spotlight_start, spotlight_end)

    # Coalesce （單選）prompts + ①/□ option lines misclassified as guide/free_text
    classified = coalesce_mcq_option_blocks(classified)

    # Split summary-PSE mega guide cells → passage + ❶❷❸❹ singles (G6-L22)
    classified = expand_embedded_pse_guides(classified)

    # Bind assets to figure blocks
    if assets:
        classified = bind_assets_to_figures(classified, assets)

    # Inject per-practice figure blocks for image_text / table_text lessons
    # (inserts figure blocks before 「練習N vs 圖N/表N」guide blocks)
    if assets:
        classified = inject_per_practice_figures(classified, assets, strategy_type)

    # Extract self-check items
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


# Strategy taxonomy: map from DOCX filename bracket keywords to strategy_type codes
# Based on inventory of 151 lessons. Order matters: more specific before general.
STRATEGY_TAXONOMY = [
    # Image/table text integration
    (re.compile(r"圖文表整合"), "table_text"),
    (re.compile(r"圖文整合"), "image_text"),
    (re.compile(r"圖表繪製|圖文表.*判讀|圖表判讀"), "image_text"),
    # Summary / PSE
    (re.compile(r"摘要策略.*問題.*解決.*結果|問題.解決.結果結構"), "summary_pse"),
    (re.compile(r"摘要策略.*問題.*解決|問題.解決結構"), "summary_pse"),
    (re.compile(r"摘要策略.*從結構找.*主題|從結構找"), "summary_structure"),
    (re.compile(r"摘要策略.*從關鍵句|從關鍵句"), "summary_keysentence"),
    (re.compile(r"摘要策略"), "summary"),
    # Inference / trait / reading comprehension
    (re.compile(r"推論.*人物特質|從言行推論"), "trait_inference"),
    (re.compile(r"推論.*情緒|推論.*感受"), "emotion_inference"),
    (re.compile(r"推論.*動機|推論.*想法"), "motivation_inference"),
    (re.compile(r"推論.*主旨|推論.*觀點|推論.*論點|找作者主要論點"), "main_idea_inference"),
    (re.compile(r"推論.*因果|找出一連串因果"), "causal_inference"),
    (re.compile(r"推論策略"), "inference"),
    # Main idea / concept extraction (P1: added patterns)
    (re.compile(r"提取上位概念|從具體.*提取|從事實歸納概念|從具體事實歸納"), "main_idea_inference"),
    # Vocabulary / word analysis (P1: added patterns)
    (re.compile(r"拆詞釋義|從上下文推測詞義|推測詞義"), "inference"),
    # Scientific inquiry / problem solving
    (re.compile(r"科學探究|解決問題.*科學|以實驗|比較異同.*解決問題|科學探究法"), "scientific_inquiry"),
    (re.compile(r"解決問題|簡單推理"), "problem_solving"),
    # Comparison / perspective
    (re.compile(r"比較多元觀點|多元觀點|以不同角度.*說明"), "multiple_perspectives"),
    (re.compile(r"比較.*異同|表格整理.*比較"), "comparison"),
    (re.compile(r"表達看法|4F思考|以科學證據說服|分辨事實與判斷|議論文結構"), "express_opinion"),
    # Self-questioning / reading strategy
    (re.compile(r"自我提問|詰問作者|解題策略"), "self_questioning"),
    # Writing techniques (P1: expanded to cover sentence patterns)
    (re.compile(r"寫作手法|認識句型|固定句式"), "writing_technique"),
    # Classical Chinese (P1: expanded)
    (re.compile(r"判讀主語|斷句.*判讀|人稱代詞|指示.*代詞|疑問代詞|指示與疑問|一字多義|判斷句|文言文閱讀策略"), "classical_grammar"),
    # Ordering / sequencing
    (re.compile(r"順序|排序|時間序"), "ordering"),
    # Information organization / comparison
    (re.compile(r"用表格整理.*比較異同|整理訊息.*比較異同|比較異同"), "comparison"),
    (re.compile(r"用表格整理|整理訊息"), "info_organization"),
    # Perspective / empathy
    (re.compile(r"換位思考|同理心|感同身受|想法感受"), "perspective_taking"),
    # Finding supporting evidence / perspective with reasons
    (re.compile(r"觀點找支持理由|找支持理由|支持理由|換位思考並找"), "evidence_finding"),
    # Emotion management (P1: expanded to cover ABC / stage variants)
    (re.compile(r"情緒管理"), "emotion_management"),
    # SEL / character development (P1: vastly expanded)
    # Note: broad patterns only — no story-specific proper nouns
    (re.compile(r"品格|SEL|感恩|善意|同情"), "sel_character"),
    (re.compile(r"自我覺察|念頭覺察|身體覺察"), "sel_character"),
    (re.compile(r"人際溝通|跨文化接納|性別平等|向.*歧視說不"), "sel_character"),
    (re.compile(r"正向思考|負責任的決定|落實環保|媒體素養"), "sel_character"),
    (re.compile(r"自我管理|時間管理|認識自我|生涯探索|建立.*習慣"), "sel_character"),
    (re.compile(r"生活素養"), "sel_character"),
    # General reading strategy (P1: catchall for unclassified reading skills)
    (re.compile(r"閱讀策略"), "inference"),
]


def detect_strategy_from_filename(docx_path):
    """
    Extract strategy type and name from DOCX filename bracket (最可靠的來源).
    Filename format: <lessonID><title>（<strategy_name>）.docx
    Returns (strategy_name, strategy_type).
    """
    basename = Path(docx_path).stem  # without .docx
    # Extract the LAST bracket in the filename — some lessons have two brackets,
    # e.g. "G5-SL7...（後篇）（推論策略-觀點找支持理由）"; the strategy is always last.
    all_brackets = re.findall(r"[（(]([^）)]+)[）)]", basename)
    if not all_brackets:
        return "未知策略", "unknown"

    strategy_raw = all_brackets[-1].strip()

    # Map to taxonomy
    for pattern, code in STRATEGY_TAXONOMY:
        if pattern.search(strategy_raw):
            return strategy_raw, code

    return strategy_raw, "unknown"


def process_lesson(lesson_id, docx_path, output_dir):
    print(f"\n{'='*60}")
    print(f"Processing {lesson_id} : {Path(docx_path).name}")
    print('='*60)

    raw_blocks = extract_raw(docx_path)
    meta = LESSON_META.get(lesson_id, {})

    # Strategy: prefer LESSON_META (manually curated for 7 professor lessons)
    # then fall back to filename parsing (generalizes to all 151 lessons)
    if meta.get("strategy_name") and meta.get("strategy_type"):
        strategy_name = meta["strategy_name"]
        strategy_type = meta["strategy_type"]
    else:
        strategy_name, strategy_type = detect_strategy_from_filename(docx_path)
        print(f"[strategy] Detected from filename: {strategy_name} → {strategy_type}")

    # 0. Extract assets (images + data tables)
    asset_dir = Path(output_dir) / "assets" / lesson_id
    assets = extract_assets(docx_path, lesson_id, asset_dir, meta)
    print(f"[assets] Extracted {len(assets)} asset(s) to {asset_dir}")
    for a in assets:
        print(f"  {a.get('seq')}: {a['filename']} — context: {a.get('context', '')[:50]}")

    # 1. Build keypoints schema
    kp_table = find_keypoints_table(raw_blocks, lesson_id)
    kp_schema = None
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

    # 2. Build spotlight schema (with assets for figure binding)
    sp_schema = build_spotlight_schema(
        lesson_id, raw_blocks, raw_blocks, strategy_type, strategy_name,
        assets=assets
    )
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
    for bt, cnt in sorted(block_types.items()):
        print(f"    {bt}: {cnt}")

    # Report figure blocks with asset bindings
    figure_blocks = [b for b in blocks_list if b.get("type") == "figure"]
    if figure_blocks:
        print(f"  Figure blocks:")
        for fb in figure_blocks:
            bind_val = fb.get('bind_paragraph') or ''
            print(f"    referent={fb.get('referent')} asset={fb.get('asset')} bind='{bind_val[:40]}'")

    null_answers = sp_schema["spotlight"].get("_null_answers", [])
    if null_answers:
        print(f"  [!] {len(null_answers)} answer(s) need manual fill:")
        for na in null_answers:
            print(f"      {na}")
    else:
        print(f"  All single/multi answers extracted.")

    return kp_schema, sp_schema, assets


def main():
    parser = argparse.ArgumentParser(description="Build lesson schema from DOCX")
    parser.add_argument("lesson_id", nargs="?", help="Lesson ID e.g. G6-L22")
    parser.add_argument("docx_path", nargs="?", help="Path to DOCX file")
    parser.add_argument("--output-dir", default="private/curriculum-source/_online-schema",
                       help="Output directory for YAML files")
    parser.add_argument("--all", action="store_true", help="Process all 7 lessons")
    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)

    if args.all:
        results = {}
        for lesson_id, docx_path in LESSON_DOCX.items():
            if not os.path.exists(docx_path):
                print(f"WARNING: {docx_path} not found, skipping {lesson_id}")
                continue
            kp, sp, assets = process_lesson(lesson_id, docx_path, args.output_dir)
            results[lesson_id] = {
                "kp": kp, "sp": sp, "assets": assets,
                "null_count": len(sp["spotlight"].get("_null_answers", [])),
                "asset_count": len(assets),
            }

        print(f"\n{'='*60}")
        print("SUMMARY")
        print('='*60)
        total_null = 0
        for lesson_id, r in results.items():
            null_count = r["null_count"]
            total_null += null_count
            asset_count = r["asset_count"]
            null_str = f"  {null_count} null answers" if null_count else "  all answers OK"
            print(f"  {lesson_id}: {asset_count} assets,{null_str}")
        print(f"Total null answers remaining: {total_null}")
    else:
        if not args.lesson_id or not args.docx_path:
            parser.error("Provide lesson_id and docx_path, or use --all")
        if not os.path.exists(args.docx_path):
            print(f"ERROR: {args.docx_path} not found", file=sys.stderr)
            sys.exit(1)
        process_lesson(args.lesson_id, args.docx_path, args.output_dir)


if __name__ == "__main__":
    main()
