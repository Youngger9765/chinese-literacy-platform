"""OMO image preprocessing — splits 2-page worksheet spreads into single pages.

Extracted from omo_grader.py (issue #1879).

Responsibilities:
  - _split_spread: detects landscape scanner output (2 facing pages joined) and
    splits into left/right halves so the OCR model can attend to each page
    independently. Falls back to original on any error (fail-open). (#1717)
"""

import io
import logging

logger = logging.getLogger(__name__)


def _split_spread(image_bytes: bytes, mime: str) -> list[tuple[bytes, str]]:
    """Split a 2-page worksheet spread into single-page halves (#1717).

    Many scanners output a single image containing two facing worksheet pages
    (e.g. Sharp MX-M4050 default). Sending the spread as one image forces the
    OCR model to attend across the spine, which hurts letter-position accuracy.
    Splitting into left/right halves gives each page focused attention.

    Generic policy: only split when aspect ratio suggests a landscape spread
    (width > 1.3 × height). Portrait single pages pass through untouched.
    Falls back to the original image on any error — no PDF-specific tuning.

    Returns:
        List of (bytes, mime) tuples — 1 element if single-page, 2 if spread.
    """
    try:
        from PIL import Image
    except ImportError:
        return [(image_bytes, mime)]

    try:
        img = Image.open(io.BytesIO(image_bytes))
        w, h = img.size
        if w <= h * 1.3:
            return [(image_bytes, mime)]
        mid = w // 2
        out_mime = "image/jpeg"
        halves = []
        for box in [(0, 0, mid, h), (mid, 0, w, h)]:
            half = img.crop(box)
            if half.mode != "RGB":
                half = half.convert("RGB")
            buf = io.BytesIO()
            half.save(buf, format="JPEG", quality=92)
            halves.append((buf.getvalue(), out_mime))
        return halves
    except Exception:
        return [(image_bytes, mime)]
