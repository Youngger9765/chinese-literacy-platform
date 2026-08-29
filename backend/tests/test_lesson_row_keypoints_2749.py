"""The assembled lesson row must actually carry the 重點表 it says it carries.

`lesson_indexes._uid_tree_lessons` built the field as
`(l.get("keypoints") or {}).get("keypoints")`. The loader has already unwrapped the
module envelope, so that asked for a `keypoints` key inside the table itself, found
nothing, and set the field to None — for all 175 lessons, with no error anywhere.
`lesson_content_loader` meanwhile carries a comment saying the 重點表 step is "served
separately on `story['keypoints']`", describing a field that was empty (#2749).

The assertions are counts and a pairing, not "at least one lesson has it": one surviving
lesson would have kept the old code green too, and a floor alone goes stale the moment
the corpus grows. The pairing — a row has the field exactly when its source module has a
table — is what stays true as lessons are added, and is derived from the source rather
than from the row being checked.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.lesson_loader import get_all_lessons  # noqa: E402
from app.services.lesson_uid_loader import load_all  # noqa: E402

# Lessons whose worksheet has a 重點表 at all. 150 of 175 today; the floor is what the
# pairing test needs in order to mean something (it holds vacuously at zero).
MIN_LESSONS_WITH_KEYPOINTS = 140


def _source_keypoints_uids() -> set[str]:
    return {l["lesson_uid"] for l in load_all() if l.get("keypoints")}


def _row_keypoints_uids() -> set[str]:
    return {l["lesson_uid"] for l in get_all_lessons() if l.get("keypoints")}


def test_the_corpus_has_not_quietly_stopped_carrying_keypoints():
    rows = _row_keypoints_uids()
    assert len(rows) >= MIN_LESSONS_WITH_KEYPOINTS, (
        f"only {len(rows)} of {len(get_all_lessons())} lessons carry a keypoints table "
        f"(expected at least {MIN_LESSONS_WITH_KEYPOINTS}) — the row builder is dropping it"
    )


def test_a_row_carries_keypoints_exactly_when_its_source_module_does():
    source, rows = _source_keypoints_uids(), _row_keypoints_uids()
    assert source, "no lesson module carries keypoints — the loader, not the row builder"
    assert sorted(source - rows) == [], (
        f"source has a 重點表 but the row dropped it: {sorted(source - rows)}"
    )
    assert sorted(rows - source) == [], (
        f"row carries a 重點表 its source module does not have: {sorted(rows - source)}"
    )


def test_the_field_is_the_table_itself_not_the_module_envelope():
    """`{lesson_uid, version_id, section_no, keypoints: {...}}` is the file's shape; the
    field must hold the inner table. Serving the envelope would put a `rows` key one
    level deeper than every reader expects — present, wrong, and silent."""
    row = next(l for l in get_all_lessons() if l.get("keypoints"))
    keypoints = row["keypoints"]
    assert isinstance(keypoints, dict), type(keypoints)
    assert "rows" in keypoints, f"not the table itself: {sorted(keypoints)}"
    assert "lesson_uid" not in keypoints, f"still wrapped in the module envelope: {sorted(keypoints)}"


def test_keypoints_and_the_served_table_come_as_a_pair():
    """`story_structure_table` is converted from this same source. A lesson with one and
    not the other means the two readers disagree about what the lesson has."""
    lessons = get_all_lessons()
    mismatched = [
        l["lesson_uid"] for l in lessons
        if bool(l.get("keypoints")) != bool(l.get("story_structure_table"))
    ]
    assert mismatched == [], f"keypoints present without a served table, or vice versa: {mismatched}"
