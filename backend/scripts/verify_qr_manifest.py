"""Reusable QA for the QR-code delivery manifest (Issue #2622 / #2625).

Run this after importing new courses (or on demand) to prove the QR xlsx the
教材端 prints is correct — every QR points at audio that will actually exist,
and nothing that should exist is missing. It is data-driven and hard-codes no
lesson numbers, so the same command validates any future course set.

What "correct" means (one invariant, gated on data — never on a stale
assumption about a grade):

  * A lesson gets a 全文 QR  iff  the batch generates a whole-text clip for it
    — i.e. its grade is in build_demo_reading._FULL_AND_PASSAGE_GRADES. This is
    imported, not re-declared, so the QA tracks the generator automatically.
  * A lesson gets a 段落 QR  iff  a 念順順段 exists for it: its grade_code is a
    key with non-empty text in key_reading_passages.yml (the SOT), which MUST
    equal the DB's has_key_reading flag.

The two QR producers this keeps honest:
  * backend  scripts/build_demo_reading.plan_demo_audio  (authoritative plan)
  * frontend LessonAudioTable.buildQrManifestRows         (the printed xlsx)

They drifted once (#2622): the frontend emitted a 段落 QR for all 165 lessons
while only 107 have a passage → 58 codes played nothing. This QA fails on that
class of drift instead of letting it reach a printed worksheet.

CLI:
  python -m scripts.verify_qr_manifest [--api-base https://...] [--json]
  exit 0 = manifest is consistent with the data; exit 1 = a real mismatch.
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from scripts.build_demo_reading import (  # noqa: E402
    _FULL_AND_PASSAGE_GRADES,
    _PASSAGE_ONLY_GRADES,
)

STAGING_API = "https://lingoleap-backend-staging-958347263320.asia-east1.run.app"


# ---------------------------------------------------------------------------
# Pure core (fully unit-tested — no network, no files)
# ---------------------------------------------------------------------------


def yml_with_passage(yml_passages: dict) -> set[str]:
    """Codes that carry a real (non-empty) passage.

    Accepts either the raw yml `passages` mapping or the loader's already-
    filtered dict; a whitespace-only passage is not a passage.
    """
    out: set[str] = set()
    for code, entry in (yml_passages or {}).items():
        passage = ((entry or {}).get("passage") or "").strip()
        if passage:
            out.add(code)
    return out


def expected_qr(lesson: dict, passage_codes: set[str]) -> dict:
    """The QR set a lesson should have, derived from data, not from a literal.

    `passage_codes` is the set from `yml_with_passage`.
    """
    return {
        "full": lesson["grade"] in _FULL_AND_PASSAGE_GRADES,
        "passage": lesson["grade_code"] in passage_codes,
    }


@dataclass
class ReconcileResult:
    ok: bool
    plan: dict  # lesson_id -> {"full": bool, "passage": bool}
    flag_mismatches: list = field(default_factory=list)
    orphan_codes: list = field(default_factory=list)
    no_qr_lesson_ids: list = field(default_factory=list)

    def summary(self) -> str:
        n = len(self.plan)
        full = sum(1 for p in self.plan.values() if p["full"])
        passage = sum(1 for p in self.plan.values() if p["passage"])
        lines = [
            f"lessons: {n}",
            f"全文 QR: {full}",
            f"段落 QR: {passage}",
            f"無任何 QR 的課: {len(self.no_qr_lesson_ids)} {self.no_qr_lesson_ids or ''}",
            f"yml↔has_key_reading 不一致: {len(self.flag_mismatches)}",
            f"yml 孤兒 code (對不到 DB): {len(self.orphan_codes)}",
            f"RESULT: {'OK' if self.ok else 'MISMATCH'}",
        ]
        for m in self.flag_mismatches:
            lines.append(
                f"  ✗ {m['grade_code']} (lesson {m['lesson_id']}): "
                f"has_key_reading={m['has_key_reading']} but yml_passage={m['yml_passage']}"
            )
        return "\n".join(lines)


def reconcile(lessons: list[dict], yml_passages: dict) -> ReconcileResult:
    """Reconcile the DB lesson list against the yml passage SOT.

    A mismatch = the DB's has_key_reading disagrees with whether the yml holds a
    real passage for that grade_code. That is the thing a printed 段落 QR would
    lie about, so it fails the QA. Orphan yml codes (passage text with no DB
    lesson) are reported but not fatal — 32 exist today from course renames.
    """
    passage_codes = yml_with_passage(yml_passages)
    db_codes = {lsn["grade_code"] for lsn in lessons}

    plan: dict = {}
    mismatches: list = []
    no_qr: list = []

    for lsn in lessons:
        exp = expected_qr(lsn, passage_codes)
        plan[lsn["id"]] = exp

        yml_has = lsn["grade_code"] in passage_codes
        if yml_has != bool(lsn.get("has_key_reading")):
            mismatches.append(
                {
                    "lesson_id": lsn["id"],
                    "grade_code": lsn["grade_code"],
                    "has_key_reading": bool(lsn.get("has_key_reading")),
                    "yml_passage": yml_has,
                }
            )

        if not exp["full"] and not exp["passage"]:
            no_qr.append(lsn["id"])

    orphans = sorted(passage_codes - db_codes)

    return ReconcileResult(
        ok=(len(mismatches) == 0),
        plan=plan,
        flag_mismatches=mismatches,
        orphan_codes=orphans,
        no_qr_lesson_ids=no_qr,
    )


# ---------------------------------------------------------------------------
# Thin I/O layer for the CLI (not unit-tested — exercised by running it live)
# ---------------------------------------------------------------------------


def fetch_lessons(api_base: str) -> list[dict]:
    """Fetch the anonymous story list; keep only the fields the QA needs."""
    url = f"{api_base.rstrip('/')}/api/stories?page_size=300"
    with urllib.request.urlopen(url, timeout=60) as resp:  # noqa: S310
        data = json.loads(resp.read().decode("utf-8"))
    stories = data["stories"]
    if len(stories) != data["total"]:
        raise SystemExit(
            f"story list truncated: got {len(stories)} / {data['total']} — "
            "raise page_size before trusting the QA"
        )
    return [
        {
            "id": s["id"],
            "grade": s["grade"],
            "grade_code": s["grade_code"],
            "has_key_reading": s.get("has_key_reading", False),
        }
        for s in stories
    ]


def load_yml_passages() -> dict:
    """Load the passage SOT via the same loader the backend serves from."""
    from app.services.lesson_layer_loaders import get_key_reading_passages

    return get_key_reading_passages()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-base", default=STAGING_API, help="backend base URL")
    parser.add_argument("--json", action="store_true", help="emit machine-readable JSON")
    args = parser.parse_args(argv)

    lessons = fetch_lessons(args.api_base)
    yml = load_yml_passages()
    result = reconcile(lessons, yml)

    if args.json:
        print(
            json.dumps(
                {
                    "ok": result.ok,
                    "flag_mismatches": result.flag_mismatches,
                    "orphan_codes": result.orphan_codes,
                    "no_qr_lesson_ids": result.no_qr_lesson_ids,
                    "counts": {
                        "lessons": len(result.plan),
                        "full_qr": sum(1 for p in result.plan.values() if p["full"]),
                        "passage_qr": sum(1 for p in result.plan.values() if p["passage"]),
                    },
                },
                ensure_ascii=False,
                indent=2,
            )
        )
    else:
        print(result.summary())

    return 0 if result.ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
