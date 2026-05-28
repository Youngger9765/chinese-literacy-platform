#!/usr/bin/env python3
"""
Rebuild 37 worksheet PDFs that render Simplified Chinese due to font substitution.
Run on macOS with Traditional Chinese fonts installed.
Issue #2018: https://github.com/Youngger9765/chinese-literacy-platform/issues/2018
"""

import os
import subprocess
import json
import time
import shutil
from datetime import datetime

SOURCE_ROOT = "/Users/young/project/chinese-literacy-platform/private/curriculum-source/2026-05-01/1.L1-158新版完成學習單1150415"
OUTPUT_DIR = "/tmp/rebuilt-worksheets"
FINAL_DIR = "/tmp/rebuilt-worksheets-final"
SOFFICE = "/opt/homebrew/bin/soffice"
BUCKET = "gs://lingoleap-assets/worksheets"

# Bad font patterns (Simplified Chinese)
BAD_FONT_PATTERNS = ["-GB5", "-SC-", "SC-Bold", "SCSong", "SCHei", "SimSun",
                     "SimHei", "Sim", "PingFangSC", "STSongti-SC", "STHeitiSC",
                     "DFFangYuanW7-GB5", "DFPFangYuanW7"]

# Affected GCS filenames (exact, confirmed from gsutil ls)
AFFECTED = [
    "G4-L04", "G4-L10", "G4-L12", "G4-L15", "G4-L19", "G4-L27", "G4-L5", "G4-L6",
    "G5-L07", "G5-L10", "G5-L11", "G5-L18", "G5-L23", "G5-L24",
    "G6-L1",  "G6-L15", "G6-L22", "G6-L23",
    "G7-L1",  "G7-L11", "G7-L17", "G7-L29", "G7-L9",
    "G8-L02", "G8-L03b", "G8-L4", "G8-L7",
    "G9-L01", "G9-L02", "G9-L09", "G9-L1", "G9-L12", "G9-L3", "G9-L9",
    "WW-L02", "WW-L10", "文-L10",
]

# Pairs that share the same source docx (same lesson, different padding in GCS)
SHARED_SOURCE = {
    "G9-L1": "G9-L01",   # same source as G9-L01
    "G9-L9": "G9-L09",   # same source as G9-L09
}

os.makedirs(OUTPUT_DIR, exist_ok=True)
os.makedirs(FINAL_DIR, exist_ok=True)


def extract_lesson_code(gcs_name):
    """G4-L04 -> (G4, 4), G7-L29 -> (G7, 29), WW-L02 -> (WW, 2), 文-L10 -> (文, 10)"""
    parts = gcs_name.split("-L")
    if len(parts) != 2:
        return None, None
    grade = parts[0]
    num_str = parts[1].rstrip("b")  # strip 'b' suffix for G8-L03b
    suffix = "b" if parts[1].endswith("b") else ""
    try:
        num = int(num_str)
    except ValueError:
        return grade, parts[1]
    return grade, num, suffix


def find_docx(gcs_name):
    """Find the source .docx for a given GCS filename. Prefer student version."""
    # Extract grade and lesson number
    parts = gcs_name.split("-L")
    if len(parts) != 2:
        return None, None
    grade = parts[0]
    lesson_part = parts[1]  # e.g. "04", "29", "03b", "5"

    # Try both padded and unpadded numbers
    try:
        lesson_num = int(lesson_part.rstrip("b"))
        suffix = "b" if lesson_part.endswith("b") else ""
        num_variants = [str(lesson_num), str(lesson_num).zfill(2), lesson_part]
    except ValueError:
        num_variants = [lesson_part]
        suffix = ""

    # Build search patterns: student (SL) preferred, then teacher (L)
    search_patterns = []
    for n in set(num_variants):
        search_patterns.append(f"{grade}-SL{n}{suffix}")
        search_patterns.append(f"{grade}-SL{n}")
        search_patterns.append(f"{grade}-L{n}{suffix}")
        search_patterns.append(f"{grade}-L{n}")

    # Search order: student dirs first, then teacher dirs
    search_dirs = [
        os.path.join(SOURCE_ROOT, "2-1學生版(L1~122)"),
        os.path.join(SOURCE_ROOT, "2-1學生版補L123-L157"),
        os.path.join(SOURCE_ROOT, "第三階段(L123開始~L157)差學生版"),
        os.path.join(SOURCE_ROOT, "1-1教師版(L1~122)"),
    ]

    candidates_student = []
    candidates_teacher = []

    for root, dirs, files in os.walk(SOURCE_ROOT):
        for fname in files:
            if not fname.endswith(".docx"):
                continue
            for pat in search_patterns:
                if pat in fname:
                    full_path = os.path.join(root, fname)
                    is_student = ("學生版" in root or "-SL" in fname)
                    if is_student:
                        candidates_student.append(full_path)
                    else:
                        candidates_teacher.append(full_path)
                    break

    if candidates_student:
        return candidates_student[0], "student"
    if candidates_teacher:
        return candidates_teacher[0], "teacher"
    return None, None


