#!/usr/bin/env python3
"""
Re-parse 教師版 docx using raw XML extraction.

Why: python-docx misses <w:txbxContent> textbox content.
Many lessons have 閱讀聚光燈 / 自我檢核 / 文章重點表 sections rendered
in textboxes the existing parser never saw, OR in normal paragraphs
that the existing parser dropped because it only captured Table 0.

Output: backend/data/lessons/_reparsed_2026-05-02/{lesson_code}.yml

Sections extracted:
  - paragraphs (story body)
  - vocabulary (詞語複習 list)
  - fill_in_blank (all 【】 markers in raw text)
  - strategy_exercise (閱讀聚光燈 ... ◎自我檢核 block, structured by 步驟)
  - self_check_items (◎自我檢核 block)
  - story_structure_table (文章重點表 — for 摘要策略 lessons)
  - multiple_choice (final MCQ block)
  - knowledge_station (知識補給站 video links)

Usage:
    python3 scripts/reparse_with_textboxes.py G6-L22 G6-L23 ...
    python3 scripts/reparse_with_textboxes.py --all
"""
from __future__ import annotations
import argparse
import re
import sys
import zipfile
from pathlib import Path
from typing import Optional

import yaml

REPO = Path("/Users/young/project/chinese-literacy-platform")
SOURCE_DIRS = [
    REPO / "private/curriculum-source/2026-05-01/1.L1-158新版完成學習單1150415/1-1教師版(L1~122)",
    REPO / "private/curriculum-source/2026-05-01/1.L1-158新版完成學習單1150415/第三階段(L123開始~L157)差學生版",
]
OUTPUT_DIR = REPO / "backend/data/lessons/_reparsed_2026-05-02"


def find_docx(lesson_code: str) -> Optional[Path]:
    for base in SOURCE_DIRS:
        if not base.exists():
            continue
        for p in base.rglob(f"{lesson_code}*.docx"):
            return p
    return None


def list_all_docx() -> list[Path]:
    out = []
    for base in SOURCE_DIRS:
        if not base.exists():
            continue
        out.extend(base.rglob("*.docx"))
    return sorted(out)


def lesson_code_from_filename(path: Path) -> Optional[str]:
    m = re.match(r"^(G\d+-L\d+(?:-\d+)?|文-L\d+)", path.name)
    return m.group(1) if m else None


def extract_full_text(docx: Path) -> str:
    """Get plaintext from document.xml including textbox content.

    We replace structural markers with newlines/tabs, then strip all tags.
    Textbox content (w:txbxContent) is interleaved at its insertion point.
    """
    with zipfile.ZipFile(docx) as z:
        xml = z.read("word/document.xml").decode("utf-8")
    # Add paragraph breaks BEFORE stripping tags
    text = re.sub(r"<w:tab/>", "\t", xml)
    text = re.sub(r"<w:br/>", "\n", text)
    text = re.sub(r"<w:p[ >][^>]*?>", "\n", text)
    text = re.sub(r"</w:p>", "", text)
    text = re.sub(r"<[^>]+>", "", text)
    # Collapse 3+ newlines to 2
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def extract_textbox_blocks(docx: Path) -> list[str]:
    """Each <w:txbxContent> as a separate plaintext block."""
    with zipfile.ZipFile(docx) as z:
        xml = z.read("word/document.xml").decode("utf-8")
    blocks = re.findall(r"<w:txbxContent[^>]*>(.*?)</w:txbxContent>", xml, re.DOTALL)
    out = []
    for b in blocks:
        t = re.sub(r"<w:tab/>", "\t", b)
        t = re.sub(r"<w:br/>", "\n", t)
        t = re.sub(r"<w:p[ >][^>]*?>", "\n", t)
        t = re.sub(r"<[^>]+>", "", t)
        t = t.strip()
        if t:
            out.append(t)
    return out


