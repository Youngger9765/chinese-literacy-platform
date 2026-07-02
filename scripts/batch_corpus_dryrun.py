#!/usr/bin/env python3
"""batch_corpus_dryrun.py — full-corpus DRY-RUN generalization harness (#2205 EDD).

WHY THIS EXISTS
---------------
``spotlight_to_lesson_content.py`` (the deterministic bridge adapter) is hard-wired
to the DEV7 spotlight dir and has no ``--all`` mode. This runner drives that SAME
adapter over the FULL spotlight corpus (dev7 + test15 + catalog) to measure whether
the bridge *generalizes* or is overfit to the 7 教授 courses. It:

  1. discovers every ``*.spotlight.yml`` under ``spotlight/<set>/`` (NO hardcoded
     lesson ids — pure glob; overfit-lint clean),
  2. runs the adapter's own functions (load_spotlight / load_parsed /
     assemble_lesson / to_lesson) — the SHIPPED adapter code is imported UNMODIFIED,
  3. writes each result to a NON-catalog dry-run dir as ``<code>.lesson.yml``,
  4. re-reads every written file through ``eval_lesson_content`` (schema validate +
     answer_round_trip + coverage) — the exact checks the eval CLI performs, run
     through disk so this is a true round-trip,
  5. emits a per-lesson red/green markdown coverage table + a totals block
     (X green / Y needs_review / Z schema-fail + gap-reason distribution),
  6. merges every gap into a DRY-RUN-scoped known-gaps ledger (a SIBLING of the
     shipped ``content_known_gaps.adapter.yaml``; the canonical
     ``content_known_gaps.yaml`` read by ``content_evidence_gate.py`` is NEVER
     touched).

DETERMINISTIC. NO AI. NO NETWORK. NO DB. Nothing here promotes into the catalog,
opens LESSON_RENDERER_V1, or edits build_lesson_schema.py / catalog / runtime.

HONESTY
-------
Every lesson is counted. schema-fail / needs_review / unanchored / no-exercise are
reported verbatim — never faked to pass, never silently skipped. If a set is skipped
(e.g. missing dir) the run prints it explicitly.

USAGE
-----
    backend/.venv/bin/python scripts/batch_corpus_dryrun.py \
        --out-dir backend/data/lessons/_lesson_content_dryrun \
        --with-keypoints \
        --report-md docs/spotlight-edd-dryrun-corpus-coverage.md \
        --gaps-out backend/data/curriculum_qa/content_known_gaps.adapter.dryrun.yaml

    # default set list = dev7,test15,catalog ; override with --sets dev7,test15
"""
from __future__ import annotations

import argparse
import collections
import datetime
import sys
from pathlib import Path
from typing import Any, Optional

# ── import the SHIPPED adapter + eval unmodified ────────────────────────────
_REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_REPO_ROOT / "scripts"))
sys.path.insert(0, str(_REPO_ROOT / "backend"))

import yaml  # noqa: E402
from pydantic import ValidationError  # noqa: E402

import spotlight_to_lesson_content as A  # noqa: E402
import eval_lesson_content as E  # noqa: E402
from app.services.lesson_code_normalization import normalize_manifest_code  # noqa: E402

SPOTLIGHT_ROOT = _REPO_ROOT / "backend" / "data" / "lessons" / "spotlight"
DEFAULT_SETS = ["dev7", "test15", "catalog"]
GAPS_SECTION = "spotlight-edd-adapter-dryrun-fullcorpus"


# ═══════════════════════════════════════════════════════════════════════════
#  Traffic-light verdict for one lesson (mirrors the DEV7 green definition)
# ═══════════════════════════════════════════════════════════════════════════
#  GREEN         = schema ok + 0 round-trip fail + 0 needs_review + all anchored
#                  + >= 1 exercise
#  NEEDS_REVIEW  = schema ok, 0 round-trip fail, but >=1 exercise flagged review
#  RT_FAIL       = schema ok, but an exercise cannot re-grade its own answer
#  NO_EXERCISE   = schema ok, but 0 exercise blocks
#  UNANCHORED    = schema ok, but an exercise has no anchor
#  SCHEMA_FAIL   = Lesson.model_validate raised (mapping bug / empty output)
#  LOAD_FAIL     = the spotlight yaml could not be loaded


