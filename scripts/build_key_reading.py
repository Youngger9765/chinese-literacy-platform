#!/usr/bin/env python3
"""build_key_reading.py — write 重點朗讀 into the uid tree (#2683, #2720).

Writes `backend/data/lessons/<uid>/<version>/key_reading.yml`.

`ok`, `confirmed` and `disagrees_with_first_edition` are written. Everything else is
withheld and the lesson keeps reading the whole text — degraded, but not a lie. The
verdicts that withhold:

    numbering_disagrees      no transformation reaches the author's paragraph count,
                             so "the Nth paragraph" is not well defined
    no_printed_numbering     no 段號 column found; nothing says which paragraph is Nth
    not_a_stored_paragraph   the numbered paragraph is not a run of body.yml's, so it
                             cannot be served whole
    anchor_out_of_range / no_anchor / implausible_length / no_body

`disagrees_with_first_edition` is WRITTEN, not withheld: 二修教材為主 (靖杭,
2026-08-18) — the second edition's own instruction about the second edition's worksheet
outranks a passage read off the first edition's printing. It is flagged and listed in
`docs/curriculum/key-reading-disagrees-first-edition.md` (25 lessons) so a human can
settle it; measured cost is 2 lessons (L0072, L0110) whose first-edition passage says we
picked the wrong paragraph.

It withheld until 2026-08-18, and this docstring described that. Leaving the old wording
in place while the code did the opposite is the same defect this whole PR is about, so it
is corrected here rather than annotated.
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
#: Fail-closed on everything the numbering cannot answer. `disagrees_with_first_edition`
#: is IN the set: 二修教材為主 (靖杭, 2026-08-18) — the second edition's own instruction
#: outranks a passage read off the first edition's printing. It is written and flagged,
#: and the flagged lessons get their own list so the disagreement stays visible.
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
    withheld: list[tuple[str, dict]] = []
    disagrees: list[str] = []
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
        if r["verdict"] == "disagrees_with_first_edition":
            disagrees.append(uid)
        if r["verdict"] not in WRITEABLE:
            withheld.append((uid, r))
            # Withholding has to REPLACE a stale file, not merely decline to write one.
            # A lesson that a previous run wrote wrongly would otherwise keep serving
            # that passage while this run reports it as withheld — the gate would read
            # as fail-closed while behaving fail-open.
            #
            # But the fluency target survives the withholding (#2722): it belongs to the
            # 念順順 section, not to the paragraph. So the file becomes benchmark-only
            # rather than disappearing, which is also the shape #2725 taught the loader
            # to tolerate — `passage: null` is not a reading step with no text, it is a
            # lesson that has a rubric and no marked paragraph.
            stale = vdir / "key_reading.yml"
            if not a.dry_run:
                if r.get("reading_benchmark"):
                    stale.write_text(
                        yaml.dump({"lesson_uid": uid, "version_id": vdir.name,
                                   "passage": None,
                                   "reading_benchmark": r["reading_benchmark"],
                                   "extraction_check": {"verdict": r["verdict"]}},
                                  allow_unicode=True, sort_keys=False, width=10**6),
                        encoding="utf-8")
                    r["kept_benchmark"] = True
                elif stale.exists():
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
            # The fluency target the worksheet sets for THIS lesson (#2722), in the shape
            # `frontend/src/utils/fluencyAnalyzer.ts` already parses. Absent where the
            # worksheet sets none; the UI then falls back to the grade default.
            **({"reading_benchmark": r["reading_benchmark"]} if r.get("reading_benchmark") else {}),
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
                 "", "| lesson_uid | verdict | 段號數 | 課文段數 | anchor | 舊檔處理 |",
                 "|---|---|---:|---:|---:|---|"]
        for uid, r in sorted(withheld):
            lines.append(
                f"| {uid} | {r['verdict']} | {r.get('printed_marks') or '—'} "
                f"| {r.get('cell_paragraphs') or '—'} | {r.get('anchor') or '—'} "
                f"| {'保留字數目標' if r.get('kept_benchmark') else ('已刪除' if r.get('removed_stale') else '—')} |")
        if not a.dry_run:
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text("\n".join(lines) + "\n", encoding="utf-8")
        print(f"  待人工確認 {len(withheld)} 課 → {out.relative_to(ROOT)}")
    # Written, but the first edition names a different paragraph of the same lesson.
    # Kept in its own list rather than mixed into the withheld one: these lessons DO
    # serve a passage, so they are a review queue, not a gap.
    if disagrees:
        out = ROOT / "docs" / "curriculum" / "key-reading-disagrees-first-edition.md"
        lines = ["# 重點朗讀：與一修對照表標的段落不同（已寫入，二修為主）", "",
                 "由 `scripts/build_key_reading.py` 自動產生。這些課**有**服務段落 —— "
                 "採用二修 DOCX 的指定段落，因為二修教材為主。",
                 "", "但一修人工掃描的段落是這一課的另一段，而且那段文字在二修課文裡"
                 "**仍逐字存在**（否則配不上），所以課文沒改、標記卻不同 —— "
                 "可能是二修真的重新畫過，也可能是我們讀錯。需要人拿二修學習單確認。",
                 "", "| lesson_uid |", "|---|"]
        lines += [f"| {u} |" for u in sorted(disagrees)]
        if not a.dry_run:
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text("\n".join(lines) + "\n", encoding="utf-8")
        print(f"  與一修標記不同（已寫入，待確認）{len(disagrees)} 課 → {out.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