# 學習單 section names → internal type code. The section name is what
# appears in the docx 一/二/三/... numbered headers (學習單 official name).
SECTION_NAME_TO_TYPE = {
    "字數": "char_count",
    "念順順": "reading_timer",       # 朗讀計時 + 我的表現 progress
    "我的表現": "reading_timer",       # alias
    "本課語詞": "lesson_vocab_list",  # comma-list of vocab words
    "語詞我最棒": "vocab_definitions",  # (N) word: definition list
    "語詞應用": "vocab_application",  # vocab_bank + letter-coded fill-in
    "閱讀聚光燈": "spotlight",
    "文言聚光燈": "spotlight",
    "文章重點表": "structure_table",  # PSR / key info table
    "閱讀理解": "mcq",                # MCQ
    "詞語複習": "word_search",        # vocab grid puzzle (visual-only)
    "找一找": "word_search",
    "知識補給站": "knowledge_station",  # bonus videos
    "小試身手": "practice",            # nested under spotlight
    "進階挑戰": "practice",
    "自我檢核": "self_check",
}

# All section keywords for boundary detection (longer first to prefer specific)
ALL_SECTION_KEYWORDS = sorted(SECTION_NAME_TO_TYPE.keys(), key=len, reverse=True)


def split_sections(text: str) -> dict[str, str]:
    """Split full text into named sections by header markers.

    Returns a dict keyed by internal type code. When a section repeats in the
    raw text (textbox label + body header), keep the LARGEST slice.
    """
    matches: list[tuple[int, str]] = []
    for name, type_code in SECTION_NAME_TO_TYPE.items():
        for m in re.finditer(re.escape(name), text, re.MULTILINE):
            matches.append((m.start(), type_code))
    matches.sort()

    sections: dict[str, str] = {}
    for i, (pos, name) in enumerate(matches):
        end = matches[i + 1][0] if i + 1 < len(matches) else len(text)
        body = text[pos:end].strip()
        if name not in sections or len(body) > len(sections[name]):
            sections[name] = body
    return sections


def extract_worksheet_section_order(text: str) -> list[dict]:
    """Extract the 一/二/三/.../九 section sequence from the docx.

    Each lesson type (G6 摘要策略 / G7 圖文整合 / 文言文) has a different
    section ordering. Preserve the order so the frontend can render a
    customizable 學習單 layout.

    Output: [{number: '一', name: '念順順', type: 'reading_timer'}, ...]
    """
    NUM_CHARS = "一二三四五六七八九十"
    # Pattern: standalone number on its own line, followed by section name on next line
    # OR number+name on same line (e.g. "一念順順" or "二 閱讀聚光燈")
    seen: list[dict] = []
    seen_numbers: set[str] = set()
    # Pattern A: \n<num>\n<name>
    pat_a = re.compile(r"[\n]\s*([" + NUM_CHARS + r"])\s*\n([^\n]{1,30})")
    for m in pat_a.finditer(text):
        num = m.group(1)
        name_line = m.group(2).strip()
        for sn in ALL_SECTION_KEYWORDS:
            if sn in name_line:
                if num not in seen_numbers:
                    seen.append({
                        "number": num,
                        "name": sn,
                        "type": SECTION_NAME_TO_TYPE[sn],
                    })
                    seen_numbers.add(num)
                break
    return seen


def extract_lesson_intro_from_docx(text: str) -> Optional[dict]:
    """Extract the lesson intro from 說明: or 導讀: patterns near top of docx.

    These appear in ~6 lessons (e.g. G7-L29) as a genuine course introduction
    sentence, distinct from worksheet_intro (which is the strategy/instructions
    metadata) and from intro.background (which is the first story paragraph).

    Returns dict with:
      - source: "docx_explanation" or "docx_guide"
      - text: the extracted sentence (30-400 chars)
    or None if neither pattern found.
    """
    search_region = text[:3000]
    # Try 說明: pattern first
    m = re.search(r'說明[：:]\s*([^\n]{30,400})', search_region)
    if m:
        return {"source": "docx_explanation", "text": m.group(1).strip()}
    # Try 導讀: pattern
    m = re.search(r'導讀[：:]\s*([^\n]{30,400})', search_region)
    if m:
        return {"source": "docx_guide", "text": m.group(1).strip()}
    return None


