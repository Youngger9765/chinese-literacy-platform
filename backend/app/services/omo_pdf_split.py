"""OMO PDF split — render a PDF into per-page JPEG bytes.

Issue #1976: scanner / copier output for paper worksheets is most often a
multi-page PDF (Adobe Scan, iOS Notes, office MFPs). The existing OMO
pipeline only accepts JPEG/PNG/WebP, so users had to manually export each
page first. This module lets the upload route fan a single PDF out into the
same per-page-image flow the rest of the pipeline already supports.

Design:
- Pure function: bytes-in, list[bytes]-out. No I/O, no GCS, no DB.
- Renders at ~150 DPI (`_RENDER_SCALE`) — enough resolution for Gemini OCR
  on student handwriting without bloating downstream image sizes.
- Output JPEG quality 85 — same target the existing client-side resize uses.
- Caller is responsible for enforcing per-page count caps (we just expose
  the helper); we surface `len(result)` so the route can compare against
  `MAX_FILES_PER_UPLOAD`.

Backend uses `pypdfium2` (PDFium binding, Apache-2.0 + BSD3) — pure-Python
wheel, no native libpoppler dependency, Cloud Run friendly.
"""

import io
import logging

# Fail-fast at import time rather than per-request. Both deps are listed in
# requirements.txt; a missing import here means the Cloud Run image is broken
# and should surface immediately on startup. Pillow itself is imported only
# to assert it's installed — pypdfium2's ``.to_pil()`` uses it internally.
import pypdfium2 as pdfium
import PIL  # noqa: F401 — presence check; .to_pil() needs it at runtime

logger = logging.getLogger(__name__)

# 150 DPI rendering scale (PDFium's render_scale uses 72 DPI baseline).
# 150/72 ≈ 2.083 — empirically enough resolution for Chinese handwriting OCR
# without producing huge JPEGs.
_RENDER_SCALE: float = 150.0 / 72.0

# JPEG quality for rendered pages (matches client-side resize quality).
_JPEG_QUALITY: int = 85


class PdfSplitError(ValueError):
    """Raised when a PDF cannot be parsed or rendered to images."""


def pdf_to_jpeg_pages(pdf_bytes: bytes, max_pages: int = 20) -> list[bytes]:
    """Render every page of a PDF to JPEG bytes.

    Parameters
    ----------
    pdf_bytes:
        Raw PDF file content.
    max_pages:
        Refuse to render past this many pages — caller is responsible for
        deciding what page count is reasonable for a worksheet (default 20
        matches the upload route's ``MAX_FILES_PER_UPLOAD`` ceiling).

    Returns
    -------
    list[bytes]
        One JPEG image per PDF page, in page order.

    Raises
    ------
    PdfSplitError
        If the PDF cannot be opened, has zero pages, exceeds ``max_pages``,
        or any page fails to render.
    """
    if not pdf_bytes:
        raise PdfSplitError("PDF is empty")

    try:
        pdf = pdfium.PdfDocument(pdf_bytes)
    except Exception as exc:
        # pypdfium2 raises various OSError / PdfiumError flavours for malformed
        # PDFs. Normalise to PdfSplitError so callers handle one exception type.
        raise PdfSplitError(f"無法解析 PDF：{exc}") from exc

    try:
        page_count = len(pdf)
        if page_count == 0:
            raise PdfSplitError("PDF 沒有任何頁面")
        if page_count > max_pages:
            raise PdfSplitError(
                f"PDF 頁數過多（{page_count} 頁），最多支援 {max_pages} 頁",
            )

        pages: list[bytes] = []
        for page_index in range(page_count):
            try:
                page = pdf[page_index]
                pil_image = page.render(scale=_RENDER_SCALE).to_pil()
                if pil_image.mode != "RGB":
                    pil_image = pil_image.convert("RGB")
                buf = io.BytesIO()
                pil_image.save(buf, format="JPEG", quality=_JPEG_QUALITY)
                pages.append(buf.getvalue())
            except PdfSplitError:
                raise
            except Exception as exc:
                raise PdfSplitError(
                    f"第 {page_index + 1} 頁無法轉換成圖片：{exc}",
                ) from exc

        logger.info(
            "omo_pdf_split: rendered %d page(s) (avg=%d KB/page)",
            page_count,
            sum(len(p) for p in pages) // (page_count * 1024) if page_count else 0,
        )
        return pages
    finally:
        # Release PDFium native handles promptly. Best-effort: a leaked
        # document on the error path is acceptable, but normal flow should
        # close.
        try:
            pdf.close()
        except Exception:
            pass


# MIME constant duplicated from omo_upload_validator to avoid a circular import
# (validator → pdf_split via expand_pdf_files). Kept private; the
# canonical source is omo_upload_validator._PDF_MIME_TYPE.
_PDF_MIME_TYPE = "application/pdf"


def expand_pdf_files(
    files_data: list[tuple[bytes, str]],
    max_total_images: int,
    per_pdf_max_pages: int = 20,
) -> list[tuple[bytes, str]]:
    """Expand any ``application/pdf`` entries into their per-page JPEGs.

    Image entries pass through untouched, preserving their position in the
    overall sequence. PDF entries are replaced in place by their N page
    JPEGs, so the page order matches the original document.

    Parameters
    ----------
    files_data:
        Validated list of (raw_bytes, content_type) tuples — typically the
        output of ``validate_upload_files``.
    max_total_images:
        Cap on the total number of resulting image entries. When PDFs
        expand past this, raise PdfSplitError — the route turns that into
        a 400 with friendly copy.
    per_pdf_max_pages:
        Per-PDF page cap (passed straight to ``pdf_to_jpeg_pages``).

    Returns
    -------
    list[tuple[bytes, str]]
        All-image entries — every tuple's MIME is one of the original
        image MIMEs or ``image/jpeg`` for PDF-derived pages.

    Raises
    ------
    PdfSplitError
        If a PDF fails to render or total expanded count exceeds
        ``max_total_images``.
    """
    expanded: list[tuple[bytes, str]] = []
    for data, mime in files_data:
        if mime == _PDF_MIME_TYPE:
            page_jpegs = pdf_to_jpeg_pages(data, max_pages=per_pdf_max_pages)
            expanded.extend((page, "image/jpeg") for page in page_jpegs)
        else:
            expanded.append((data, mime))

        if len(expanded) > max_total_images:
            raise PdfSplitError(
                f"展開後共 {len(expanded)} 張，超過 {max_total_images} 張上限",
            )
    return expanded