def _verdict(cov: dict[str, Any]) -> str:
    if cov["round_trip_fail"] > 0:
        return "RT_FAIL"
    if cov["n_needs_review"] > 0:
        return "NEEDS_REVIEW"
    if cov["n_exercises"] == 0:
        return "NO_EXERCISE"
    if not cov["all_anchored"]:
        return "UNANCHORED"
    return "GREEN"


_LIGHT = {True: "🟢", False: "🔴"}


# ═══════════════════════════════════════════════════════════════════════════
#  Core: process one set
# ═══════════════════════════════════════════════════════════════════════════


def process_corpus(
    sets: list[str], out_dir: Path, with_keypoints: bool
) -> tuple[list[dict[str, Any]], A.GapLog, dict[str, int]]:
    """Returns (rows, gaps, set_counts). rows are ordered by set then code."""
    rows: list[dict[str, Any]] = []
    gaps = A.GapLog()
    set_counts: dict[str, int] = {}

    for setname in sets:
        set_dir = SPOTLIGHT_ROOT / setname
        if not set_dir.is_dir():
            set_counts[setname] = -1  # sentinel: dir missing / skipped
            continue
        files = sorted(set_dir.glob("*.spotlight.yml"))
        set_counts[setname] = len(files)
        for path in files:
            file_code = path.name[: -len(".spotlight.yml")]
            row: dict[str, Any] = {
                "set": setname,
                "file_code": file_code,
                "lesson_code": file_code,
                "status": None,
                "kinds": [],
                "n_blocks": 0,
                "n_exercises": 0,
                "n_steps": 0,
                "n_review": 0,
                "all_anchored": None,
                "rt_ok": 0,
                "rt_partial": 0,
                "rt_soft": 0,
                "rt_fail": 0,
                "gaps": [],
                "err": "",
                "out_file": None,
            }

            # 1. load spotlight (adapter fn)
            try:
                spot = A.load_spotlight(path)
            except Exception as e:  # noqa: BLE001
                row["status"] = "LOAD_FAIL"
                row["err"] = str(e).splitlines()[0][:160]
                rows.append(row)
                continue

            lesson_code = normalize_manifest_code(str(spot.get("lesson") or file_code))
            row["lesson_code"] = lesson_code
            parsed = A.load_parsed(lesson_code)

            # 2. assemble + validate (adapter fns — fail LOUD as SCHEMA_FAIL)
            try:
                lesson_dict = A.assemble_lesson(spot, parsed, gaps, with_keypoints)
                A.to_lesson(lesson_dict)  # raises ValidationError on mapping bug
            except ValidationError as e:
                row["status"] = "SCHEMA_FAIL"
                row["err"] = f"{e.error_count()} err: " + str(e).splitlines()[0][:120]
                row["gaps"] = gaps.for_lesson(lesson_code)
                rows.append(row)
                continue

            # 3. write to the dry-run out dir
            out_path = out_dir / setname / f"{lesson_code}.lesson.yml"
            A.write_yaml(lesson_dict, out_path)
            row["out_file"] = str(out_path.relative_to(_REPO_ROOT))

            # 4. re-read via the eval harness (true through-disk round-trip)
            lesson = E.load_lesson(out_path)
            cov = E.lesson_coverage(lesson)
            row["kinds"] = sorted(cov["kinds"])
            row["n_blocks"] = cov["n_blocks"]
            row["n_exercises"] = cov["n_exercises"]
            row["n_review"] = cov["n_needs_review"]
            row["all_anchored"] = cov["all_anchored"]
            row["rt_ok"] = cov["round_trip_ok"]
            row["rt_partial"] = cov["round_trip_partial"]
            row["rt_soft"] = cov["round_trip_soft"]
            row["rt_fail"] = cov["round_trip_fail"]
            row["n_steps"] = sum(
                len(getattr(b.question, "steps", []) or [])
                for b in lesson.blocks
                if getattr(b, "type", None) == "exercise"
            )
            row["gaps"] = gaps.for_lesson(lesson_code)
            row["status"] = _verdict(cov)
            rows.append(row)

    return rows, gaps, set_counts


# ═══════════════════════════════════════════════════════════════════════════
#  Markdown coverage report
# ═══════════════════════════════════════════════════════════════════════════

_STATUS_ORDER = [
    "GREEN",
    "NEEDS_REVIEW",
    "UNANCHORED",
    "NO_EXERCISE",
    "RT_FAIL",
    "SCHEMA_FAIL",
    "LOAD_FAIL",
]