def extract_worksheet_intro(text: str) -> dict:
    """Extract the 學習單 intro section from the top of the docx.

    The intro lives BEFORE the lesson body — it contains:
    - step_label:       e.g. "讀全文-做記號" (from "一\\n讀全文-做記號" header)
    - target_strategy:  e.g. "摘要策略──問題.解決.結果結構"
    - instructions:     lines starting with □ (full-width checkbox)
    - level_label:      e.g. "Level 6・記敘文"
    - lesson_label:     e.g. "第22課 小兵立大功：雞鳴狗盜的故事"
    - authors:          e.g. "課文：曾世杰  學習單：張明珠"

    Typical raw text (G6-L22):
      "一\\n讀全文-做記號00\\n目標策略：摘要策略──...\\n□ 請在...\\nLevel 6・記敘文..."

    The Word object ID digits (e.g. "00") appear between real content lines.
    We strip those before matching.
    """
    # Limit search to the first ~3000 chars (intro is near top of doc)
    intro_region = text[:3000]

    # Strip Word object IDs — digit-only tokens between Chinese content.
    # Pattern: 2+ digits at a line boundary, alone or adjacent to newlines.
    cleaned = re.sub(r"\n\s*\d{2,}\s*(?=\n)", "\n", intro_region)

    result: dict = {}

    # step_label: "一\n讀全文-做記號" or "一 讀全文-做記號"
    # The leading Chinese numeral "一" marks the first section of the worksheet.
    step_m = re.search(r"[一]\s*\n\s*([^\n0-9]{2,30})", cleaned)
    if not step_m:
        step_m = re.search(r"[一]\s+([^\n0-9]{2,30})", cleaned)
    if step_m:
        result["step_label"] = step_m.group(1).strip()

    # target_strategy: line with "目標策略：" prefix (may have trailing digits stripped)
    strategy_m = re.search(r"目標策略[：:]\s*([^\n]+)", cleaned)
    if strategy_m:
        val = strategy_m.group(1).strip()
        # Strip trailing Word object ID digits
        val = re.sub(r"\s*\d{2,}\s*$", "", val).strip()
        if val:
            result["target_strategy"] = val

    # instructions: lines starting with □ (U+25A1 or half-width □)
    # Only capture lines that begin with Chinese text (not numeric benchmarks like "＜210字").
    # Docx may have "□ text00\n□ text" — strip trailing digits.
    instructions = []
    seen_instr: set[str] = set()
    for m in re.finditer(r"[□]\s+([^\n□]{2,100})", cleaned):
        line = m.group(1).strip()
        # Strip trailing Word object IDs
        line = re.sub(r"\s*\d{2,}\s*$", "", line).strip()
        # Skip numeric/symbol benchmarks (e.g. "＜210字", "211~240字")
        # Valid instructions start with a CJK character or punctuation like 「
        if not line or line in seen_instr:
            continue
        first_char = line[0]
        if re.match(r"[一-鿿「」《》【】]", first_char):
            instructions.append(line)
            seen_instr.add(line)
    if instructions:
        result["instructions"] = instructions

    # level_label: "Level N・文類" pattern
    level_m = re.search(r"(Level\s+\d+\s*[・·]\s*[^\n0-9]{1,20})", cleaned)
    if level_m:
        val = level_m.group(1).strip()
        val = re.sub(r"\s*\d{2,}\s*$", "", val).strip()
        if val:
            result["level_label"] = val

    # lesson_label: "第N課 title" — lesson title line
    lesson_m = re.search(r"(第\d+課\s+[^\n]{1,60})", cleaned)
    if lesson_m:
        val = lesson_m.group(1).strip()
        # Strip trailing Word object ID digits and position markers
        val = re.sub(r"\s+\d{1,5}\s*$", "", val).strip()
        if val:
            result["lesson_label"] = val

    # authors: "課文 ：A\n學習單：B" — may span two lines in docx
    # Approach: find "課文" occurrence, grab next 2 lines
    authors_m = re.search(
        r"課文\s*[：:]\s*([^\n]{1,40})\n\s*學習單[：:]\s*([^\n]{1,40})",
        cleaned,
    )
    if authors_m:
        c = re.sub(r"\s*\d{2,}\s*$", "", authors_m.group(1)).strip()
        w = re.sub(r"\s*\d{2,}\s*$", "", authors_m.group(2)).strip()
        if c or w:
            result["authors"] = f"課文：{c}  學習單：{w}"
    else:
        # Single-line: "課文：A 學習單：B"
        authors_single = re.search(
            r"(課文\s*[：:][^\n]{1,40}學習單[：:][^\n]{1,30})",
            cleaned,
        )
        if authors_single:
            raw = authors_single.group(1).strip()
            raw = re.sub(r"\s{2,}", "  ", raw)
            result["authors"] = raw

    return result if result else {}


