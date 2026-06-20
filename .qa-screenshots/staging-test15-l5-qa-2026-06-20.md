# test15 Staging E2E — 14/14 PASS (2026-06-20)

| 層 | 結果 | 方法 |
|----|------|------|
| L4 API | **14/14** | `GET /api/stories/{id}` → `spotlight_v2.strategy_name` + blocks |
| L5 UI | **14/14** | Playwright headless · 小明懶人登入 · `/learn/{id}/reading-strategy` |

環境：staging  
Frontend: https://lingoleap-frontend-staging-958347263320.asia-east1.run.app  
Backend: https://lingoleap-backend-staging-958347263320.asia-east1.run.app  

> 注意：`GET /api/stories` 預設 `page_size=60` 只回第一頁；test15 部分課在 id 1000+，查 catalog 需 `page_size=300` 或逐 id curl

## L4 API（14/14）

| id | fixture | grade_code | blocks | strategy_name |
|----|---------|------------|--------|---------------|
| 1010 | G4-SL10 | G4-L10 | 37 | 推論策略-推論情緒和感受 |
| 6 | G4-L13 | G4-L13 | 12 | 想法感受的換位思考 |
| 1034 | G5-SL7 | G5-L7 | 17 | 推論策略-觀點找支持理由 |
| 10 | G5-SL10 | G5-L10 | 9 | 推論策略-從言行推論人物特質 |
| 1053 | G5-L26 | G5-L26 | 24 | 用表格整理訊息-比較異同 |
| 1057 | G6-SL3 | G6-L3 | 3 | 解決問題-以實驗觀察找答案 |
| 18 | G6-SL8 | G6-L08 | 35 | 摘要策略-從結構找小主題與細節 |
| 22 | G6-L14 | G6-L14 | 14 | 自我提問-問重要的問題 |
| 33 | G7-SL9 | G7-L09 | 11 | 表達看法-4F思考法 |
| 37 | G7-L17 | G7-L17 | 4 | 解決問題-科學探究法 |
| 1098 | G7-L19 | G7-L19 | 3 | 自我提問-詰問作者的步驟 |
| 1114 | G8-SL4 | G8-L3b | 21 | 推論策略-由課文觀點找出支持理由 |
| 1118 | G8-SL8 | G8-L6b | 34 | 推論策略-找出一連串因果 |
| 54 | G9-SL9 | G9-L09 | 22 | 圖表繪製與判讀-圖文表綜合判讀 |

## L5 UI（14/14）

### Smoke（快速）
腳本：`.qa-screenshots/run-test15-l5-staging.mjs`  
判定：`body` 含「閱讀聚光燈」+ 各課 strategy 關鍵字 · console error 0

### Deep（dev7 同級，2026-06-20）
腳本：`.qa-screenshots/run-test15-l5-deep-staging.mjs`  
機器讀數：`.qa-screenshots/spotlight-test15-deep-qa.jsonl`

每課 probe：`BlockSequenceRenderer` header · guide · passage 計數 · dualCol（lg:grid-cols-5）· MCQ/textarea · figure · stepper 聚光燈 · console 0 · session 過期自動 re-login

| id | fixture | L5 deep |
|----|---------|---------|
| 1010 | G4-SL10 | PASS |
| 6 | G4-L13 | PASS |
| 1034 | G5-SL7 | PASS |
| 10 | G5-SL10 | PASS |
| 1053 | G5-L26 | PASS |
| 1057 | G6-SL3 | PASS |
| 18 | G6-SL8 | PASS |
| 22 | G6-L14 | PASS |
| 33 | G7-SL9 | PASS |
| 37 | G7-L17 | PASS |
| 1098 | G7-L19 | PASS |
| 1114 | G8-SL4 | PASS |
| 1118 | G8-SL8 | PASS |
| 54 | G9-SL9 | PASS |

**14/14 PASS** · 設計備註：多數 test15 課無 inline `閱讀文本` passage（練習以 free_text 為主），dualCol 僅在 passage+interactive 同 segment 時出現（例 G9-SL9）

## 補充：G6-L03 id=24

Layer-1 課 `L24.yml` 與 test15 `G6-SL3` 同策略，先前已手動 browse PASS（見 `staging-g6-l03-test15-l5-qa.md`）。staging API id=1057 為 Layer-2 同課另一入口，兩者皆載入 test15 fixture

## 重跑

```bash
cd frontend && node ../.qa-screenshots/run-test15-l5-staging.mjs      # smoke
cd frontend && node ../.qa-screenshots/run-test15-l5-deep-staging.mjs # deep (dev7 parity)
```
