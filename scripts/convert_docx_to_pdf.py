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
from collections import defaultdict
from functools import lru_cache
import os
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
import zipfile
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

DOCX_FONT_FILES = ("word/document.xml", "word/styles.xml")
DOCX_FONT_ATTRS = ("ascii", "eastAsia", "hAnsi", "cs")
WORD_NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"

MACOS_FONT_DIRS = [
    Path.home() / "Library" / "Fonts",
    Path("/Library/Fonts"),
    Path("/System/Library/Fonts"),
]

FONT_EXTENSIONS = {".ttf", ".otf", ".ttc"}

FONT_STYLE_SUFFIX_RE = re.compile(
    r"([ _-](regular|bold|semibold|semi bold|medium|light|black|heavy|"
    r"thin|extralight|extra light|ultralight|ultra light|italic|oblique|"
    r"w[0-9]+))*$",
    re.IGNORECASE,
)

FONT_ALIASES = {
    "芫荽": ("Iansui",),
    "Iansui": ("芫荽",),
    "源泉圓體 B": ("GenSenRounded", "GenSenRoundedTW", "GenSenRoundedTW-Bold"),
    "GenSenRounded": ("源泉圓體", "源泉圓體 B", "GenSenRoundedTW"),
    "BpmfIansui": ("Bpmf Iansui",),
    "標楷體": ("BiauKai", "Kaiti TC", "DFKai-SB"),
    "jf open 粉圓": ("jf open huninn", "jf-openhuninn", "jf-open 粉圓"),
    "ㄅ源樣注音黑體": ("BpmfGenYoGothic", "Bpmf GenYo Gothic", "源樣注音黑體"),
}

# Distinctive DESIGN fonts whose substitution visibly breaks the worksheet
# (typeface wrong + layout drift). Preflight HARD-BLOCKS only when one of these
# is missing. Incidental Office/system fonts (Calibri, Aptos, Cambria, Segoe UI,
# 新細明體, MS Mincho, Arial…) are WARN-only: they either appear on non-visible
# runs or LibreOffice substitutes them acceptably. The pdffonts POSTFLIGHT is the
# real safety net that fails on any substitution that actually lands in output.
CRITICAL_FONT_RE = re.compile(
    r"(芫荽|iansui|源泉圓體|gensenrounded|標楷|biaukai|kaiti|dfkai|"
    r"粉圓|huninn|源樣注音黑體|genyo|bpmf)",
    re.IGNORECASE,
)


def is_critical_font(name: str) -> bool:
    """True if a missing font would visibly break the worksheet (design font)."""
    return bool(CRITICAL_FONT_RE.search(name or ""))

# Known font substitutions that must never pass a worksheet PDF gate.
BAD_FONT_PATTERNS = [
    "DFHaiBao",
    "STSongti",
    "STHeiti",
    "HiraMin",
    "HiraKaku",
    "ArialUnicodeMS",
    "LiberationSans",
    "LiberationSerif",
    "SimSun",
    "SimHei",
    "PingFangSC",
    "-SC-",
    "SCSong",
    "SCHei",
    "GB5",
    "STSongti-SC",
    "STHeitiSC",
    "DFFangYuanW7-GB5",
    "DFPFangYuanW7",
]

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


def _normalize_font_key(name: str) -> str:
    compact = name.replace("\\", "")
    return re.sub(r"[\s_\-]+", "", compact).casefold()


def _font_name_keys(name: str) -> set[str]:
    stripped = name.strip()
    if not stripped:
        return set()
    base = FONT_STYLE_SUFFIX_RE.sub("", stripped).strip()
    version_base = re.sub(r"\s+\d+(?:\.\d+)+$", "", stripped).strip()
    keys = {_normalize_font_key(stripped)}
    if base:
        keys.add(_normalize_font_key(base))
    if version_base:
        keys.add(_normalize_font_key(version_base))
    return {key for key in keys if key}


