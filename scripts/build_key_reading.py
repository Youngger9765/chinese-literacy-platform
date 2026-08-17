#!/usr/bin/env python3
"""build_key_reading.py — write 重點朗讀 into the uid tree (#2683, #2720).

Writes `backend/data/lessons/<uid>/<version>/key_reading.yml`.

ONLY `ok` and `confirmed` are written. Every other verdict is withheld and the lesson
keeps reading the whole text — degraded, but not a lie. The verdicts that withhold:

    numbering_disagrees      the worksheet's 段號 count and the 課文 cell's paragraph
                             count differ, so "the Nth paragraph" is undefined
    no_printed_numbering     no 段號 column found; nothing says which paragraph is Nth
    not_a_stored_paragraph   the numbered paragraph is not one of body.yml's, so it
                             cannot be served whole (Word split it at a line break)
    disagrees_with_first_edition   the first edition marked a different paragraph of
                             this same lesson; one of the two is wrong
    anchor_out_of_range / no_anchor / implausible_length / no_body

`disagrees_with_first_edition` USED to be written-and-flagged, on the reasoning that a
neighbouring paragraph of the right lesson beats the whole text. #2720 measured that
reasoning: on 靖杭's golden set the paragraph the extractor picked was wrong in 14 of 34
comparable lessons and 8 of those carried `confirmed`. A flag nobody reads is not a
safeguard, so the disagreement now withholds and appears in the review list instead.
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
#: Fail-closed. See the module docstring for why `disagrees_with_first_edition` left
#: this set in #2720.
WRITEABLE = {"ok", "confirmed"}


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
    withheld: list[tuple[str, dict]] = []
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
            withheld.append((uid, r))
            # Withholding has to REMOVE a stale file, not merely decline to write one.
            # A lesson that a previous run wrote wrongly would otherwise keep serving
            # that passage while this run reports it as withheld — the gate would read
            # as fail-closed while behaving fail-open.
            stale = vdir / "key_reading.yml"
            if stale.exists() and not a.dry_run:
                stale.unlink()
                r["removed_stale"] = True
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
                # True  = the first edition's passage TEXT is this same paragraph
                # None  = this lesson has no first-edition counterpart (text rewritten
                #         or newly added). Not a pass — see extract_key_reading.
                "corroborated_by_first_edition": r["corroborated_by_first_edition"],
                "printed_marks": r.get("printed_marks"),
                "cell_paragraphs": r.get("cell_paragraphs"),
            },
        }
        if not a.dry_run:
            (vdir / "key_reading.yml").write_text(
                yaml.dump(doc, allow_unicode=True, sort_keys=False, width=10**6),
                encoding="utf-8",
            )
        written += 1

    print(f"  寫入 {written} 課的 key_reading.yml")
    for v, n in sorted(counts.items(), key=lambda kv: -kv[1]):
        print(f"    {v:30s} {n}")
    # The withheld lessons are the deliverable's other half: each one reads the whole
    # text until a human resolves it, and a count alone does not say which.
    if withheld:
        out = ROOT / "docs" / "curriculum" / "key-reading-needs-review.md"
        lines = ["# 重點朗讀待人工確認清單", "",
                 "由 `scripts/build_key_reading.py` 自動產生。列在這裡的課**沒有**寫入 "
                 "`key_reading.yml`，線上會 fallback 唸全文。",
                 "", "| lesson_uid | verdict | 段號數 | 課文段數 | anchor | 已移除舊檔 |",
                 "|---|---|---:|---:|---:|---|"]
        for uid, r in sorted(withheld):
            lines.append(
                f"| {uid} | {r['verdict']} | {r.get('printed_marks') or '—'} "
                f"| {r.get('cell_paragraphs') or '—'} | {r.get('anchor') or '—'} "
                f"| {'是' if r.get('removed_stale') else '—'} |")
        if not a.dry_run:
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text("\n".join(lines) + "\n", encoding="utf-8")
        print(f"  待人工確認 {len(withheld)} 課 → {out.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
