#!/usr/bin/env bash
# run_spotlight_dev_gate.sh — CI gate for professor dev7 spotlight v2
#
# Layers:
#   1. Overfit lint (build_lesson_schema.py detectors)
#   2. Gold contract eval (checked-in YAML vs gold_manifest.json)
#   3. pytest backend/specs/test_spotlight_v2_spec.py
#   4. Frontend vitest (spotlightBlockLogic + BlockSequenceRenderer)
#
# Usage:
#   bash scripts/run_spotlight_dev_gate.sh

set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

echo "=== [1/4] Overfit lint ==="
python3 -c "
import sys
sys.path.insert(0, 'scripts')
from eval_lesson_schema import overfit_lint
from pathlib import Path
r = overfit_lint(Path('scripts/build_lesson_schema.py'))
print('OVERFIT_LINT:', 'PASS' if r['pass'] else 'FAIL')
if not r['pass']:
    for h in r.get('hits', []):
        print(' ', h)
    sys.exit(1)
"

echo "=== [2/4] Gold contract (dev7 checked-in fixtures) ==="
python3 scripts/spotlight_contract.py --dev7

echo "=== [3/6] Backend pytest (spotlight block model TDD) ==="
cd backend && python -m pytest specs/test_spotlight_block_model_spec.py -q --tb=short

echo "=== [4/6] Backend pytest (PSE MCQ parser TDD) ==="
python -m pytest specs/test_pse_mcq_parser_spec.py -q --tb=short

echo "=== [5/6] Backend pytest (spotlight v2 spec) ==="
python -m pytest specs/test_spotlight_v2_spec.py -q --tb=short
cd "$REPO_ROOT"

echo "=== [6/6] Frontend vitest (spotlight v2) ==="
cd frontend && npm run test -- --run src/components/reading-spotlight/__tests__/

echo "=== Gate PASS: dev7 spotlight v2 all checks green ==="