def render_markdown(
    rows: list[dict[str, Any]],
    set_counts: dict[str, int],
    sets: list[str],
    with_keypoints: bool,
    gaps: A.GapLog,
    out_dir: Path,
    gaps_out: Path,
) -> str:
    processed = [r for r in rows if r["status"] is not None]
    reason_counter: collections.Counter = collections.Counter()
    strat_unmapped: collections.Counter = collections.Counter()
    for r in processed:
        for g in r["gaps"]:
            reason_counter[g["reason"]] += 1
            if g["reason"] == "strategy_type_unmapped":
                strat_unmapped[g.get("detail", "")] += 1

    status_tot: collections.Counter = collections.Counter(r["status"] for r in processed)
    per_set: dict[str, collections.Counter] = {
        s: collections.Counter(r["status"] for r in processed if r["set"] == s) for s in sets
    }

    ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    L: list[str] = []
    L.append("# Spotlight→Lesson Adapter — Full-Corpus DRY-RUN Coverage")
    L.append("")
    L.append(f"_Generated {ts} by `scripts/batch_corpus_dryrun.py` "
             f"(`--with-keypoints`={'on' if with_keypoints else 'off'})._")
    L.append("")
    L.append("**DRY-RUN**: nothing promoted into the catalog, `LESSON_RENDERER_V1` untouched, "
             "shipped `spotlight_to_lesson_content.py` / `eval_lesson_content.py` imported "
             "unmodified. Generated `*.lesson.yml` live in "
             f"`{out_dir.relative_to(_REPO_ROOT)}/` (gitignored). "
             f"Gaps ledger: `{gaps_out.relative_to(_REPO_ROOT)}`.")
    L.append("")

    # ── coverage counts / skips ──
    n_glob = sum(c for c in set_counts.values() if c >= 0)
    n_proc = len(processed)
    L.append("## Corpus coverage (honesty)")
    L.append("")
    L.append("| set | files discovered | processed | skipped |")
    L.append("|---|---|---|---|")
    for s in sets:
        c = set_counts.get(s, -1)
        if c < 0:
            L.append(f"| {s} | dir missing | 0 | ⚠️ set skipped (dir not found) |")
        else:
            proc_s = sum(1 for r in processed if r["set"] == s)
            L.append(f"| {s} | {c} | {proc_s} | {c - proc_s} |")
    L.append(f"| **TOTAL** | **{n_glob}** | **{n_proc}** | **{n_glob - n_proc}** |")
    L.append("")
    L.append(f"Every discovered `*.spotlight.yml` was processed end-to-end "
             f"({n_proc}/{n_glob}); 0 files silently skipped or truncated.")
    L.append("")

    # ── totals / generalization ──
    green = status_tot.get("GREEN", 0)
    L.append("## Totals — generalization verdict")
    L.append("")
    L.append("| status | count | % of processed |")
    L.append("|---|---|---|")
    for st in _STATUS_ORDER:
        n = status_tot.get(st, 0)
        pct = f"{100.0 * n / n_proc:.1f}%" if n_proc else "—"
        L.append(f"| {st} | {n} | {pct} |")
    L.append(f"| **processed** | **{n_proc}** | 100% |")
    L.append("")
    L.append("### Per-set breakdown")
    L.append("")
    hdr = "| set | " + " | ".join(_STATUS_ORDER) + " | processed |"
    L.append(hdr)
    L.append("|" + "---|" * (len(_STATUS_ORDER) + 2))
    for s in sets:
        pc = per_set.get(s, collections.Counter())
        proc_s = sum(pc.values())
        cells = " | ".join(str(pc.get(st, 0)) for st in _STATUS_ORDER)
        L.append(f"| {s} | {cells} | {proc_s} |")
    L.append("")
    # generalization gap (DEV green-rate vs held-out TEST green-rate)
    dev_proc = sum(1 for r in processed if r["set"] == "dev7")
    dev_green = per_set.get("dev7", collections.Counter()).get("GREEN", 0)
    test_proc = sum(1 for r in processed if r["set"] == "test15")
    test_green = per_set.get("test15", collections.Counter()).get("GREEN", 0)
    if dev_proc and test_proc:
        dev_rate = dev_green / dev_proc
        test_rate = test_green / test_proc
        gap = dev_rate - test_rate
        L.append(f"**generalization_gap** (DEV green-rate − TEST green-rate) = "
                 f"{dev_rate:.2f} − {test_rate:.2f} = **{gap:+.2f}** "
                 f"({'⚠️ overfit warning (>0.15)' if gap > 0.15 else 'within #2205 §4 tolerance'})")
        L.append("")
    L.append(f"**Overall green rate:** {green}/{n_proc} "
             f"({100.0 * green / n_proc:.1f}%) of processed lessons pass all lights.")
    L.append("")

    # ── gap-reason distribution ──
    L.append("## Gap / failure reason distribution")
    L.append("")
    L.append("| reason | count | blocks a green? |")
    L.append("|---|---|---|")
    # reasons that DO block green vs cosmetic
    blocking = {
        "no_anchorable_block",
        "answer_not_in_options",
        "multi_choice_unsplittable_options",
        "multi_choice_incomplete_answer",
        "keypoints_blank_null_answer",
        "keypoints_choice_distractor_unrecoverable",
        "no_keypoints_source",
    }
    for reason, n in reason_counter.most_common():
        note = "cosmetic (→ DEFAULT_KIND, does not block)" if reason == "strategy_type_unmapped" else (
            "yes (unanchored / review / no-exercise)" if reason in blocking else "—"
        )
        L.append(f"| `{reason}` | {n} | {note} |")
    L.append("")
    if strat_unmapped:
        L.append("<details><summary>unmapped strategy_type codes "
                 "(all fall to DEFAULT_KIND=guided_steps, the #2205 catch-all — cosmetic)"
                 "</summary>")
        L.append("")
        L.append("| strategy_type | occurrences |")
        L.append("|---|---|")
        for st, n in strat_unmapped.most_common():
            L.append(f"| `{st or '(empty)'}` | {n} |")
        L.append("")
        L.append("</details>")
        L.append("")

    # ── per-lesson table ──
    L.append("## Per-lesson red/green (紅綠燈)")
    L.append("")
    L.append("`anchors` = every exercise has ≥1 anchor. `answer-verifiable` = 0 round-trip "
             "fails (exact/partial/rubric breakdown in parens). `reasons` = distinct gap reasons "
             "logged for that lesson.")
    L.append("")
    L.append("| set | lesson_code | status | kind(s) | blocks | ex | steps | anchors | "
             "answer-verifiable | needs_review | reasons |")
    L.append("|---|---|---|---|---|---|---|---|---|---|---|")
    status_emoji = {
        "GREEN": "🟢 GREEN",
        "NEEDS_REVIEW": "🟡 NEEDS_REVIEW",
        "UNANCHORED": "🟠 UNANCHORED",
        "NO_EXERCISE": "⚪ NO_EXERCISE",
        "RT_FAIL": "🔴 RT_FAIL",
        "SCHEMA_FAIL": "🔴 SCHEMA_FAIL",
        "LOAD_FAIL": "🔴 LOAD_FAIL",
    }
    for r in processed:
        distinct_reasons = sorted({g["reason"] for g in r["gaps"]})
        reasons_cell = ", ".join(f"`{x}`" for x in distinct_reasons) or "—"
        if r["status"] in ("SCHEMA_FAIL", "LOAD_FAIL"):
            kinds_cell = f"— ({r['err']})"
            anchors_cell = "🔴"
            verifiable_cell = "🔴"
        else:
            kinds_cell = ", ".join(r["kinds"]) or "—"
            anchors_cell = _LIGHT[bool(r["all_anchored"])]
            verifiable_cell = (
                f"{_LIGHT[r['rt_fail'] == 0]} "
                f"({r['rt_ok']}e/{r['rt_partial']}p/{r['rt_soft']}r)"
            )
        L.append(
            f"| {r['set']} | {r['lesson_code']} | {status_emoji.get(r['status'], r['status'])} | "
            f"{kinds_cell} | {r['n_blocks']} | {r['n_exercises']} | {r['n_steps']} | "
            f"{anchors_cell} | {verifiable_cell} | {r['n_review']} | {reasons_cell} |"
        )
    L.append("")
    L.append("---")
    L.append(f"_Total gap entries this run: {len(gaps.items)} "
             f"(unified ledger written to `{gaps_out.relative_to(_REPO_ROOT)}`)._")
    L.append("")
    return "\n".join(L)


