#!/usr/bin/env python3
"""
strip_checkmarks_and_reupload.py — Remove red ☑ answer-leaks from worksheet docx files,
re-convert to PDF, and re-upload to GCS.

Root cause: Source docx (教師版 + 第三階段) contain Wingdings F0FE (☑ BALLOT BOX WITH CHECK)
symbols rendered as red checkmarks in the PDF, indicating multi-choice answers. Student-version
PDFs inherit these leaks.

Fix: Strip every <w:sym w:font="Wingdings" w:char="F0FE"/> tag from word/document.xml.
Preserve F0E0 (→ arrow) and other symbols. Optionally normalize FF0000 red color on
adjacent □ runs (not done here — text-character □ may have legitimate red use; just
removing the Wingdings checkbox is enough to clear the answer indicator).

Pipeline per docx:
  1. Read source docx
  2. Strip F0FE Wingdings symbols (in place inside XML)
  3. Write stripped docx to /tmp/lingoleap-worksheets-stripped/<lesson_code>.docx
  4. soffice --convert-to pdf → /tmp/lingoleap-worksheets/<lesson_code>.pdf (overwrites)
  5. gsutil cp → gs://lingoleap-assets/worksheets/<lesson_code>.pdf

Usage:
  python3 scripts/strip_checkmarks_and_reupload.py [--priority-only] [--dry-run] [--no-upload]
  python3 scripts/strip_checkmarks_and_reupload.py --lessons G7-L28,G7-L29,G7-L30

Idempotent: PDFs are always overwritten if --force or if stripped count > 0.
"""

import argparse
import concurrent.futures
import os
import re
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent

PRIVATE_DIR = REPO_ROOT / "private" / "curriculum-source" / "2026-05-01" / "1.L1-158新版完成學習單1150415"

# Source priority: 學生版 first (cleaner), then 教師版, then 第三階段 (only fallback)
SOURCE_DIRS_PRIORITY = [
    PRIVATE_DIR / "2-1學生版(L1~122)",
    PRIVATE_DIR / "2-1學生版補L123-L157",
    PRIVATE_DIR / "1-1教師版(L1~122)",
    PRIVATE_DIR / "第三階段(L123開始~L157)差學生版",
]

STRIPPED_DIR = Path("/tmp/lingoleap-worksheets-stripped")
PDF_DIR = Path("/tmp/lingoleap-worksheets")
GCS_BUCKET = "gs://lingoleap-assets/worksheets/"

# 5/1 demo priority — verify post-fix
PRIORITY_LESSONS = ["G6-L22", "G6-L23", "G6-L24", "G6-L25", "G7-L28", "G7-L29", "G7-L30"]

MAX_WORKERS = 2  # soffice has singleton lock; high parallelism causes race failures
SOFFICE_TIMEOUT = 120

SOFFICE_CANDIDATES = [
    "/opt/homebrew/bin/soffice",
    "/Applications/LibreOffice.app/Contents/MacOS/soffice",
    "soffice",
    "libreoffice",
]

# Strip pattern: <w:sym w:font="Wingdings" w:char="F0FE"/>
# Attributes can be in any order, hex case varies. Also strip the wrapping <w:r>...</w:r>
# only if it contains nothing else meaningful — safer to just strip the <w:sym/> self-closing tag
# and leave the wrapping run (it becomes an empty <w:r> with rPr only, which is harmless).
F0FE_PATTERN = re.compile(
    r'<w:sym\s+[^/>]*w:char="F0FE"[^/>]*/>',
    re.IGNORECASE
)
# Catch attribute order variant
F0FE_PATTERN_ALT = re.compile(
    r'<w:sym\s+w:char="F0FE"\s+w:font="[^"]*"\s*/>',
    re.IGNORECASE
)


def find_soffice() -> str:
    for candidate in SOFFICE_CANDIDATES:
        if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            return candidate
    try:
        result = subprocess.run(["which", "soffice"], capture_output=True, text=True)
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip()
    except Exception:
        pass
    return ""


def extract_lesson_code(filename: str) -> str | None:
    """G7-SL28xxx.docx → G7-L28 (normalize S prefix away)."""
    m = re.match(r"^(G\d+-)S?(L\d+(?:-L?\d+)?)", filename)
    if m:
        return m.group(1) + m.group(2)
    m = re.match(r"^(文-L\d+)", filename)
    if m:
        return m.group(1)
    return None