EXCLUDE_MARKERS = (
    "計時", "影片", "閱讀聚光燈", "文章重點表", "知識補給站", "詞語複習",
    "步驟❶", "目標策略", "Level ", "字數", "完讀時間", "□", "請根據文章",
    "自我檢核", "小試身手", "進階挑戰",
)


def looks_like_story(text: str) -> bool:
    """Heuristic: cell contains story prose, not exercise markup."""
    if len(text) < 80:
        return False
    head = text[:30]
    if any(m in head for m in EXCLUDE_MARKERS):
        return False
    # Reject exercise-pattern cells. ❶❷❸❹❺ are PSR question marks (exercise);
    # ①②③ may appear inline as "情境①" labels in story prose, so allow those.
    exercise_markers = sum(text.count(m) for m in "❶❷❸❹❺")
    if exercise_markers >= 3:
        return False
    # Story is mostly plain Chinese; reject if too many checkboxes
    if text.count("□") >= 3:
        return False
    return True


def extract_paragraphs_from_table(docx: Path) -> list[str]:
    """Scan ALL table cells, pick the longest cell that looks like story prose.

    The existing parser only accepted single-row 1-2 col tables, missing
    G6-L22-style docx where the story lives at Table[0] cell(2,1) inside
    a metadata 3x4 header table.
    """
    try:
        from docx import Document
    except ImportError:
        return []
    doc = Document(str(docx))

    candidates: list[tuple[int, str]] = []  # (length, text)
    seen_text: set[str] = set()
    for t in doc.tables:
        for row in t.rows:
            for cell in row.cells:
                text = cell.text.strip()
                if text in seen_text:  # skip cell-merge duplicates
                    continue
                seen_text.add(text)
                if looks_like_story(text):
                    candidates.append((len(text), text))

    if not candidates:
        return []

    # Pick the largest candidate — that's the story body
    candidates.sort(reverse=True)
    body = candidates[0][1]

    # Each newline separates a paragraph in these docs. Blank lines just
    # produce an empty entry which we skip.
    paragraphs: list[str] = []
    for chunk in body.split("\n"):
        chunk = chunk.strip("　 \t")
        if chunk and len(chunk) > 20 and not re.match(r"^\d+$", chunk):
            paragraphs.append(chunk)
    return paragraphs


def parse_fill_in_blank(text: str, paragraphs: list[str]) -> list[dict]:
    """Find all 【answer】 markers in main text (excluding spotlight section)
    and capture context_before/after."""
    items: list[dict] = []
    seen: set[str] = set()
    for i, m in enumerate(re.finditer(r"【\s*([^】]+?)\s*】", text), 1):
        ans = m.group(1).strip()
        if not ans or ans in seen:
            continue
        seen.add(ans)
        before = text[max(0, m.start() - 60) : m.start()].replace("\n", " ").strip()
        after = text[m.end() : m.end() + 60].replace("\n", " ").strip()
        items.append({
            "id": i,
            "answer": ans,
            "context_before": before,
            "context_after": after,
        })
    return items


