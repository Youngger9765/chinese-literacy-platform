"""
Spec: omo-image-preprocess — spread splitting and fail-open contracts.

Canonical source: backend/app/services/omo_image_preprocess.py
Related issue: #1717
Module spec: specs/modules/omo-image-preprocess/INTENT.md

These tests are pure-function, no DB, no AI.
"""

import io
import sys
from pathlib import Path

# Make app importable regardless of invocation cwd
_BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from PIL import Image

from app.services.omo_image_preprocess import _split_spread


def _jpeg_bytes(width: int, height: int) -> bytes:
    image = Image.new("RGB", (width, height), "white")
    buf = io.BytesIO()
    image.save(buf, format="JPEG")
    return buf.getvalue()


# ---------------------------------------------------------------------------
# I-1: Split spread fails open on unreadable image bytes
# ---------------------------------------------------------------------------

class TestSplitSpreadFailOpen:
    def test_garbage_bytes_never_raise_and_return_original(self):
        original = b"not an image"
        assert _split_spread(original, "image/jpeg") == [(original, "image/jpeg")]


# ---------------------------------------------------------------------------
# I-2: Non-wide images pass through untouched
# ---------------------------------------------------------------------------

class TestSplitSpreadSinglePage:
    def test_normal_non_wide_image_returns_original_single_element(self):
        original = _jpeg_bytes(800, 1000)
        assert _split_spread(original, "image/jpeg") == [(original, "image/jpeg")]


# ---------------------------------------------------------------------------
# I-3: Wide spreads split into two JPEG halves
# ---------------------------------------------------------------------------

class TestSplitSpreadWideImage:
    def test_very_wide_image_returns_two_halves(self):
        original = _jpeg_bytes(2000, 600)

        halves = _split_spread(original, "image/jpeg")

        assert len(halves) == 2
        assert all(mime == "image/jpeg" for _, mime in halves)
        assert all(data.startswith(b"\xff\xd8") for data, _ in halves)
