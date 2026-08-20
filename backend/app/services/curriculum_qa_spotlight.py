"""Spotlight QA manifest for the admin curriculum dashboard.

WHERE THE VERDICTS COME FROM (#2747)
------------------------------------
Until 2026-08-19 this described seven first-edition lessons — the `dev7` fixtures —
and compared them against `backend/data/lessons/spotlight/dev7/gold_manifest.json`.
The re-ink deleted that directory, so:

  * `build_spotlight_manifest()` raised FileNotFoundError — the only way to recompute
    the dashboard's numbers was dead;
  * `load_spotlight_manifest()` fell back to the checked-in snapshot, last refreshed in
    `5d371855`, and served **7/7 pass, 0 fail** on every request;
  * `get_spotlight_lesson('G6-L22')` returned `overall_pass: True` with `spotlight: None`
    — a verdict about a lesson that is not there.

Seven of 175 was also never the coverage the dashboard implied. The source is now the
corpus the platform serves: `get_all_lessons()` → `spotlight_v2`, keyed by `lesson_uid`,
which is the identity the re-ink established and the one a renumber cannot move.

WHAT "GOLD" IS NOW
------------------
`backend/data/spotlight_fingerprints.json` — the structural ratchet from #2727, keyed by
uid, covering all 175, regenerated with `scripts/spotlight_fingerprints.py --write` and
enforced by `specs/run-ci.sh` Gate 5. It already exists and is already maintained; a
second baseline for the same question would be a second thing to forget to update.

WHAT THIS DOES NOT DO
---------------------
It does not re-run the first edition's per-lesson semantic bounds. `SEMANTIC_EXPECTATIONS`
is keyed by first-edition codes (G7-L28/29/30, G6-L22) that now name different lessons, so
applying them by code would hold four unrelated lessons to another lesson's numbers. Every
lesson is evaluated against the generic bound instead — deliberately, and verified: no uid
collides with those keys, so the choice is not an accident of lookup order.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from app.services.spotlight_contract import (
    eval_spotlight_v2,
    fingerprint_spotlight,
    semantic_eval_spotlight,
)

_QA_ROOT = Path(__file__).resolve().parent.parent.parent / "data" / "curriculum_qa"
_MANIFEST = _QA_ROOT / "spotlight_manifest.json"
_FINGERPRINTS = Path(__file__).resolve().parent.parent.parent / "data" / "spotlight_fingerprints.json"

# Lessons the platform serves with no 聚光燈 at all.
#
# A ratchet, not a config: it may shrink, never grow. Rebuilding re-baselines every
# verdict, which is also exactly how a lesson whose extraction broke would drop out of
# the manifest and leave the summary looking healthy — the failure this file exists to
# stop. So a served lesson with no spotlight has to be named here, and a name that has
# been fixed has to be deleted (the gate fails on a stale entry too).
#
# All seven have a `v2/spotlight.yml` and no `v3/` one, and the loader serves the latest
# version directory — so the extraction that produced the rest of v3 did not produce
# these. Six are a grade's lesson zero (G5-L0 … G9-L0) plus G4-L1; L0137 is G9-L16.
# Content gap in the extraction, not a defect in this gate.
LESSONS_WITHOUT_SPOTLIGHT: frozenset[str] = frozenset({
    "L0011",  # G4-L1
    "L0021",  # G5-L0
    "L0049",  # G6-L0
    "L0077",  # G7-L0
    "L0107",  # G8-L0
    "L0130",  # G9-L0
    "L0137",  # G9-L16
})


def _fingerprint_baseline() -> dict[str, Any]:
    if not _FINGERPRINTS.is_file():
        return {}
    return json.loads(_FINGERPRINTS.read_text(encoding="utf-8")).get("lessons") or {}


def _served_lessons() -> list[dict[str, Any]]:
    from app.services.lesson_loader import get_all_lessons

    return get_all_lessons()


def _entry(lesson: dict[str, Any], baseline: dict[str, Any]) -> dict[str, Any]:
    uid = lesson["lesson_uid"]
    spotlight = lesson["spotlight_v2"]

    ev = eval_spotlight_v2(spotlight)
    # uid, not grade_code — see the module docstring on SEMANTIC_EXPECTATIONS.
    semantic = semantic_eval_spotlight(uid, spotlight)
    fp = fingerprint_spotlight(spotlight)

    recorded = baseline.get(uid)
    if recorded is None:
        gold = {"match": None, "reason": "no fingerprint baseline for this lesson"}
    else:
        diffs = {k: {"actual": fp.get(k), "expected": recorded.get(k)}
                 for k in recorded if fp.get(k) != recorded.get(k)}
        gold = {"match": not diffs, "diffs": diffs}

    return {
        "lesson_id": uid,
        "lesson_uid": uid,
        "grade_code": lesson.get("grade_code"),
        "title": lesson.get("title"),
        "strategy_type": spotlight.get("strategy_type"),
        "block_count": ev.get("block_count"),
        "overall_pass": bool(ev.get("pass") and semantic["semantic_pass"] and gold.get("match") is not False),
        "eval": {
            "pass": ev.get("pass"),
            "guide_retained": ev.get("guide_retained"),
            "answer_recall": ev.get("answer_recall"),
            "mcq_leakage": ev.get("mcq_leakage"),
            "struct_errors": ev.get("struct_errors"),
            "semantic": semantic,
        },
        "gold": gold,
        "type_histogram": ev.get("type_histogram"),
        "fingerprint": fp,
    }


def build_spotlight_manifest() -> dict[str, Any]:
    """Recompute every verdict from the corpus the platform serves. Writes nothing."""
    baseline = _fingerprint_baseline()
    lessons_out = [
        _entry(l, baseline) for l in _served_lessons() if l.get("spotlight_v2")
    ]
    lessons_out.sort(key=lambda e: e["lesson_uid"])

    missing = sorted(l["lesson_uid"] for l in _served_lessons() if not l.get("spotlight_v2"))
    pass_count = sum(1 for e in lessons_out if e["overall_pass"])

    return {
        "schema_version": 2,
        "generated_by": "scripts/build_spotlight_qa_manifest.py",
        "source": "served corpus — get_all_lessons()['spotlight_v2'], keyed by lesson_uid (#2747)",
        "gold_source": "backend/data/spotlight_fingerprints.json (#2727 ratchet)",
        "summary": {
            "total": len(lessons_out),
            "pass": pass_count,
            "fail": len(lessons_out) - pass_count,
            # Not part of `total`: a lesson with no spotlight has nothing to evaluate.
            # Counted separately so the dashboard cannot show "168/168 pass" and imply
            # the corpus is 168 lessons — it is 175.
            "lessons_without_spotlight": len(missing),
            "corpus_total": len(_served_lessons()),
        },
        "lessons_without_spotlight": missing,
        "lessons": lessons_out,
    }


def verify_spotlight_manifest() -> list[str]:
    """Errors describing how the committed manifest disagrees with what is served."""
    errors: list[str] = []
    if not _MANIFEST.is_file():
        return [f"missing manifest: {_MANIFEST} — run scripts/build_spotlight_qa_manifest.py"]

    manifest = json.loads(_MANIFEST.read_text(encoding="utf-8"))
    served = {l["lesson_uid"]: l for l in _served_lessons() if l.get("spotlight_v2")}
    recorded_uids: set[str] = set()

    for entry in manifest.get("lessons") or []:
        uid = entry.get("lesson_uid") or entry.get("lesson_id")
        if not uid:
            continue
        recorded_uids.add(uid)
        lesson = served.get(uid)
        if lesson is None:
            errors.append(f"{uid}: in manifest but the platform serves no spotlight for it")
            continue
        live_fp = fingerprint_spotlight(lesson["spotlight_v2"])
        if entry.get("fingerprint") != live_fp:
            errors.append(f"{uid}: manifest fingerprint != served spotlight — rebuild")

    for uid in sorted(set(served) - recorded_uids):
        errors.append(f"{uid}: serves a spotlight but is missing from the manifest")

    missing = {l["lesson_uid"] for l in _served_lessons() if not l.get("spotlight_v2")}
    for uid in sorted(missing - LESSONS_WITHOUT_SPOTLIGHT):
        errors.append(
            f"{uid}: serves no 聚光燈 and is not named in LESSONS_WITHOUT_SPOTLIGHT — "
            "the step renders its empty state and the summary would not show it"
        )
    for uid in sorted(LESSONS_WITHOUT_SPOTLIGHT - missing):
        errors.append(
            f"{uid}: named in LESSONS_WITHOUT_SPOTLIGHT but now serves one — "
            "delete the entry so the ratchet tightens"
        )
    return errors


def load_spotlight_manifest() -> dict[str, Any]:
    """The committed snapshot, or a fresh build when it is absent.

    The snapshot is what the dashboard reads; `verify_spotlight_manifest` is what keeps
    it honest. Serving a stale snapshot with no way to recompute it was the defect.
    """
    if _MANIFEST.exists():
        return json.loads(_MANIFEST.read_text(encoding="utf-8"))
    return build_spotlight_manifest()


def get_spotlight_lesson(lesson_id: str) -> dict[str, Any] | None:
    """One lesson's verdict together with the spotlight that verdict is about.

    Accepts a uid (`L0042`) or a catalogue code (`G4-L1`); the manifest is keyed by uid,
    but the dashboard's links and anyone typing a lesson number use the code.
    """
    manifest = load_spotlight_manifest()
    by_uid = {l["lesson_uid"]: l for l in _served_lessons()}
    by_code = {l.get("grade_code"): l for l in _served_lessons() if l.get("grade_code")}

    for entry in manifest.get("lessons") or []:
        uid = entry.get("lesson_uid") or entry.get("lesson_id")
        if lesson_id not in (uid, entry.get("grade_code")):
            continue
        lesson = by_uid.get(uid) or by_code.get(entry.get("grade_code"))
        # `or None`, never `{}`: an empty dict reads as "there is a spotlight, it is
        # blank", which is the shape that let a pass be reported about nothing.
        return {**entry, "spotlight": (lesson or {}).get("spotlight_v2") or None}
    return None
