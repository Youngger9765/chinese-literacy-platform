#!/usr/bin/env bash
# Story-structure ship gate — run before merging parser/YAML/manifest changes.
#
#   bash scripts/story_structure_ship_gate.sh          # verify only (CI)
#   bash scripts/story_structure_ship_gate.sh --rebuild # rebuild the manifest first, then verify
#
# --rebuild used to require private/curriculum-source/_online-schema, the first
# edition's curation workspace. That directory was deleted in the re-ink, so the
# rebuild path was unreachable and the manifest could not be refreshed (#2749).
# The builder now reads the served lesson tree, which is in the repo.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

PYBIN="$REPO_ROOT/backend/.venv/bin/python"
[ -x "$PYBIN" ] || PYBIN="$(command -v python3)"

REBUILD=false
if [ "${1:-}" = "--rebuild" ]; then
  REBUILD=true
fi

if $REBUILD; then
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
