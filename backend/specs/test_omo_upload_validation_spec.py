"""
Spec: omo-upload-validation — file size, count, and retry validation contracts.

Canonical source: backend/app/services/omo_upload_validator.py
Module spec: specs/modules/omo-upload-validation/INTENT.md

These tests are pure-function, no DB, no AI.
"""

import sys
from pathlib import Path

# Make app importable regardless of invocation cwd
_BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

import pytest
from fastapi import HTTPException

from app.services.omo_upload_validator import (
    MAX_FILE_SIZE_BYTES,
    MAX_FILES_PER_UPLOAD,
    MAX_PDF_SIZE_BYTES,
    PDF_MIME_TYPE,
    _MAX_TOTAL_ATTEMPTS,
    validate_attempt_files,
    validate_upload_files,
)


# ---------------------------------------------------------------------------
# I-1: Upload constraint constants are the single source of truth
# ---------------------------------------------------------------------------

class TestUploadConstraintConstants:
    def test_file_size_constants(self):
        assert MAX_FILE_SIZE_BYTES == 10 * 1024 * 1024
        assert MAX_PDF_SIZE_BYTES == 20 * 1024 * 1024

    def test_count_and_attempt_constants(self):
        assert MAX_FILES_PER_UPLOAD == 20
        assert _MAX_TOTAL_ATTEMPTS == 5


# ---------------------------------------------------------------------------
# I-2: New upload validation rejects invalid file lists
# ---------------------------------------------------------------------------

class TestValidateUploadFiles:
    def test_empty_file_list_raises_400(self):
        with pytest.raises(HTTPException) as exc:
            validate_upload_files([])
        assert exc.value.status_code == 400

    def test_more_than_max_files_raises_400(self):
        files = [(b"x", "image/jpeg")] * (MAX_FILES_PER_UPLOAD + 1)
        with pytest.raises(HTTPException) as exc:
            validate_upload_files(files)
        assert exc.value.status_code == 400

    def test_empty_file_bytes_raises_400(self):
        with pytest.raises(HTTPException) as exc:
            validate_upload_files([(b"", "image/jpeg")])
        assert exc.value.status_code == 400

    def test_single_oversized_image_raises_413(self):
        oversized = b"x" * (MAX_FILE_SIZE_BYTES + 1)
        with pytest.raises(HTTPException) as exc:
            validate_upload_files([(oversized, "image/jpeg")])
        assert exc.value.status_code == 413

    def test_pdf_uses_pdf_size_cap(self):
        image_oversized_but_pdf_allowed = b"x" * (MAX_FILE_SIZE_BYTES + 1)
        validate_upload_files([(image_oversized_but_pdf_allowed, PDF_MIME_TYPE)])

        oversized_pdf = b"x" * (MAX_PDF_SIZE_BYTES + 1)
        with pytest.raises(HTTPException) as exc:
            validate_upload_files([(oversized_pdf, PDF_MIME_TYPE)])
        assert exc.value.status_code == 413


# ---------------------------------------------------------------------------
# I-3: Existing upload attempts have a hard retry cap
# ---------------------------------------------------------------------------

class TestValidateAttemptFiles:
    def test_existing_attempt_count_at_cap_raises_400(self):
        with pytest.raises(HTTPException) as exc:
            validate_attempt_files([(b"x", "image/jpeg")], _MAX_TOTAL_ATTEMPTS)
        assert exc.value.status_code == 400

    def test_existing_attempt_count_above_cap_raises_400(self):
        with pytest.raises(HTTPException) as exc:
            validate_attempt_files([(b"x", "image/jpeg")], _MAX_TOTAL_ATTEMPTS + 1)
        assert exc.value.status_code == 400
