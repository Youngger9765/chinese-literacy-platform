---
spec_id: points.ledger_invariants
module: points
title: 點數帳本不變式（pointer module）
stability: active
canonical_source: backend/app/services/points_service.py + backend/app/routes/organizations.py
owns_code:
  - backend/app/services/points_service.py
legacy_tests:
  - backend/tests/test_points_system.py
related_issues:
  - 2058
last_reviewed: 2026-06-02
owner: young
---

# Points：點數帳本不變式（pointer module）

> **這是 pointer-only module。** 沒有獨立的 `backend/specs/test_points_spec.py`。
> 所有機器可驗的契約由 `backend/tests/test_points_system.py` 覆蓋，已列於 `legacy_tests:`。

## 1. 這個 module 在管什麼

Organization 點數系統：扣點操作的原子性與記錄一致性，以及組織訂閱日期管理。

## 2. 核心不變式（Invariants）

### I-1: 扣點原子性 — 餘額不足時必 raise

```
deduct_points(org_id, amount) where balance < amount →
  raises InsufficientPointsError (or equivalent)
  DB 不被修改
```

對應測試：`test_deduct_points_insufficient`

### I-2: 扣點成功時建立 PointsLog 記錄

每次成功扣點在 `points_log` 表新增一筆記錄（amount、reason、created_at）。

對應測試：`test_points_log_created`

### I-3: 無點數限制模式（no_limit）直接成功

`deduct_points_no_limit` 跳過餘額檢查，永遠成功。

對應測試：`test_deduct_points_no_limit`

## 3. 為何不建獨立 spec test

`test_points_system.py` 混合純邏輯測試與 DB-fixture 測試，需要真實 DB 環境（Organization + PointsLog）。現有測試已穩定，pointer 機制足夠。
