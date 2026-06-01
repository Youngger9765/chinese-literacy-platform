# OMO Probes — 語意 drift（LLM-as-judge）

> ⚠️ **尚未接上 per-PR CI gate（刻意的）。** 這層處理 deterministic test 抓不到的
> AI 行為 drift，但跑它要打 Gemini（錢 + latency），上線前要 Young 拍板預算與排程。

## 為什麼需要這層

`backend/specs/test_omo_assessment_spec.py` 的 deterministic 契約抓得到「字母對應錯」
這種機械性 drift。但抓不到**語意 drift**：grader 回傳合法 JSON、字母對應沒變，但

- 對國小學生回「你很差」這類負面語氣
- 在繁體中文教室回簡體字
- 推薦課文 `vocab_bank` 以外的語詞

→ pytest 全 pass，學生先壞掉。這就是 spec battle Round 3 Attack 2 的場景。

## 第一個 probe（規格，待實作）

對 `private/omo-real-samples/` 的 5 張真實學生作答影像跑 grader，再用 Gemini
2.5-flash-lite（per CLAUDE.md task config，與既有 grader 同 `ai_service`）當 judge 斷言：

- `llm_judge("是否含簡體字？", output) == False`
- `llm_judge("語氣是否適合國小高年級？", output) == True`
- `llm_judge("回饋是否只推薦本課 vocab_bank 內語詞？", output) == True`
- 分數落在預期 band 內

ground truth 接 #2028 corpus（教用本 = 標準答案）。

## Probe latency / budget 政策（critic 強制 upfront，先定再寫）

| 項目 | 規則 |
|------|------|
| Per-PR probe 總 LLM wall time | ≤ 30s；超過 → 改 nightly schedule |
| Per-PR probe 預算 | ≤ $0.50（用 cost-tracking 量） |
| Probe failure triage | 跟 deterministic test fail 分開；critic-agent review + 24h 內 assign owner |
| 跑法 | 先 nightly / 手動，**不**進 per-PR 必擋 gate，直到證明穩定 + 便宜 |

## 為什麼這版 PR 不 ship probe

shipping 一個會打 LLM 的 CI gate，在沒定好上面政策前 = 正是 critic 警告的反模式
（"probe latency 3 個月內殺掉 CI adoption"）。所以這版只放**規格 + 政策 + 結構**，
實際 probe 實作是 scoped follow-up（自然歸 #2028 ground-truth corpus）。
