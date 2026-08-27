# 一課多篇 · 修復矩陣（#2916 / #2930）

> 這份是**逐項打勾的清單**。每一格必須寫「用什麼驗的」，沒寫等於沒驗。
> ⛔ 禁止用 `?p=` 直達網址當驗證 —— 那不是真實入口。
> ⛔ 禁止用「三篇內容不同」當判準 —— 不同 ≠ 正確，要跟後端該篇真值逐項比對。
>
> **狀態圖例**：☐ 未驗　🔧 已修待驗　✅ 已驗（附證據）　❌ 確認壞

## A. 擁有者實測回報的 bug（2026-08-26）

### A1. G6-L22（三篇）

| # | 回報內容 | 根因 | 修復 | staging | prod |
|---|---|---|---|---|---|
| A1-1 | 第 9、14 步語詞應用都出現篇 1 的題目 | 模組 `vocab_application` vs 欄位 `fill_in_blank` 名字對不上 | ✅ | ✅ D1 | ✅ D3（資料層） |
| A1-2 | 第 11、16 步重點表都跟第 6 步一樣 | `/structure` 只帶課號，快取 key 也只有課號 | ✅ | ✅ D1 | ✅ D3（資料層） |
| A1-3 | 第 2、7、12 步按完成標記直接跳到第 21 步 | `dispatchStepFinish` 傳不含輪次的 base id | ✅ | ✅ D1 | ⛔ 需學生帳號 |

### A2. G5-L17（兩篇）

| # | 回報內容 | 修復 | staging | prod |
|---|---|---|---|---|
| A2-1 | 第 11 步應出現篇 2 的題目，卻與第 4 步（篇 1）相同 | ✅ D1 | ✅ D3（資料層） |
| A2-2 | 第 13 步重點表應為篇 2，卻與第 6 步（篇 1）相同 | ✅ D1 | ✅ D3（資料層） |
| A2-3 | 第 2、8 步按完成標記直接跳到第 18 步 | ✅ D1 | ⛔ 需學生帳號 |

### A3. 重點朗讀 QR（9 張抽查，單篇課）

| # | 回報內容 | 根因 | 修復 | staging | prod |
|---|---|---|---|---|---|
| A3-1 | 掃進去按播放，唸的是課文第一段不是重點段 | 訪客頁換了 content，但朗讀仍用 `lessonId+段落序號` 對照 | ✅ | ✅ D2（9/9） | ✅ **D4（9/9，本輪重跑）** |

擁有者提供的 9 張：G4-L9 `wkmdr`／G4-L13 `6yxve`／G5-L26 `qt9uh`／G5-L15 `yy4tx`／
G5-L3 `mdjjy`／G6-L5 `vfmem`／G6-L4 `9rncr`／G7-L16 `fff44`／G7-L20 `uf6ny`

## B. 十個維度 × 多文本 / 單文本

| # | 維度 | 多文本 | 單文本 | 用什麼驗的 |
|---|---|---|---|---|
| B0 | 帳本 `_manifest.yml` | ✅ | ✅ | `test_row_overlay_spec.py` + 對帳鎖 |
| B1 | yml / 後端資料 | ✅ | ✅ | D5：prod 五課每輪內容各自不同（md5 逐欄位比對） |
| B2 | slug | ✅ | ✅ | `test_qr_addressing_spec.py`；D4 九張代號實掃 |
| B3 | 內容 | ✅ | ✅ | **D6：prod 訪客實際渲染 17 對 / 0 錯**（五課讀全文＋念順順逐篇比對真值） |
| B4 | 元件 active | ✅ staging | ☐ | journey e2e 斷言高亮位移一致 |
| B5 | HTML 顯示 | ⚠️ 部分 | ☐ | 只在 staging 截圖看過三篇；prod 未截圖 |
| B6 | QR code | ✅ | ✅ | D4：prod 九張 9/9，轉址 307＋負向對照 404 |
| B7 | URL | ✅ | ✅ | `stepPathIsTheOnlyBuilder.test.ts`；D4 轉址目標逐一比對 |
| B8 | Audio | ✅ | ✅ | D4 攔 `/api/tts` 比對送出文字；`audio-comes-from-azure.spec.ts` |
| B9 | Log / 進度 | ✅ staging | ⛔ | journey e2e 攔進度寫入斷言 key 帶輪次；prod 需學生帳號 |

## C. 機器鎖（有沒有插電）

| 鎖 | 涵蓋 | 在 CI 清單裡 |
|---|---|---|
| `tests/e2e/multiTextJourney.spec.ts` | 真實 journey，五課全跑 + 完成標記前進 | ✅ e2e job 跑全部 spec（不需具名） |
| `specs/test_every_round_module_reaches_frontend_spec.py` | 模組 → 前端欄位對照（防第四次） | ✅ `spec-check.yml` 跑 `specs/run-ci.sh`（全部 specs） |
| `specs/test_tts_mapping_round_spec.py` | 朗讀對照表、語詞應用、重點表、詞語理解 per-round | ✅ 同上 |
| `specs/test_round_module_ledger_reconcile_spec.py` | 帳本 vs 每輪資料對帳 | ✅ 同上 |
| `src/pages/__tests__/guestKeyPassageAudio.test.tsx` | 訪客重點朗讀不用課號定址 | ✅ 已 pin 進具名清單 |
| `src/hooks/__tests__/finishAdvancesWithinRound.test.ts` | 完成標記走到同輪下一步 | ✅ 已 pin 進具名清單 |

## D. 驗證紀錄

| 編號 | 日期 | 項次 | 環境 | 方法 | 結果 |
|---|---|---|---|---|---|
| D1 | 2026-08-26 | A1-1~3、A2-1~3 | staging | `npx playwright test tests/e2e/multiTextJourney.spec.ts` —— 登入後從第 1 步逐步按完成標記走完，每一步拿後端 `repeat_rounds` 真值比對，並斷言不會中途跳報告頁 | **五課全過**（G5-L17／G6-L22／G8-L13／G9-L16／G9-L23）；mutation 驗過（把比對指到別篇 → 紅） |
| D2 | 2026-08-26 | A3-1 | staging | 9 個代號逐一掃入，攔 `/api/tts` 比對 | **9/9** |
| D3 | 2026-08-27 | A1-1/2、A2-1/2 | **prod** | 打 `/api/stories/{id}`，五課每輪的 `paragraphs`／`key_reading`／`fill_in_blank`／`story_structure_table`／`vocabulary` 逐欄位 md5 比對 | **五課全對**（每輪內容各自不同） |
| D4 | 2026-08-27 | A3-1、B6、B7、B8 | **prod** | 真瀏覽器掃 9 張 QR → 攔 `/api/tts` → 跟該課 `key_reading.passage` 比對 | **9/9** |
| D5 | 2026-08-27 | B1 | **prod** | 同 D3 | 五課全對 |
| D6 | 2026-08-27 | B3 | **prod** | 真瀏覽器訪客路徑，五課的每一篇「讀全文」與「念順順」逐篇比對後端真值，並檢查有無混入別篇 | **17 對 / 0 錯** |
