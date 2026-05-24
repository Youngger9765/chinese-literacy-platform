"""OMO upload input validation — pure, sync, no DB/GCS side-effects.

Extracted from backend/app/routes/omo.py as part of the 3-module split.
AnalysisBy: issue #1857 — routes/omo.py second-pass refactor.

Contains:
- Upload constraint constants
- validate_upload_files(): raises HTTPException for invalid file lists
- validate_attempt_files(): same checks + attempt-count guard
"""

from fastapi import HTTPException

# ── Upload constraints (single source of truth) ────────────────────────────────
_MAX_FILE_SIZE_BYTES: int = 10 * 1024 * 1024   # 10 MB per image
# #1976: PDFs are commonly larger because they bundle multiple pages —
# allow a bigger cap before we expand them into per-page JPEGs.
_MAX_PDF_SIZE_BYTES: int = 20 * 1024 * 1024    # 20 MB per PDF
_MAX_FILES_PER_UPLOAD: int = 20                  # max files per single upload call
_MAX_TOTAL_ATTEMPTS: int = 5                     # max attempts per upload session
_IMAGE_MIME_TYPES: frozenset[str] = frozenset({
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
})
_PDF_MIME_TYPE: str = "application/pdf"
_ALLOWED_MIME_TYPES: frozenset[str] = _IMAGE_MIME_TYPES | {_PDF_MIME_TYPE}


def _cap_for_mime(content_type: str) -> int:
    """Return the per-file size cap that applies to ``content_type``."""
    return _MAX_PDF_SIZE_BYTES if content_type == _PDF_MIME_TYPE else _MAX_FILE_SIZE_BYTES


def _check_single_file(data: bytes, content_type: str) -> None:
    """Raise HTTPException if a single file violates MIME / size / empty rules.

    Shared between validate_upload_files and validate_attempt_files so the two
    paths can't drift on what's allowed.
    """
    if content_type not in _ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"不支援的格式 {content_type}，請上傳 JPEG / PNG / WebP / PDF",
        )
    cap = _cap_for_mime(content_type)
    if len(data) > cap:
        cap_mb = cap // (1024 * 1024)
        kind = "PDF" if content_type == _PDF_MIME_TYPE else "圖片"
        raise HTTPException(
            status_code=413,
            detail=f"{kind}太大（{len(data) // (1024 * 1024)}MB），最大允許 {cap_mb}MB",
        )
    if len(data) == 0:
        raise HTTPException(status_code=400, detail="上傳的檔案是空的")


def validate_upload_files(files_data: list[tuple[bytes, str]]) -> None:
    """Validate a list of (bytes, mime_type) tuples for a new upload.

    Raises HTTPException (400 or 413) for any of:
    - Empty file list
    - Too many files (> _MAX_FILES_PER_UPLOAD)
    - Unsupported MIME type
    - Oversized file (image > 10MB, PDF > 20MB)
    - Zero-byte file content

    Parameters
    ----------
    files_data:
        List of (raw_bytes, content_type) for each uploaded file.
        Bytes must already be read (no async here).

    Note
    ----
    PDFs count as 1 file here regardless of page count.  Per-page expansion
    happens after validation in the route layer (#1976), where the expanded
    image count is re-checked against ``_MAX_FILES_PER_UPLOAD``.
    """
    if not files_data:
        raise HTTPException(status_code=400, detail="最少需要上傳 1 個檔案")
    if len(files_data) > _MAX_FILES_PER_UPLOAD:
        raise HTTPException(
            status_code=400,
            detail=f"最多只能上傳 {_MAX_FILES_PER_UPLOAD} 個檔案",
        )
    for data, content_type in files_data:
        _check_single_file(data, content_type)


def validate_attempt_files(
    files_data: list[tuple[bytes, str]],
    existing_attempt_count: int,
) -> None:
    """Validate files for an additional attempt on an existing upload session.

    Extends validate_upload_files with an attempt-count guard.

    Raises HTTPException 400 if existing_attempt_count >= _MAX_TOTAL_ATTEMPTS.
    All other checks are identical to validate_upload_files.
    """
    if existing_attempt_count >= _MAX_TOTAL_ATTEMPTS:
        raise HTTPException(
            status_code=400,
            detail=f"最多 {_MAX_TOTAL_ATTEMPTS} 次重拍機會",
        )
    if not files_data:
        raise HTTPException(status_code=400, detail="最少需要上傳 1 個檔案")
    if len(files_data) > _MAX_FILES_PER_UPLOAD:
        raise HTTPException(
            status_code=400,
            detail=f"每次最多上傳 {_MAX_FILES_PER_UPLOAD} 個檔案",
        )
    for data, content_type in files_data:
        _check_single_file(data, content_type)