# ═══════════════════════════════════════════════════════════════════════════
#  Gaps ledger (DRY-RUN sibling — never the canonical content_known_gaps.yaml)
# ═══════════════════════════════════════════════════════════════════════════


def write_dryrun_gaps(gaps: A.GapLog, gaps_out: Path) -> None:
    gaps_out.parent.mkdir(parents=True, exist_ok=True)
    existing: dict[str, Any] = {}
    if gaps_out.exists():
        loaded = yaml.safe_load(gaps_out.read_text(encoding="utf-8"))
        if isinstance(loaded, dict):
            existing = loaded
    section: list[dict[str, Any]] = existing.get(GAPS_SECTION) or []
    seen = {
        (e.get("lesson_code"), e.get("step", ""), e.get("reason"))
        for e in section
        if isinstance(e, dict)
    }
    for g in gaps.items:
        key = (g.get("lesson_code"), g.get("step", ""), g.get("reason"))
        if key not in seen:
            seen.add(key)
            section.append(g)
    existing[GAPS_SECTION] = section
    header = (
        "# FULL-CORPUS DRY-RUN adapter known-gaps (scripts/batch_corpus_dryrun.py).\n"
        "# DRY-RUN artifact — NOT the shipped DEV7 content_known_gaps.adapter.yaml and\n"
        "# NOT the canonical content_known_gaps.yaml read by content_evidence_gate.py.\n"
        "# Enumerates every schema-MAPPING gap the deterministic bridge logged while\n"
        "# translating ALL spotlight sets (dev7 + test15 + catalog). Honest ledger of\n"
        "# where the adapter falls short of a full green; no gap is faked into a pass.\n"
    )
    gaps_out.write_text(
        header + yaml.safe_dump(existing, allow_unicode=True, sort_keys=False, width=1000),
        encoding="utf-8",
    )


