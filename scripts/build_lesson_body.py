#!/usr/bin/env python3
"""build_lesson_body.py — write the extracted 課文 into the uid tree (#2683).

Reads each lesson's DOCX, runs `extract_lesson_body`, and writes

    backend/data/lessons/<lesson_uid>/<version_id>/body.yml

alongside the spotlight and keypoints the pipeline already produces.

The vocabulary check travels WITH the data. Each file records how many of the
lesson's own vocabulary words were found in the extracted text, so a reader — or a
later gate — can tell a verified extraction from one that merely ran. A lesson whose
check comes back `suspect` is written with `needs_review: true` rather than withheld:
the text is probably right (both suspects were hand-checked and are), and hiding it
would lose the reason it was ever doubted.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from extract_lesson_body import extract  # noqa: E402

LESSONS = ROOT / "backend" / "data" / "lessons"
REGISTRY = ROOT / "docs" / "curriculum" / "lesson-uid-registry.yml"


def latest_version(uid_dir: Path) -> Path | None:
    vs = sorted((c for c in uid_dir.iterdir() if c.is_dir() and c.name.startswith("v")),
                key=lambda c: c.name) if uid_dir.is_dir() else []
    return vs[-1] if vs else None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", default="/tmp/docx-src", help="<lesson_uid>.docx 的目錄")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    src = Path(a.source)
    reg = yaml.safe_load(REGISTRY.read_text(encoding="utf-8"))
    written = skipped = failed = 0
    verdicts: dict[str, int] = {}

    for entry in reg["lessons"]:
        uid = entry["lesson_uid"]
        docx = src / f"{uid}.docx"
        vdir = latest_version(LESSONS / uid)
        if not docx.exists() or vdir is None:
            skipped += 1
            continue

        result = extract(docx)
        if not result["ok"]:
            failed += 1
            print(f"  ❌ {uid} {entry['catalog_slot']:9s} {result['reason']}")
            continue

        check = result["check"]
        verdicts[check["verdict"]] = verdicts.get(check["verdict"], 0) + 1
        doc = {
            "lesson_uid": uid,
            "version_id": vdir.name,
            "source": "DOCX 第一節（讀全文-做記號）",
            "paragraphs": result["paragraphs"],
            "paragraph_count": len(result["paragraphs"]),
            "char_count": result["char_count"],
            # 「Level 4・記敘文」 from the masthead — grade band and genre, authored with
            # the lesson rather than in the planning spreadsheet.
            "level": result.get("level"),
            "extraction_check": {
                "method": "本課語詞是否出現在抽出的課文裡（語詞由學習單另一節獨立寫成）",
                "vocabulary_found": check["hit"],
                "vocabulary_total": check["of"],
                "ratio": check["ratio"],
                "verdict": check["verdict"],
            },
        }
        # `suspect` — the check ran and came back low. `no_vocab` — the check could not
        # run at all, because these worksheets (11 of them 文言文, which use 古文今譯
        # instead of a 本課語詞 box) name no vocabulary to compare against. That is a
        # body with NO cross-validation: the extraction produced text and nothing
        # confirms the boundary. Unflagged it would read as verified, which is the
        # distinction the QA plan exists to preserve.
        if check["verdict"] in ("suspect", "no_vocab"):
            doc["needs_review"] = True
            doc["review_reason"] = (
                "語詞比對結果偏低" if check["verdict"] == "suspect"
                else "這份學習單沒有本課語詞，課文邊界無從交叉驗證"
            )

        if not a.dry_run:
            (vdir / "body.yml").write_text(
                yaml.dump(doc, allow_unicode=True, sort_keys=False, width=10**6),
                encoding="utf-8",
            )
        written += 1

    print(f"\n  寫入 {written} 課  失敗 {failed}  略過 {skipped}")
    print(f"  驗證分布: {verdicts}")
    return 0 if failed <= 3 else 1


if __name__ == "__main__":
    sys.exit(main())