def find_all_docx() -> dict[str, Path]:
    """Return {lesson_code: docx_path} using SOURCE_DIRS_PRIORITY ordering."""
    seen: dict[str, Path] = {}
    for source_dir in SOURCE_DIRS_PRIORITY:
        if not source_dir.exists():
            continue
        for docx in sorted(source_dir.rglob("*.docx")):
            code = extract_lesson_code(docx.name)
            if not code:
                continue
            if code not in seen:
                seen[code] = docx
    return seen


def strip_checkmarks_from_docx(src: Path, dst: Path) -> int:
    """
    Copy src → dst with all <w:sym w:char="F0FE"/> tags removed from word/document.xml.
    Returns count of stripped checkmarks.
    """
    dst.parent.mkdir(parents=True, exist_ok=True)
    stripped_count = 0

    with zipfile.ZipFile(src, "r") as zin:
        with zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as zout:
            for item in zin.infolist():
                data = zin.read(item.filename)
                if item.filename == "word/document.xml":
                    text = data.decode("utf-8")
                    new_text, n1 = F0FE_PATTERN.subn("", text)
                    new_text, n2 = F0FE_PATTERN_ALT.subn("", new_text)
                    stripped_count = n1 + n2
                    data = new_text.encode("utf-8")
                zout.writestr(item, data)
    return stripped_count


def convert_to_pdf(stripped_docx: Path, out_pdf: Path, soffice: str,
                   user_dir_suffix: str = "default") -> bool:
    """Convert docx → pdf via soffice. Returns True on success.

    Uses a per-worker -env:UserInstallation to avoid soffice singleton lock
    when multiple processes run concurrently.
    """
    out_pdf.parent.mkdir(parents=True, exist_ok=True)
    user_profile = f"/tmp/soffice-profile-{user_dir_suffix}"
    try:
        result = subprocess.run(
            [
                soffice,
                f"-env:UserInstallation=file://{user_profile}",
                "--headless", "--convert-to", "pdf",
                "--outdir", str(out_pdf.parent), str(stripped_docx),
            ],
            capture_output=True, text=True, timeout=SOFFICE_TIMEOUT,
        )
        if result.returncode != 0:
            print(f"  soffice err ({stripped_docx.stem}): {result.stderr.strip()[:200]}", file=sys.stderr)
            return False
        generated = out_pdf.parent / f"{stripped_docx.stem}.pdf"
        if generated.exists() and generated != out_pdf:
            generated.replace(out_pdf)
        return out_pdf.exists()
    except subprocess.TimeoutExpired:
        print(f"  TIMEOUT ({stripped_docx.stem}, {SOFFICE_TIMEOUT}s)", file=sys.stderr)
        return False
    except Exception as e:
        print(f"  ERR ({stripped_docx.stem}): {e}", file=sys.stderr)
        return False


def process_one(code: str, src_docx: Path, soffice: str, dry_run: bool,
                worker_id: str = "0") -> dict:
    result = {"code": code, "source": src_docx.name, "stripped": 0,
              "convert_ok": False, "pdf_path": None, "error": None}

    stripped_docx = STRIPPED_DIR / f"{code}.docx"
    out_pdf = PDF_DIR / f"{code}.pdf"

    try:
        n = strip_checkmarks_from_docx(src_docx, stripped_docx)
        result["stripped"] = n

        if dry_run:
            result["convert_ok"] = True
            return result

        # Try with per-worker profile, retry once with unique pid on failure
        ok = convert_to_pdf(stripped_docx, out_pdf, soffice, user_dir_suffix=worker_id)
        if not ok:
            import time, random
            time.sleep(random.uniform(0.5, 2.0))
            ok = convert_to_pdf(stripped_docx, out_pdf, soffice,
                                user_dir_suffix=f"{worker_id}-retry-{os.getpid()}")
        if not ok:
            result["error"] = "convert failed (after retry)"
            return result

        result["convert_ok"] = True
        result["pdf_path"] = out_pdf
    except Exception as e:
        result["error"] = str(e)
    return result


