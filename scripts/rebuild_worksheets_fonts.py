#!/usr/bin/env python3
"""
Rebuild worksheet PDFs with the shared font gates used by convert_docx_to_pdf.py.
Run on macOS with the required Traditional Chinese fonts installed.
Issue #2018: https://github.com/Youngger9765/chinese-literacy-platform/issues/2018
"""

import json
import os
import shutil
import subprocess
import time
from datetime import datetime
from pathlib import Path

from convert_docx_to_pdf import (
    OUTPUT_DIR as CONVERTER_OUTPUT_DIR,
    check_pdf_fonts,
    find_all_docx_files,
    find_soffice,
    run_font_preflight,
)

OUTPUT_DIR = Path("/tmp/rebuilt-worksheets")
FINAL_DIR = Path("/tmp/rebuilt-worksheets-final")
BUCKET = "gs://lingoleap-assets/worksheets"

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
FINAL_DIR.mkdir(parents=True, exist_ok=True)


def build_pdf(
    soffice: str,
    docx_path: Path,
    output_name: str,
) -> tuple[bool, Path | None, float]:
    start = time.time()
    cmd = [
        soffice,
        "--headless",
        "--convert-to",
        "pdf",
        "--outdir",
        str(OUTPUT_DIR),
        str(docx_path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    elapsed = time.time() - start

    if result.returncode != 0:
        print(f"  SOFFICE FAILED: {result.stderr[:200]}")
        return False, None, elapsed

    built_pdf = OUTPUT_DIR / f"{docx_path.stem}.pdf"
    if not built_pdf.exists():
        print(f"  WARNING: expected {built_pdf} not found, searching...")
        pdfs = sorted(OUTPUT_DIR.glob("*.pdf"), key=os.path.getmtime)
        if not pdfs:
            return False, None, elapsed
        built_pdf = pdfs[-1]
        print(f"  Found: {built_pdf}")

    final_pdf = FINAL_DIR / f"{output_name}.pdf"
    shutil.copy2(built_pdf, final_pdf)
    return True, final_pdf, elapsed


def upload_to_gcs(pdf_path: Path, gcs_name: str) -> tuple[bool, str]:
    subprocess.run(
        ["gcloud", "config", "configurations", "activate", "lingoleap"],
        capture_output=True,
    )
    dest = f"{BUCKET}/{gcs_name}.pdf"
    result = subprocess.run(
        ["gsutil", "cp", str(pdf_path), dest],
        capture_output=True,
        text=True,
    )
    if result.returncode == 0:
        return True, dest
    print(f"  UPLOAD FAILED: {result.stderr[:200]}")
    return False, dest


def main() -> None:
    pairs = find_all_docx_files()
    results = []
    font_failed = []
    uploaded = []

    print(f"Starting rebuild of {len(pairs)} worksheet PDFs...")
    print(f"Converter output reference: {CONVERTER_OUTPUT_DIR}")
    print(f"Output: {FINAL_DIR}")
    print()

    if not pairs:
        print("No docx files found.")
        raise SystemExit(1)

    if not run_font_preflight(pairs):
        raise SystemExit(1)

    soffice = find_soffice()
    if not soffice:
        print("ERROR: LibreOffice (soffice) not found.")
        raise SystemExit(1)

    for gcs_name, docx_path in pairs:
        print(f"[{gcs_name}]")
        print(f"  Source: {docx_path.name}")

        ok, final_pdf, elapsed = build_pdf(soffice, docx_path, gcs_name)
        if not ok or final_pdf is None:
            print(f"  BUILD FAILED ({elapsed:.1f}s)")
            results.append(
                {
                    "gcs_name": gcs_name,
                    "source_docx": str(docx_path),
                    "build_time_s": round(elapsed, 1),
                    "error": "build_failed",
                }
            )
            continue

        print(f"  Built in {elapsed:.1f}s")

        passed, fonts, bad = check_pdf_fonts(final_pdf)
        if not passed:
            print(f"  FONT CHECK FAILED: {bad}")
            font_failed.append(gcs_name)
            try:
                final_pdf.unlink()
            except OSError:
                pass
            results.append(
                {
                    "gcs_name": gcs_name,
                    "source_docx": str(docx_path),
                    "build_time_s": round(elapsed, 1),
                    "font_check": "FAILED",
                    "bad_fonts_found": bad,
                    "upload_status": "skipped_bad_fonts",
                }
            )
            continue

        print(f"  Font check PASSED ({len(fonts)} fonts)")

        upload_ok, dest = upload_to_gcs(final_pdf, gcs_name)
        status = "uploaded" if upload_ok else "upload_failed"
        if upload_ok:
            uploaded.append(gcs_name)
            print(f"  Uploaded -> {dest}")
        else:
            print("  UPLOAD FAILED")

        results.append(
            {
                "gcs_name": gcs_name,
                "source_docx": str(docx_path),
                "build_time_s": round(elapsed, 1),
                "font_check": "PASS",
                "fonts_after_rebuild": fonts[:10],
                "bad_fonts_found": [],
                "upload_status": status,
                "gcs_url": dest,
            }
        )

    manifest = {
        "rebuilt_at": datetime.utcnow().isoformat() + "Z",
        "issue": "https://github.com/Youngger9765/chinese-literacy-platform/issues/2018",
        "total_attempted": len(pairs),
        "results": results,
        "failed_font_check": font_failed,
        "uploaded": uploaded,
    }
    manifest_path = OUTPUT_DIR / "MANIFEST.json"
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    print()
    print("=" * 50)
    print("REBUILD SUMMARY")
    print("=" * 50)
    print(f"Total attempted:          {len(pairs)}")
    print(f"Font check failed:        {len(font_failed)} {font_failed}")
    print(f"Uploaded to GCS:          {len(uploaded)}")
    print(f"MANIFEST:                 {manifest_path}")


if __name__ == "__main__":
    main()
