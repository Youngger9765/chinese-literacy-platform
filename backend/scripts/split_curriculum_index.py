#!/usr/bin/env python3
"""
split_curriculum_index.py
=========================
Split backend/data/curriculum-index.json into per-lesson YAML source-of-truth files.

Output:
  backend/data/curriculum/manifest.yml          -- top-level index (158 entries)
  backend/data/curriculum/lessons/G4-L01.yml    -- one file per lesson (158 total)
  backend/data/curriculum/audit-2026-05-01.md   -- mismatch + classification report

Source sheets:
  总表      (148 rows) -- all white-vernacular lessons G4-G9
  文言文     (10 rows)  -- classical Chinese lessons (display_order 149-158)
  注意課次安排 (69 rows)  -- strategy enrichment for first ~55 total-sheet lessons
  影片連結-新 (158 rows) -- video links (covers white-vernacular only)

Does NOT modify:
  backend/data/lessons/L*.yml  (content layer, untouched)
  backend/data/curriculum-index.json (read-only source)

Usage:
  python3 backend/scripts/split_curriculum_index.py
"""

import json
import os
import sys
import re
from datetime import date
from pathlib import Path

try:
    import yaml
except ImportError:
    print("ERROR: PyYAML not installed. Run: pip install pyyaml")
    sys.exit(1)

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
SCRIPT_DIR = Path(__file__).parent
REPO_ROOT = SCRIPT_DIR.parent.parent
DATA_DIR = REPO_ROOT / "backend" / "data"
SOURCE_JSON = DATA_DIR / "curriculum-index.json"
CURRICULUM_DIR = DATA_DIR / "curriculum"
LESSONS_DIR = CURRICULUM_DIR / "lessons"
MANIFEST_FILE = CURRICULUM_DIR / "manifest.yml"
AUDIT_FILE = CURRICULUM_DIR / f"audit-{date.today().isoformat()}.md"
EXISTING_LESSONS_DIR = DATA_DIR / "lessons"

# ---------------------------------------------------------------------------
# YAML dumper: preserve UTF-8 and nice block style
# ---------------------------------------------------------------------------
class NiceDumper(yaml.Dumper):
    pass

def _str_representer(dumper, data):
    if "\n" in data:
        return dumper.represent_scalar("tag:yaml.org,2002:str", data, style="|")
    return dumper.represent_scalar("tag:yaml.org,2002:str", data)

NiceDumper.add_representer(str, _str_representer)


