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
        """Was skipped from 2026-08-14 to 2026-08-19 because the builder read
        `private/curriculum-source/_online-schema`, deleted in the second-edition
        re-ink — so the manifest could not be rebuilt and this could only fail
        (#2749). The builder now reads the lessons the platform serves, which is
        what this compares against, so the skip has nothing left to excuse."""
        errors = default_verify()
        assert errors == [], "Manifest stale vs runtime:\n" + "\n".join(f"  - {e}" for e in errors)

    def test_summary_invariants(self):
        manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        summary = manifest["summary"]
        assert summary["fail"] == 0
        assert summary["known_gap_count"] == 0
        assert summary["pass"] == summary["total"]
        assert manifest.get("smoke_only") is False

    def test_no_lesson_is_marked_a_parser_gap(self):
        """Was pinned to G7-L6 having >= 5 fill-blanks (#2273 fixed a parser gap
        there). G7-L6 is a different lesson in the second edition — 果醬男孩, one
        blank — so that number described material that no longer exists. What the
        test was protecting is that no lesson sits in the manifest flagged as a
        parser gap, which is checkable without naming one."""
        manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        gaps = [l["lesson_id"] for l in manifest["lessons"] if l.get("known_data_gap")]
        assert gaps == [], f"lessons still flagged as parser gaps: {gaps}"

    def test_builder_runs_against_the_served_corpus(self):
        """#2749's actual defect: the builder's only source was two first-edition
        directories that the re-ink deleted, so `--all` exited 1 on a missing path
        and the manifest this gate compares against could not be regenerated at
        all. A gate whose baseline cannot be rebuilt is a gate that can only be
        deleted, so this asserts the builder runs on what the platform serves."""
        from build_keypoints_qa_manifest import build_manifest

        manifest, snapshots = build_manifest()
        assert manifest["summary"]["total"] > 100, manifest["summary"]
        assert manifest["smoke_only"] is False
        assert set(snapshots) == {l["lesson_id"] for l in manifest["lessons"]}

    def test_manifest_records_the_lesson_the_code_now_points_at(self):
        """The first-edition manifest went stale invisibly: the second edition
        renumbered every code, so `G4-L13` in the manifest and `G4-L13` in the
        loader were two different lessons and the gate compared one against the
        other. Identity is the uid, so the gate checks the pair, not the code."""
        from keypoints_manifest_verify import live_profiles_by_code

        manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        live = live_profiles_by_code()
        wrong = [
            (l["lesson_id"], l.get("lesson_uid"), live[l["lesson_id"]]["lesson_uid"])
            for l in manifest["lessons"]
            if l["lesson_id"] in live
            and l.get("lesson_uid") != live[l["lesson_id"]]["lesson_uid"]
        ]
        assert wrong == [], f"manifest code→uid disagrees with the loader: {wrong}"

    def test_display_only_lessons_are_a_named_ratchet(self):
        """A 重點表 that renders `display_only` hands the student a filled-in
        answer key and nothing to answer — the failure #2749's gate was the only
        thing to catch (2026-08-17: v3 served five empty display rows and every
        other gate was green). Rebuilding the manifest re-baselines it, which is
        also how such a regression would get laundered into the baseline, so each
        display_only lesson has to be named here to be allowed through."""
        from keypoints_manifest_verify import DISPLAY_ONLY_LESSONS

        manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        found = {
            l["lesson_id"]
            for l in manifest["lessons"]
            if (l.get("layout") or {}).get("mode") == "display_only"
        }
        assert found - DISPLAY_ONLY_LESSONS == set(), (
            f"un-named display_only lessons: {sorted(found - DISPLAY_ONLY_LESSONS)} — "
            "the student sees the answer key and cannot answer. Fix the lesson, or "
            "add it to DISPLAY_ONLY_LESSONS with the reason."
        )
        assert DISPLAY_ONLY_LESSONS - found == set(), (
            f"DISPLAY_ONLY_LESSONS names lessons that are now interactive: "
            f"{sorted(DISPLAY_ONLY_LESSONS - found)} — delete them so the ratchet tightens."
        )
