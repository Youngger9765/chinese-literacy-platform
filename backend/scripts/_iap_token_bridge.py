"""_iap_token_bridge.py — load the repo-root `scripts/iap_token.py` from
inside the `backend.scripts` package (#3719).

Why this indirection exists: `backend/scripts/` is itself a package named
`scripts` (it has its own `__init__.py`), and the repo-root `scripts/` dir
is a *different* `scripts` namespace. When this package is invoked the way
its own CLIs document (`python -m scripts.verify_qr_manifest` run from
`backend/`), Python registers `backend/scripts` as `sys.modules['scripts']`
— a plain `import scripts.iap_token` from here would then look for
`iap_token.py` inside `backend/scripts/`, not the repo root, and fail.

Loading the root file by path (not by package name) sidesteps the
collision entirely, so both backend scripts that live under staging/
preview URLs (`verify_qr_manifest.py`, `verify_lesson_audio.py`) can share
the one real implementation instead of duplicating its logic.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[2]
_SPEC = importlib.util.spec_from_file_location(
    "_lingoleap_iap_token", _ROOT / "scripts" / "iap_token.py"
)
assert _SPEC is not None and _SPEC.loader is not None, (
    f"scripts/iap_token.py not found at {_ROOT / 'scripts' / 'iap_token.py'}"
)
_module = importlib.util.module_from_spec(_SPEC)
# Register before exec so the loaded module can resolve its own absolute
# imports / be found by name if anything introspects sys.modules (standard
# importlib recipe) — iap_token.py has no self-referencing imports today,
# but this is the textbook-correct order regardless.
sys.modules[_SPEC.name] = _module
_SPEC.loader.exec_module(_module)

# Re-export the public surface so call sites can do
# `from scripts._iap_token_bridge import iap_header, urlopen_with_iap`.
iap_header = _module.iap_header
urlopen_with_iap = _module.urlopen_with_iap
get_iap_token = _module.get_iap_token
