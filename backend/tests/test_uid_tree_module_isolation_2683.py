"""Rebuilding one module must not delete the others (#2683).

REPRODUCED before fixing, on a copy of a real lesson directory:

    L0001/v2 in:   assets body.yml key_reading.yml keypoints.yml
                   lesson.yml metadata.yml sections.yml spotlight.yml
    after the two lines `if dest.exists(): shutil.rmtree(dest)`:  (empty)

`build_lesson_uid_tree.py` cleared the whole version directory before writing. That was
safe when spotlight, keypoints and assets were the only things in it. They are not:
body.yml, sections.yml, metadata.yml and key_reading.yml come from separate extractors
over the same DOCX, and assets/ also holds the cover produced by a different script
again. A re-run deleted all of them, and the tree still looked populated because the
pipeline immediately wrote three files back.

Impact: any re-run of the documented tree builder — 175 lessons — silently loses
課文, 生字, 語詞應用, 閱讀理解, 課程簡介, 影片, 重點朗讀 and every cover.

The fix is not "delete less". It is that each module is repairable on its own, so
`--module spotlight` rebuilds the spotlight and touches nothing else.
"""

import os
import shutil
import sys
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "scripts"))

import pytest

import build_lesson_uid_tree as T

#: Everything a lesson directory can hold. The first four belong to other extractors.
OTHERS = ("body.yml", "sections.yml", "metadata.yml", "key_reading.yml")
OWNED = ("spotlight.yml", "keypoints.yml")


@pytest.fixture
def lesson_dir(tmp_path):
    d = tmp_path / "L9999" / "v2"
    (d / "assets").mkdir(parents=True)
    for name in OTHERS + OWNED + ("lesson.yml",):
        (d / name).write_text(f"# {name}\n", encoding="utf-8")
    (d / "assets" / "thumbnail.webp").write_bytes(b"cover")
    (d / "assets" / "fig1.png").write_bytes(b"figure")
    return d


def test_clearing_one_module_leaves_every_other_file(lesson_dir):
    for module in ("spotlight", "keypoints"):
        T._clear_module(lesson_dir, module)

    for name in OTHERS:
        assert (lesson_dir / name).exists(), f"{name} was deleted by a spotlight rebuild"
    assert (lesson_dir / "lesson.yml").exists()
    for name in OWNED:
        assert not (lesson_dir / name).exists(), f"{name} should have been cleared"


def test_clearing_assets_keeps_the_cover(lesson_dir):
    """assets/ is shared: figures come from this pipeline, thumbnail.webp from
    reuse_lesson_thumbnails.py. Clearing the directory took all 175 covers."""
    T._clear_module(lesson_dir, "assets")
    assert (lesson_dir / "assets" / "thumbnail.webp").exists(), "the cover was deleted"
    assert not (lesson_dir / "assets" / "fig1.png").exists(), "figures should be cleared"


def test_no_module_can_clear_a_file_it_does_not_own(lesson_dir):
    """Run every module's clear in turn. Between them they may remove only what this
    pipeline produces — which is the invariant, rather than a list of today's files."""
    for module in T.MODULES:
        T._clear_module(lesson_dir, module)
    survivors = {p.name for p in lesson_dir.iterdir()}
    assert set(OTHERS) <= survivors, f"other extractors' output was deleted: {survivors}"
    assert (lesson_dir / "assets" / "thumbnail.webp").exists()