def write_yaml(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        yaml.dump(
            data,
            f,
            Dumper=NiceDumper,
            allow_unicode=True,
            default_flow_style=False,
            sort_keys=False,
        )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def clean(val):
    """Return None for empty / NaN-like values."""
    if val is None:
        return None
    if isinstance(val, str) and val.strip() in ("", "nan", "None", "null"):
        return None
    return val


def to_lesson_code(新課次_raw, is_classical: bool, classical_idx: int = 0,
                   grade_override: int | None = None, seq_within_grade: int | None = None,
                   suffix: str = "") -> str:
    """
    Convert 新課次 raw value to lesson_code.
    White-vernacular: '4-1' -> 'G4-L01', '9-15' -> 'G9-L15'
    Classical:        use 'WW-L01' ... 'WW-L10'
    Edge cases:
      - null 新課次: use grade_override + seq_within_grade
      - duplicate 新課次: append suffix ('a', 'b')
    """
    if is_classical:
        return f"WW-L{classical_idx:02d}"
    if isinstance(新課次_raw, str) and "-" in 新課次_raw:
        parts = 新課次_raw.split("-")
        grade = parts[0]
        lesson = int(parts[1])
        return f"G{grade}-L{lesson:02d}{suffix}"
    # Fallback: use grade_override + seq_within_grade
    if grade_override is not None and seq_within_grade is not None:
        return f"G{grade_override}-L{seq_within_grade:02d}{suffix}"
    return f"UNK-{新課次_raw}"


def extract_strategy_name(row: dict) -> str | None:
    """Pick the best strategy name from 總表 row."""
    # Prefer 教材目標策略 (longer, more descriptive)
    name = clean(row.get("閱讀聚光燈策略──教材目標策略（學習單第一頁右上方）"))
    if name:
        return name
    name = clean(row.get("閱讀聚光燈策略──研發夥伴用"))
    if name:
        return name
    name = clean(row.get("閱讀聚光燈策略──第六大題標題"))
    return name


def extract_strategy_name_ww(row: dict) -> str | None:
    """Pick strategy name from 文言文 row."""
    name = clean(row.get("閱讀聚光燈策略──教材目標策略（學習單第一頁右上方）"))
    if name:
        return name
    name = clean(row.get("閱讀聚光燈策略──研發夥伴用"))
    if name:
        return name
    name = clean(row.get("閱讀聚光燈策略──第六大題標題"))
    return name


def build_vocab_list(row: dict) -> list[str]:
    """Collect 語詞1..語詞20 into a compact list."""
    vocab = []
    for i in range(1, 21):
        w = clean(row.get(f"語詞{i}"))
        if w:
            vocab.append(w)
    return vocab


# ---------------------------------------------------------------------------
# Load source data
# ---------------------------------------------------------------------------
print(f"Loading {SOURCE_JSON} ...")
with open(SOURCE_JSON, encoding="utf-8") as f:
    data = json.load(f)

sheets = data["sheets"]
sheet_總表 = sheets["總表"]["rows"]
sheet_ww = sheets["文言文"]["rows"]
sheet_注意 = sheets["注意課次安排"]["rows"]
sheet_video = sheets["影片連結-新"]["rows"]

print(f"  總表:      {len(sheet_總表)} rows")
print(f"  文言文:    {len(sheet_ww)} rows")
print(f"  注意課次:  {len(sheet_注意)} rows")
print(f"  影片連結:  {len(sheet_video)} rows")

# ---------------------------------------------------------------------------
# Build lookup: strategy enrichment by course title
# ---------------------------------------------------------------------------
strat_by_title: dict[str, dict] = {}
for r in sheet_注意:
    title = clean(r.get("課名"))
    if not title:
        continue
    strat_by_title[title] = {
        "strategy_id": clean(r.get("閱讀聚光燈策略")),
        "strategy_dependency": clean(r.get("因策略")),
        "strategy_relation": clean(r.get("策略關聯")),
        "applicable_grade_note": clean(r.get("適用年級")),
    }

print(f"\nStrategy enrichment entries: {len(strat_by_title)}")

# ---------------------------------------------------------------------------
# Build lookup: video links by course title
# ---------------------------------------------------------------------------
video_by_title: dict[str, list[dict]] = {}
for r in sheet_video:
    title = clean(r.get("課名"))
    if not title:
        continue
    links = []
    for i in range(1, 4):
        url = clean(r.get(f"影片{i}"))
        if url:
            links.append({"title": f"影片{i}", "url": url})
    if links:
        video_by_title[title] = links

print(f"Video link entries:          {len(video_by_title)}")

# ---------------------------------------------------------------------------
# Build lookup: existing L*.yml by title
# ---------------------------------------------------------------------------
existing_yaml_by_title: dict[str, str] = {}
if EXISTING_LESSONS_DIR.exists():
    for yml_path in sorted(EXISTING_LESSONS_DIR.glob("L*.yml")):
        try:
            with open(yml_path, encoding="utf-8") as f:
                lesson_data = yaml.safe_load(f)
            title = clean(lesson_data.get("title") if lesson_data else None)
            if title:
                existing_yaml_by_title[title] = yml_path.name
        except Exception as e:
            print(f"  WARNING: could not read {yml_path.name}: {e}")

print(f"Existing lesson YAMLs:       {len(existing_yaml_by_title)}")

# ---------------------------------------------------------------------------
# Generate per-lesson records
# ---------------------------------------------------------------------------
# Clear output directory first to ensure idempotency (no stale files from prev runs)
if LESSONS_DIR.exists():
    for old_file in LESSONS_DIR.glob("*.yml"):
        old_file.unlink()
    print(f"Cleared existing files in {LESSONS_DIR}")
LESSONS_DIR.mkdir(parents=True, exist_ok=True)

records = []  # for manifest
generated_files = []
unmatched_strat_titles = set(strat_by_title.keys())

# --- Pre-pass: detect duplicate lesson codes in 總表 ---
# Build per-code row counts to assign suffixes
from collections import defaultdict

code_occurrences: dict[str, list[int]] = defaultdict(list)
for idx0, row0 in enumerate(sheet_總表, start=1):
    raw0 = row0.get("新課次")
    grade_raw0 = clean(row0.get("適用年級"))
    grade0 = int(grade_raw0) if grade_raw0 and str(grade_raw0).isdigit() else None
    seq0 = idx0  # fallback
    if isinstance(raw0, str) and "-" in raw0:
        parts0 = raw0.split("-")
        base_code = f"G{parts0[0]}-L{int(parts0[1]):02d}"
    elif grade0 is not None:
        base_code = f"G{grade0}-L??"  # null 新課次 case
    else:
        base_code = f"UNK-{raw0}"
    code_occurrences[base_code].append(idx0)

# Build suffix map: if a code appears >1, assign 'a', 'b', ...
suffix_map: dict[int, str] = {}  # row_idx -> suffix
for code, row_indices in code_occurrences.items():
    if len(row_indices) > 1:
        for i, ridx in enumerate(row_indices):
            suffix_map[ridx] = chr(ord("a") + i)

# Build per-grade sequential counter for null 新課次 rows
grade_seq_counter: dict[int, int] = defaultdict(int)
grade_max_lesson: dict[int, int] = defaultdict(int)
for row0 in sheet_總表:
    raw0 = row0.get("新課次")
    if isinstance(raw0, str) and "-" in raw0:
        parts0 = raw0.split("-")
        grade0 = int(parts0[0])
        lesson0 = int(parts0[1])
        grade_max_lesson[grade0] = max(grade_max_lesson[grade0], lesson0)

# --- White-vernacular lessons (總表, display_order 1-148) ---
print("\nProcessing 總表 (white-vernacular) ...")
# Track per-grade seq for null cases
grade_null_counter: dict[int, int] = defaultdict(int)

for idx, row in enumerate(sheet_總表, start=1):
    title = clean(row.get("課名"))
    if not title:
        print(f"  WARNING: Row {idx} in 總表 has no title, skipping")
        continue

    新課次_raw = row.get("新課次")
    原課次_raw = clean(row.get("原課次"))
    suffix = suffix_map.get(idx, "")
    grade_raw = clean(row.get("適用年級"))
    grade = int(grade_raw) if grade_raw and str(grade_raw).isdigit() else grade_raw

    # Handle null 新課次 edge case
    if not (isinstance(新課次_raw, str) and "-" in 新課次_raw):
        # Determine grade from row context (look at neighbours or 適用年級)
        g = grade if isinstance(grade, int) else None
        if g is None:
            # Fall back to previous grade
            print(f"  WARNING: Row {idx} '{title}' has null 新課次 and no numeric grade")
            g = 0
        # Assign the next sequential lesson number within this grade
        grade_null_counter[g] += 1
        seq_within = grade_max_lesson.get(g, 0) + grade_null_counter[g]
        lesson_code = to_lesson_code(None, is_classical=False,
                                     grade_override=g, seq_within_grade=seq_within, suffix=suffix)
        print(f"  NOTE: Row {idx} '{title}' has null 新課次 -> assigned {lesson_code}")
    else:
        lesson_code = to_lesson_code(新課次_raw, is_classical=False, suffix=suffix)

    display_order = idx
    if suffix:
        print(f"  NOTE: Duplicate 新課次 at row {idx} '{title}' -> {lesson_code}")

    genre = clean(row.get("文體"))
    text_type = clean(row.get("文本類型"))
    unit_topic = clean(row.get("單元議題"))
    strategy_name = extract_strategy_name(row)

    # Enrich from 注意課次安排
    strat_info = strat_by_title.get(title, {})
    strategy_id = clean(strat_info.get("strategy_id"))
    strategy_dependency = clean(strat_info.get("strategy_dependency"))
    strategy_relation = clean(strat_info.get("strategy_relation"))
    applicable_grade = clean(strat_info.get("applicable_grade_note"))
    if title in strat_by_title:
        unmatched_strat_titles.discard(title)

    # Video links
    video_links = video_by_title.get(title, [])

    # Existing YAML cross-ref
    existing_yaml = existing_yaml_by_title.get(title) or clean(row.get("_existing_yaml"))

    # Build vocab
    vocab = build_vocab_list(row)

    lesson_record = {
        "lesson_code": lesson_code,
        "display_order": display_order,
        "original_order": 原課次_raw,
        "title": title,
        "grade": grade,
        "genre": genre,
        "text_type": text_type,
        "unit_topic": unit_topic,
        "applicable_grade": applicable_grade,
        "strategy_id": strategy_id,
        "strategy_name": strategy_name,
        "strategy_dependency": strategy_dependency,
        "strategy_relation": strategy_relation,
        "classical_chinese": False,
        "video_links": video_links if video_links else None,
        "vocab": vocab if vocab else None,
        "existing_content_yaml": existing_yaml,
        "notes": None,
    }

    output_path = LESSONS_DIR / f"{lesson_code}.yml"
    write_yaml(output_path, lesson_record)
    generated_files.append(lesson_code)

    records.append({
        "lesson_code": lesson_code,
        "display_order": display_order,
        "title": title,
        "grade": grade,
        "strategy_id": strategy_id,
        "strategy_name": strategy_name,
        "classical_chinese": False,
    })

print(f"  Written: {len(generated_files)} files")

# --- Classical Chinese lessons (文言文, display_order 149-158) ---
print("Processing 文言文 (classical) ...")
classical_count = 0
for idx, row in enumerate(sheet_ww, start=1):
    title = clean(row.get("課名"))
    if not title:
        print(f"  WARNING: Row {idx} in 文言文 has no title, skipping")
        continue

    display_order = 148 + idx
    lesson_code = to_lesson_code(None, is_classical=True, classical_idx=idx)
    原課次_raw = clean(row.get("原課次"))
    grade_raw = clean(row.get("適用年級"))
    grade = int(grade_raw) if grade_raw and str(grade_raw).isdigit() else grade_raw

    genre = clean(row.get("文體"))
    text_type = clean(row.get("文本類型"))
    unit_topic = clean(row.get("單元議題"))
    strategy_name = extract_strategy_name_ww(row)

    # Enrich from 注意課次安排
    strat_info = strat_by_title.get(title, {})
    strategy_id = clean(strat_info.get("strategy_id"))
    strategy_dependency = clean(strat_info.get("strategy_dependency"))
    strategy_relation = clean(strat_info.get("strategy_relation"))
    applicable_grade = clean(strat_info.get("applicable_grade_note"))
    if title in strat_by_title:
        unmatched_strat_titles.discard(title)

    # Classical lessons have no video links in 影片連結-新
    video_links = []

    # Existing YAML cross-ref
    existing_yaml = existing_yaml_by_title.get(title) or clean(row.get("_existing_yaml"))

    vocab = build_vocab_list(row)

    lesson_record = {
        "lesson_code": lesson_code,
        "display_order": display_order,
        "original_order": 原課次_raw,
        "title": title,
        "grade": grade,
        "genre": genre,
        "text_type": text_type,
        "unit_topic": unit_topic,
        "applicable_grade": applicable_grade,
        "strategy_id": strategy_id,
        "strategy_name": strategy_name,
        "strategy_dependency": strategy_dependency,
        "strategy_relation": strategy_relation,
        "classical_chinese": True,
        "video_links": None,
        "vocab": vocab if vocab else None,
        "existing_content_yaml": existing_yaml,
        "notes": None,
    }

    output_path = LESSONS_DIR / f"{lesson_code}.yml"
    write_yaml(output_path, lesson_record)
    generated_files.append(lesson_code)
    classical_count += 1

    records.append({
        "lesson_code": lesson_code,
        "display_order": display_order,
        "title": title,
        "grade": grade,
        "strategy_id": strategy_id,
        "strategy_name": strategy_name,
        "classical_chinese": True,
    })

print(f"  Written: {classical_count} files")

# ---------------------------------------------------------------------------
# Write manifest.yml
# ---------------------------------------------------------------------------
total = len(records)
white_count = sum(1 for r in records if not r["classical_chinese"])
classical_count_total = sum(1 for r in records if r["classical_chinese"])

manifest = {
    "generated_at": date.today().isoformat(),
    "source_excel": data.get("source_file", "自學教材清單.xlsx"),
    "total_lessons": total,
    "breakdown": {
        "白話": white_count,
        "文言文": classical_count_total,
    },
    "lessons": sorted(records, key=lambda r: r["display_order"]),
}

write_yaml(MANIFEST_FILE, manifest)
print(f"\nManifest written: {MANIFEST_FILE}")
print(f"  Total lessons: {total} (白話: {white_count}, 文言文: {classical_count_total})")

# ---------------------------------------------------------------------------
# Audit
# ---------------------------------------------------------------------------
print("\nRunning audit ...")

existing_yaml_titles = set(existing_yaml_by_title.keys())
curriculum_titles = {r["title"] for r in records}

# Excel has but no existing content YAML
excel_no_yaml: list[dict] = []
for r in records:
    if not existing_yaml_by_title.get(r["title"]):
        excel_no_yaml.append(r)

# Existing YAMLs that matched
matched_yamls = {
    fname for title, fname in existing_yaml_by_title.items()
    if title in curriculum_titles
}

# Existing YAMLs NOT in Excel
existing_files = sorted(EXISTING_LESSONS_DIR.glob("L*.yml"))
not_in_excel: list[dict] = []
for yml_path in existing_files:
    try:
        with open(yml_path, encoding="utf-8") as f:
            ld = yaml.safe_load(f)
        title = clean(ld.get("title") if ld else None)
        if not title or title not in curriculum_titles:
            not_in_excel.append({
                "file": yml_path.name,
                "title": title or "(no title)",
            })
    except Exception as e:
        not_in_excel.append({"file": yml_path.name, "title": f"(read error: {e})"})

# Strategy distribution
strat_dist: dict = {}
for r in records:
    sid = r["strategy_id"]
    sname = r.get("strategy_name") or "(no strategy)"
    key = f"{sid}: {sname}" if sid else f"None: {sname}"
    strat_dist[key] = strat_dist.get(key, 0) + 1

top5_strats = sorted(strat_dist.items(), key=lambda x: -x[1])[:5]

# L56.yml classification
L56_title = None
L56_classification = "not found in existing lessons"
for yml_path in existing_files:
    if yml_path.name == "L56.yml":
        try:
            with open(yml_path, encoding="utf-8") as f:
                ld = yaml.safe_load(f)
            L56_title = clean(ld.get("title") if ld else None)
            if L56_title and L56_title in curriculum_titles:
                L56_classification = f"MATCHED to curriculum ({L56_title})"
            else:
                L56_classification = f"NOT IN EXCEL — title: '{L56_title}'"
                # Check if it looks like a multi-text that was split/renamed
                if L56_title and ("未解之謎" in L56_title or "巨石" in L56_title or "摩艾" in L56_title):
                    L56_classification += " (likely split into separate G9 lessons)"
        except Exception as e:
            L56_classification = f"read error: {e}"

# 注意課次安排 entries not in either sheet
strat_not_matched = [t for t in unmatched_strat_titles if t]

# ---------------------------------------------------------------------------
# Write audit report
# ---------------------------------------------------------------------------
audit_lines = [
    f"# Curriculum Audit — {date.today().isoformat()}",
    "",
    "## Summary",
    "",
    f"| Item | Count |",
    f"|------|-------|",
    f"| Total curriculum lessons (Excel) | {total} |",
    f"| White-vernacular (白話) | {white_count} |",
    f"| Classical Chinese (文言文) | {classical_count_total} |",
    f"| Existing `L*.yml` files | {len(existing_files)} |",
    f"| Existing YAMLs matched to Excel | {len(matched_yamls)} |",
    f"| Excel lessons without content YAML | {len(excel_no_yaml)} |",
    f"| Existing YAMLs NOT in Excel | {len(not_in_excel)} |",
    f"| 注意課次安排 entries not matched to any lesson | {len(strat_not_matched)} |",
    "",
    "## L56.yml Classification",
    "",
    f"- File: `backend/data/lessons/L56.yml`",
    f"- Title: `{L56_title}`",
    f"- Classification: **{L56_classification}**",
    "",
    "## Existing YAMLs NOT in Excel (suspect / obsolete)",
    "",
    "These files exist in `backend/data/lessons/` but their title does not appear in the Excel curriculum.",
    "They may be: renamed lessons, draft files, multi-text precursors, or obsolete content.",
    "",
]

if not_in_excel:
    audit_lines.append("| File | Title |")
    audit_lines.append("|------|-------|")
    for item in not_in_excel:
        audit_lines.append(f"| `{item['file']}` | {item['title']} |")
else:
    audit_lines.append("_(none — all existing YAMLs are matched)_")

audit_lines += [
    "",
    "## Excel Lessons Without Content YAML (expected ~102)",
    "",
    f"These {len(excel_no_yaml)} lessons exist in the Excel curriculum but have no corresponding",
    "content YAML in `backend/data/lessons/`. They will be created by issue #1344 (bulk docx parser).",
    "",
    "| lesson_code | display_order | title | grade |",
    "|-------------|---------------|-------|-------|",
]
for r in sorted(excel_no_yaml, key=lambda x: x["display_order"]):
    audit_lines.append(
        f"| `{r['lesson_code']}` | {r['display_order']} | {r['title']} | {r.get('grade', '?')} |"
    )

audit_lines += [
    "",
    "## Strategy Distribution (Top 5 by Lesson Count)",
    "",
    "| Strategy | Lesson Count |",
    "|----------|-------------|",
]
for strat, count in top5_strats:
    audit_lines.append(f"| {strat} | {count} |")

audit_lines += [
    "",
    "## 注意課次安排 Entries Not Matched to Any Lesson",
    "",
    "These entries in `注意課次安排` sheet have titles that don't appear in 總表 OR 文言文.",
    "They are likely older lesson names that were renamed or superseded.",
    "",
]
if strat_not_matched:
    for t in sorted(strat_not_matched):
        audit_lines.append(f"- {t}")
else:
    audit_lines.append("_(none)_")

audit_lines += [
    "",
    "## Strategy Coverage",
    "",
    f"Lessons with strategy_id: {sum(1 for r in records if r.get('strategy_id'))}",
    f"Lessons with strategy_name: {sum(1 for r in records if r.get('strategy_name'))}",
    f"Lessons with no strategy info: {sum(1 for r in records if not r.get('strategy_id') and not r.get('strategy_name'))}",
    "",
    "### Full Strategy Distribution",
    "",
    "| Strategy | Count |",
    "|----------|-------|",
]
for strat, count in sorted(strat_dist.items(), key=lambda x: -x[1]):
    audit_lines.append(f"| {strat} | {count} |")

audit_lines += [""]

with open(AUDIT_FILE, "w", encoding="utf-8") as f:
    f.write("\n".join(audit_lines))

print(f"Audit written: {AUDIT_FILE}")

# ---------------------------------------------------------------------------
# Final summary
# ---------------------------------------------------------------------------
print("\n" + "=" * 60)
print("SPLIT COMPLETE")
print("=" * 60)
print(f"  Per-lesson YAMLs generated: {len(generated_files)}")
print(f"  Manifest: {MANIFEST_FILE}")
print(f"  Audit:    {AUDIT_FILE}")
print()
print("Audit summary:")
print(f"  Existing YAMLs matched:    {len(matched_yamls)}/{len(existing_files)}")
print(f"  Existing YAMLs not in Excel: {len(not_in_excel)}")
print(f"  Excel without content YAML:  {len(excel_no_yaml)}")
print()
print("L56.yml:", L56_classification)
print()
print("Top 5 strategies:")
for strat, count in top5_strats:
    print(f"  {count:3d} lessons — {strat}")
