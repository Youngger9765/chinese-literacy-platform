"""Shim — canonical module lives in backend/app/services/story_structure_qa_lib.py."""

from __future__ import annotations

import sys
from pathlib import Path

_BACKEND = Path(__file__).resolve().parents[1] / "backend"
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from app.services.story_structure_qa_lib import *  # noqa: F403