def _add_font_name(available: set[str], name: str) -> None:
    for part in name.split(","):
        available.update(_font_name_keys(part))


@lru_cache(maxsize=1)
def load_available_font_keys() -> frozenset[str]:
    available: set[str] = set()

    try:
        result = subprocess.run(
            ["fc-list", ":", "family"],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode == 0:
            for line in result.stdout.splitlines():
                _add_font_name(available, line)
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass

    for font_dir in MACOS_FONT_DIRS:
        if not font_dir.exists():
            continue
        for path in font_dir.rglob("*"):
            if path.is_file() and path.suffix.lower() in FONT_EXTENSIONS:
                _add_font_name(available, path.stem)

    return frozenset(available)


def font_family_is_available(
    family: str,
    available_keys: frozenset[str] | None = None,
) -> bool:
    keys = set()
    for candidate in (family, *FONT_ALIASES.get(family, ())):
        keys.update(_font_name_keys(candidate))
    available = available_keys if available_keys is not None else load_available_font_keys()
    return any(key in available for key in keys)


def extract_required_font_families(docx_path: Path) -> set[str]:
    families: set[str] = set()

    try:
        with zipfile.ZipFile(docx_path) as docx:
            for member in DOCX_FONT_FILES:
                try:
                    root = ET.fromstring(docx.read(member))
                except KeyError:
                    continue
                for rfonts in root.iter(f"{WORD_NS}rFonts"):
                    for attr in DOCX_FONT_ATTRS:
                        value = rfonts.attrib.get(f"{WORD_NS}{attr}")
                        if value and value.strip():
                            families.add(value.strip())
    except (zipfile.BadZipFile, ET.ParseError) as exc:
        raise ValueError(f"cannot parse DOCX fonts from {docx_path}: {exc}") from exc

    return families


def collect_missing_fonts_by_lesson(
    pairs: list[tuple[str, Path]],
) -> dict[str, tuple[Path, list[str]]]:
    available = load_available_font_keys()
    missing_by_lesson: dict[str, tuple[Path, list[str]]] = {}

    for lesson_code, docx_path in pairs:
        required = extract_required_font_families(docx_path)
        missing = sorted(
            family
            for family in required
            if not font_family_is_available(family, available)
        )
        if missing:
            missing_by_lesson[lesson_code] = (docx_path, missing)

    return missing_by_lesson


def format_missing_font_report(missing_by_lesson: dict[str, tuple[Path, list[str]]]) -> str:
    by_font: dict[str, list[str]] = defaultdict(list)
    for lesson_code, (_, missing) in missing_by_lesson.items():
        for family in missing:
            by_font[family].append(lesson_code)

    lines = [
        "ERROR: missing required worksheet fonts; refusing to render PDFs.",
        "Install these font families on the LibreOffice rendering machine:",
    ]
    for family in sorted(by_font):
        lessons = ", ".join(sorted(by_font[family]))
        lines.append(f"  - {family}: {lessons}")
    return "\n".join(lines)


def detect_bad_pdf_fonts_from_output(pdffonts_output: str) -> tuple[list[str], list[str]]:
    fonts: list[str] = []
    bad_fonts: list[str] = []
    patterns = [pattern.casefold() for pattern in BAD_FONT_PATTERNS]

    for line in pdffonts_output.splitlines():
        stripped = line.strip()
        if (
            not stripped
            or stripped.startswith("name ")
            or stripped.startswith("---")
        ):
            continue
        font_name = stripped.split()[0]
        fonts.append(font_name)
        if any(pattern in font_name.casefold() for pattern in patterns):
            bad_fonts.append(font_name)

    return fonts, bad_fonts


def check_pdf_fonts(pdf_path: Path | str) -> tuple[bool, list[str], list[str]]:
    try:
        result = subprocess.run(
            ["pdffonts", str(pdf_path)],
            capture_output=True,
            text=True,
            timeout=30,
        )
    except FileNotFoundError:
        return False, [], ["pdffonts not found"]
    except subprocess.TimeoutExpired:
        return False, [], ["pdffonts timed out"]

    if result.returncode != 0:
        return False, [], [f"pdffonts error: {result.stderr.strip()[:100]}"]

    fonts, bad_fonts = detect_bad_pdf_fonts_from_output(result.stdout)
    return len(bad_fonts) == 0, fonts, bad_fonts


def run_font_preflight(pairs: list[tuple[str, Path]]) -> bool:
    """Hard-block only when a CRITICAL design font is missing; WARN on incidental
    Office/system fonts (they don't cause the 跑版 and postflight catches any real
    substitution). Returns False (block) only on critical misses."""
    missing_by_lesson = collect_missing_fonts_by_lesson(pairs)
    if not missing_by_lesson:
        return True

    critical: dict[str, tuple[Path, list[str]]] = {}
    incidental: dict[str, tuple[Path, list[str]]] = {}
    for lesson_code, (path, missing) in missing_by_lesson.items():
        crit = [f for f in missing if is_critical_font(f)]
        inc = [f for f in missing if not is_critical_font(f)]
        if crit:
            critical[lesson_code] = (path, crit)
        if inc:
            incidental[lesson_code] = (path, inc)

    if incidental:
        print(
            format_missing_font_report(incidental).replace(
                "ERROR: missing required worksheet fonts; refusing to render PDFs.",
                "WARNING: missing incidental (Office/system) fonts — rendering anyway; "
                "postflight will catch any substitution that lands in output.",
            ),
            file=sys.stderr,
        )
    if critical:
        print(format_missing_font_report(critical), file=sys.stderr)
        return False
    return True


def print_report(pairs: list[tuple[str, Path]], output_dir: Path) -> None:
    missing_by_lesson = collect_missing_fonts_by_lesson(pairs)
    postflight_failed: dict[str, list[str]] = {}
    postflight_unchecked: list[str] = []

    for lesson_code, _ in pairs:
        out_pdf = output_dir / f"{lesson_code}.pdf"
        if not out_pdf.exists():
            postflight_unchecked.append(lesson_code)
            continue
        passed, _, bad_fonts = check_pdf_fonts(out_pdf)
        if not passed:
            postflight_failed[lesson_code] = bad_fonts

    print("Worksheet PDF font report")
    print(f"Lessons scanned: {len(pairs)}")
    print(f"Preflight failures: {len(missing_by_lesson)}")
    if missing_by_lesson:
        print(format_missing_font_report(missing_by_lesson))
    else:
        print("Preflight failures: none")

    print()
    print(f"Postflight failures in {output_dir}: {len(postflight_failed)}")
    if postflight_failed:
        for lesson_code in sorted(postflight_failed):
            print(f"  - {lesson_code}: {', '.join(postflight_failed[lesson_code])}")
    else:
        print("Postflight failures: none")

    if postflight_unchecked:
        print()
        print(
            f"Postflight unchecked, PDF not present in {output_dir}: "
            f"{len(postflight_unchecked)}"
        )
        for lesson_code in sorted(postflight_unchecked):
            print(f"  - {lesson_code}")


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
        passed, _, bad_fonts = check_pdf_fonts(out_pdf)
        if not passed:
            print(
                f"  ERROR {lesson_code}: existing PDF failed font gate: {bad_fonts}",
                file=sys.stderr,
            )
            return lesson_code, "error"
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

        passed, _, bad_fonts = check_pdf_fonts(out_pdf)
        if not passed:
            try:
                out_pdf.unlink()
            except OSError:
                pass
            print(
                f"  ERROR {lesson_code}: PDF failed font gate: {bad_fonts}",
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
    parser.add_argument(
        "--report",
        action="store_true",
        help="Report font preflight/postflight failures without converting or uploading",
    )
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

    if args.report:
        print_report(pairs, OUTPUT_DIR)
        return

    if not run_font_preflight(pairs):
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
