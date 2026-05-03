#!/usr/bin/env python3
"""
Merge re-parsed content into prod yml — additive only, no overwrites.

Source:
  - re-parsed yml: backend/data/lessons/_reparsed_2026-05-02/{LESSON}.yml
  - structured spotlight JSON: backend/data/lessons/_reparsed_2026-05-02/spotlight_structured/{LESSON}.json
  - excel intro map: /tmp/excel_intro_map.json (from build_lesson_intro_from_excel.py)

Target:
  - prod yml: backend/data/lessons/_parsed_2026-05-01/{LESSON}.yml

Merge policy: ONLY fill fields that are missing/empty in prod yml. Never overwrite
existing structured data (manual/AI-curated content takes priority).

Fields merged (if missing in prod):
  - vocab_bank                       (vocab_bank: {A: word, ...})
  - fill_in_blank (vocab_application) — only if prod's fill_in_blank is empty
  - spotlight_raw_text               (raw text dump for fallback rendering)
  - strategy_exercise                (Gemini-structured guided_steps; only if prod is null/empty)
  - 本課語詞 list
  - vocab_definitions
  - videos / video_links             (only if prod has none)
  - worksheet_section_order          (always overwrite — order metadata)
  - image_captions                   (graphic-text only)
  - lesson_intro                     (#1443: docx 說明/導讀 preferred; excel fallback)

Usage:
  python3 scripts/merge_reparsed_to_prod.py --demo  # 7 demo lessons (preview/dry-run)
  python3 scripts/merge_reparsed_to_prod.py --demo --apply  # actually write
  python3 scripts/merge_reparsed_to_prod.py --all --apply   # all lessons
"""
from __future__ import annotations
import argparse
import json
import sys
from pathlib import Path
from typing import Optional

import yaml

REPO = Path("/Users/young/project/chinese-literacy-platform")
REPARSED_DIR = REPO / "backend/data/lessons/_reparsed_2026-05-02"
STRUCTURED_DIR = REPARSED_DIR / "spotlight_structured"
PROD_DIR = REPO / "backend/data/lessons/_parsed_2026-05-01"

DEMO_LESSONS = ["G6-L22", "G6-L23", "G6-L24", "G6-L25", "G7-L28", "G7-L29", "G7-L30"]
EXCEL_INTRO_MAP_PATH = Path("/tmp/excel_intro_map.json")

# Lazily loaded excel intro map — populated once on first use
_excel_intro_map: dict | None = None


def get_excel_intro_map() -> dict:
    """Load and cache the excel intro map from /tmp/excel_intro_map.json."""
    global _excel_intro_map
    if _excel_intro_map is None:
        if EXCEL_INTRO_MAP_PATH.exists():
            _excel_intro_map = json.loads(EXCEL_INTRO_MAP_PATH.read_text(encoding="utf-8"))
            print(f"  [excel_intro] Loaded {len(_excel_intro_map)} entries from {EXCEL_INTRO_MAP_PATH}")
        else:
            _excel_intro_map = {}
            print(f"  [excel_intro] WARNING: {EXCEL_INTRO_MAP_PATH} not found — excel fallback disabled")
    return _excel_intro_map


def is_empty(v) -> bool:
    """Check if a yml value is missing/empty/null."""
    if v is None:
        return True
    if isinstance(v, (list, dict, str)) and len(v) == 0:
        return True
    return False