def parse_mcq(section: str) -> list[dict]:
    """Parse 閱讀理解選擇題.

    Format: （ X ）N. 題目\n A.選項1 B.選項2 C.選項3 D.選項4

    Tricky parts the previous version got wrong:
      - Options can be inline on same line: "A.手電筒　　B.毛帽　　C.太陽眼鏡　　D.雨具"
      - Explanation/comment text inserted between options
        (e.g. "29501129867\n(文中第二至七段...)00\n(文中第二至七段...)")
      - Trailing whitespace/tabs after question line

    New approach: locate each （X）N. marker, slice to next marker, then
    extract A./B./C./D. options from the slice using a flat regex regardless
    of line breaks.
    """
    full_to_half = {"Ａ": "A", "Ｂ": "B", "Ｃ": "C", "Ｄ": "D"}
    # Find all question-start markers
    starts = list(
        re.finditer(r"[（(]\s*([A-DＡＢＣＤ])\s*[）)]\s*(\d+)\s*[\.．。]\s*", section)
    )
    items: list[dict] = []
    for i, m in enumerate(starts):
        ans = full_to_half.get(m.group(1), m.group(1))
        end = starts[i + 1].start() if i + 1 < len(starts) else len(section)
        block = section[m.end():end]

        # First line of block (up to first newline) is the question
        nl = block.find("\n")
        if nl == -1:
            # Question + options inline on same line — split at first " A."
            opt_match = re.search(r"\s+A[.．]", block)
            if opt_match:
                question = block[:opt_match.start()].strip()
                rest = block[opt_match.start():]
            else:
                question = block.strip()
                rest = ""
        else:
            question = block[:nl].strip()
            rest = block[nl:]

        # Strip explanation chunks: (...) and bare digit runs
        rest_clean = re.sub(r"\([^)]+\)", "", rest)
        rest_clean = re.sub(r"^\s*\d{4,}\s*$", "", rest_clean, flags=re.MULTILINE)

        # Extract options: A. / B. / C. / D.
        # Each option = letter + dot + content up to next letter+dot OR end.
        opt_starts = list(re.finditer(r"([ABCD])[.．]\s*", rest_clean))
        options: list[str] = []
        seen_letters: set[str] = set()
        for j, om in enumerate(opt_starts):
            letter = om.group(1)
            if letter in seen_letters:
                continue
            seen_letters.add(letter)
            opt_end = opt_starts[j + 1].start() if j + 1 < len(opt_starts) else len(rest_clean)
            opt_text = rest_clean[om.end():opt_end].strip()
            # Strip trailing digit-only runs (Word object IDs leak through)
            # and trailing layout markers (right/left + digits)
            opt_text = re.sub(r"\s*(?:right|left)\s*\d+.*$", "", opt_text, flags=re.DOTALL)
            opt_text = re.sub(r"\s+\d{2,}\s*$", "", opt_text)
            opt_text = re.sub(r"\s*\d{4,}.*$", "", opt_text, flags=re.DOTALL)
            opt_text = re.sub(r"\n+", " ", opt_text)
            opt_text = re.sub(r"\s+", " ", opt_text)
            opt_text = opt_text.strip("　 \t")
            if opt_text:
                options.append(opt_text)

        # Skip empty/garbage entries (need at least 2 options to count as MCQ)
        if len(options) >= 2 and question:
            items.append({
                "question": question,
                "options": options,
                "answer": ans,
            })
    return items


def parse_vocab_review(section: str) -> list[dict]:
    """Vocab list with definitions:  X. word: definition"""
    items: list[dict] = []
    # Try numbered list: 1. word\n definition
    for m in re.finditer(
        r"\d+\.\s*([一-鿿]{2,6})[:：]\s*([^\n0-9][^\n]+)", section
    ):
        items.append({"word": m.group(1).strip(), "definition": m.group(2).strip()})
    return items


def parse_strategy_exercise(spotlight: str) -> dict:
    """Structure 閱讀聚光燈 block into ordered steps."""
    if not spotlight:
        return {}
    # Remove the leading "閱讀聚光燈" header
    body = re.sub(r"^閱讀聚光燈\s*", "", spotlight)
    # Find each 步驟❶ ... ❷ ... ❸ ... boundary
    step_pat = re.compile(r"步驟\s*([❶❷❸❹❺①②③④⑤])\s*[:：]?\s*([^\n]*)\n")
    steps: list[dict] = []
    matches = list(step_pat.finditer(body))
    for i, m in enumerate(matches):
        s = m.start()
        e = matches[i + 1].start() if i + 1 < len(matches) else len(body)
        title = m.group(2).strip()
        content = body[m.end():e].strip()
        steps.append({"step": m.group(1), "title": title, "content": content})
    intro = body[: matches[0].start()].strip() if matches else body.strip()
    return {"intro": intro, "steps": steps}


def parse_lesson_vocab_list(text: str) -> list[str]:
    """Extract 本課語詞 from comma-separated list.

    Format: "本課語詞：\n爭強鬥勝、互比苗頭、讒言、軟禁、..."
    """
    m = re.search(r"本課語詞[：:]\s*\n?([^\n]{10,300})", text)
    if not m:
        return []
    raw = m.group(1).strip()
    # Strip trailing Word object IDs (digits) and full stops
    raw = re.sub(r"[。．]\s*\d+\s*$", "", raw)
    raw = raw.rstrip("。． 　\t")
    words = re.split(r"[、，,]", raw)
    cleaned: list[str] = []
    for w in words:
        w = w.strip().rstrip("。．")
        # Strip trailing 4+ digits (Word object IDs leak into last word)
        w = re.sub(r"\d{2,}$", "", w)
        w = w.strip("　 \t")
        if w and 1 < len(w) < 10:
            cleaned.append(w)
    return cleaned


