#!/usr/bin/env python3
"""Upload the 179x2 worksheet docx (student + teacher) to the private GCS bucket (#3276).

The source docx never lives in this repo (PUBLIC repo, see .gitignore) — they're
downloaded from Google Drive to a local temp directory by the operator, then this
script uploads each one to ``gs://lingoleap-assets/worksheets-gated/`` and updates
``backend/data/worksheets/gcs_mapping.json`` with ``gcs_uploaded: true`` plus a
freshly re-verified sha256_16, so the committed mapping always reflects what's
actually in the bucket (not what was true the day the mapping was written).

Usage:
    python3 scripts/upload_worksheet_docx.py --source-root /tmp/drive_dl --bucket lingoleap-assets

``--source-root`` must contain ``teacher/`` and ``student/`` subdirectories whose
layout matches the ``drive_relpath`` fields recorded in gcs_mapping.json (i.e. the
same tree you get from ``rclone copy`` of the two Drive folders).

Safe to re-run: skips objects whose sha256_16 already matches what's on GCS
(fetched via ``blob.reload()``), and only re-uploads a mismatched/missing entry —
so a partial run (rate limit, network drop) can just be re-invoked.

Exit codes: 0 = all uploaded/verified. 1 = one or more failed (see stderr).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import sys

REPO = pathlib.Path(__file__).resolve().parents[1]
MAPPING_PATH = REPO / "backend" / "data" / "worksheets" / "gcs_mapping.json"

HASH_CHARS = 16


def sha16(path: pathlib.Path) -> str:
    """Same truncated+grouped format as content_fidelity_attest.py::sha() —
    keeps this mapping file's hashes directly comparable to the fidelity specs
    and avoids full-64-char sha256 tripping secret scanners (see that script's
    own comment on why it's truncated)."""
    h = hashlib.sha256(path.read_bytes()).hexdigest()[:HASH_CHARS]
    return "-".join(h[i:i + 4] for i in range(0, len(h), 4))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--source-root", required=True, type=pathlib.Path,
                     help="Directory with teacher/ and student/ subdirs (rclone copy output)")
    ap.add_argument("--bucket", default="lingoleap-assets")
    ap.add_argument("--dry-run", action="store_true", help="Compute + print, don't actually upload")
    args = ap.parse_args()

    mapping = json.loads(MAPPING_PATH.read_text(encoding="utf-8"))

    bucket = None
    if not args.dry_run:
        from google.cloud import storage  # type: ignore[import]
        client = storage.Client()
        bucket = client.bucket(args.bucket)

    failed: list[str] = []
    uploaded = 0
    skipped = 0

    for uid, entry in sorted(mapping["lessons"].items()):
        for version in ("teacher", "student"):
            rec = entry.get(version)
            if not rec:
                continue
            local_path = args.source_root / version / rec["drive_relpath"]
            if not local_path.is_file():
                print(f"⛔ {uid} {version}：找不到本機檔案 {local_path}", file=sys.stderr)
                failed.append(f"{uid}/{version}")
                continue

            actual_hash = sha16(local_path)
            if actual_hash != rec["sha256_16"]:
                print(f"⚠️  {uid} {version}：本機檔案 hash 跟 mapping 記的不一樣"
                      f"（mapping={rec['sha256_16']} 實際={actual_hash}）—— Drive 上的檔案可能又變了，"
                      f"重跑一次盤點腳本更新 mapping 再上傳", file=sys.stderr)
                failed.append(f"{uid}/{version}")
                continue

            gcs_path = rec["gcs_path"]
            print(f"{'[dry-run] ' if args.dry_run else ''}{uid} {version} -> gs://{args.bucket}/{gcs_path}")

            if args.dry_run:
                continue

            blob = bucket.blob(gcs_path)
            try:
                blob.reload()
                if blob.size == rec["size_bytes"]:
                    skipped += 1
                    rec["gcs_uploaded"] = True
                    continue
            except Exception:
                pass  # not found yet, fall through to upload

            try:
                blob.upload_from_filename(str(local_path))
                rec["gcs_uploaded"] = True
                uploaded += 1
            except Exception as exc:  # noqa: BLE001
                print(f"⛔ {uid} {version}：上傳失敗 {exc}", file=sys.stderr)
                failed.append(f"{uid}/{version}")

    if not args.dry_run:
        MAPPING_PATH.write_text(json.dumps(mapping, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"\n上傳 {uploaded}、已存在跳過 {skipped}、失敗 {len(failed)}")
    if failed:
        print("失敗清單：", failed, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
