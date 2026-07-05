"""
Tests for URL rewriting in lesson_layer_loaders.py — issue #2486.

lingoleap-assets is going private. Every URL the backend hands to the frontend
for content in that bucket (thumbnails, worksheet PDFs/DOCX) must point at our
own `/assets/...` proxy instead of the absolute
`https://storage.googleapis.com/lingoleap-assets/...` GCS URL — otherwise those
URLs 403 the moment the bucket ACL flips.

320+ YAML source files still contain literal absolute GCS URLs for
`worksheet_pdf_url` (out of scope to hand-edit every one) — `_to_asset_proxy_url`
is the single point where those get rewritten before reaching an API response.

TDD: written before the lesson_layer_loaders.py rewrite. Red -> Green -> Refactor.
"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.lesson_layer_loaders import (
    _to_asset_proxy_url,
    _derive_docx_url,
    load_layer1_lessons,
)


class TestToAssetProxyUrl:
    def test_rewrites_absolute_gcs_url_to_relative_proxy_path(self):
        absolute = "https://storage.googleapis.com/lingoleap-assets/worksheets/G5-L23.pdf"
        assert _to_asset_proxy_url(absolute) == "/assets/worksheets/G5-L23.pdf"

    def test_rewrites_lessons_images_url(self):
        absolute = "https://storage.googleapis.com/lingoleap-assets/lessons-images/G4-L1/G4-L1-01.jpg"
        assert _to_asset_proxy_url(absolute) == "/assets/lessons-images/G4-L1/G4-L1-01.jpg"

    def test_passes_through_none(self):
        assert _to_asset_proxy_url(None) is None

    def test_passes_through_empty_string(self):
        assert _to_asset_proxy_url("") == ""

    def test_passes_through_already_relative_url_unchanged(self):
        """Idempotent — a URL already rewritten (or authored relative) is untouched."""
        assert _to_asset_proxy_url("/assets/worksheets/G5-L23.pdf") == "/assets/worksheets/G5-L23.pdf"

    def test_does_not_touch_unrelated_absolute_url(self):
        """A URL pointing somewhere else entirely (not our bucket) must not be mangled."""
        other = "https://example.com/some/other/file.pdf"
        assert _to_asset_proxy_url(other) == other


class TestDeriveDocxUrlIsRelative:
    def test_derived_docx_url_uses_asset_proxy_base(self):
        # Any grade_code from the checked-in manifest works; use a known one
        # if present, else just check the shape via a monkeypatched code set.
        import app.services.lesson_layer_loaders as loaders
        original_codes = loaders._DOCX_CODES
        try:
            loaders._DOCX_CODES = frozenset({"G4-L01"})
            url = _derive_docx_url("G4-L01")
            assert url == "/assets/worksheets/G4-L01.docx"
            assert not url.startswith("https://")
        finally:
            loaders._DOCX_CODES = original_codes

    def test_derive_docx_url_returns_none_for_unknown_code(self):
        assert _derive_docx_url("NOT-A-REAL-CODE") is None

    def test_derive_docx_url_returns_none_for_empty_code(self):
        assert _derive_docx_url("") is None
        assert _derive_docx_url(None) is None


class TestLayer1LessonsUseAssetProxyUrls:
    """Integration: the actual lesson dicts served to the frontend must never
    carry an absolute storage.googleapis.com URL after the #2486 fix."""

    def test_no_lesson_has_absolute_gcs_thumbnail_url(self):
        lessons = load_layer1_lessons()
        for lesson in lessons:
            url = lesson.get("thumbnail_url", "")
            assert not url.startswith("https://storage.googleapis.com/"), (
                f"Lesson {lesson.get('lesson_number')} thumbnail_url is still absolute: {url}"
            )

    def test_thumbnail_url_uses_asset_proxy_prefix(self):
        lessons = load_layer1_lessons()
        for lesson in lessons:
            assert lesson["thumbnail_url"].startswith("/assets/stories/thumbnails/")

    def test_no_lesson_has_absolute_gcs_worksheet_pdf_url(self):
        lessons = load_layer1_lessons()
        for lesson in lessons:
            url = lesson.get("worksheet_pdf_url")
            if url:
                assert not url.startswith("https://storage.googleapis.com/"), (
                    f"Lesson {lesson.get('lesson_number')} worksheet_pdf_url is still absolute: {url}"
                )
                assert url.startswith("/assets/worksheets/")

    def test_no_lesson_has_absolute_gcs_worksheet_docx_url(self):
        lessons = load_layer1_lessons()
        for lesson in lessons:
            url = lesson.get("worksheet_docx_url")
            if url:
                assert not url.startswith("https://storage.googleapis.com/"), (
                    f"Lesson {lesson.get('lesson_number')} worksheet_docx_url is still absolute: {url}"
                )
                assert url.startswith("/assets/worksheets/")