def build_pdf(docx_path, output_name):
    """Convert docx to PDF using soffice. Returns (success, built_pdf_path, elapsed_s)."""
    start = time.time()
    cmd = [SOFFICE, "--headless", "--convert-to", "pdf", "--outdir", OUTPUT_DIR, docx_path]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    elapsed = time.time() - start

    if result.returncode != 0:
        print(f"  SOFFICE FAILED: {result.stderr[:200]}")
        return False, None, elapsed

    # soffice outputs file named after docx basename
    docx_basename = os.path.splitext(os.path.basename(docx_path))[0]
    built_pdf = os.path.join(OUTPUT_DIR, docx_basename + ".pdf")

    if not os.path.exists(built_pdf):
        # Try to find any newly created pdf
        print(f"  WARNING: expected {built_pdf} not found, searching...")
        pdfs = [f for f in os.listdir(OUTPUT_DIR) if f.endswith(".pdf")]
        if pdfs:
            built_pdf = os.path.join(OUTPUT_DIR, sorted(pdfs)[-1])
            print(f"  Found: {built_pdf}")
        else:
            return False, None, elapsed

    # Rename to final name
    final_pdf = os.path.join(FINAL_DIR, output_name + ".pdf")
    shutil.copy2(built_pdf, final_pdf)
    return True, final_pdf, elapsed


def check_fonts(pdf_path):
    """Run pdffonts and check for bad fonts. Returns (passed, fonts_list, bad_fonts)."""
    result = subprocess.run(["pdffonts", pdf_path], capture_output=True, text=True, timeout=30)
    if result.returncode != 0:
        return False, [], [f"pdffonts error: {result.stderr[:100]}"]

    lines = result.stdout.strip().split("\n")
    fonts = []
    bad = []
    for line in lines[2:]:  # skip header
        if not line.strip():
            continue
        font_name = line.split()[0] if line.split() else ""
        fonts.append(font_name)
        for pat in BAD_FONT_PATTERNS:
            if pat.lower() in font_name.lower():
                bad.append(font_name)
                break
    return len(bad) == 0, fonts, bad


def upload_to_gcs(pdf_path, gcs_name):
    """Upload rebuilt PDF to GCS, overwriting original."""
    subprocess.run(["gcloud", "config", "configurations", "activate", "lingoleap"],
                   capture_output=True)
    dest = f"{BUCKET}/{gcs_name}.pdf"
    result = subprocess.run(["gsutil", "cp", pdf_path, dest], capture_output=True, text=True)
    if result.returncode == 0:
        return True, dest
    print(f"  UPLOAD FAILED: {result.stderr[:200]}")
    return False, dest


