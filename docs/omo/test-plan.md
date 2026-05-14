# OMO 測試計畫書

**目的**：確保 OMO 在 7/1 demo 前所有路徑驗證過，無未測 path 上 prod
**Linked**：[command-center.md](command-center.md) · [test-catalog.md](test-catalog.md) · [risks.md](risks.md)

---

## 1. 驗收門檻（7/1 demo 必過）

| 維度 | 門檻 | 量法 |
|------|------|------|
| 課程辨識準確率 | top-1 ≥ 95% | 7 課各跑 3 張 = 21 樣本，命中率 |
| 手寫答案抽取準確率 | word-level ≥ 80% | 5 張真實手寫，per-question 比對 |
| 位置標記準確率 | per-question position error < 50px | 標 + 人工比對 |
| E2E latency p95 | < 60s | 100 次跑樣本 |
| 成本 per 學習單 | < NT$0.1 | identify + grade Gemini call 計 |
| 環境分隔 | demo accounts prod 拒登入 | curl 三角色 |
| 上傳防呆 | 同 image hash 不重複辨識 | 兩次同檔 → 2nd from_cache=true |
| 學生 override | flag 後可改答案 | UI flow + DB diff |

---

## 2. 測試矩陣

### A. 課程辨識（已驗）
- 7 課乾淨 worksheet × 3 角度 = 21 樣本
- 邊緣：中度 blur 8px / 旋轉 15-45° / 仿射歪斜 / 對比 0.4
- 拒絕：純白 / 無關內容
- **狀態**：26/26 acceptance loop 跑著（10 min cadence）

### B. 填寫答案抽取
- 印刷字（已驗，position + 字 100% 對）
- 手寫工整（模擬中 — Apple Kaiti / DFP方圓體 W7 / Brush Script）
- 手寫潦草（模擬中 — 加 jitter + 旋轉 ±5°）
- 三種字混合（中文題目 / 數字答 1-9 / 英文選 ABCD）
- **狀態**：印刷✅ 手寫 simulated 進行中 真實⧗

### C. 多次拍照
- 同 omo_upload 加 2-5 個 attempt
- 抽答案使用最後 attempt 還是合併？
- 學生補拍能否覆蓋舊辨識？
- **狀態**：API 存在，未實測

### D. 學生 Flag 校正
- 每題 flag icon 工作
- 改 student_answer 後 score 重算
- 「AI 看錯題目」flag 進 review queue
- **狀態**：API 存在，UI 在 PR #1592 開發中

### E. 防止浪費（dedup）
- 同 hash 第二次上傳 → from_cache=true，0 Gemini call
- status=graded 後第二次 → already_graded=true，prompt 重批改？
- 重批改：POST /regrade → 新一輪 Gemini call
- **狀態**：PR #1588 merged，需驗證 cache hit rate

### F. 確認 UX (3-tier confidence)
- conf ≥ 0.9 → 大綠按鈕「對」+ 小灰「不是」
- 0.4 ≤ conf < 0.9 → top-3 卡片選
- conf < 0.4 → 重拍 + 手動選課
- **狀態**：PR #1594 (老版 #1590 merged)，需驗哪個版本上了 + UI 截圖

### G. 結果頁
- 總分 + 答對率 + 鼓勵語
- per-question 卡片（原圖 + AI 答 + 標準答）
- ai_confidence < 0.7 黃框
- flag icon 工作
- **狀態**：PR #1592 開發中 conflict

### H. UI Polish
- Loading 文案 cycle（上傳→辨識→批改）
- Client-side resize（>2048px 自動壓）
- 錯誤 toast 中文
- **狀態**：PR #1593 開發中 conflict

### I. 跨 user 隔離（安全）
- user_b 用 GET /api/omo/{user_a_upload_id} → 403/404
- user_b 改 user_a 的 flag → 403
- 圖檔 signed URL 不能跨 user 拿
- **狀態**：code 看起來有 `_get_upload_or_404` 但未專門測

### J. 環境分隔
- prod demo accounts 拒登入（已驗）
- 三 GCS bucket 隔離（已建）
- staging 獨立 DB（已分）
- 各 env GCS_OMO_BUCKET env var 正確
- **狀態**：✅ Phase 1a 完成

### K. Latency
- Upload p50 < 1s p95 < 2s
- Identify p50 < 10s p95 < 15s
- Grade p50 < 15s p95 < 30s
- 全程 p95 < 60s（spec target）
- **狀態**：sample 跑過幾次 in range，需 sustained 量測

### L. Cost
- Identify: ~NT$0.012/張（gemini-2.5-flash multimodal）
- Grade: ~NT$0.03/張（structured output 較大）
- 月估：1500 × 7 × 2 = 21k id calls + grade ≈ NT$1000/月
- dedup 節省：估 30-40% repeat rate
- **狀態**：未實際計帳，月底看 GCP billing 才知道

---

## 3. 簡訊驗證計畫

### 立即（本機跑）
| Test | Script | 狀態 |
|------|--------|------|
| Acceptance 26 項 | `/tmp/omo_acceptance_test.sh` | ✅ 10min cron |
| 模擬手寫 | `/tmp/gen_handwriting_sim.py` | 🔧 TODO 寫 |
| 混合字型 | `/tmp/gen_mixed_script.py` | 🔧 TODO 寫 |
| Multi-attempt | `/tmp/test_omo_multi_attempt.sh` | 🔧 TODO 寫 |
| Cross-user | `/tmp/test_omo_isolation.sh` | 🔧 TODO 寫 |

### Preview / staging
| Test | When | 狀態 |
|------|------|------|
| Sub-PR preview smoke | Each PR open | 🔧 part-auto |
| Umbrella preview smoke | Before merge umbrella | 🔧 TODO |
| Playwright UI flows | Before each sub-PR merge | 🔧 TODO |
| Staging E2E | After umbrella merge | 🔧 TODO |

### 真實手寫（Young 提供圖後）
| Test | 樣本 | 狀態 |
|------|------|------|
| 工整手寫 | 1 張 | ⧗ 等 Young |
| 潦草手寫 | 1 張 | ⧗ 等 Young |
| 含英文選項 | 1 張 | ⧗ 等 Young |

---

## 4. Pre-demo dry-run 程序（7/1 前 1 週）

1. 學生角度跑全流程 5 次（不同學習單）
2. 老師角度看後台（Phase 2 — 先 skip）
3. 教授角度看 demo flow 60 秒 SOP
4. 錄一段 backup video（演現場掛掉用）
5. 量 cost 1 週實跑 + 月推估

---

## 5. 失敗 fallback

| 場景 | 處理 |
|------|------|
| Gemini 暫斷 | Circuit breaker 3 次跳 → 503 + 「AI 服務暫停，請稍後」 |
| 拍糊辨識不出 | conf<0.4 filter → 「看不清楚 😅 重拍」|
| 抽錯答案 | 學生 flag → 改正 → 重算 |
| Upload 過大 | client resize 2048px |
| 跨 user 偷看 | 403 |
| Demo 現場掛 | 錄好的 backup video |

---

## 6. Coverage Gaps（已知未測）

- [ ] 真實人類手寫（P0 risk）
- [ ] 老師後台 override（Phase 2）
- [ ] 班級聚合（Phase 2）
- [ ] Concurrent upload from same user
- [ ] DB full / GCS quota exhausted
- [ ] Slow network (3G) 上傳完整性
- [ ] iOS Safari vs Android Chrome 相容性

---

## 7. 通過率追蹤

```
Week of 5/12: acceptance 26/26 → 25/26 (extreme blur P3 removed) → 25/25 stable
Week of 5/14 +: track here as new tests come online
```
