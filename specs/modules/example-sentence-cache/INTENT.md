---
spec_id: example_sentence.cache.ttl
module: example-sentence-cache
title: 例句快取 — TTL 與 pre-generated 永不過期契約
stability: active
canonical_source: backend/app/services/example_sentence_cache.py
owns_code:
  - backend/app/services/example_sentence_cache.py
owns_data: []
spec_tests:
  - backend/specs/test_example_sentence_cache_spec.py
related_issues:
  - 780
source_meetings: []
last_reviewed: 2026-06-02
owner: young
---

# 例句快取：TTL 與 pre-generated 永不過期規格

## Intent

`example_sentence_cache.py` 用本地 JSON cache 避免同一課文、同一生字反覆呼叫 Gemini 產生例句。
runtime 產生的快取有 TTL；由預產生腳本寫入的 curated 例句則是內容資產，不應因時間到期被丟棄。

這份 spec 鎖定 `_is_expired()` 的時間語意，尤其是 issue #780 的 pre-generated 永不過期保證。

## Invariants

1. `CACHE_TTL_DAYS == 30`。
2. runtime cache entry 超過 30 天必須視為 expired。
3. fresh runtime cache entry 不可視為 expired。
4. `source == "pregenerated"` 是 seed / pre-generated entry 的標記。
5. pre-generated entry 不論 `cached_at` 多舊都不可 expired。
6. 缺少 `cached_at` 的 runtime entry 必須 expired。
7. 無法 parse 的 `cached_at` 必須 expired。

## Out of scope

AI 例句生成品質、JSON 檔案 I/O、bulk seed 腳本、cache key 選字策略與 API route 行為不屬於這個 module。
這裡只管 cache TTL 判斷與 pre-generated 永不過期契約。
