"""
Spec: keypoints QA manifest must match live story-structure runtime (no fake greens).

Module spec: specs/modules/story-structure/INTENT.md (I-6)
"""

import json
import sys
from pathlib import Path

_SCRIPTS_DIR = Path(__file__).resolve().parents[2] / "scripts"
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))

from keypoints_manifest_verify import MANIFEST_PATH, default_verify  # noqa: E402


class TestKeypointsManifestFreshness:
    def test_manifest_exists(self):
        assert MANIFEST_PATH.is_file(), (
            "keypoints_manifest.json missing — run scripts/build_keypoints_qa_manifest.py --all"
        )

    def test_manifest_matches_runtime(self):
        errors = default_verify()
        assert errors == [], "Manifest stale vs runtime:\n" + "\n".join(f"  - {e}" for e in errors)

    def test_summary_invariants(self):
        manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        summary = manifest["summary"]
        assert summary["fail"] == 0
        assert summary["known_gap_count"] == 0
        assert summary["pass"] == summary["total"]
        assert manifest.get("smoke_only") is False

    def test_g7_l6_not_parser_gap(self):
        manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        g7 = next(l for l in manifest["lessons"] if l["lesson_id"] == "G7-L6")
        assert g7["known_data_gap"] is False
        assert g7["layout"]["mode"] == "fill_blank"
        assert g7["layout"]["fill_blank_count"] >= 5
