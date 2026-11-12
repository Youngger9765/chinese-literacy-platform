# PRD：一次移除多位學生（#3821）

## 問題

老師只能逐一移除學生（點「移除」→「確認移除」兩下）。班級人數多，或要整批清掉重複/測試帳號時，操作次數跟人數成正比，很煩。

## 均一教育平台的做法（概念參考，非原始碼）

均一的學生名單頁支援勾選多位學生，畫面下方浮出一條「已選取 N 位學生」的動作列，提供「取消」與「移除學生」兩個按鈕。
本票借鏡這個互動模式（勾選＋底部動作列＋人數顯示），不借用其後端邏輯——均一的批次移除還會處理「從未登入過的附屬帳號順便砍掉」「正在星空活動中的學生不給移除」這類跟我們產品無關的規則，本票明確排除。

## 驗收條件（Given / When / Then）

### AC1 — 勾選多位學生後可一次移除
```
Given 老師 T 的班級 A 有學生 S1, S2, S3
When T 勾選 S1、S2（不勾 S3），點擊「移除學生」並在確認對話框按下確認
Then S1、S2 不再出現在班級 A 的名單
  And S3 仍在名單上
  And 回應包含 removed_count=2
```

### AC2 — 確認對話框要寫出數量
```
Given 老師 T 勾選了 2 位學生
When T 點擊「移除學生」
Then 前端在送出 API 前跳出確認對話框，文案包含數字 2（例如「確定要移除 2 位學生嗎？」）
  And T 取消對話框時，不會呼叫移除 API，名單不變
```

### AC3 — 只移出班級，不刪帳號
```
Given 學生 S1 是老師批次建立、從未登入過的帳號
When T 把 S1 批次移出班級 A
Then S1 的 User 帳號仍然存在（可查詢得到、email 不變）
  And S1 原本的 AssignmentSubmission / LearningSession 紀錄不受影響
```

### AC4 — 權限：只有該班 owner/admin 能操作
```
Given 老師 U 不是班級 A 的 owner，也不是 admin
When U 呼叫批次移除 API 對班級 A
Then 回傳 403，S1/S2 都還在名單上
```

### AC5 — 部分 id 無效時的行為
```
Given 老師 T 的班級 A 有學生 S1
When T 呼叫批次移除 API，student_ids = [S1, 99999]（99999 不存在於這個班）
Then S1 被移除
  And 回應的 not_found_ids 包含 99999
  And 回應整體狀態仍是 200（部分成功，不因為一個無效 id 讓整批失敗）
```

### AC6 — 空清單
```
Given 老師 T 呼叫批次移除 API，student_ids = []
When ...
Then 回傳 422（至少要選一位學生）
```

## 不做的範圍（明確排除）

- 不刪除學生帳號本體，即使該帳號從未登入過（跟均一不同，是刻意簡化：我們的學生帳號跟班級是分離的兩個概念，帳號生命週期由另一個流程處理）
- 不處理「活動進行中」這類跨產品限制
- 不支援跨班級批次移除；每次操作只對目前打開的這一個班級生效
- 單次批次上限：跟現有單班學生數量上限一致（沿用 CSV 匯入的 100 人上限精神，批次移除同樣限制最多 100 筆/次請求，避免超大 payload）

## API 設計

```
POST /api/classrooms/{classroom_id}/students/batch-remove
Body: { "student_ids": [<int>, ...] }   # 1~100 筆
Response 200: {
  "removed_count": <int>,
  "not_found_ids": [<int>, ...]
}
```

權限：`require_owner_or_admin`，跟現有單一移除學生一致。

## 資料庫變更

無。對每個有效 id 執行與現有單一移除相同的 `db.delete(ClassroomStudent)`，在同一個 transaction 內跑完整批。

## 前端

`StudentListTab.tsx` 每一行加 checkbox；勾選任一學生後，畫面下方浮出 `BatchActionBar`：
- 顯示「已選取 N 位學生」
- 「取消」清空選取
- 「移除學生」→ `window.confirm` 顯示數量 → 確認後呼叫 API → 成功後刷新名單、清空選取
