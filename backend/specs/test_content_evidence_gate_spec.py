"""
Spec: content evidence gate — story dedup + canonical-code manifest fallback.

These lock the #2397 fixes that removed phantom unknowns caused by the platform
storing the same lesson under two padded/unpadded DB rows (G4-L01 / G4-L1).
"""

import sys
from pathlib import Path

_BACKEND_DIR = Path(__file__).resolve().parents[1]
_SCRIPTS_DIR = _BACKEND_DIR.parent / "scripts"
for _p in (_BACKEND_DIR, _SCRIPTS_DIR):
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

import content_evidence_gate as gate  # noqa: E402


class TestDedupeStoriesByCanonicalCode:
    def test_collapses_padded_unpadded_pair_keeping_canonical(self):
        stories = [
            {"id": 1, "grade_code": "G4-L01"},
            {"id": 1001, "grade_code": "G4-L1"},
        ]
        out = gate.dedupe_stories_by_canonical_code(stories)
        assert len(out) == 1
        # Keeps the unpadded/canonical row (the catalog entry with content).
        assert out[0]["id"] == 1001
        assert out[0]["grade_code"] == "G4-L1"

    def test_collapses_classical_chinese_pair(self):
        stories = [
            {"id": 44, "grade_code": "文-L01"},
            {"id": 1149, "grade_code": "文-L1"},
        ]
        out = gate.dedupe_stories_by_canonical_code(stories)
        assert len(out) == 1
        assert out[0]["id"] == 1149

    def test_distinct_lessons_all_kept(self):
        stories = [
            {"id": 1001, "grade_code": "G4-L1"},
            {"id": 1002, "grade_code": "G4-L2"},
            {"id": 1003, "grade_code": "G4-L3"},
        ]
        out = gate.dedupe_stories_by_canonical_code(stories)
        assert len(out) == 3

    def test_no_canonical_row_falls_back_to_higher_id(self):
        # Both rows padded (no exact canonical match): keep higher id.
        stories = [
            {"id": 11, "grade_code": "G5-L11"},
            {"id": 1038, "grade_code": "G5-L11"},
        ]
        out = gate.dedupe_stories_by_canonical_code(stories)
        assert len(out) == 1
        assert out[0]["id"] == 1038


class TestKeypointsCanonicalFallback:
    def test_lookup_by_story_id_then_canonical_code(self):
        # Simulate a manifest indexed only under the canonical story_id 1001;
        # the iterated duplicate row (story 1 / G4-L01) must still resolve.
        gate._KP_BY_STORY = {1001: {"story_id": 1001, "gates": {"L1": {"pass": True}}}}
        gate._KP_BY_CODE = {"G4-L1": gate._KP_BY_STORY[1001]}
        entry = gate._keypoints_entry({"id": 1}, "G4-L01")
        assert entry is not None
        assert entry["story_id"] == 1001
        # cleanup module-level cache so other tests rebuild from disk
        gate._KP_BY_STORY = None
        gate._KP_BY_CODE = None

    def test_direct_story_id_match_preferred(self):
        gate._KP_BY_STORY = {7: {"story_id": 7, "gates": {"L1": {"pass": True}}}}
        gate._KP_BY_CODE = {}
        entry = gate._keypoints_entry({"id": 7}, "G4-L03")
        assert entry is not None and entry["story_id"] == 7
        gate._KP_BY_STORY = None
        gate._KP_BY_CODE = None
