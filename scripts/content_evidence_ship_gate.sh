#!/usr/bin/env bash
# content_evidence_ship_gate.sh — fail-closed gate for the Content Evidence Gate (#2397).
#
# Spec /tmp/cursor-gate-spec.txt §6.1. Verifies a run's evidence is complete and
# clean before allowing a merge / "done" claim.口頭宣稱無法過關 — 只認證據檔。
#
#   bash scripts/content_evidence_ship_gate.sh --run-id <run_id>
#   bash scripts/content_evidence_ship_gate.sh --run-id <run_id> --evidence-root qa/content-evidence
#   bash scripts/content_evidence_ship_gate.sh --run-id <run_id> --smoke    # allow <304 cells (smoke set)
#   bash scripts/content_evidence_ship_gate.sh --run-id <run_id> --lesson   # allow <304 cells (per-lesson pilot run)
#
# --smoke and --lesson both relax the "expected_total_cells == 304" assertion
# (full-sweep-only invariant); everything else (unknown/fail/checksum/human
# sign-off gates) still applies at full strength to a partial run.
#
# Exit 0 + "CONTENT_EVIDENCE_GATE=PASS run_id=<run_id>" on success.
# Exit 1 + specific fail codes otherwise.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

PYBIN="$REPO_ROOT/backend/.venv/bin/python"
[ -x "$PYBIN" ] || PYBIN="$(command -v python3)"

RUN_ID=""
EVIDENCE_ROOT="qa/content-evidence"
PARTIAL="false"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --run-id) RUN_ID="$2"; shift 2 ;;
    --evidence-root) EVIDENCE_ROOT="$2"; shift 2 ;;
    --smoke) PARTIAL="true"; shift ;;
    --lesson) PARTIAL="true"; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

if [ -z "$RUN_ID" ]; then
  echo "ERROR: --run-id is required" >&2
  exit 2
fi

RUN_DIR="$EVIDENCE_ROOT/$RUN_ID"
if [ ! -d "$RUN_DIR" ]; then
  echo "FAIL: run dir not found: $RUN_DIR" >&2
  exit 1
fi

# All validation logic in Python (schema + checksum recompute + counters).
"$PYBIN" - "$RUN_DIR" "$PARTIAL" <<'PY'
import hashlib
import json
import sys
from pathlib import Path

run_dir = Path(sys.argv[1])
# "partial" covers BOTH --smoke (fixed 10-lesson regression set) and --lesson
# (arbitrary pilot lesson selection) — either way this is not a full 152-lesson
# sweep, so the ==304 cell-count assertion below does not apply.
partial = sys.argv[2] == "true"

fails: list[str] = []

REQUIRED = [
    "coverage_manifest.json",
    "l1_results.jsonl",
    "l3_render_results.jsonl",
    "figure_asset_audit.jsonl",
    "review_queue.jsonl",
    "human_review.md",
]

# 1. file existence
for name in REQUIRED:
    if not (run_dir / name).exists():
        fails.append(f"MISSING_FILE:{name}")

if fails:
    for f in fails:
        print(f"FAIL: {f}")
    sys.exit(1)

# parse manifest
try:
    manifest = json.loads((run_dir / "coverage_manifest.json").read_text("utf-8"))
except Exception as exc:
    print(f"FAIL: MANIFEST_PARSE_ERROR:{exc}")
    sys.exit(1)

# parse jsonl
def load_jsonl(name: str) -> list[dict]:
    rows = []
    for i, line in enumerate((run_dir / name).read_text("utf-8").splitlines(), 1):
        line = line.strip()
        if not line:
            continue
        try:
            rows.append(json.loads(line))
        except Exception as exc:
            fails.append(f"JSONL_PARSE_ERROR:{name}:line{i}:{exc}")
    return rows

l1 = load_jsonl("l1_results.jsonl")
l3 = load_jsonl("l3_render_results.jsonl")
fig = load_jsonl("figure_asset_audit.jsonl")

if fails:
    for f in fails:
        print(f"FAIL: {f}")
    sys.exit(1)

