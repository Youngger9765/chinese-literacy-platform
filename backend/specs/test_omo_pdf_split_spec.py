"""
Spec: omo-pdf-split — PDF render constants and per-page JPEG contracts.

Canonical source: backend/app/services/omo_pdf_split.py
Related issue: #1976
Module spec: specs/modules/omo-pdf-split/INTENT.md

These tests are pure-function, no DB, no AI.
"""

import inspect
import io
import sys
import types
from pathlib import Path

# Make app importable regardless of invocation cwd
_BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

import pytest
from PIL import Image

try:
    import pypdfium2  # noqa: F401
    _PDFIUM_AVAILABLE = True
except ModuleNotFoundError:
    _PDFIUM_AVAILABLE = False

    def _missing_pdfium_document(*_args, **_kwargs):
        raise ModuleNotFoundError("No module named 'pypdfium2'")

    sys.modules["pypdfium2"] = types.SimpleNamespace(
        PdfDocument=_missing_pdfium_document,
    )

from app.services.omo_pdf_split import (
    _JPEG_QUALITY,
    _RENDER_SCALE,
    pdf_to_jpeg_pages,
)
from app.services.omo_upload_validator import MAX_FILES_PER_UPLOAD


# ---------------------------------------------------------------------------
# I-1: Render constants match the OCR-oriented PDF conversion contract
# ---------------------------------------------------------------------------

class TestPdfRenderConstants:
    def test_render_scale_and_jpeg_quality(self):
        assert _RENDER_SCALE == 150.0 / 72.0
        assert _JPEG_QUALITY == 85

    def test_default_max_pages_matches_upload_cap(self):
        signature = inspect.signature(pdf_to_jpeg_pages)
        assert signature.parameters["max_pages"].default == 20
        assert signature.parameters["max_pages"].default == MAX_FILES_PER_UPLOAD


# ---------------------------------------------------------------------------
# I-2: Real multi-page PDFs render into JPEG page blobs
# ---------------------------------------------------------------------------

class TestPdfToJpegPages:
    def test_real_multi_page_pdf_renders_to_jpeg_pages(self):
        if not _PDFIUM_AVAILABLE:
            pytest.xfail("pypdfium2 is unavailable in this test environment")
        first = Image.new("RGB", (120, 160), "white")
        second = Image.new("RGB", (120, 160), "lightgray")
        third = Image.new("RGB", (120, 160), "white")
        buf = io.BytesIO()
        first.save(buf, format="PDF", save_all=True, append_images=[second, third])

        pages = pdf_to_jpeg_pages(buf.getvalue(), max_pages=MAX_FILES_PER_UPLOAD)

        assert 0 < len(pages) <= MAX_FILES_PER_UPLOAD
        assert len(pages) == 3
        assert all(page.startswith(b"\xff\xd8") for page in pages)
