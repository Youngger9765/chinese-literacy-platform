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


class TestKnownGaps:
    """Honest content-gap registry: a listed (lesson, step) becomes known_gap
    (NOT pass, NOT silent unknown). Reasons must be in the validated enum.
    """

    def test_registry_loads_with_reasons(self):
        gate._KNOWN_GAPS = None
        gaps = gate._known_gaps()
        # Every reason value must be in the validated enum (no typos slip in).
        for section, entries in gaps.items():
            for code, reason in entries.items():
                assert reason in gate.KNOWN_GAP_REASONS, (section, code, reason)
        # G7-L31 multi-text secondary is a tracked story-structure gap.
        assert "G7-L31" in gaps["story-structure"]
        gate._KNOWN_GAPS = None

    def test_reading_strategy_known_gap_marks_known_gap_not_unknown(self):
        gate._KNOWN_GAPS = {
            "reading-strategy": {"G4-L1": "no_spotlight_source"},
            "story-structure": {},
            "figure": {},
        }
        story = {"id": 1001, "grade_code": "G4-L1", "spotlight_v2": {"blocks": []}}
        r = gate.l1_reading_strategy(story, "G4-L1", {})
        assert r["status"] == "known_gap"
        assert r["failure_codes"] == ["KNOWN_CONTENT_GAP_NO_SPOTLIGHT_SOURCE"]
        gate._KNOWN_GAPS = None

    def test_unlisted_missing_source_stays_unknown(self):
        gate._KNOWN_GAPS = {"reading-strategy": {}, "story-structure": {}, "figure": {}}
        story = {"id": 9999, "grade_code": "G4-L99", "spotlight_v2": {"blocks": []}}
        r = gate.l1_reading_strategy(story, "G4-L99", {})
        assert r["status"] == "unknown"
        assert r["failure_codes"] == ["SOURCE_MISSING"]
        gate._KNOWN_GAPS = None

    def test_blacklist_hit_never_gap_allowed(self):
        # A blacklisted placeholder md5 must stay fail even if lesson is listed.
        gate._KNOWN_GAPS = {
            "reading-strategy": {},
            "story-structure": {},
            "figure": {"G8-L6b": "no_spotlight_source"},
        }
        bl = next(iter(gate.BLACKLIST_MD5))
        # Fake a story whose single asset hashes to the blacklist md5.
        orig_md5 = gate.gcs_md5_hex
        orig_assets = gate.figure_assets_from_story
        gate.gcs_md5_hex = lambda code, fn, timeout=30: (bl, None)
        gate.figure_assets_from_story = lambda s: ["fig1.png"]
        try:
            r = gate.audit_figures({"id": 1118, "grade_code": "G8-L6b"}, "G8-L6b", "reading-strategy")
            assert r["status"] == "fail"
            assert "FIGURE_BLACKLIST_HIT" in r["failure_codes"]
        finally:
            gate.gcs_md5_hex = orig_md5
            gate.figure_assets_from_story = orig_assets
        gate._KNOWN_GAPS = None
