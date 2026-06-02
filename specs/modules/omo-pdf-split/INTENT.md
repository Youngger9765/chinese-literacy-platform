---
spec_id: omo.pdf_split.rendering
module: omo-pdf-split
title: OMO PDF 拆頁 — PDF 轉 per-page JPEG 契約
stability: active
canonical_source: backend/app/services/omo_pdf_split.py
owns_code:
  - backend/app/services/omo_pdf_split.py
owns_data: []
spec_tests:
  - backend/specs/test_omo_pdf_split_spec.py
related_issues:
  - 1976
source_meetings: []
last_reviewed: 2026-06-02
owner: young
---

# OMO PDF 拆頁：PDF 轉 per-page JPEG 規格

## Intent

`omo_pdf_split.py` 讓掃描器或手機掃描 app 產出的多頁 PDF 可以進入既有 OMO 圖片流程。
它是純函式：輸入 PDF bytes，輸出每頁 JPEG bytes，不碰檔案系統、DB、GCS 或 AI。

這份 spec 鎖定 PDF render 參數、預設頁數上限，以及與 `omo_upload_validator.py`
單次上傳張數上限的 coupling。

## Invariants

1. `_RENDER_SCALE == 150.0 / 72.0`，以 PDF 72 DPI baseline render 約 150 DPI 圖片。
2. `_JPEG_QUALITY == 85`，與既有圖片 resize 品質目標一致。
3. `pdf_to_jpeg_pages()` 的預設 `max_pages` 必須是 20。
4. `pdf_to_jpeg_pages()` 的預設 `max_pages` 必須等於
   `omo_upload_validator.MAX_FILES_PER_UPLOAD`，避免 PDF 預設展開頁數與 OMO 單次上傳張數上限 drift。
5. 真實多頁 PDF 經 `pdf_to_jpeg_pages()` render 後，輸出張數不可超過 `max_pages`。
6. 每個 render 出來的 page bytes 必須是 JPEG，開頭為 `b"\xff\xd8"`。

## Out of scope

上傳前的 PDF 大小驗證、展開後的 route error copy、GCS 儲存、AI OCR 品質與頁面方向校正不在此 module。
本 module 只負責 PDF bytes 到 JPEG page bytes 的純轉換。
