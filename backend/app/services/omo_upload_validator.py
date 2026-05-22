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
_MAX_FILES_PER_UPLOAD: int = 20                  # max files per single upload call
_MAX_TOTAL_ATTEMPTS: int = 5                     # max attempts per upload session
_ALLOWED_MIME_TYPES: frozenset[str] = frozenset({
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
})


def validate_upload_files(files_data: list[tuple[bytes, str]]) -> None:
    """Validate a list of (bytes, mime_type) tuples for a new upload.

    Raises HTTPException (400 or 413) for any of:
    - Empty file list
    - Too many files (> _MAX_FILES_PER_UPLOAD)
    - Unsupported MIME type
    - Oversized file (> _MAX_FILE_SIZE_BYTES)
    - Zero-byte file content

    Parameters
    ----------
    files_data:
        List of (raw_bytes, content_type) for each uploaded file.
        Bytes must already be read (no async here).
    """
    if not files_data:
        raise HTTPException(status_code=400, detail="最少需要上傳 1 張照片")
    if len(files_data) > _MAX_FILES_PER_UPLOAD:
        raise HTTPException(
            status_code=400,
            detail=f"最多只能上傳 {_MAX_FILES_PER_UPLOAD} 張照片",
        )
    for data, content_type in files_data:
        if content_type not in _ALLOWED_MIME_TYPES:
            raise HTTPException(
                status_code=400,
                detail=f"不支援的圖片格式 {content_type}，請上傳 JPEG 或 PNG",
            )
        if len(data) > _MAX_FILE_SIZE_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"圖片太大（{len(data) // (1024 * 1024)}MB），最大允許 10MB",
            )
        if len(data) == 0:
            raise HTTPException(status_code=400, detail="上傳的圖片是空的")


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
        raise HTTPException(status_code=400, detail="最少需要上傳 1 張照片")
    if len(files_data) > _MAX_FILES_PER_UPLOAD:
        raise HTTPException(
            status_code=400,
            detail=f"每次最多上傳 {_MAX_FILES_PER_UPLOAD} 張照片",
        )
    for data, content_type in files_data:
        if content_type not in _ALLOWED_MIME_TYPES:
            raise HTTPException(
                status_code=400,
                detail=f"不支援的圖片格式 {content_type}",
            )
        if len(data) > _MAX_FILE_SIZE_BYTES:
            raise HTTPException(status_code=413, detail="圖片超過 10MB")
        if not data:
            raise HTTPException(status_code=400, detail="空的圖片檔案")
