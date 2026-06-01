"""Make `app` importable for spec files regardless of pytest invocation cwd.

CI runs `cd backend && python -m pytest specs/` (backend on sys.path), but this
keeps `pytest backend/specs/` working from the repo root too.
"""
import sys
from pathlib import Path

_BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))
