#!/usr/bin/env bash
# Local CI for the modular spec system (specs/).
#
# Runs the exact same two gates as specs/ci/spec-check.yml, but locally — so the
# 27 spec-module contracts are enforceable WITHOUT the GitHub Actions workflow
# (which is blocked on a token with `workflow` scope, tracked in issue 2041).
#
# Usage:
#   bash specs/run-ci.sh          # run both gates, exit non-zero on any failure
#   bash specs/run-ci.sh --quick  # gate 1 only (registry freshness, instant)
#
# Run this before pushing changes that touch specs/ or backend/app/services/.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

# Prefer the backend venv (has google.genai etc.); fall back to python3.
PYBIN="backend/.venv/bin/python"
[ -x "$PYBIN" ] || PYBIN="$(command -v python3)"

echo "== Local Spec CI =="
echo "   python: $PYBIN"
echo "   modules: $(ls -d specs/modules/*/ 2>/dev/null | wc -l | tr -d ' ')"
echo ""

echo "-- Gate 1/2: registry freshness (build_registry.py --check) --"
"$PYBIN" specs/build_registry.py --check
echo "   OK"
echo ""

if [ "${1:-}" = "--quick" ]; then
  echo "(--quick: skipping gate 2 pytest)"
  exit 0
fi

echo "-- Gate 2/2: spec contracts (pytest specs/) --"
( cd backend && "$PYBIN" -m pytest specs/ -q )
echo ""
echo "== Local Spec CI: PASS =="