scope = manifest.get("scope", {})
observed = manifest.get("observed", {})
counts = manifest.get("summary_counts", {})

# 2. expected_total_cells == 304 (full = 152 deduped lessons x 2 steps) ;
#    for a partial (--smoke or --lesson) run = expected_lessons * 2. 304 (not
#    330): the raw /api/stories list has 13 padded/unpadded duplicate rows the
#    gate now collapses.
expected_total = scope.get("expected_total_cells")
if not partial and expected_total != 304:
    fails.append(f"EXPECTED_TOTAL_NOT_304:{expected_total}")

# 3. observed three layers all == expected_total
for layer in ("l1_rows", "l3_rows", "figure_rows"):
    if observed.get(layer) != expected_total:
        fails.append(f"OBSERVED_{layer.upper()}_NE_EXPECTED:{observed.get(layer)}!={expected_total}")

if len(l1) != expected_total:
    fails.append(f"L1_ROWCOUNT:{len(l1)}!={expected_total}")
if len(l3) != expected_total:
    fails.append(f"L3_ROWCOUNT:{len(l3)}!={expected_total}")
if len(fig) != expected_total:
    fails.append(f"FIG_ROWCOUNT:{len(fig)}!={expected_total}")

# 4-7. counter gates
if counts.get("unknown_cells", -1) != 0:
    fails.append(f"UNKNOWN_CELLS:{counts.get('unknown_cells')}")
if counts.get("missing_screenshot_cells", -1) != 0:
    fails.append(f"MISSING_SCREENSHOT_CELLS:{counts.get('missing_screenshot_cells')}")
if counts.get("console_error_cells", -1) != 0:
    fails.append(f"CONSOLE_ERROR_CELLS:{counts.get('console_error_cells')}")
if counts.get("figure_blacklist_hits", -1) != 0:
    fails.append(f"FIGURE_BLACKLIST_HITS:{counts.get('figure_blacklist_hits')}")
if counts.get("fail_cells", -1) != 0:
    fails.append(f"FAIL_CELLS:{counts.get('fail_cells')}")

# 7b. known_gap cells are NON-blocking (honest, owned content gaps) but MUST
# be reason-annotated in every l1/figure row — a known_gap status with no
# KNOWN_CONTENT_GAP_* failure_code would be a silent skip, which is a fail.
known_gap_cells = counts.get("known_gap_cells", 0)
for row in l1 + fig:
    if row.get("status") == "known_gap":
        codes = row.get("failure_codes") or []
        if not any(c.startswith("KNOWN_CONTENT_GAP_") for c in codes):
            fails.append(f"KNOWN_GAP_NO_REASON:{row.get('cell_id')}")
print(f"INFO: known_gap_cells={known_gap_cells} (honest content gaps, non-blocking)")

# 8. overall_status == pass
if manifest.get("overall_status") != "pass":
    fails.append(f"OVERALL_STATUS:{manifest.get('overall_status')}")

# 9. human_review.md filled (reviewer + final decision)
hr = (run_dir / "human_review.md").read_text("utf-8")
import re
reviewer_filled = bool(re.search(r"-\s*Reviewer:\s*\S", hr))
decision = re.search(r"Human final decision:\s*(PASS|FAIL)\b", hr)
if not reviewer_filled:
    fails.append("HUMAN_REVIEW_NO_REVIEWER")
if not decision or decision.group(1) != "PASS":
    fails.append("HUMAN_REVIEW_NO_PASS_SIGNOFF")

# 10. checksums recompute consistent (anti hand-edit)
def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()

for name, expected_sha in (manifest.get("checksums_sha256") or {}).items():
    actual = sha256(run_dir / name)
    if actual != expected_sha:
        fails.append(f"CHECKSUM_MISMATCH:{name}")

if fails:
    print("CONTENT_EVIDENCE_GATE=FAIL")
    for f in fails:
        print(f"FAIL: {f}")
    sys.exit(1)

print(f"CONTENT_EVIDENCE_GATE=PASS run_id={manifest.get('run_id')}")
sys.exit(0)
PY
