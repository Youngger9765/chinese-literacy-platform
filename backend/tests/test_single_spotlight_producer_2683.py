"""聚光燈只能有一條產出路徑 (#2683).

Three existed. Two were dead and one of them was still in the tree, which is how a
reader ends up believing there is a choice to make:

    A  build_lesson_schema.py → spotlight.yml → uid tree     ← live, all 175 lessons
    B  ai-lesson-extract skill → _ai_lessons/*.lesson.yml    ← 9 lessons, data removed
                                                               in the re-ink (b5190178)
    C  structure_spotlight_with_gemini.py                    ← REMOVED here

C read `_reparsed_2026-05-02/`, a first-edition directory the re-ink deleted, and wrote
to a folder nobody reads. Reverse audit before removing it: zero callers; its only
consumer, merge_reparsed_to_prod.py, has zero callers too and the same missing input.
Positive control on the same search — `build_lesson_schema` — returned 40 files, so the
zero was a real zero.

This asserts C stays gone, and that no new producer appears without the comparison being
made deliberately.
"""

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent


def test_the_retired_gemini_producer_is_not_back():
    assert not (ROOT / "scripts" / "structure_spotlight_with_gemini.py").exists(), (
        "structure_spotlight_with_gemini.py is back — it reads _reparsed_2026-05-02/, "
        "which the re-ink deleted"
    )


def test_nothing_reads_the_first_edition_reparse_directory():
    """Its input is gone, so anything still reading it is dead code that looks alive."""
    if not (ROOT / ".git").exists():
        return
    out = subprocess.run(
        ["grep", "-rl", "_reparsed_2026-05-02", "--exclude-dir=.git",
         "--exclude-dir=node_modules", "--exclude-dir=.venv",
         "--exclude-dir=__pycache__", "."],
        cwd=ROOT, capture_output=True, text=True,
    )
    # This file names the directory in order to check for it, so it excludes itself.
    # The first version counted its own source AND its compiled .pyc — a search that
    # finds its own artefacts reports a number that has nothing to do with the code.
    here = os.path.basename(__file__)
    readers = [l for l in out.stdout.splitlines() if l.strip() and here not in l]
    # Three scripts still reference it and have zero callers themselves. Recorded rather
    # than deleted, because removing them was not what was asked for; the number must
    # not GROW.
    assert len(readers) <= 3, (
        f"{len(readers)} files read a directory that does not exist: {readers}"
    )


def test_the_live_producer_is_the_one_that_is_wired():
    """Positive control. Without it, the two assertions above would pass in a repo with
    no spotlight pipeline at all."""
    assert (ROOT / "scripts" / "build_lesson_schema.py").exists()
    assert (ROOT / "scripts" / "build_lesson_uid_tree.py").exists()
