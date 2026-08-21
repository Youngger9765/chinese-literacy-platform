"""Spec: the spotlight QA manifest must describe the lessons the platform serves (#2747).

The admin dashboard reported 7/7 pass, 0 fail. Those seven were the first edition's dev7
fixtures, the snapshot was last refreshed in `5d371855`, and the only path that could
regenerate it — `build_spotlight_manifest()` — died on a FileNotFoundError, because its
gold lived in `backend/data/lessons/spotlight/dev7/`, a directory the re-ink deleted.
`get_spotlight_lesson('G6-L22')` returned `overall_pass: True` with `spotlight: None`.

Same shape as #2749: a green light coming from a checked-in file that nobody can recompute.
The rule is the same one — the gate compares against what is served, and the baseline must
be rebuildable, or it will be deleted the first time it is inconvenient.

Module spec: specs/modules/spotlight_v2/INTENT.md
"""

import sys
from pathlib import Path

_BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from app.services.curriculum_qa_spotlight import (  # noqa: E402
    build_spotlight_manifest,
    get_spotlight_lesson,
    load_spotlight_manifest,
)
from app.services.lesson_loader import get_all_lessons  # noqa: E402


def _served_with_spotlight():
    return [l for l in get_all_lessons() if l.get("spotlight_v2")]


class TestSpotlightManifestDescribesWhatIsServed:
    def test_the_builder_runs_without_the_deleted_first_edition_fixtures(self):
        manifest = build_spotlight_manifest()
        assert manifest["summary"]["total"] > 100, manifest["summary"]

    def test_the_committed_manifest_matches_the_served_corpus(self):
        from app.services.curriculum_qa_spotlight import verify_spotlight_manifest

        errors = verify_spotlight_manifest()
        assert errors == [], "spotlight manifest stale vs runtime:\n" + "\n".join(
            f"  - {e}" for e in errors
        )

    def test_every_manifest_entry_resolves_to_a_lesson_that_serves_a_spotlight(self):
        """The failure this spec exists for: an entry whose `overall_pass` is True while
        the lesson it names serves nothing. A pass about a lesson that is not there is
        worse than no entry — it is counted in the summary the dashboard shows."""
        manifest = load_spotlight_manifest()
        served = {l["lesson_uid"] for l in _served_with_spotlight()}
        orphans = [
            e["lesson_id"] for e in manifest["lessons"] if e.get("lesson_uid") not in served
        ]
        assert orphans == [], f"manifest entries with no served spotlight: {orphans}"

    def test_the_detail_endpoint_returns_the_spotlight_it_reports_on(self):
        sample = _served_with_spotlight()[0]
        detail = get_spotlight_lesson(sample["lesson_uid"])
        assert detail is not None, f"{sample['lesson_uid']} missing from the manifest"
        assert detail.get("spotlight"), (
            f"{sample['lesson_uid']}: overall_pass={detail.get('overall_pass')} but the "
            "spotlight itself is empty — the verdict describes nothing"
        )

    def test_a_lesson_that_stopped_serving_a_spotlight_has_to_be_named(self):
        """Rebuilding re-baselines every verdict, which is also how a lesson whose
        extraction broke would drop out silently and leave the summary looking healthy.
        A served lesson with no spotlight must be named, and a name that has been fixed
        must be deleted — the list only shrinks."""
        from app.services.curriculum_qa_spotlight import LESSONS_WITHOUT_SPOTLIGHT

        missing = {
            l["lesson_uid"] for l in get_all_lessons() if not l.get("spotlight_v2")
        }
        assert missing - set(LESSONS_WITHOUT_SPOTLIGHT) == set(), (
            f"lessons serving no spotlight and not named: {sorted(missing - set(LESSONS_WITHOUT_SPOTLIGHT))}"
        )
        assert set(LESSONS_WITHOUT_SPOTLIGHT) - missing == set(), (
            f"named as missing but now serving one: {sorted(set(LESSONS_WITHOUT_SPOTLIGHT) - missing)} "
            "— delete the entry so the ratchet tightens"
        )