def upload_to_gcs(pdf_paths: list[Path]) -> bool:
    """Bulk upload using gsutil -m for parallelism."""
    if not pdf_paths:
        return True
    print(f"\nUploading {len(pdf_paths)} PDFs to GCS...")
    cmd = ["gsutil", "-m", "cp", "-J",
           *[str(p) for p in pdf_paths],
           GCS_BUCKET]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    if result.returncode != 0:
        print(f"  gsutil ERR: {result.stderr[:500]}", file=sys.stderr)
        return False
    # gsutil might not honor cache-control on multi-cp; set it after via setmeta
    setmeta = subprocess.run(
        ["gsutil", "-m", "setmeta", "-h", "Cache-Control:public, max-age=86400",
         *[GCS_BUCKET + p.name for p in pdf_paths]],
        capture_output=True, text=True, timeout=300,
    )
    if setmeta.returncode != 0:
        print(f"  setmeta warning: {setmeta.stderr[:200]}", file=sys.stderr)
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--priority-only", action="store_true",
                    help="Only process 7 priority lessons (G6-L22~25, G7-L28~30)")
    ap.add_argument("--lessons", type=str, default=None,
                    help="Comma-separated lesson codes (e.g. G7-L28,G7-L29)")
    ap.add_argument("--dry-run", action="store_true",
                    help="Strip + report only, no PDF convert or upload")
    ap.add_argument("--no-upload", action="store_true",
                    help="Strip + convert, but don't upload to GCS")
    ap.add_argument("--max-workers", type=int, default=MAX_WORKERS)
    args = ap.parse_args()

    soffice = find_soffice()
    if not soffice and not args.dry_run:
        print("ERROR: LibreOffice (soffice) not found", file=sys.stderr)
        sys.exit(1)

    all_docx = find_all_docx()
    print(f"Source docx total: {len(all_docx)}")

    # Filter
    if args.lessons:
        wanted = set(args.lessons.split(","))
        all_docx = {k: v for k, v in all_docx.items() if k in wanted}
        print(f"Filtered to --lessons: {len(all_docx)}")
    elif args.priority_only:
        all_docx = {k: v for k, v in all_docx.items() if k in PRIORITY_LESSONS}
        print(f"Filtered to priority: {len(all_docx)}")

    STRIPPED_DIR.mkdir(parents=True, exist_ok=True)
    PDF_DIR.mkdir(parents=True, exist_ok=True)

    results = []
    pdfs_to_upload = []
    progress = 0
    total = len(all_docx)

    with concurrent.futures.ThreadPoolExecutor(max_workers=args.max_workers) as ex:
        futures = {}
        for idx, (code, path) in enumerate(sorted(all_docx.items())):
            worker_id = str(idx % args.max_workers)
            futures[ex.submit(process_one, code, path, soffice, args.dry_run, worker_id)] = code
        for fut in concurrent.futures.as_completed(futures):
            r = fut.result()
            results.append(r)
            progress += 1
            if r["convert_ok"] and r["pdf_path"]:
                pdfs_to_upload.append(r["pdf_path"])
            if progress % 10 == 0 or progress == total:
                stripped_so_far = sum(x["stripped"] for x in results)
                print(f"  [{progress}/{total}] stripped={stripped_so_far} "
                      f"errors={sum(1 for x in results if x['error'])}")

    # Report
    print("\n" + "=" * 60)
    print("STRIP RESULTS — top 15 leaky")
    print("=" * 60)
    sorted_r = sorted(results, key=lambda x: -x["stripped"])
    print(f"{'Code':<12} {'☑ stripped':<12} {'Source':<60}")
    for r in sorted_r[:15]:
        print(f"{r['code']:<12} {r['stripped']:<12} {r['source'][:60]}")

    total_stripped = sum(x["stripped"] for x in results)
    docx_with_leaks = sum(1 for x in results if x["stripped"] > 0)
    errors = [x for x in results if x["error"]]
    print(f"\nTotal docx processed: {len(results)}")
    print(f"Docx with ≥1 ☑ stripped: {docx_with_leaks}")
    print(f"Total ☑ marks stripped: {total_stripped}")
    if errors:
        print(f"\nErrors ({len(errors)}):")
        for r in errors:
            print(f"  {r['code']}: {r['error']}")

    # Priority verification
    print("\n=== 7 PRIORITY LESSONS ===")
    pri_results = {r["code"]: r for r in results if r["code"] in PRIORITY_LESSONS}
    for code in PRIORITY_LESSONS:
        if code in pri_results:
            r = pri_results[code]
            status = "OK" if r["convert_ok"] else "ERR"
            print(f"  {code}: stripped={r['stripped']:3d}  convert={status}  src={r['source'][:50]}")

    # Upload
    if not args.dry_run and not args.no_upload and pdfs_to_upload:
        if not upload_to_gcs(pdfs_to_upload):
            print("Upload failed", file=sys.stderr)
            sys.exit(1)
        print(f"Uploaded {len(pdfs_to_upload)} PDFs to {GCS_BUCKET}")

    print("\nDone.")


if __name__ == "__main__":
    main()
