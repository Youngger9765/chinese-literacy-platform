#!/usr/bin/env python3
"""
Curriculum ingestion parser — auto-sync from 教授 source to backend/data/.

Reads:
  - <source>/自學教材清單.xlsx (master index, sheet 總表 + 文言文)
  - <source>/1-1教師版(L1~122)/{grade}/G{grade}-L{NN}*.docx (teacher version)
  - <source>/2-1學生版(L1~122)/{grade}/G{grade}-SL{NN}*.docx (student version)
  - <source>/第三階段(L123開始~L157)差學生版/G{grade}-L{NN}*.docx (phase 3)

Writes (to --target):
  - curriculum/lessons/G{grade}-L{NN}.yml  (catalog metadata, per-grade NN)
  - lessons/L{original_order}.yml          (content yml, keyed by 原課次)
  - curriculum/MANIFEST.yml                (active_version + provenance)

Identity model (important!):
  - lesson_code = G{grade}-L{NN} where NN is per-grade sequential (new edition)
  - display_order = global 新課次 (1..158)
  - original_order = 原課次 from xlsx (used as content yml stem)
  - Content yml stems (L01..L158) are STABLE across editions — downstream
    AI-generated fields (story_structure, fill_in_blank, etc.) keyed by these stems

Parser writes catalog yml in full + content yml minimal subset
(lesson_number, grade, grade_code, title, story_text, paragraphs, vocab).
Downstream AI-generated fields are NOT clobbered (drift detector compares
parser-managed subset only).

Usage:
  python scripts/ingest_curriculum.py \\
    --source private/curriculum-source/2026-05-01/1.L1-158新版完成學習單1150415/ \\
    --target /tmp/parsed-from-source/ --write

Owner: Young / LingoLeap | Issue: #1624
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import signal
import sys
from pathlib import Path
from typing import Any

try:
    from docx import Document
except ImportError:
    sys.stderr.write("ERROR: python-docx required. pip install python-docx\n")
    sys.exit(2)

try:
    import openpyxl
except ImportError:
    sys.stderr.write("ERROR: openpyxl required. pip install openpyxl\n")
    sys.exit(2)

try:
    import yaml
except ImportError:
    sys.stderr.write("ERROR: pyyaml required. pip install pyyaml\n")
    sys.exit(2)


# ----------------------------------------------------------------------
# Constants
# ----------------------------------------------------------------------

DOCX_PARSE_TIMEOUT_SECONDS = 60
PARSER_VERSION = "1.0.0"
EXCEL_DATE_BASE = dt.datetime(2025, 4, 1)


# ----------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------


def _parse_grade(val: Any) -> int | str | None:
    if val is None or val == "無" or val == "":
        return None
    if isinstance(val, (int, float)):
        return int(val)
    s = str(val).strip()
    if s.isdigit():
        return int(s)
    return None


def _normalize_str(val: Any) -> str:
    if val is None:
        return ""
    return str(val).strip()


def _decode_new_order(raw: Any) -> int | None:
    """Excel auto-converted 新課次 1 → 2025-04-01. Reverse it."""
    if raw is None:
        return None
    if isinstance(raw, dt.datetime):
        return (raw - EXCEL_DATE_BASE).days + 1
    if isinstance(raw, (int, float)):
        return int(raw)
    s = _normalize_str(raw)
    if s.isdigit():
        return int(s)
    return None


def _lesson_code(grade: Any, per_grade_seq: int) -> str:
    if isinstance(grade, int):
        return f"G{grade}-L{per_grade_seq:02d}"
    return f"文-L{per_grade_seq:02d}"


def _content_yml_stem(original_order: int) -> str:
    if original_order is None:
        return None
    return f"L{original_order:02d}" if original_order < 100 else f"L{original_order}"


# ----------------------------------------------------------------------
# Step A: parse master xlsx
# ----------------------------------------------------------------------


def parse_master_xlsx(xlsx_path: Path) -> list[dict]:
    """Parse 自學教材清單.xlsx → list of lesson records (ordered by new_order).

    Returns records with: new_order, original_order, grade (int|'文'),
    title, genre, text_type, unit_topic, applicable_grade, strategy_name,
    vocab[], classical_chinese, per_grade_seq.
    """
    wb = openpyxl.load_workbook(xlsx_path, read_only=True, data_only=True)
    lessons: list[dict] = []

    # --- 總表 sheet (白話) ---
    ws = wb["總表"]
    header = [_normalize_str(c) for c in next(ws.iter_rows(min_row=1, max_row=1, values_only=True))]
    vocab_col_idx = [i for i, h in enumerate(header) if h.startswith("語詞")]

    for row in ws.iter_rows(min_row=2, values_only=True):
        if not row or row[0] is None:
            continue
        new_order = _decode_new_order(row[0])
        if new_order is None:
            continue

        try:
            original_order = int(row[1]) if row[1] is not None else None
        except (ValueError, TypeError):
            original_order = None

        grade = _parse_grade(row[2])
        title = _normalize_str(row[3])
        if not title or grade is None:
            continue

        genre = _normalize_str(row[4])
        strategy_name = _normalize_str(row[6]) or "無"
        unit_topic = _normalize_str(row[8]) or None
        text_type = _normalize_str(row[10])

        vocab = []
        for vi in vocab_col_idx:
            if vi < len(row) and row[vi]:
                v = _normalize_str(row[vi])
                if v and v != "無":
                    vocab.append(v)

        lessons.append(
            {
                "new_order": new_order,
                "original_order": original_order,
                "grade": grade,
                "title": title,
                "genre": genre,
                "text_type": text_type,
                "unit_topic": unit_topic,
                "applicable_grade": None,
                "strategy_name": strategy_name,
                "vocab": vocab,
                "classical_chinese": False,
            }
        )

    # --- 文言文 sheet ---
    if "文言文" in wb.sheetnames:
        ws = wb["文言文"]
        header = [_normalize_str(c) for c in next(ws.iter_rows(min_row=1, max_row=1, values_only=True))]
        vocab_col_idx = [i for i, h in enumerate(header) if h.startswith("語詞")]

        for row in ws.iter_rows(min_row=2, values_only=True):
            if not row or row[0] is None:
                continue
            try:
                new_order = int(row[0])
            except (ValueError, TypeError):
                continue
            try:
                original_order = int(row[1]) if row[1] is not None else None
            except (ValueError, TypeError):
                original_order = None

            applicable_grade = _normalize_str(row[2]) or None
            title = _normalize_str(row[3])
            if not title:
                continue
            genre = _normalize_str(row[4])
            unit_topic = _normalize_str(row[6]) or None
            strategy_name = _normalize_str(row[8]) or "無"
            text_type = _normalize_str(row[10])

            vocab = []
            for vi in vocab_col_idx:
                if vi < len(row) and row[vi]:
                    v = _normalize_str(row[vi])
                    if v and v != "無":
                        vocab.append(v)

            lessons.append(
                {
                    "new_order": new_order,
                    "original_order": original_order,
                    "grade": "文",
                    "title": title,
                    "genre": genre,
                    "text_type": text_type,
                    "unit_topic": unit_topic,
                    "applicable_grade": applicable_grade,
                    "strategy_name": strategy_name,
                    "vocab": vocab,
                    "classical_chinese": True,
                }
            )

    wb.close()
    lessons.sort(key=lambda x: x["new_order"])

    # Compute per-grade sequential (G4 L01, L02, ... independently per grade)
    per_grade_counter: dict[Any, int] = {}
    for L in lessons:
        g = L["grade"]
        per_grade_counter[g] = per_grade_counter.get(g, 0) + 1
        L["per_grade_seq"] = per_grade_counter[g]

    return lessons


# ----------------------------------------------------------------------
# Step B + C: scan docx + extract story_text
# ----------------------------------------------------------------------


def scan_docx_files(source_root: Path) -> dict[str, dict[str, Path]]:
    """Build map: lesson_code (e.g. 'G4-L17') → {teacher: Path, student: Path}."""
    teacher_dir = source_root / "1-1教師版(L1~122)"
    student_dir = source_root / "2-1學生版(L1~122)"
    phase3_dir = source_root / "第三階段(L123開始~L157)差學生版"
    classical_dir_marker = "文言文"  # subdir in both teacher/student

    found: dict[str, dict[str, Path]] = {}

    def _scan(root: Path, role: str) -> None:
        if not root.exists():
            return
        for docx in root.rglob("*.docx"):
            if docx.name.startswith("~$"):
                continue
            # Match G{grade}-L{NN} or G{grade}-SL{NN} (also G{grade}-L{NN}-{MM} for multi-lesson)
            m = re.match(r"G(\d+)-S?L(\d+)(?:-\d+)?", docx.name)
            if m:
                grade_num = int(m.group(1))
                lesson_num = int(m.group(2))
                code = f"G{grade_num}-L{lesson_num:02d}"
            else:
                # Classical: filenames like "1假新聞？鞭虎救弟記.docx" or similar
                m2 = re.match(r"(\d+)", docx.name)
                if not m2:
                    continue
                # Use per-grade-seq from classical dir
                if classical_dir_marker not in str(docx):
                    continue
                lesson_num = int(m2.group(1))
                code = f"文-L{lesson_num:02d}"
            found.setdefault(code, {})[role] = docx

    _scan(teacher_dir, "teacher")
    _scan(student_dir, "student")
    _scan(phase3_dir, "student")
    return found


def _docx_timeout_handler(signum, frame):
    raise TimeoutError("docx parsing timeout")


def extract_story_from_docx(docx_path: Path) -> tuple[str, list[str]]:
    """Extract story_text from a teacher docx.

    Strategy: scan tables for the largest text cell > 100 chars (heuristic
    verified on G4-L1 sample — story in table[0][2,1]).
    """
    signal.signal(signal.SIGALRM, _docx_timeout_handler)
    signal.alarm(DOCX_PARSE_TIMEOUT_SECONDS)
    try:
        doc = Document(docx_path)
        candidate: tuple[int, str] = (0, "")
        for table in doc.tables:
            for row in table.rows:
                for cell in row.cells:
                    text = cell.text.strip()
                    # Skip obvious non-story cells
                    if len(text) > candidate[0] and not _looks_like_metadata(text):
                        candidate = (len(text), text)

        if candidate[0] < 100:
            return "", []

        story = candidate[1]
        chunks = re.split(r"\n\s*\n|\n(?=　)", story)
        paragraphs = [c.strip() for c in chunks if c.strip()]
        full_text = "\n".join(paragraphs)
        return full_text, paragraphs
    except TimeoutError:
        sys.stderr.write(f"WARN: timeout parsing {docx_path.name} — skipped\n")
        return "", []
    except Exception as e:
        sys.stderr.write(f"WARN: failed to parse {docx_path.name}: {e}\n")
        return "", []
    finally:
        signal.alarm(0)


def _looks_like_metadata(text: str) -> bool:
    """Filter out non-story cells (vocab banks, video lists, instructions)."""
    head = text[:30]
    for marker in ("第", "計時", "影片", "請", "□", "◎", "A.", "B.", "C.", "D.", "E.", "F.", "G.", "H."):
        if head.startswith(marker):
            return True
    return False


# ----------------------------------------------------------------------
# Step D + E: render yml
# ----------------------------------------------------------------------


def render_catalog_yml(lesson: dict) -> dict:
    code = _lesson_code(lesson["grade"], lesson["per_grade_seq"])
    grade_field = lesson["grade"] if isinstance(lesson["grade"], int) else None
    content_stem = _content_yml_stem(lesson["original_order"])
    return {
        "lesson_code": code,
        "display_order": lesson["new_order"],
        "original_order": lesson["original_order"],
        "title": lesson["title"],
        "grade": grade_field,
        "genre": lesson["genre"],
        "text_type": lesson["text_type"],
        "unit_topic": lesson["unit_topic"],
        "applicable_grade": lesson.get("applicable_grade"),
        "strategy_id": None,
        "strategy_name": lesson["strategy_name"],
        "strategy_dependency": None,
        "strategy_relation": None,
        "classical_chinese": lesson["classical_chinese"],
        "video_links": [],
        "vocab": lesson["vocab"],
        "existing_content_yaml": f"{content_stem}.yml" if content_stem else None,
        "notes": None,
    }


def render_content_yml_minimal(lesson: dict, story_text: str, paragraphs: list[str]) -> dict:
    """Minimal content yml — only parser-managed fields.

    Drift detector compares ONLY these fields. Downstream-managed fields
    (vocabulary, vocab_bank, fill_in_blank, multiple_choice, story_structure, etc.)
    are NOT touched.
    """
    grade_field = lesson["grade"] if isinstance(lesson["grade"], int) else None
    code = _lesson_code(lesson["grade"], lesson["per_grade_seq"])
    return {
        "lesson_number": lesson["original_order"],
        "grade": grade_field,
        "grade_code": code,
        "title": lesson["title"],
        "genre": lesson["genre"],
        "text_type": lesson["text_type"],
        "reading_strategy": lesson["strategy_name"],
        "story_text": story_text,
        "paragraphs": paragraphs,
        "paragraph_count": len(paragraphs),
        "char_count": len(story_text),
        "vocab_keywords": lesson["vocab"],
    }


# ----------------------------------------------------------------------
# Step F: MANIFEST
# ----------------------------------------------------------------------


def write_manifest(target_root: Path, source_root: Path, version: str, stats: dict) -> Path:
    # Use INGESTION_MANIFEST.yml to avoid case-collision with existing manifest.yml
    # (macOS is case-insensitive — the legacy manifest.yml is loaded by lesson_loader.py)
    manifest_path = target_root / "curriculum" / "INGESTION_MANIFEST.yml"
    try:
        rel_source = str(source_root.relative_to(Path.cwd()))
    except ValueError:
        rel_source = str(source_root)
    manifest = {
        "active_version": version,
        "source_dir": rel_source,
        "source_excel": "自學教材清單.xlsx",
        "parsed_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "parser_version": PARSER_VERSION,
        "stats": stats,
        "schema_note": (
            "MANIFEST tracks the active 教授 source version. "
            "Use scripts/check_curriculum_drift.py to verify backend/data/ "
            "matches what parser would generate from this source."
        ),
        "parser_managed_catalog_fields": [
            "lesson_code", "display_order", "original_order", "title", "grade",
            "genre", "text_type", "unit_topic", "applicable_grade",
            "strategy_name", "classical_chinese", "vocab",
        ],
        "parser_managed_content_fields": [
            "lesson_number", "grade", "grade_code", "title", "genre", "text_type",
            "reading_strategy", "story_text", "paragraphs", "paragraph_count",
            "char_count", "vocab_keywords",
        ],
    }
    return _write_yaml(manifest_path, manifest)


def _write_yaml(path: Path, data: dict) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        yaml.safe_dump(data, f, allow_unicode=True, sort_keys=False, width=10000)
    return path


# ----------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------


def main() -> int:
    ap = argparse.ArgumentParser(description="Ingest curriculum source → backend/data yml")
    ap.add_argument("--source", required=True, type=Path,
                    help="教授 source root (contains 自學教材清單.xlsx)")
    ap.add_argument("--target", required=True, type=Path,
                    help="Output root (writes curriculum/lessons/ + lessons/ + curriculum/MANIFEST.yml)")
    ap.add_argument("--version", default=None,
                    help="Version label (default: auto-detect from source parent dir)")
    ap.add_argument("--write", action="store_true",
                    help="Actually write files (default: dry-run, no write)")
    ap.add_argument("--limit", type=int, default=None,
                    help="Limit to first N lessons (for testing)")
    args = ap.parse_args()

    source_root: Path = args.source.resolve()
    target_root: Path = args.target.resolve()

    if not source_root.exists():
        sys.stderr.write(f"ERROR: source not found: {source_root}\n")
        return 2

    xlsx = source_root / "自學教材清單.xlsx"
    if not xlsx.exists():
        sys.stderr.write(f"ERROR: master xlsx not found: {xlsx}\n")
        return 2

    version = args.version or _infer_version(source_root)
    print(f"[ingest] source: {source_root}", flush=True)
    print(f"[ingest] target: {target_root} ({'WRITE' if args.write else 'DRY-RUN'})", flush=True)
    print(f"[ingest] version: {version}", flush=True)

    print(f"[ingest] Step A: parsing master xlsx...", flush=True)
    lessons = parse_master_xlsx(xlsx)
    print(f"[ingest]   loaded {len(lessons)} lesson records", flush=True)

    print(f"[ingest] Step B: scanning docx files...", flush=True)
    docx_map = scan_docx_files(source_root)
    print(f"[ingest]   found docx for {len(docx_map)} lesson codes", flush=True)

    print(f"[ingest] Step C-E: extracting stories + rendering yml...", flush=True)
    catalog_written = 0
    content_written = 0
    missing_story = 0
    missing_docx = 0
    matched_docx = 0

    iter_lessons = lessons[: args.limit] if args.limit else lessons

    for i, lesson in enumerate(iter_lessons, 1):
        if i % 25 == 0:
            print(f"[ingest]   progress: {i}/{len(iter_lessons)}", flush=True)

        code = _lesson_code(lesson["grade"], lesson["per_grade_seq"])
        docx_paths = docx_map.get(code, {})
        teacher_docx = docx_paths.get("teacher")
        student_docx = docx_paths.get("student")

        story_text = ""
        paragraphs: list[str] = []
        if teacher_docx and teacher_docx.exists():
            story_text, paragraphs = extract_story_from_docx(teacher_docx)
            matched_docx += 1
        elif student_docx and student_docx.exists():
            story_text, paragraphs = extract_story_from_docx(student_docx)
            matched_docx += 1
        else:
            missing_docx += 1

        if docx_paths and not story_text:
            missing_story += 1

        catalog = render_catalog_yml(lesson)
        content = render_content_yml_minimal(lesson, story_text, paragraphs)

        content_stem = _content_yml_stem(lesson["original_order"])
        catalog_path = target_root / "curriculum" / "lessons" / f"{code}.yml"
        content_path = target_root / "lessons" / f"{content_stem}.yml" if content_stem else None

        if args.write:
            _write_yaml(catalog_path, catalog)
            if content_path:
                _write_yaml(content_path, content)
        catalog_written += 1
        if content_path:
            content_written += 1

    stats = {
        "total_lessons": len(iter_lessons),
        "catalog_yml_count": catalog_written,
        "content_yml_count": content_written,
        "docx_matched": matched_docx,
        "missing_docx": missing_docx,
        "missing_story_text": missing_story,
        "白話": sum(1 for L in iter_lessons if not L["classical_chinese"]),
        "文言文": sum(1 for L in iter_lessons if L["classical_chinese"]),
    }
    if args.write:
        manifest_path = write_manifest(target_root, source_root, version, stats)
        print(f"[ingest] wrote MANIFEST: {manifest_path}", flush=True)

    print(f"\n[ingest] DONE", flush=True)
    print(f"[ingest] stats: {json.dumps(stats, ensure_ascii=False)}", flush=True)
    if not args.write:
        print(f"[ingest] (dry-run — no files written; pass --write to commit)", flush=True)
    return 0


def _infer_version(source_root: Path) -> str:
    for part in reversed(source_root.parts):
        m = re.match(r"^(\d{4}-\d{2}-\d{2})$", part)
        if m:
            return m.group(1)
    return dt.date.today().strftime("%Y-%m-%d")


if __name__ == "__main__":
    sys.exit(main())