def main():
    results = []
    not_found = []
    font_failed = []
    uploaded = []

    # Pre-build shared source map (G9-L1 reuses G9-L01's built PDF)
    built_cache = {}  # canonical_name -> final_pdf_path

    print(f"Starting rebuild of {len(AFFECTED)} worksheets...")
    print(f"Source: {SOURCE_ROOT}")
    print(f"Output: {FINAL_DIR}")
    print()

    for gcs_name in AFFECTED:
        print(f"[{gcs_name}]")

        # If this is a shared-source alias, copy from already-built
        if gcs_name in SHARED_SOURCE:
            canonical = SHARED_SOURCE[gcs_name]
            if canonical in built_cache:
                src_pdf = built_cache[canonical]
                final_pdf = os.path.join(FINAL_DIR, gcs_name + ".pdf")
                shutil.copy2(src_pdf, final_pdf)
                print(f"  Copied from {canonical} -> {gcs_name}")
                # Upload
                ok, dest = upload_to_gcs(final_pdf, gcs_name)
                status = "uploaded" if ok else "upload_failed"
                if ok:
                    uploaded.append(gcs_name)
                results.append({
                    "gcs_name": gcs_name,
                    "source_docx": f"[shared from {canonical}]",
                    "version_type": "shared",
                    "build_time_s": 0,
                    "font_check": "PASS (shared)",
                    "bad_fonts_found": [],
                    "upload_status": status,
                    "gcs_url": dest,
                })
                continue
            else:
                print(f"  WARNING: canonical {canonical} not yet built, processing normally")

        # Find docx
        docx_path, version_type = find_docx(gcs_name)
        if not docx_path:
            print(f"  NOT FOUND")
            not_found.append(gcs_name)
            results.append({
                "gcs_name": gcs_name,
                "source_docx": None,
                "version_type": None,
                "error": "source_docx_not_found",
            })
            continue

        print(f"  Source: {os.path.basename(docx_path)} ({version_type})")

        # Build PDF
        ok, final_pdf, elapsed = build_pdf(docx_path, gcs_name)
        if not ok:
            print(f"  BUILD FAILED ({elapsed:.1f}s)")
            results.append({
                "gcs_name": gcs_name,
                "source_docx": docx_path,
                "version_type": version_type,
                "build_time_s": round(elapsed, 1),
                "error": "build_failed",
            })
            continue

        print(f"  Built in {elapsed:.1f}s")

        # Check fonts
        passed, fonts, bad = check_fonts(final_pdf)
        if not passed:
            print(f"  FONT CHECK FAILED: {bad}")
            font_failed.append(gcs_name)
            results.append({
                "gcs_name": gcs_name,
                "source_docx": docx_path,
                "version_type": version_type,
                "build_time_s": round(elapsed, 1),
                "font_check": "FAILED",
                "bad_fonts_found": bad,
                "upload_status": "skipped_bad_fonts",
            })
            continue

        print(f"  Font check PASSED ({len(fonts)} fonts)")
        built_cache[gcs_name] = final_pdf  # cache for shared-source aliases

        # Upload
        upload_ok, dest = upload_to_gcs(final_pdf, gcs_name)
        status = "uploaded" if upload_ok else "upload_failed"
        if upload_ok:
            uploaded.append(gcs_name)
            print(f"  Uploaded -> {dest}")
        else:
            print(f"  UPLOAD FAILED")

        results.append({
            "gcs_name": gcs_name,
            "source_docx": docx_path,
            "version_type": version_type,
            "build_time_s": round(elapsed, 1),
            "font_check": "PASS",
            "fonts_after_rebuild": fonts[:10],  # first 10
            "bad_fonts_found": [],
            "upload_status": status,
            "gcs_url": dest,
        })

    # Write manifest
    manifest = {
        "rebuilt_at": datetime.utcnow().isoformat() + "Z",
        "issue": "https://github.com/Youngger9765/chinese-literacy-platform/issues/2018",
        "total_affected": len(AFFECTED),
        "results": results,
        "not_found": not_found,
        "failed_font_check": font_failed,
        "uploaded": uploaded,
    }
    manifest_path = os.path.join(OUTPUT_DIR, "MANIFEST.json")
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    # Summary
    print()
    print("=" * 50)
    print("REBUILD SUMMARY")
    print("=" * 50)
    print(f"Total attempted:          {len(AFFECTED)}")
    print(f"Source docx found:        {len(AFFECTED) - len(not_found)}")
    print(f"Font check passed:        {len(uploaded) + len([r for r in results if r.get('upload_status') == 'upload_failed'])}")
    print(f"Uploaded to GCS:          {len(uploaded)}")
    print(f"NOT FOUND (no docx):      {len(not_found)} {not_found}")
    print(f"Font check FAILED:        {len(font_failed)} {font_failed}")
    print(f"MANIFEST:                 {manifest_path}")


if __name__ == "__main__":
    main()
