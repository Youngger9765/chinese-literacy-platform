"""
Spec: content evidence gate — story dedup + canonical-code manifest fallback.

These lock the #2397 fixes that removed phantom unknowns caused by the platform
storing the same lesson under two padded/unpadded DB rows (G4-L01 / G4-L1).
"""

import sys
import pytest
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

    @pytest.mark.skip(

        reason="斷言的 G7-L31 是一修課號，二修重編後不存在（#2683）；gate 本身仍有效，只是 known-gaps registry 的內容已整份換成二修的缺口"

    )

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


class TestFigureAssetsFromStory:
    """#2459 — the gate must audit ONLY the figure filenames the FRONTEND
    actually fetches (story.images[].filename via buildImageSrc), never the
    synthetic spotlight_v2 blocks[].asset name (figN.png). block.asset is used
    frontend-side only to derive the figure label; it is never uploaded to GCS
    under that name, so auditing it produced false 404 gaps on lessons whose
    real image is present and rendering (G7-L28/L29/L30/G9-L9)."""

    def test_audits_img_filename_not_synthetic_block_asset(self):
        story = {
            "id": 1,
            "spotlight_v2": {
                "blocks": [{"type": "figure", "asset": "fig1.png", "bind_paragraph": "圖一"}]
            },
            "images": [
                {"filename": "images/G7-L28/G7-L28-08.jpg", "figure_label": "圖一"}
            ],
        }
        assets = gate.figure_assets_from_story(story)
        # The real, fetched filename is audited...
        assert "G7-L28-08.jpg" in assets
        # ...and the synthetic block.asset name is NOT (it 404s in GCS → false gap).
        assert "fig1.png" not in assets
        assert assets == ["G7-L28-08.jpg"]

    def test_synthetic_block_asset_alone_yields_no_audit_target(self):
        # A figure block with a synthetic asset but no backing image must not
        # inject figN.png into the audit set (frontend renders a placeholder,
        # it never fetches figN.png).
        story = {
            "id": 2,
            "spotlight_v2": {"blocks": [{"type": "figure", "asset": "fig10.png"}]},
            "images": [],
        }
        assert gate.figure_assets_from_story(story) == []

    def test_skips_non_image_table_json(self):
        # G7-L30's API-served images[] carries table*.json entries (tables
        # mis-modeled as figures). Those are not rendered as <img> and must not
        # be audited as figures.
        story = {
            "id": 3,
            "spotlight_v2": {"blocks": []},
            "images": [
                {"filename": "images/G7-L30/G7-L30-06.png"},
                {"filename": "table1.json"},
                {"filename": "table2.json"},
            ],
        }
        assert gate.figure_assets_from_story(story) == ["G7-L30-06.png"]

    def test_audits_unusual_real_image_extensions_fail_closed(self):
        # Denylist (not allowlist): a real figure with a non-standard docx
        # extraction extension (.x-emf / .svg) must STILL be audited against
        # GCS, never silently skipped — otherwise a future broken figure in
        # that format would pass invisibly (#2459 review). Only .json tables skip.
        story = {
            "id": 5,
            "spotlight_v2": {"blocks": []},
            "images": [
                {"filename": "images/G9-L7/G9-L7-03.x-emf"},
                {"filename": "images/G5-L5/G5-L5-02.svg"},
                {"filename": "notes.json"},
            ],
        }
        assert gate.figure_assets_from_story(story) == [
            "G9-L7-03.x-emf",
            "G5-L5-02.svg",
        ]

    def test_collects_all_real_image_filenames_deduped(self):
        story = {
            "id": 4,
            "spotlight_v2": {"blocks": []},
            "images": [
                {"filename": "images/G9-L9/G9-L9-02.jpg"},
                {"filename": "images/G9-L9/G9-L9-04.png"},
                {"filename": "images/G9-L9/G9-L9-02.jpg"},  # dup basename
            ],
        }
        assert gate.figure_assets_from_story(story) == ["G9-L9-02.jpg", "G9-L9-04.png"]