def parse_vocab_definitions(section: str) -> list[dict]:
    """Extract 語詞我最棒 (vocab definitions).

    Format: "(1)    開門見山    ：說話或寫文章一開始就直接切入主題。"
    """
    items: list[dict] = []
    # (N) word ：definition  (allow whitespace flexibility)
    pat = re.compile(
        r"\(\s*\d+\s*\)\s*([^\s:：（()]{2,8})\s*[:：]\s*([^\n(]+?)(?=\n|\(\d+\)|$)"
    )
    for m in pat.finditer(section):
        word = m.group(1).strip()
        defn = m.group(2).strip().rstrip("。")
        if word and defn:
            items.append({"word": word, "definition": defn})
    return items


def parse_vocab_application(section: str) -> dict:
    """Extract 語詞應用: vocab_bank (A→word) + letter-coded fill-in questions.

    Format:
        A.互比苗頭
        B.津津樂道
        ...
        (1)考試時，教室裡(  F  )，只有筆尖劃過紙面的聲音。
        (2)他(  C  )的說明來意...
    """
    if not section:
        return {"vocab_bank": {}, "questions": []}

    # Strip header noise
    body = re.sub(r"^.*?語詞應用\s*", "", section, count=1)

    # vocab_bank: lines starting with A-Z+. then 2-6 char Chinese
    bank: dict[str, str] = {}
    # Stop bank scan when we hit (1) — that's where questions start
    bank_section = body.split("(1)")[0] if "(1)" in body else body[:500]
    for m in re.finditer(r"\b([A-Z])[.．]\s*([一-鿿]{2,8})", bank_section):
        letter = m.group(1)
        word = m.group(2).strip()
        if letter not in bank and len(word) >= 2:
            bank[letter] = word

    # Questions: (N) sentence with (X) or （X） blank → letter answer
    # Different docx use either half-width () or full-width （） around the letter.
    # Use a unified regex that handles both, and full-width spaces 　 inside.
    questions: list[dict] = []
    q_section = body[body.find("(1)"):] if "(1)" in body else ""
    pat = re.compile(
        r"\((\d+)\)\s*"               # (N)
        r"([^\n（()]+?)"               # context before
        r"[（(]\s*([A-Z])\s*[）)]"      # （X） or (X) — half- or full-width
        r"([^\n（()]*)"                # context after
    )
    for m in pat.finditer(q_section):
        idx = int(m.group(1))
        before = m.group(2).strip().strip("　")
        letter = m.group(3)
        after = m.group(4).strip().strip("　").rstrip("。")
        if letter in bank:
            questions.append({
                "id": idx,
                "answer_letter": letter,
                "answer_word": bank[letter],
                "context_before": before,
                "context_after": after,
            })

    return {"vocab_bank": bank, "questions": questions}


def parse_video_links(section: str) -> list[dict]:
    """Extract 影片連結 from 知識補給站 section.

    Format:
        影片連結
        1. 成語任務22-雞鳴狗盜
        ・片長：(4:02)
        ・來源：中華文化永續發展基金會
    """
    if not section:
        return []
    # Strip Word object IDs (long digit runs) that prefix video index numbers.
    # e.g. docx export adds "XXXXXX1. 成語任務" → strip leading digits to get "1. 成語任務"
    cleaned = re.sub(r"\d{6,}(?=[1-9][.．])", "", section)
    videos: list[dict] = []
    pat = re.compile(
        r"(?:^|\D)([1-9])[.．]\s*([^\n]+?)(?:\n|$)"
        r"(?:[^\n]*?[・·]\s*片長\s*[:：]?\s*\(?\s*([\d:]+)\s*\)?)?"
        r"(?:[^\n]*?[・·]\s*來源\s*[:：]?\s*([^\n]+?)(?=\n|$))?",
        re.MULTILINE,
    )
    section = cleaned
    seen_titles: set[str] = set()
    for m in pat.finditer(section):
        idx = m.group(1)
        title = m.group(2).strip()
        duration = (m.group(3) or "").strip()
        source = (m.group(4) or "").strip()
        # Strip Word object IDs (long digit prefix) from title
        title = re.sub(r"^\d{6,}\s*", "", title).strip()
        # Skip junk titles
        if (
            len(title) < 3
            or title in seen_titles
            or "00" == title.strip()
            or re.match(r"^\d+$", title)
        ):
            continue
        seen_titles.add(title)
        videos.append({
            "index": int(idx),
            "title": title,
            "duration": duration,
            "source": source,
        })
    return videos