def merge_lesson(code: str) -> dict:
    """Compute merge plan for one lesson. Returns audit record + new yml dict."""
    prod_path = PROD_DIR / f"{code}.yml"
    reparsed_path = REPARSED_DIR / f"{code}.yml"
    structured_path = STRUCTURED_DIR / f"{code}.json"

    if not prod_path.exists():
        return {"code": code, "status": "MISSING_PROD"}
    if not reparsed_path.exists():
        return {"code": code, "status": "MISSING_REPARSED"}

    prod = yaml.safe_load(prod_path.read_text(encoding="utf-8"))
    reparsed = yaml.safe_load(reparsed_path.read_text(encoding="utf-8"))
    structured = None
    if structured_path.exists():
        structured = json.loads(structured_path.read_text(encoding="utf-8"))

    changes: list[str] = []
    new = dict(prod)  # shallow copy

    # ── 0. paragraphs / story_text — fill if prod empty ────────────────────
    # Critical: 6 lessons (G5-L1, G5-L5, G8-L8, G9-L2, 文-L7, 文-L10) had
    # paragraphs=[] in prod yml because old parser couldn't extract from
    # their docx structure. New raw-XML parser handles them.
    prod_paragraphs = prod.get("paragraphs") or []
    if not prod_paragraphs and reparsed.get("paragraphs"):
        new["paragraphs"] = reparsed["paragraphs"]
        new["story_text"] = reparsed.get("story_text") or "\n".join(reparsed["paragraphs"])
        new["paragraph_count"] = len(reparsed["paragraphs"])
        new["char_count"] = reparsed.get("char_count") or sum(len(p) for p in reparsed["paragraphs"])
        changes.append(f"paragraphs: {len(reparsed['paragraphs'])} (was 0)")

    # ── 1. vocab_bank — fill if prod empty ─────────────────────────────────
    if is_empty(prod.get("vocab_bank")) and reparsed.get("vocab_bank"):
        new["vocab_bank"] = reparsed["vocab_bank"]
        changes.append(f"vocab_bank: {len(reparsed['vocab_bank'])} entries")

    # ── 2. fill_in_blank (vocab_application letter-coded) — fill if empty ──
    # Only override if prod has 0 or missing fill_in_blank AND reparsed has questions.
    # (G6 lessons: prod's fill_in_blank usually has 5-8 from PSR table; don't overwrite)
    prod_fb = prod.get("fill_in_blank") or []
    if not prod_fb and reparsed.get("vocab_application_questions"):
        # Convert vocab_application_questions to fill_in_blank shape
        questions = reparsed["vocab_application_questions"]
        new["fill_in_blank"] = [
            {
                "id": q["id"],
                "answer": q["answer_letter"],
                "answer_word": q["answer_word"],
                "context_before": q["context_before"],
                "context_after": q["context_after"],
            }
            for q in questions
        ]
        new["fill_in_blank_count"] = len(questions)
        changes.append(f"fill_in_blank (vocab_app): {len(questions)} questions")

    # ── 3. spotlight_raw_text — always add (raw fallback) ───────────────────
    if is_empty(prod.get("spotlight_raw_text")) and reparsed.get("spotlight_raw_text"):
        new["spotlight_raw_text"] = reparsed["spotlight_raw_text"]
        changes.append(f"spotlight_raw_text: {len(reparsed['spotlight_raw_text'])} chars")

    # ── 4. strategy_exercise — Gemini-structured (fill if prod empty) ──────
    prod_se = prod.get("strategy_exercise")
    prod_se_list = prod.get("strategy_exercises") or []
    if (is_empty(prod_se) or prod_se in (None, {})) and not prod_se_list and structured:
        new["strategy_exercise"] = structured
        # Mark as AI-generated for downstream awareness
        new["strategy_exercise_source"] = "gemini-2.5-flash-2026-05-02"
        changes.append(f"strategy_exercise (Gemini): {len(structured.get('steps', []))} steps")

    # ── 5. 本課語詞 list ────────────────────────────────────────────────────
    if is_empty(prod.get("本課語詞")) and reparsed.get("本課語詞"):
        new["本課語詞"] = reparsed["本課語詞"]
        changes.append(f"本課語詞: {len(reparsed['本課語詞'])} words")

    # ── 6. vocab_definitions (語詞我最棒) ────────────────────────────────────
    # prod may have a 'vocabulary' field with definitions already
    if is_empty(prod.get("vocab_definitions")) and is_empty(prod.get("vocabulary")):
        if reparsed.get("vocab_definitions"):
            new["vocab_definitions"] = reparsed["vocab_definitions"]
            changes.append(f"vocab_definitions: {len(reparsed['vocab_definitions'])}")

    # ── 7. videos — only if prod has none ───────────────────────────────────
    if is_empty(prod.get("videos")) and is_empty(prod.get("video_links")):
        if reparsed.get("videos"):
            new["videos"] = reparsed["videos"]
            changes.append(f"videos: {len(reparsed['videos'])}")

    # ── 8. worksheet_section_order — always overwrite (metadata) ────────────
    if reparsed.get("worksheet_section_order"):
        new["worksheet_section_order"] = reparsed["worksheet_section_order"]
        changes.append(f"worksheet_section_order: {len(reparsed['worksheet_section_order'])} sections")

    # ── 8b. worksheet_intro — always overwrite (metadata, #1434) ────────────
    if reparsed.get("worksheet_intro"):
        new["worksheet_intro"] = reparsed["worksheet_intro"]
        strategy = reparsed["worksheet_intro"].get("target_strategy", "")[:30]
        changes.append(f"worksheet_intro: strategy={strategy}")

    # ── 9. image_captions (graphic-text only) ───────────────────────────────
    if is_empty(prod.get("image_captions")) and reparsed.get("image_captions"):
        new["image_captions"] = reparsed["image_captions"]
        changes.append(f"image_captions: {len(reparsed['image_captions'])}")

    # ── 10. lesson_intro (#1443) — docx 說明/導讀 preferred, excel fallback ─
    # Always set (overwrite) lesson_intro from the best available source.
    # Docx intro is more specific and authoritatively written; excel is generic.
    existing_intro = prod.get("lesson_intro")
    # Prefer docx-sourced intro from reparsed yml
    docx_intro = reparsed.get("lesson_intro")
    if docx_intro and docx_intro.get("source") in ("docx_explanation", "docx_guide"):
        if not existing_intro or existing_intro.get("source") != docx_intro["source"]:
            new["lesson_intro"] = docx_intro
            changes.append(f"lesson_intro (docx): source={docx_intro['source']} text={docx_intro['text'][:40]!r}")
    else:
        # Fall back to excel map
        excel_map = get_excel_intro_map()
        excel_intro = excel_map.get(code)
        if excel_intro:
            if not existing_intro:
                new["lesson_intro"] = excel_intro
                changes.append(f"lesson_intro (excel): topic={excel_intro.get('unit_topic','')[:30]!r}")
        else:
            # No source available — keep existing (if any), else leave absent
            if not existing_intro:
                changes.append(f"lesson_intro: no source found (neither docx nor excel)")

    return {
        "code": code,
        "status": "OK" if changes else "NO_CHANGES",
        "changes": changes,
        "new_yml": new,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("lessons", nargs="*")
    ap.add_argument("--demo", action="store_true")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--apply", action="store_true", help="Actually write changes")
    args = ap.parse_args()

    if args.demo:
        targets = DEMO_LESSONS
    elif args.all:
        targets = sorted(f.stem for f in REPARSED_DIR.glob("*.yml") if not f.name.startswith("_"))
    else:
        targets = args.lessons

    if not targets:
        print("Usage: --demo or --all or <lesson>...")
        sys.exit(1)

    print(f"Merging {len(targets)} lessons {'(APPLY)' if args.apply else '(DRY RUN)'}")
    print()

    summary = []
    for code in targets:
        r = merge_lesson(code)
        summary.append(r)
        if r["status"] == "OK":
            print(f"  ✓ {code}: {len(r['changes'])} fields")
            for c in r["changes"]:
                print(f"      + {c}")
            if args.apply:
                prod_path = PROD_DIR / f"{code}.yml"
                # Backup
                backup = prod_path.with_suffix(".yml.bak-2026-05-02")
                if not backup.exists():
                    backup.write_bytes(prod_path.read_bytes())
                # Write merged
                with open(prod_path, "w", encoding="utf-8") as f:
                    yaml.dump(r["new_yml"], f, allow_unicode=True, sort_keys=False, width=10**9)
                print(f"      📝 wrote {prod_path.name} (backup: {backup.name})")
        elif r["status"] == "NO_CHANGES":
            print(f"  – {code}: no changes needed")
        else:
            print(f"  ✗ {code}: {r['status']}")

    print()
    print(f"Total: {sum(1 for r in summary if r['status']=='OK')} merged, "
          f"{sum(1 for r in summary if r['status']=='NO_CHANGES')} unchanged, "
          f"{sum(1 for r in summary if r['status'] not in ('OK','NO_CHANGES'))} errors")


if __name__ == "__main__":
    main()
