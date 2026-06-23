# Mapping Fix Report (Issue #2397)

run_id: `issue-2397-mapping-fix`  
branch: `fix/issue-2397-gate-p0-hardening`

## Code changes

- `backend/app/services/spotlight_v2_loader.py`
  - fail-closed for known padded alias collision slots: `G4-L02`, `G4-L03`
  - fail-closed for multi-text secondary slot: `G7-L31`
  - fail-closed for unresolved spotlight identity slots: `G4-L17`, `G4-L20`
  - denylist checks run before exact/norm fallback lookup
- `backend/app/services/lesson_layer_loaders.py`
  - fail-closed story-structure on multi-text primary slots (`MULTI_LESSON_PRIMARY`)
- `backend/data/curriculum_qa/content_known_gaps.yaml`
  - added explicit known-gap entries for affected reading-strategy/story-structure cells

## Victim before/after (staging vs local-after-fix)

Evidence file: `qa/content-evidence/p0-l1-matrix/mapping-regression-check.json`

- victims checked: 5
- fixed: 5 / 5

Expected fix criteria:

- story `2`, `3`, `1017`, `1103`: `has_spotlight` true (staging) -> false (local-after-fix)
- story `1020`: `has_spotlight` true -> false and `has_story_structure` true -> false

## Faithful regression check

Evidence file: `qa/content-evidence/p0-l1-matrix/mapping-regression-check.json`

- G4 faithful sample checked: 18
- unchanged availability (`spotlight` + `story_structure`): 18 / 18

## Verification

- spec tests:
  - `backend/specs/test_spotlight_v2_spec.py`
  - `backend/specs/test_story_structure_spec.py`
  - `backend/specs/test_lesson_loader_spec.py`
  - result: `124 passed`
- content evidence gate:
  - command: `python scripts/content_evidence_gate.py --no-l3 --run-id issue-2397-mapping-fix`
  - evidence dir: `qa/content-evidence/issue-2397-mapping-fix`

