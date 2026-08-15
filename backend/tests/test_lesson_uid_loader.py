"""Regression lock for the uid-tree loader (#2692).

The defect this replaces was silent: a title mismatch of one punctuation mark
made the old two-layer merge hand back an empty shell instead of failing. So
these tests care less about the happy path than about what happens when the tree
is *wrong* — a half-written directory must be treated as absent, never served
partially.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services import lesson_uid_loader as L  # noqa: E402


@pytest.fixture
def tree(tmp_path, monkeypatch):
    """A minimal uid tree, swapped in for the real LESSONS_ROOT."""
    monkeypatch.setattr(L, "LESSONS_ROOT", tmp_path)
    L.reset_cache()
    yield tmp_path
    L.reset_cache()


def _write(root: Path, uid: str, version: str, *, meta=True, spotlight=True,
           keypoints=True, assets=0) -> Path:
    d = root / uid / version
    d.mkdir(parents=True)
    if meta:
        (d / "lesson.yml").write_text(yaml.dump({
            "lesson_uid": uid, "version_id": version,
            "title": f"課文 {uid}", "catalog_slot": "G4-L1",
        }, allow_unicode=True), encoding="utf-8")
    if spotlight:
        (d / "spotlight.yml").write_text(yaml.dump({"spotlight": {"blocks": []}}),
                                         encoding="utf-8")
    if keypoints:
        (d / "keypoints.yml").write_text(yaml.dump({"keypoints": {"rows": []}}),
                                         encoding="utf-8")
    if assets:
        a = d / "assets"
        a.mkdir()
        for i in range(assets):
            (a / f"fig{i}.png").write_bytes(b"x")
    return d


def test_loads_a_complete_lesson(tree):
    _write(tree, "L0001", "v2", assets=3)
    lesson = L.load_lesson("L0001")
    assert lesson["lesson_uid"] == "L0001"
    assert lesson["version_id"] == "v2"
    assert "spotlight" in lesson and "keypoints" in lesson
    assert len(lesson["assets"]) == 3


def test_identity_comes_from_the_directory_not_the_title(tree):
    """Two lessons may share a title — 大自然的氣象小幫手 is both G4-L12 and
    G7-L17 with different strategies and Levels. They must stay distinct."""
    for uid in ("L0001", "L0002"):
        d = _write(tree, uid, "v2")
        (d / "lesson.yml").write_text(yaml.dump({
            "lesson_uid": uid, "version_id": "v2",
            "title": "大自然的氣象小幫手",          # same title on purpose
            "catalog_slot": "G4-L12" if uid == "L0001" else "G7-L17",
        }, allow_unicode=True), encoding="utf-8")
    L.reset_cache()
    assert len(L.load_all()) == 2
    assert {x["catalog_slot"] for x in L.load_all()} == {"G4-L12", "G7-L17"}


def test_highest_version_wins_by_default(tree):
    _write(tree, "L0001", "v1")
    _write(tree, "L0001", "v2")
    assert L.load_lesson("L0001")["version_id"] == "v2"


def test_explicit_version_can_pin_an_older_edition(tree):
    _write(tree, "L0001", "v1")
    _write(tree, "L0001", "v2")
    assert L.load_lesson("L0001", "v1")["version_id"] == "v1"


def test_missing_lesson_yml_is_absent_not_empty(tree):
    """Fail-closed: a half-written dir must not be served as a shell.
    Serving an empty lesson is exactly how the old two-layer merge failed."""
    _write(tree, "L0001", "v2", meta=False)
    assert L.load_lesson("L0001") is None
    assert L.load_all() == []


def test_dir_without_any_version_is_ignored(tree):
    (tree / "L0009").mkdir()
    L.reset_cache()
    assert "L0009" not in L.available_uids()


def test_non_uid_directories_are_ignored(tree):
    """The lessons root also holds _parsed_2026-05-01/, spotlight/, L01.yml …
    during the dual-path window. None of them may be mistaken for a uid."""
    for name in ("_parsed_2026-05-01", "spotlight", "_ai_lessons", "L01.yml"):
        (tree / name).mkdir()
    _write(tree, "L0001", "v2")
    L.reset_cache()
    assert L.available_uids() == ("L0001",)


def test_modules_are_optional(tree):
    """A lesson with no keypoints table is normal, not a failure."""
    _write(tree, "L0001", "v2", keypoints=False)
    lesson = L.load_lesson("L0001")
    assert "spotlight" in lesson
    assert "keypoints" not in lesson


def test_corrupt_module_yaml_does_not_take_the_lesson_down(tree):
    d = _write(tree, "L0001", "v2")
    (d / "spotlight.yml").write_text("{[not: valid", encoding="utf-8")
    L.reset_cache()
    lesson = L.load_lesson("L0001")
    assert lesson is not None            # the lesson still loads
    assert "spotlight" not in lesson     # but the broken module is dropped


# ── index invariants (#2683) ────────────────────────────────────────────────

def test_lookup_by_code_is_populated():
    """`build_indexes` keys the by-code index on `lesson_code`, and the tree rows
    only carried `grade_code` — so `_LESSONS_BY_CODE` built EMPTY and
    `get_lesson_by_code` returned None for every code in the catalogue, without
    raising. Anything resolving a lesson by its code silently found nothing."""
    from app.services.lesson_loader import _LESSONS_BY_CODE, get_all_lessons, get_lesson_by_code

    all_lessons = get_all_lessons()
    assert len(_LESSONS_BY_CODE) == len(all_lessons), (
        f"by-code index has {len(_LESSONS_BY_CODE)} of {len(all_lessons)} lessons"
    )
    sample = all_lessons[0]
    found = get_lesson_by_code(sample["grade_code"])
    assert found is not None, f"{sample['grade_code']} not resolvable by code"
    assert found["lesson_uid"] == sample["lesson_uid"]


def test_assetless_table_figures_are_stripped_at_load():
    """`inject_per_practice_figures` emits `{type: figure, referent: table,
    asset: null}` on every rebuild — 89 of 143 lessons carried them. They render to
    nothing, so every consumer would otherwise need to know to skip them."""
    from app.services.lesson_loader import get_all_lessons

    leftover = [
        (l["lesson_uid"], b)
        for l in get_all_lessons()
        for b in ((l.get("spotlight_v2") or {}).get("blocks") or [])
        if isinstance(b, dict)
        and b.get("type") == "figure"
        and b.get("referent") == "table"
        and not b.get("asset")
    ]
    assert leftover == [], f"{len(leftover)} assetless table figures survived loading"
