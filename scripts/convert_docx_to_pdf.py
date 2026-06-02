#!/usr/bin/env python3
"""
convert_docx_to_pdf.py — Convert 158 lesson docx worksheets to PDF.

Usage:
    python3 scripts/convert_docx_to_pdf.py [--dry-run] [--force]

Source directories — STUDENT versions preferred (#2043: student-facing PDFs must
never embed teacher answers); teacher dir is a last-resort fallback only:
    .../2-1學生版(L1~122)/
    .../2-1學生版補L123-L157/
    .../第三階段(L123開始~L157)差學生版/
    .../1-1教師版(L1~122)/   (fallback — only for codes with no student source)

Output: /tmp/lingoleap-worksheets/{lesson_code}.pdf
    e.g. G6-L22.pdf

Idempotent: skip if PDF already exists (override with --force).
Parallel: 4 concurrent conversions.

Requirements:
    /opt/homebrew/bin/soffice (LibreOffice via Homebrew)
    or /Applications/LibreOffice.app/Contents/MacOS/soffice
"""

import argparse
import concurrent.futures
import os
import re
import subprocess
import sys
from pathlib import Path

# ── Config ────────────────────────────────────────────────────────────────────

REPO_ROOT = Path(__file__).parent.parent

# private/ is gitignored — check both the worktree and the canonical repo path
def _find_private_dir() -> Path:
    candidates = [
        REPO_ROOT / "private" / "curriculum-source",
        Path("/Users/young/project/chinese-literacy-platform/private/curriculum-source"),
    ]
    for c in candidates:
        p = c / "2026-05-01" / "1.L1-158新版完成學習單1150415"
        if p.exists():
            return p
    return REPO_ROOT / "private" / "curriculum-source" / "2026-05-01" / "1.L1-158新版完成學習單1150415"

PRIVATE_DIR = _find_private_dir()

# Student versions FIRST so student-facing PDFs never embed teacher answers
# (#2043). The teacher dir is a last-resort fallback for lesson codes that have
# no student source. Mirrors rebuild_worksheets_fonts.py's student-preferred order.
SOURCE_DIRS = [
    PRIVATE_DIR / "2-1學生版(L1~122)",
    PRIVATE_DIR / "2-1學生版補L123-L157",
    PRIVATE_DIR / "第三階段(L123開始~L157)差學生版",
    PRIVATE_DIR / "1-1教師版(L1~122)",
]

OUTPUT_DIR = Path("/tmp/lingoleap-worksheets")

MAX_WORKERS = 4

# LibreOffice binary search order
SOFFICE_CANDIDATES = [
    "/opt/homebrew/bin/soffice",
    "/Applications/LibreOffice.app/Contents/MacOS/soffice",
    "soffice",
    "libreoffice",
]

# ── Helpers ───────────────────────────────────────────────────────────────────

def find_soffice() -> str:
    for candidate in SOFFICE_CANDIDATES:
        if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            return candidate
        try:
            result = subprocess.run(
                ["which", candidate], capture_output=True, text=True
            )
            if result.returncode == 0 and result.stdout.strip():
                return result.stdout.strip()
        except Exception:
            pass
    return ""


def extract_lesson_code(filename: str) -> str | None:
    """
    Extract lesson code from docx filename.

    Examples:
        'G6-L22小兵立大功.docx' → 'G6-L22'
        'G6-SL25...docx'        → 'G6-L25'   (student 'SL' → canonical 'L', #2043)
        'G4-L20-22物以稀為貴.docx' → 'G4-L20-22'
        'G9-SL15~16.docx'       → 'G9-L15-16'
        '文-L1假新聞.docx' → '文-L1'

    Student-version files are named with an 'SL' marker (學生版); normalize it to
    the canonical 'L' so the student and teacher versions of a lesson resolve to
    the SAME code (#2043). Without this, 'G6-SL25' failed to parse, every student
    file was skipped, and the teacher version (with answers) won by default.
    """
    # Normalize: fullwidth Ｇ → G, range tildes → '-', and the student 'SL' marker
    # ('G6-SL25' / '文-SL1') → canonical 'L' before matching.
    name = filename.replace("Ｇ", "G").replace("～", "-").replace("~", "-")
    name = re.sub(r"-S(L\d)", r"-\1", name)
    # Match G{grade}-L{num} optionally followed by -L{num} or -{num} for ranges,
    # or 文-L{num} for 文言文 lessons.
    m = re.match(r"^(G\d+-L\d+(?:-L?\d+)?|文-L\d+)", name)
    if m:
        return m.group(1)
    return None


