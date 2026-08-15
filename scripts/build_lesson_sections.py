#!/usr/bin/env python3
"""build_lesson_sections.py — write the extracted sections into the uid tree (#2683).

Writes `backend/data/lessons/<uid>/<version>/sections.yml` beside the body, spotlight
and keypoints.

WHAT GETS WRITTEN, AND WHAT DOES NOT
------------------------------------
A section whose check came back `mismatch` is NOT written. That is the point of
running the check: the QA plan says a section that cannot be shown to be right does
not go in front of a student, because the failure mode is showing another lesson's
questions or an answer that is not among the options.

`weak` is written — the content is present and structurally sound, with a lesser
concern recorded (a missing definition, a question with only two options). `unverified`
is written too, but flagged `needs_human_review`: 知識補給站 has no cross-check that
could exist, so it is honest to say so rather than imply it was validated.

The check travels with the data. Without it a section is just content that appeared,
with no way to tell a verified extraction from one that merely ran.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from extract_lesson_body import _paragraphs, extract as extract_body, extract_vocabulary  # noqa: E402
from extract_lesson_sections import extract_all  # noqa: E402

LESSONS = ROOT / "backend" / "data" / "lessons"
REGISTRY = ROOT / "docs" / "curriculum" / "lesson-uid-registry.yml"

#: Verdicts that may be served. `mismatch` and `empty` are withheld.
WRITEABLE = {"ok", "weak", "unverified"}


def latest_version(uid_dir: Path) -> Path | None:
    vs = sorted((c for c in uid_dir.iterdir() if c.is_dir() and c.name.startswith("v")),
                key=lambda c: c.name) if uid_dir.is_dir() else []
    return vs[-1] if vs else None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", default="/tmp/docx-src")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    src = Path(a.source)
    reg = yaml.safe_load(REGISTRY.read_text(encoding="utf-8"))
    written = 0
    per_section: dict[str, dict[str, int]] = {}

    for entry in reg["lessons"]:
        uid = entry["lesson_uid"]
        docx = src / f"{uid}.docx"
        vdir = latest_version(LESSONS / uid)
        if not docx.exists() or vdir is None:
            continue

        paras = _paragraphs(docx)
        body = extract_body(docx)
        result = extract_all(
            docx, extract_vocabulary(paras), "".join(body.get("paragraphs") or []),
        )

        doc: dict = {"lesson_uid": uid, "version_id": vdir.name}
        for name, data in result.items():
            verdict = data["check"]["verdict"]
            per_section.setdefault(name, {}).setdefault(verdict, 0)
            per_section[name][verdict] += 1
            if verdict not in WRITEABLE:
                continue
            section = {k: v for k, v in data.items() if k != "check"}
            section["extraction_check"] = data["check"]
            if verdict == "unverified":
                section["needs_human_review"] = True
            doc[name] = section

        if len(doc) <= 2:          # identity only — nothing passed
            continue
        if not a.dry_run:
            (vdir / "sections.yml").write_text(
                yaml.dump(doc, allow_unicode=True, sort_keys=False, width=10**6),
                encoding="utf-8",
            )
        written += 1

    print(f"  寫入 {written} 課的 sections.yml\n")
    for name, counts in per_section.items():
        kept = sum(v for k, v in counts.items() if k in WRITEABLE)
        print(f"  {name:20s} 收錄 {kept:3d}  明細 {dict(sorted(counts.items()))}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
