#!/usr/bin/env bash
# Story-structure ship gate — run before merging parser/YAML/manifest changes.
#
#   bash scripts/story_structure_ship_gate.sh          # verify only (CI)
#   bash scripts/story_structure_ship_gate.sh --rebuild # rebuild manifest if schema present, then verify
#
# Requires private schema for --rebuild:
#   private/curriculum-source/_online-schema/*.keypoints.yml
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

PYBIN="$REPO_ROOT/backend/.venv/bin/python"
[ -x "$PYBIN" ] || PYBIN="$(command -v python3)"

REBUILD=false
if [ "${1:-}" = "--rebuild" ]; then
  REBUILD=true
fi

SCHEMA_DIR="$REPO_ROOT/private/curriculum-source/_online-schema"

if $REBUILD; then
  if [ ! -d "$SCHEMA_DIR" ]; then
    echo "ERROR: --rebuild requires $SCHEMA_DIR" >&2
    exit 1
  fi
  echo "== Rebuild keypoints manifest (--all) =="
  "$PYBIN" scripts/build_keypoints_qa_manifest.py --all
  echo ""
fi

echo "== Manifest freshness (runtime vs committed JSON) =="
"$PYBIN" scripts/keypoints_manifest_verify.py
echo ""

echo "== Spec contracts (story-structure + manifest) =="
(
  cd backend
  "$PYBIN" -m pytest specs/test_keypoints_manifest_spec.py specs/test_story_structure_spec.py \
    tests/test_story_structure_qa_contract.py -q
)
echo ""

echo "SHIP GATE: all checks passed"