def find_all_docx_files() -> list[tuple[str, Path]]:
    """
    Return list of (lesson_code, docx_path) tuples.
    When multiple source dirs have the same lesson code, the FIRST dir wins, and
    student dirs are ordered first — so the student version is preferred (#2043).
    """
    seen: dict[str, Path] = {}

    for source_dir in SOURCE_DIRS:
        if not source_dir.exists():
            print(f"WARNING: source dir not found: {source_dir}", file=sys.stderr)
            continue
        # Walk subdirectories (grade folders like 4年級, 5年級, etc.)
        for docx in sorted(source_dir.rglob("*.docx")):
            code = extract_lesson_code(docx.name)
            if not code:
                print(f"  SKIP (no lesson code): {docx.name}", file=sys.stderr)
                continue
            if code not in seen:
                seen[code] = docx
            # else: already have this code from an earlier (student-preferred) dir

    return sorted(seen.items())


def convert_one(
    lesson_code: str,
    docx_path: Path,
    output_dir: Path,
    soffice: str,
    force: bool,
    dry_run: bool,
) -> tuple[str, str]:
    """
    Convert one docx to PDF.

    Returns (lesson_code, status) where status is one of:
        'skipped'  — PDF already exists
        'ok'       — converted successfully
        'error'    — conversion failed
    """
    out_pdf = output_dir / f"{lesson_code}.pdf"

    if out_pdf.exists() and not force:
        return lesson_code, "skipped"

    if dry_run:
        print(f"  [DRY-RUN] {lesson_code}: {docx_path.name} → {out_pdf}")
        return lesson_code, "ok"

    try:
        result = subprocess.run(
            [
                soffice,
                "--headless",
                "--convert-to",
                "pdf",
                "--outdir",
                str(output_dir),
                str(docx_path),
            ],
            capture_output=True,
            text=True,
            timeout=120,
        )
        if result.returncode != 0:
            print(
                f"  ERROR {lesson_code}: soffice exit {result.returncode}\n"
                f"    {result.stderr.strip()[:200]}",
                file=sys.stderr,
            )
            return lesson_code, "error"

        # soffice names output file after the input filename stem, not lesson_code
        # e.g. "G6-L22小兵立大功.pdf" — rename to "G6-L22.pdf"
        stem = docx_path.stem
        generated_pdf = output_dir / f"{stem}.pdf"
        if generated_pdf.exists() and generated_pdf != out_pdf:
            generated_pdf.rename(out_pdf)
        elif not out_pdf.exists():
            print(
                f"  ERROR {lesson_code}: expected PDF not found at {out_pdf}",
                file=sys.stderr,
            )
            return lesson_code, "error"

        return lesson_code, "ok"

    except subprocess.TimeoutExpired:
        print(f"  ERROR {lesson_code}: conversion timed out (>120s)", file=sys.stderr)
        return lesson_code, "error"
    except Exception as exc:
        print(f"  ERROR {lesson_code}: {exc}", file=sys.stderr)
        return lesson_code, "error"


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Convert lesson docx files to PDF")
    parser.add_argument("--dry-run", action="store_true", help="Print plan, don't convert")
    parser.add_argument("--force", action="store_true", help="Re-convert even if PDF exists")
    args = parser.parse_args()

    # Verify LibreOffice
    soffice = find_soffice()
    if not soffice:
        print(
            "ERROR: LibreOffice (soffice) not found.\n"
            "Install via: brew install --cask libreoffice",
            file=sys.stderr,
        )
        sys.exit(1)
    print(f"Using soffice: {soffice}")

    # Ensure output directory
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Output dir: {OUTPUT_DIR}")

    # Collect files
    pairs = find_all_docx_files()
    print(f"Found {len(pairs)} unique lesson docx files\n")

    if not pairs:
        print("No docx files found. Check SOURCE_DIRS.")
        sys.exit(1)

    # Convert in parallel
    counts = {"ok": 0, "skipped": 0, "error": 0}
    errors: list[str] = []

    with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {
            executor.submit(
                convert_one,
                code,
                path,
                OUTPUT_DIR,
                soffice,
                args.force,
                args.dry_run,
            ): code
            for code, path in pairs
        }
        for future in concurrent.futures.as_completed(futures):
            code, status = future.result()
            counts[status] += 1
            if status == "error":
                errors.append(code)
            icon = {"ok": "OK", "skipped": "SKIP", "error": "ERR"}[status]
            print(f"  [{icon}] {code}")

    print(
        f"\nDone: {counts['ok']} converted, {counts['skipped']} skipped, {counts['error']} errors"
    )
    if errors:
        print(f"Failed codes: {', '.join(errors)}")
        sys.exit(1)

    # Print upload command
    print(
        f"\nNext step — upload to GCS:\n"
        f"  gcloud storage cp /tmp/lingoleap-worksheets/*.pdf "
        f"gs://lingoleap-assets/worksheets/ --cache-control='public, max-age=86400'"
    )


if __name__ == "__main__":
    main()
