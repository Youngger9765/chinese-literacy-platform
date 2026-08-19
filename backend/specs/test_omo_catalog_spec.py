"""Spec: the OMO lesson catalogue the platform loads is intact (#2746).

`curriculum-drift-check.yml` nominally watched `backend/data/` for drift against the
professor's source. It never could — the source is a gitignored snapshot and the version
it names (`2026-05-01`) no longer exists on any machine — so it skipped and reported
success on every run. Deleting it is right, but half of what it *claimed* to watch is
still live and would then have nothing on it at all:

    backend/data/curriculum/lessons/G*-L*.yml   → omo_lesson_catalog._load_omo_lessons()
                                                → omo_identifier / omo_title_matching

Drift-against-source is unanswerable for those files now, by anyone, in any environment:
the source they were generated from is gone. What is answerable in-repo is that the
catalogue is still there and still has the fields OMO indexes on — which is the realistic
failure now that nothing regenerates it (a rename, a cleanup, an empty directory).

⚠️ This does not claim the catalogue is *correct*. It is first-edition data, and the
resolution ratchet below records how much of it no longer points at a served lesson.
"""

import sys
from pathlib import Path

_BACKEND = Path(__file__).resolve().parents[1]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from app.services.lesson_loader import get_lesson_by_code  # noqa: E402
from app.services.omo_lesson_catalog import _load_omo_lessons  # noqa: E402

# 148 entries load today. The floor is well below that so an intentional curation change
# does not fail the build, while an emptied or renamed directory does.
MIN_CATALOG_ENTRIES = 120

# How many catalogue codes still resolve to a lesson the platform serves: 126 of 148.
#
# A ratchet — it may rise, never fall. The 22 that do not resolve are first-edition codes
# the re-ink renumbered; OMO identifies a photographed worksheet through this catalogue,
# so those 22 resolve to nothing or to another lesson. That is a real content-identity
# defect, reported separately, NOT something this spec blesses. It is pinned so it cannot
# quietly get worse, and so fixing it forces the number here up.
MIN_CODES_RESOLVING = 126


def _catalog():
    lessons = _load_omo_lessons()
    assert lessons, "OMO catalogue loaded nothing — omo_identifier has no lessons to match against"
    return lessons


def test_the_catalogue_omo_matches_against_is_still_there():
    lessons = _catalog()
    assert len(lessons) >= MIN_CATALOG_ENTRIES, (
        f"OMO catalogue has {len(lessons)} entries (floor {MIN_CATALOG_ENTRIES}) — "
        "backend/data/curriculum/lessons/ may have been emptied or renamed"
    )


def test_every_catalogue_entry_has_the_fields_omo_indexes_on():
    """`lesson_code` and `title` are what the identifier and the title matcher read. An
    entry missing either is not a candidate — it is a silent hole in the match space."""
    lessons = _catalog()
    no_code = [l for l in lessons if not (l.get("lesson_code") or "").strip()]
    no_title = [l for l in lessons if not (l.get("title") or "").strip()]
    assert no_code == [], f"{len(no_code)} catalogue entries have no lesson_code"
    assert no_title == [], f"{len(no_title)} catalogue entries have no title"


def test_catalogue_codes_resolving_to_a_served_lesson_only_goes_up():
    lessons = _catalog()
    codes = [l["lesson_code"] for l in lessons if l.get("lesson_code")]
    resolving = sum(1 for c in codes if get_lesson_by_code(c))
    assert resolving >= MIN_CODES_RESOLVING, (
        f"only {resolving} of {len(codes)} OMO catalogue codes resolve to a served lesson "
        f"(was {MIN_CODES_RESOLVING}) — a renumber or a catalogue edit made OMO's match "
        "space smaller"
    )
