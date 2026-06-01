---
spec_id: omo.image_preprocess.spread_split
module: omo-image-preprocess
title: OMO 圖片預處理 — 橫向雙頁切半 fail-open 契約
stability: active
canonical_source: backend/app/services/omo_image_preprocess.py
owns_code:
  - backend/app/services/omo_image_preprocess.py
owns_data: []
spec_tests:
  - backend/specs/test_omo_image_preprocess_spec.py
related_issues:
  - 1717
source_meetings: []
last_reviewed: 2026-06-02
owner: young
---

# OMO 圖片預處理：橫向雙頁切半規格

## Intent

`omo_image_preprocess.py` 在 OMO 批改前處理掃描器常見的橫向雙頁 spread。當圖片寬度明顯大於高度時，
`_split_spread()` 將左右頁切成兩張 JPEG，讓後續 OCR 不必同時處理跨頁內容。

Issue #1717 的核心保證是 fail-open：圖片預處理不能因為壞圖、未知格式或 Pillow 問題阻斷批改流程。

## Invariants

1. `_split_spread()` 收到垃圾 bytes 或非圖片 bytes 時永遠不可 raise。
2. 無法解析圖片時，`_split_spread()` 必須回傳 `[(original_bytes, mime)]`。
3. 一般非寬圖必須維持原始單元素 list，不重新編碼、不改 MIME。
4. 寬圖判斷門檻是 `width > height * 1.3`。
5. 非寬圖，例如 800x1000，必須回傳原始單元素 list。
6. 很寬的圖，例如 2000x600，必須回傳左右兩半。
7. 切半輸出固定為 JPEG bytes，MIME 為 `image/jpeg`。

## Out of scope

PDF 拆頁、OCR、GCS、AI 批改、影像去噪、旋轉校正與版面偵測不屬於這個 module。
這裡只管簡單 aspect-ratio spread split 與 fail-open 行為。
