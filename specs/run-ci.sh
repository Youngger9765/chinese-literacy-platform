#!/usr/bin/env bash
# Local CI for the modular spec system (specs/).
#
# Runs the exact same gates as specs/ci/spec-check.yml, but locally — so all
# spec-module contracts are enforceable WITHOUT the GitHub Actions workflow
# (which is blocked on a token with `workflow` scope, tracked in issue 2041).
#
# Gates:
#   Gate 1: registry freshness + legacy_tests pointer-rot check
#           (build_registry.py --check — includes Lock 2 dangling-path guard)
#   Gate 2: spec contracts   (pytest specs/)
#   Gate 3: legacy_tests     (union of all legacy_tests: paths from the registry)
#           Skip if no module has legacy_tests entries.
#
# Usage:
#   bash specs/run-ci.sh          # run all gates, exit non-zero on any failure
#   bash specs/run-ci.sh --quick  # gate 1 only (registry freshness, instant)
#
# Run this before pushing changes that touch specs/ or backend/app/services/.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

# Prefer the backend venv (has google.genai etc.); fall back to python3.
PYBIN="$REPO_ROOT/backend/.venv/bin/python"
[ -x "$PYBIN" ] || PYBIN="$(command -v python3)"

echo "== Local Spec CI =="
echo "   python: $PYBIN"
echo "   modules: $(ls -d specs/modules/*/ 2>/dev/null | wc -l | tr -d ' ')"
echo ""

# ── Gate 1/3: registry freshness + legacy_tests pointer-rot ──────────────────
echo "-- Gate 1/3: registry freshness + pointer-rot check (build_registry.py --check) --"
"$PYBIN" specs/build_registry.py --check
echo "   OK"
echo ""

if [ "${1:-}" = "--quick" ]; then
  echo "(--quick: skipping gates 2 and 3)"
  exit 0
fi

# ── Gate 2/3: spec contracts ──────────────────────────────────────────────────
echo "-- Gate 2/3: spec contracts (pytest specs/) --"
( cd backend && "$PYBIN" -m pytest specs/ -q )
echo ""

# ── Gate 3/3: legacy_tests union ─────────────────────────────────────────────
# Collect all legacy_tests: paths from the registry (Lock 1).
# Uses Python to parse registry.yaml rather than duplicating YAML logic in bash.
LEGACY_PATHS=$(
  "$PYBIN" - <<'PYEOF'
import yaml, sys
from pathlib import Path

registry = Path("specs/registry.yaml")
if not registry.exists():
    sys.exit(0)
data = yaml.safe_load(registry.read_text()) or {}
paths = []
for m in data.get("modules", []):
    for p in m.get("legacy_tests") or []:
        paths.append(p)
print("\n".join(paths))
PYEOF
)

if [ -z "$LEGACY_PATHS" ]; then
  echo "-- Gate 3/3: legacy_tests -- (no legacy_tests entries, skip) --"
else
  echo "-- Gate 3/3: legacy_tests union --"
  # Paths in INTENT.md are repo-relative (e.g. backend/tests/foo.py).
  # pytest is run from inside backend/, so strip the leading "backend/" prefix.
  PYTEST_ARGS=()
  while IFS= read -r p; do
    [ -n "$p" ] && PYTEST_ARGS+=("${p#backend/}")
  done <<< "$LEGACY_PATHS"
  echo "   running: pytest ${PYTEST_ARGS[*]}"
  ( cd backend && "$PYBIN" -m pytest "${PYTEST_ARGS[@]}" -q )
  echo ""
fi

# ── Gate 4/4: QR-manifest reconciliation (no 空砲, no missing QR) ─────────────
# Reusable: validates against current data, not hard-coded lesson numbers.
# After importing new courses, re-run this same gate.
echo "-- Gate 4/4: QR-manifest reconciliation (verify_qr_manifest) --"
( cd backend && "$PYBIN" -m pytest tests/test_verify_qr_manifest.py -q )
echo ""

# ── Gate 5/5: spotlight structural ratchet ───────────────────────────────────
# The spotlight gate existed and nothing ran it. `run_spotlight_dev_gate.sh` and
# `content_evidence_gate.py` appear in no workflow and were not here either, while
# CLAUDE.md said a spotlight PR must print CONTENT_EVIDENCE_GATE=PASS. The gate had
# been exiting 1 on a deleted first-edition fixture for the whole re-ink.
#
# This is the cheap half — structure only, deterministic, all 175 lessons — and it is
# the half that matters before a full rebuild: #2713 and #2714 both end by rebuilding
# every lesson's spotlight, and without this nothing says what else moved.
echo "-- Gate 5/5: spotlight structural ratchet (spotlight_fingerprints) --"
"$PYBIN" scripts/spotlight_fingerprints.py --check
echo ""

echo "== Local Spec CI: PASS =="