def parse_image_captions(text: str) -> list[dict]:
    """Extract 圖一/圖二/圖三/圖四 captions for 圖文整合 lessons."""
    captions: list[dict] = []
    NUM_TO_INT = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5}
    seen: set[str] = set()
    # Pattern: "圖一  巴斯德鵝頸瓶實驗的設計與程序" (label + descriptor)
    # OR "圖一的標題是：巴斯德的..."
    for m in re.finditer(r"圖([一二三四五])(?:的標題是?)?\s*[:：]?\s*([^。\n（(]{5,80})", text):
        num = m.group(1)
        caption = m.group(2).strip()
        # Reject captions that are clearly questions or instructions
        if any(kw in caption for kw in ["哪一", "什麼", "如何", "為什麼", "請", "你猜", "（單選"]):
            continue
        key = f"{num}:{caption[:30]}"
        if key in seen:
            continue
        seen.add(key)
        captions.append({
            "figure_number": num,
            "figure_index": NUM_TO_INT.get(num, 0),
            "caption": caption,
        })
    return captions


def parse_self_check(section: str) -> list[str]:
    items: list[str] = []
    # Strip leading 自我檢核 header
    body = re.sub(r"^[◎\s]*自我檢核.*?\n", "", section)
    for m in re.finditer(r"[□☐■✓\s]*\d+\.?\s*([^\n]+)", body):
        line = m.group(1).strip()
        if line and not line.startswith("步驟") and len(line) > 2:
            items.append(line)
        if len(items) >= 10:
            break
    return items


