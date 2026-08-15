#!/usr/bin/env python3
"""build_key_reading.py — write 重點朗讀 into the uid tree (#2683).

Writes `backend/data/lessons/<uid>/<version>/key_reading.yml`.

Only `ok` and `confirmed` are written. `disagrees_with_first_edition` means two
independent pipelines picked different paragraphs for the same lesson and this script
cannot say which is right; `anchor_out_of_range` means the anchor and the body
segmentation disagree. Both are withheld, and the lesson keeps reading the whole text
— the behaviour it has today, which is degraded but not wrong.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from extract_key_reading import extract  # noqa: E402

LESSONS = ROOT / "backend" / "data" / "lessons"
#: `disagrees_with_first_edition` is written and FLAGGED rather than withheld: the
#: two editions marked paragraphs one apart on two lessons, the passage is still this
#: lesson's, and withholding sends the student back to reading the whole text.
WRITEABLE = {"ok", "confirmed", "disagrees_with_first_edition"}


def _read_body(vdir: Path) -> list[str] | None:
    f = vdir / "body.yml"
    if not f.exists():
        return None
    doc = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
    return doc.get("paragraphs") or None


def latest_version(uid_dir: Path) -> Path | None:
    vs = sorted((c for c in uid_dir.iterdir() if c.is_dir() and c.name.startswith("v")),
                key=lambda c: c.name) if uid_dir.is_dir() else []
    return vs[-1] if vs else None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", default="/tmp/docx-src")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    written = 0
    counts: dict[str, int] = {}
    for docx in sorted(Path(a.source).glob("*.docx")):
        uid = docx.stem
        vdir = latest_version(LESSONS / uid)
        if vdir is None:
            continue
        # The stored body — the anchor is an index and must be applied to the exact
        # paragraphs the API will serve.
        stored = _read_body(vdir)
        r = extract(docx, stored)
        counts[r["verdict"]] = counts.get(r["verdict"], 0) + 1
        if r["verdict"] not in WRITEABLE:
            continue

        doc = {
            "lesson_uid": uid,
            "version_id": vdir.name,
            "passage": r["passage"],
            "start_text": r["start_text"],
            "extent_chars": len(r["passage"]),
            "source": "docx-extract",
            "anchor_paragraph": r["anchor"],
            "paragraphs_used": r["paragraphs_used"],
            # Recorded so the stronger of the two verdicts stays visible in the data:
            # a paragraph number the first edition's PDF pipeline also arrived at,
            # matched by content rather than by the lesson code that misbound before.
            "extraction_check": {
                "verdict": r["verdict"],
                "corroborated_by_first_edition": r["corroborated_by_first_edition"],
            },
        }
        if r.get("needs_human_review"):
            doc["needs_human_review"] = True
            doc["review_reason"] = (
                f"二修 DOCX 標第 {r['anchor']} 段，一修對照表標第 "
                f"{r['corroborated_by_first_edition']} 段；採用二修")
        if not a.dry_run:
            (vdir / "key_reading.yml").write_text(
                yaml.dump(doc, allow_unicode=True, sort_keys=False, width=10**6),
                encoding="utf-8",
            )
        written += 1

    print(f"  寫入 {written} 課的 key_reading.yml")
    for v, n in sorted(counts.items(), key=lambda kv: -kv[1]):
        print(f"    {v:30s} {n}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
