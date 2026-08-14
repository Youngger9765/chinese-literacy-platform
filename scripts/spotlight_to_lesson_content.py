"""Compatibility alias — the adapter now lives inside the app package.

Moved in #2680: this module is a RUNTIME dependency of
`app/services/lesson_content_loader.py`, not a standalone script. It used to sit
under `scripts/`, which `backend/Dockerfile` never COPYs (and cannot: the build
context is `./backend` while `scripts/` is one level above). In the container the
dynamic import therefore raised `No module named 'spotlight_to_lesson_content'`,
and the fail-closed path returned a null `lesson_content` for every one of the
124 lessons that had spotlight_v2 — silently, for about four months.

This file rebinds itself to the real module so `import spotlight_to_lesson_content`
keeps working for the CLI, the dry-run runner and the existing tests, including
their access to private helpers (`_make_step` etc.) that `import *` would hide.
Nothing is duplicated, so the two paths cannot drift.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from app.services import spotlight_to_lesson_content as _real  # noqa: E402

sys.modules[__name__] = _real

if __name__ == "__main__":
    raise SystemExit(_real.main())