# ═══════════════════════════════════════════════════════════════════════════
#  CLI
# ═══════════════════════════════════════════════════════════════════════════


def _parse_sets(raw: Optional[str]) -> list[str]:
    if not raw:
        return list(DEFAULT_SETS)
    return [s.strip() for s in raw.split(",") if s.strip()]


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--out-dir",
        default=str(_REPO_ROOT / "backend" / "data" / "lessons" / "_lesson_content_dryrun"),
        help="dry-run output dir for generated *.lesson.yml (NON-catalog)",
    )
    ap.add_argument("--sets", default=None, help="comma list of spotlight sets (default all 3)")
    ap.add_argument("--with-keypoints", action="store_true", help="emit ex-keypoints exercise")
    ap.add_argument(
        "--report-md",
        default=str(_REPO_ROOT / "docs" / "spotlight-edd-dryrun-corpus-coverage.md"),
        help="markdown coverage report path",
    )
    ap.add_argument(
        "--gaps-out",
        default=str(
            _REPO_ROOT / "backend" / "data" / "curriculum_qa"
            / "content_known_gaps.adapter.dryrun.yaml"
        ),
        help="DRY-RUN unified known-gaps ledger (sibling; not canonical)",
    )
    args = ap.parse_args(argv)

    sets = _parse_sets(args.sets)
    out_dir = Path(args.out_dir)
    report_md = Path(args.report_md)
    gaps_out = Path(args.gaps_out)

    rows, gaps, set_counts = process_corpus(sets, out_dir, args.with_keypoints)

    write_dryrun_gaps(gaps, gaps_out)
    md = render_markdown(rows, set_counts, sets, args.with_keypoints, gaps, out_dir, gaps_out)
    report_md.parent.mkdir(parents=True, exist_ok=True)
    report_md.write_text(md, encoding="utf-8")

    # ── console summary (for the harness caller) ──
    processed = [r for r in rows if r["status"] is not None]
    status_tot: collections.Counter = collections.Counter(r["status"] for r in processed)
    n_glob = sum(c for c in set_counts.values() if c >= 0)
    print(f"processed {len(processed)}/{n_glob} spotlight files "
          f"(sets: {','.join(f'{s}={set_counts.get(s)}' for s in sets)})")
    for st in _STATUS_ORDER:
        print(f"  {st:<13} {status_tot.get(st, 0)}")
    reason_counter: collections.Counter = collections.Counter()
    for r in processed:
        for g in r["gaps"]:
            reason_counter[g["reason"]] += 1
    print("top gap reasons:")
    for reason, n in reason_counter.most_common(6):
        print(f"  {n:>4} {reason}")
    print(f"report → {report_md}")
    print(f"gaps   → {gaps_out} ({len(gaps.items)} entries)")
    print(f"lessons→ {out_dir}")
    # This is a MEASUREMENT run, not a gate. Non-green lessons are expected findings,
    # not a failure of the run itself. Exit 0 always (schema-fails are DATA, reported).
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
