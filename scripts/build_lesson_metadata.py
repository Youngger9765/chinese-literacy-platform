#!/usr/bin/env python3
"""build_lesson_metadata.py — write spreadsheet metadata into the uid tree (#2683).

Writes `backend/data/lessons/<uid>/<version>/metadata.yml` with the lesson's intro,
genre, category and video links, taken from 自學教材總表.xlsx.

Matched on TITLE. The spreadsheet's lesson numbers are first-edition — one of its
columns is literally named 舊課次 — and joining on those is what put a bus interior on
a sprinting lesson and another lesson's passage into 重點朗讀.

Each file records which spreadsheet title it matched, so a wrong pairing is
inspectable rather than invisible.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
sys.path.insert(0, str(ROOT / "backend"))

from extract_lesson_metadata import DEFAULT_XLSX, build, lookup, norm_title  # noqa: E402

LESSONS = ROOT / "backend" / "data" / "lessons"


def latest_version(uid_dir: Path) -> Path | None:
    vs = sorted((c for c in uid_dir.iterdir() if c.is_dir() and c.name.startswith("v")),
                key=lambda c: c.name) if uid_dir.is_dir() else []
    return vs[-1] if vs else None


def main() -> int:
    from app.services.lesson_loader import get_all_lessons

    ap = argparse.ArgumentParser()
    ap.add_argument("--xlsx", default=str(DEFAULT_XLSX))
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    meta = build(Path(a.xlsx))
    written = unmatched = 0
    fields = {"intro": 0, "genre": 0, "category": 0, "video_links": 0}

    for lesson in get_all_lessons():
        uid = lesson["lesson_uid"]
        row = lookup(meta, lesson["title"])
        vdir = latest_version(LESSONS / uid)
        if vdir is None:
            continue
        if row is None:
            unmatched += 1
            continue

        doc = {
            "lesson_uid": uid,
            "version_id": vdir.name,
            "source": "自學教材總表.xlsx",
            # Recorded so a wrong pairing can be seen. Titles are matched with
            # punctuation folded and a leading stray ordinal stripped, so the two
            # strings are not always identical — which is exactly when it matters.
            "matched_spreadsheet_title": row["title"],
            "intro": row.get("intro"),
            "unit_topic": row.get("unit_topic") or None,
            "strategy": row.get("strategy") or None,
            "genre": row.get("genre") or None,
            "category": row.get("category") or None,
            "video_links": row.get("video_links") or [],
        }
        for k in fields:
            if doc.get(k):
                fields[k] += 1
        if not a.dry_run:
            (vdir / "metadata.yml").write_text(
                yaml.dump(doc, allow_unicode=True, sort_keys=False, width=10**6),
                encoding="utf-8",
            )
        written += 1

    print(f"  寫入 {written} 課   課名對不上試算表 {unmatched} 課")
    for k, v in fields.items():
        print(f"    {k:14s} {v}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
