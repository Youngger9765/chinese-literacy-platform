"""Path-injection regression lock for curriculum_qa_service (#3955).

`read_preview_html(lesson_id)` and `read_snapshot_json(lesson_id, name)` built
a filesystem path directly from a caller-supplied `lesson_id` with zero
validation (`_QA_ROOT / "previews" / lesson_id / "original.html"`). A
`lesson_id` containing `..` segments can walk the resulting path out of the
intended `previews/` / `snapshots/` tree and read a file elsewhere on disk
whose name happens to match the hardcoded filename ("original.html" /
a given snapshot name).

These tests monkeypatch `_QA_ROOT` to a throwaway `tmp_path` tree so the
traversal primitive is proven directly, independent of whatever currently
happens to sit on disk next to the real `curriculum_qa/` directory.

Proven red on the pre-fix code: `read_preview_html("../../secret")` returned
the contents of `<tmp_path>/secret/original.html`, a file entirely outside
`previews/`.
"""
from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest

from app.services import curriculum_qa_service as svc

TRAVERSAL_LESSON_IDS = [
    "..",
    "../..",
    "../secret",
    "../../secret",
    "../../../etc",
    "G8-L11/../../secret",
]


@pytest.fixture
def qa_root(tmp_path, monkeypatch):
    root = tmp_path / "curriculum_qa"
    (root / "previews" / "G8-L11").mkdir(parents=True)
    (root / "previews" / "G8-L11" / "original.html").write_text(
        "<p>real lesson</p>", encoding="utf-8"
    )
    (root / "snapshots" / "G8-L11").mkdir(parents=True)
    (root / "snapshots" / "G8-L11" / "keypoints.json").write_text(
        json.dumps({"ok": True}), encoding="utf-8"
    )

    # The traversal target: a file that sits OUTSIDE `previews/` and
    # `snapshots/` (one level above `root`), named exactly what the service
    # would try to read if a `..`-laden lesson_id reached it unvalidated.
    secret_dir = tmp_path / "secret"
    secret_dir.mkdir()
    (secret_dir / "original.html").write_text("<p>TOP SECRET</p>", encoding="utf-8")
    (secret_dir / "keypoints.json").write_text(
        json.dumps({"leaked": True}), encoding="utf-8"
    )

    monkeypatch.setattr(svc, "_QA_ROOT", root)
    return root


class TestReadPreviewHtmlPathInjection:
    def test_traversal_lesson_id_returns_none(self, qa_root):
        for bad in TRAVERSAL_LESSON_IDS:
            assert svc.read_preview_html(bad) is None, bad

    def test_real_lesson_id_still_resolves(self, qa_root):
        # Positive control: the fix must not break the happy path.
        assert svc.read_preview_html("G8-L11") == "<p>real lesson</p>"


class TestReadSnapshotJsonPathInjection:
    def test_traversal_lesson_id_returns_none(self, qa_root):
        for bad in TRAVERSAL_LESSON_IDS:
            assert svc.read_snapshot_json(bad, "keypoints.json") is None, bad

    def test_real_lesson_id_still_resolves(self, qa_root):
        assert svc.read_snapshot_json("G8-L11", "keypoints.json") == {"ok": True}


class TestLessonIdRegexAcceptsRealShapes:
    """The manifest/previews/snapshots trees use grade codes G4-G9 plus the
    CJK categories 文 (classical) and 體 — confirm the validator accepts the
    real shapes it has to keep serving, not just that it rejects attacks."""

    @pytest.mark.parametrize(
        "lesson_id", ["G4-L1", "G4-L27", "G9-L20", "文-L9", "體-L1"]
    )
    def test_accepts_real_lesson_id_shapes(self, lesson_id):
        assert svc._LESSON_ID_RE.fullmatch(lesson_id), lesson_id
