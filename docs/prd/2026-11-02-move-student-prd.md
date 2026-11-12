# PRD：學生換班（#3819）

## 問題

老師目前只能「把學生從 A 班移除」再「到 B 班用學生編號重新加入」才能做到換班的效果。這個兩步流程：
- 讓老師以為學生帳號被刪除了（移除的用詞沒有說明「稍後還能再加回來」）
- 容易漏做第二步，學生就從老師的所有班級消失
- 沒有任何一步明確表達「這是換班，不是刪除學生」

## 均一教育平台的做法（概念參考，非原始碼）

均一的學生名單設定頁對每個學生提供一個「移進/移出班級」的操作，讓老師直接勾選目的班級；
底層是「加入新班」與「移出舊班」兩個動作合併成一次操作，而不是分開的刪除再新增。
本票借鏡這個概念（一次操作完成换班），具體 API 形狀與資料模型照本專案既有架構設計，不是照抄均一程式碼。

## 驗收條件（Given / When / Then）

### AC1 — 老師可以把自己班上的學生換到自己另一個班
```
Given 老師 T 同時擁有班級 A 與班級 B（皆為 T 建立或 T 是 primary teacher）
  And 學生 S 目前在班級 A 的名單上
When T 呼叫「換班」API，把 S 從 A 換到 B
Then S 不再出現在 A 班的學生名單
  And S 出現在 B 班的學生名單
  And 回應包含 from_classroom_id=A, to_classroom_id=B, 新的 enrolled_at
```

### AC2 — 學習紀錄保留
```
Given 學生 S 在換班前，於班級 A 的某個作業已有 AssignmentSubmission / LearningSession 紀錄
When T 把 S 從 A 換到 B
Then S 原本在 A 的 AssignmentSubmission / LearningSession 紀錄不會被刪除或改動
  And S 加入 B 之後，若 B 有「全班指派」且仍啟用中的作業，S 會被補上該作業的 submission（沿用既有 create_submissions_for_new_student 行為，與直接加入新班一致）
```

### AC3 — 不能換到別人的班
```
Given 老師 T 與老師 U 各自有獨立班級，T 不是 U 班級的 owner 或共同授課老師
  And 學生 S 在 T 的班級 A 名單上
When T 呼叫「換班」API，試圖把 S 換到 U 的班級
Then 回傳 403，S 仍留在班級 A，沒有任何變動
```

### AC4 — 目的班級必須存在、必須和來源同校
```
Given 老師 T 擁有班級 A（學校 X）與班級 C（學校 Y，不同校）
When T 試圖把班級 A 的學生 S 換到班級 C
Then 回傳 400（跨校換班不支援），S 仍留在班級 A
```

### AC5 — 學生不在來源班，或已經在目的班
```
Given 學生 S 不在班級 A 的名單上
When T 呼叫「換班」API，來源寫 A
Then 回傳 404

Given 學生 S 已經同時出現在班級 A 與班級 B（理論上不會發生於正常流程，但要防呆)
When T 把 S 從 A 換到 B
Then 回傳 409（學生已經在目的班），A 班的紀錄不會被移除
```

## 不做的範圍（明確排除）

- 不支援一次多位學生換班（那是另一張票 #批次移除 的姊妹需求，但換班本票僅處理單一學生單一動作；UI 上每次只對一位學生操作「換班」）
- 不支援換到別的老師管理的班級（即使同校）
- 不支援跨校換班
- 不新增「學生同時屬於多個班級」的資料模型；換班＝刪一筆 enrollment + 建一筆新 enrollment，仍是「單一時間只在一個班」的既有假設

## API 設計

```
POST /api/classrooms/{from_classroom_id}/students/{student_id}/move
Body: { "to_classroom_id": <int> }
Response 200: {
  "student_id": <int>,
  "from_classroom_id": <int>,
  "to_classroom_id": <int>,
  "enrolled_at": "<ISO8601>"
}
```

權限：來源與目的班級都必須通過 `require_owner_or_admin`（跟現有 add/remove student 的權限模型一致，co-teacher 助教不可操作換班，與移除學生的既有限制一致）。

## 資料庫變更

無。沿用既有 `ClassroomStudent` 表，換班動作 = 刪除來源 row + 新增目的 row，於同一個 DB transaction 內完成。

## 前端

`ClassroomDetail.tsx` / `StudentListTab.tsx` 每一行學生新增「換班」按鈕：
- 點擊展開下拉選單，列出老師自己其他「同校」的班級
- 選定後二次確認（顯示「確定把 X 從目前班級換到 Y 班？」）
- 成功後該學生從目前頁面的名單消失（已換走），並顯示成功提示
