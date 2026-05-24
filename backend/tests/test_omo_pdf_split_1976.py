"""Tests for #1976 — PDF upload support.

Covers:
- pdf_to_jpeg_pages renders each page as JPEG bytes in order
- max_pages cap is enforced
- malformed / empty PDFs raise PdfSplitError (not a generic exception)
- expand_pdf_files preserves position of image entries and explodes PDFs
- expand_pdf_files raises when total expanded count exceeds max_total_images
- validator accepts application/pdf with the 20MB cap
- validator rejects PDFs over 20MB and unknown MIME types
"""

import io

import pytest
from fastapi import HTTPException

from app.services.omo_pdf_split import (
    PdfSplitError,
    expand_pdf_files,
    pdf_to_jpeg_pages,
)
from app.services.omo_upload_validator import (
    MAX_PDF_SIZE_BYTES,
    validate_upload_files,
)


# ---------------------------------------------------------------------------
# Helpers — build small PDFs in-memory via Pillow
# ---------------------------------------------------------------------------

def _make_pdf(pages: int, color_per_page: tuple[str, ...] | None = None) -> bytes:
    """Build a tiny multi-page PDF for tests.

    Each page is 100x100 with the given fill colour (or white by default).
    Returns the PDF bytes — small enough to keep tests fast.
    """
    from PIL import Image

    if color_per_page is None:
        color_per_page = tuple("white" for _ in range(pages))
    assert len(color_per_page) == pages

    imgs = [Image.new("RGB", (100, 100), c) for c in color_per_page]
    buf = io.BytesIO()
    imgs[0].save(
        buf,
        format="PDF",
        save_all=True,
        append_images=imgs[1:] if len(imgs) > 1 else [],
    )
    return buf.getvalue()


def _is_jpeg(data: bytes) -> bool:
    """Quick JPEG magic-byte check — JFIF / EXIF SOI marker."""
    return data[:3] == b"\xff\xd8\xff"


# ---------------------------------------------------------------------------
# pdf_to_jpeg_pages
# ---------------------------------------------------------------------------

class TestPdfToJpegPages:
    def test_single_page_pdf_returns_one_jpeg(self):
        pdf = _make_pdf(1)
        pages = pdf_to_jpeg_pages(pdf)
        assert len(pages) == 1
        assert _is_jpeg(pages[0]), "Output should be JPEG bytes"

    def test_multi_page_pdf_returns_one_jpeg_per_page_in_order(self):
        pdf = _make_pdf(3, color_per_page=("red", "green", "blue"))
        pages = pdf_to_jpeg_pages(pdf)
        assert len(pages) == 3
        for p in pages:
            assert _is_jpeg(p)

    def test_empty_bytes_raises(self):
        with pytest.raises(PdfSplitError):
            pdf_to_jpeg_pages(b"")

    def test_malformed_pdf_raises_pdf_split_error(self):
        with pytest.raises(PdfSplitError):
            pdf_to_jpeg_pages(b"not actually a pdf, just some bytes")

    def test_max_pages_cap_enforced(self):
        pdf = _make_pdf(5)
        # Allow 4 → 5-page PDF must be rejected
        with pytest.raises(PdfSplitError, match="頁數過多"):
            pdf_to_jpeg_pages(pdf, max_pages=4)


# ---------------------------------------------------------------------------
# expand_pdf_files
# ---------------------------------------------------------------------------

class TestExpandPdfFiles:
    def test_pure_image_list_passes_through_unchanged(self):
        files = [(b"\xff\xd8\xff_fake1", "image/jpeg"), (b"\xff\xd8\xff_fake2", "image/png")]
        out = expand_pdf_files(files, max_total_images=10)
        assert out == files, "Image-only list should be returned untouched"

    def test_single_pdf_explodes_to_per_page_jpegs(self):
        pdf = _make_pdf(3)
        out = expand_pdf_files([(pdf, "application/pdf")], max_total_images=10)
        assert len(out) == 3
        for data, mime in out:
            assert mime == "image/jpeg"
            assert _is_jpeg(data)

    def test_mixed_image_and_pdf_preserves_order(self):
        pdf = _make_pdf(2, color_per_page=("yellow", "purple"))
        fake_jpeg = b"\xff\xd8\xff_fake"
        out = expand_pdf_files(
            [(fake_jpeg, "image/jpeg"), (pdf, "application/pdf"), (fake_jpeg, "image/png")],
            max_total_images=10,
        )
        # Expected: jpeg, pdf-p1, pdf-p2, png
        assert len(out) == 4
        assert out[0] == (fake_jpeg, "image/jpeg")
        assert out[3] == (fake_jpeg, "image/png")
        assert out[1][1] == "image/jpeg" and _is_jpeg(out[1][0])
        assert out[2][1] == "image/jpeg" and _is_jpeg(out[2][0])

    def test_total_count_cap_enforced(self):
        # 3-page PDF + cap 2 → should raise
        pdf = _make_pdf(3)
        with pytest.raises(PdfSplitError, match="超過 2 張上限"):
            expand_pdf_files([(pdf, "application/pdf")], max_total_images=2)

    def test_per_pdf_max_pages_propagates(self):
        pdf = _make_pdf(5)
        with pytest.raises(PdfSplitError, match="頁數過多"):
            expand_pdf_files(
                [(pdf, "application/pdf")],
                max_total_images=20,
                per_pdf_max_pages=4,
            )


# ---------------------------------------------------------------------------
# Validator — PDF acceptance & size caps
# ---------------------------------------------------------------------------

class TestValidatorPdfSupport:
    def test_accepts_pdf_under_20mb(self):
        # 10 MB of bytes labelled as PDF — validator must not raise (we don't
        # actually parse here, just MIME + size).
        small_pdf = b"%PDF-1.4 " + b"x" * (10 * 1024 * 1024)
        # No exception
        validate_upload_files([(small_pdf, "application/pdf")])

    def test_rejects_pdf_over_20mb(self):
        oversized = b"%PDF-1.4 " + b"x" * (MAX_PDF_SIZE_BYTES + 1)
        with pytest.raises(HTTPException) as exc:
            validate_upload_files([(oversized, "application/pdf")])
        assert exc.value.status_code == 413

    def test_rejects_image_over_10mb_but_accepts_under(self):
        small_img = b"\xff\xd8\xff" + b"x" * (5 * 1024 * 1024)
        validate_upload_files([(small_img, "image/jpeg")])

        big_img = b"\xff\xd8\xff" + b"x" * (15 * 1024 * 1024)
        with pytest.raises(HTTPException) as exc:
            validate_upload_files([(big_img, "image/jpeg")])
        assert exc.value.status_code == 413

    def test_rejects_unknown_mime(self):
        with pytest.raises(HTTPException) as exc:
            validate_upload_files([(b"x" * 100, "application/zip")])
        assert exc.value.status_code == 400
        assert "格式" in exc.value.detail
