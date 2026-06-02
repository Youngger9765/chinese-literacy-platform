---
spec_id: omo.upload.validation
module: omo-upload-validation
title: OMO 上傳驗證 — 檔案大小、數量、重拍次數契約
stability: active
canonical_source: backend/app/services/omo_upload_validator.py
owns_code:
  - backend/app/services/omo_upload_validator.py
owns_data: []
spec_tests:
  - backend/specs/test_omo_upload_validation_spec.py
related_issues: []
source_meetings: []
last_reviewed: 2026-06-02
owner: young
---

# OMO 上傳驗證：檔案大小、數量、重拍次數規格

## Intent

`omo_upload_validator.py` 是 OMO 紙本上傳進入後端後的第一道純函式防線。它不碰 DB、
GCS 或 AI，只驗證 `(bytes, mime_type)` 清單是否符合上傳限制，並用 `HTTPException`
回傳路由層可直接轉成使用者訊息的錯誤。

這份 spec 鎖定三組契約：單檔大小上限、單次上傳檔案數上限、同一 session 的重拍次數上限。

## Invariants

1. 圖片單檔上限是 `MAX_FILE_SIZE_BYTES == 10 * 1024 * 1024`。
2. PDF 單檔上限是 `MAX_PDF_SIZE_BYTES == 20 * 1024 * 1024`。
3. 單次上傳最多 `MAX_FILES_PER_UPLOAD == 20` 個檔案。
4. 同一 upload session 最多 `_MAX_TOTAL_ATTEMPTS == 5` 次重拍。
5. `validate_upload_files([])` 必須 raise `HTTPException`，`status_code == 400`。
6. `validate_upload_files()` 收到超過 20 個檔案必須 raise `HTTPException`，`status_code == 400`。
7. 單一圖片超過 10 MB 必須被拒絕；單一 PDF 超過 20 MB 才使用 PDF 上限拒絕。
8. 空 bytes 檔案必須 raise `HTTPException`，`status_code == 400`。
9. `validate_attempt_files()` 在 `existing_attempt_count >= 5` 時必須 raise `HTTPException`，
   `status_code == 400`。

## Out of scope

PDF 展開、圖片切半、GCS 儲存、DB session 狀態、AI 識課與批改都不屬於這個 module。
這裡只管同步、純函式、檔案輸入驗證。