def parse_lesson(docx: Path) -> dict:
    code = lesson_code_from_filename(docx)
    text = extract_full_text(docx)
    sections = split_sections(text)
    worksheet_order = extract_worksheet_section_order(text)
    worksheet_intro = extract_worksheet_intro(text)
    lesson_intro = extract_lesson_intro_from_docx(text)

    paragraphs = extract_paragraphs_from_table(docx)
    full_story = "\n".join(paragraphs)

    # fill_in_blank from main text (excludes textbox repeats by skipping seen answers)
    blanks = parse_fill_in_blank(text, paragraphs)

    spotlight_section = sections.get("spotlight", "")
    self_check = parse_self_check(sections.get("self_check", ""))
    # MCQ: scan FULL text — 閱讀理解 header repeats (TOC + section).
    mcq = parse_mcq(text)

    # New section content extractors (Young 2026-05-02 ask):
    lesson_vocab = parse_lesson_vocab_list(text)
    vocab_definitions = parse_vocab_definitions(sections.get("vocab_definitions", ""))
    vocab_application = parse_vocab_application(sections.get("vocab_application", ""))
    videos = parse_video_links(sections.get("knowledge_station", ""))
    image_captions = parse_image_captions(text)

    # Determine layout_mode + reading_strategy_type from filename
    fname = docx.name
    if "圖文整合" in fname:
        layout_mode = "graphic-text"
        strategy_type = "graphic_text_integration"
    elif "摘要策略" in fname:
        layout_mode = "standard"
        strategy_type = "summary_psr"
    else:
        layout_mode = "standard"
        strategy_type = "general"

    # 學習單 section content map. Key order in this dict matches the order
    # we emit; downstream code should reorder per worksheet_section_order if
    # they want to render exactly as the docx 一/二/三/.../九 layout.
    section_content = {
        "本課語詞": lesson_vocab,
        "語詞我最棒": vocab_definitions,
        "語詞應用": vocab_application,  # {vocab_bank: {A: word}, questions: [...]}
        "閱讀聚光燈": spotlight_section,
        "文章重點表": sections.get("structure_table", ""),
        "閱讀理解": mcq,
        "知識補給站": {
            "videos": videos,
            "raw_text": sections.get("knowledge_station", ""),
        },
        "自我檢核": self_check,
        "圖片說明": image_captions,  # for 圖文整合 lessons
    }

    return {
        "lesson_code": code,
        "source_file": docx.name,
        "layout_mode": layout_mode,
        "reading_strategy_type": strategy_type,
        # ── 學習單 section ordering (CRITICAL — Young 2026-05-02) ──────────
        # Preserve the 一/二/三/.../九 sequence the docx ships with so the
        # frontend can render the worksheet in its native order, OR reorder
        # for customization (e.g. demo skipping word_search).
        "worksheet_section_order": worksheet_order,
        # ── 學習單 intro metadata (#1434) ──────────────────────────────────
        "worksheet_intro": worksheet_intro if worksheet_intro else None,
        # ── Lesson intro — docx 說明/導讀 (#1443) ─────────────────────────
        "lesson_intro": lesson_intro,  # None if no 說明/導讀 found
        # ── Story body ────────────────────────────────────────────────────
        "paragraphs": paragraphs,
        "story_text": full_story,
        "paragraph_count": len(paragraphs),
        "char_count": sum(len(p) for p in paragraphs),
        # ── Section content (keyed by 學習單 Chinese name) ─────────────────
        "section_content": section_content,
        # ── Convenience top-level fields (for back-compat with existing yml) ─
        "fill_in_blank": blanks,
        "fill_in_blank_count": len(blanks),
        "spotlight_raw_text": spotlight_section,
        "spotlight_present": bool(spotlight_section and len(spotlight_section) > 100),
        "self_check_items": self_check,
        "self_check_count": len(self_check),
        "閱讀理解選擇題": mcq,
        "閱讀理解選擇題_count": len(mcq),
        "multiple_choice": mcq,
        "multiple_choice_count": len(mcq),
        "vocab_bank": vocab_application["vocab_bank"],
        "vocab_application_questions": vocab_application["questions"],
        "本課語詞": lesson_vocab,
        "vocab_definitions": vocab_definitions,
        "videos": videos,
        "image_captions": image_captions,
        # Diagnostics
        "_sections_found": sorted(sections.keys()),
        "_raw_text_length": len(text),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("lessons", nargs="*", help="Lesson codes like G6-L22, or empty for --all")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--out", default=str(OUTPUT_DIR))
    args = ap.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    targets: list[tuple[str, Path]] = []
    if args.all:
        for p in list_all_docx():
            code = lesson_code_from_filename(p)
            if code:
                targets.append((code, p))
    else:
        for code in args.lessons:
            p = find_docx(code)
            if p:
                targets.append((code, p))
            else:
                print(f"  [skip] {code}: no docx found")

    print(f"Re-parsing {len(targets)} lessons -> {out_dir}")
    summary = []
    for code, p in targets:
        try:
            data = parse_lesson(p)
            yml_path = out_dir / f"{code}.yml"
            with open(yml_path, "w", encoding="utf-8") as f:
                yaml.dump(data, f, allow_unicode=True, sort_keys=False, width=10**9)
            summary.append({
                "code": code,
                "para": data["paragraph_count"],
                "fb": data["fill_in_blank_count"],
                "spot": "Y" if data["spotlight_present"] else "-",
                "spot_chars": len(data["spotlight_raw_text"]),
                "sc": data["self_check_count"],
                "mcq": data["multiple_choice_count"],
                "voc": len(data.get("本課語詞", [])),
                "vbank": len(data["vocab_bank"]),
                "vapp": len(data["vocab_application_questions"]),
                "vid": len(data["videos"]),
                "img": len(data["image_captions"]),
                "ws_n": len(data["worksheet_section_order"]),
            })
        except Exception as e:
            print(f"  [error] {code}: {e}")

    print()
    # Column headers in 學習單 Chinese names (per Young's request).
    # Order columns to match docx natural sequence: 段落｜本課語詞｜語詞我最棒(vbank)｜
    # 語詞應用｜閱讀聚光燈｜文章重點表｜閱讀理解｜知識補給站(影片)｜圖片說明｜學習單段數
    print(
        f"{'課':<10} {'段落':>3} {'本課語詞':>5} {'vbank':>5} {'語詞應用':>5} {'聚光燈':>4} "
        f"{'聚字數':>5} {'自檢':>3} {'閱選':>3} {'影片':>3} {'圖':>2} {'段數':>3}"
    )
    print("-" * 90)
    for s in summary:
        print(
            f"{s['code']:<10} {s['para']:>3} {s['voc']:>5} {s['vbank']:>5} {s['vapp']:>5} "
            f"{s['spot']:>4} {s['spot_chars']:>5} {s['sc']:>3} {s['mcq']:>3} "
            f"{s['vid']:>3} {s['img']:>2} {s['ws_n']:>3}"
        )


if __name__ == "__main__":
    main()
