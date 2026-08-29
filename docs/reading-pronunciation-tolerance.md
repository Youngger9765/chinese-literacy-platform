# 朗讀口音通融（Accent Tolerance）規劃

> 來源：2026-07-20 教授審查會議，曾世傑教授會後提供「台灣人常見發音錯誤清單」。
> 目的：朗讀評分時把**台灣口音**當對（不扣分），只抓真正的念錯/漏字。會議記錄 → `docs/meetings/2026-07-20-record.md` §4。

## 為什麼要通融
台灣人說國語受台語/客語/台灣國語影響，某些音本來就分不清。若把口音當錯字，學生朗讀永遠過不了（正是教授上次現場痛點：辨識太嚴、唸幾次都不過）。**通融這些口音 = 只評「有沒有念到 + 流暢度」，不評「咬字有沒有字正腔圓」**（對齊教授「流暢率為主指標」）。

## 教授清單（3 類，應通融算對）

| # | 類別 | 混淆對 | 例（念成） |
|---|------|--------|-----------|
| 1 | 前後鼻音 | ㄣ/ㄧㄣ ↔ ㄥ/ㄧㄥ | 清楚→親楚、電影→電癮 |
| 2 | 捲舌/不捲舌 | ㄓㄔㄕㄖ ↔ ㄗㄘㄙㄌ（相近音）| 老師→老斯 |
| 3 | ㄦ/兒化弱 | ㄦ 音弱化/丟失 | 兒子→鵝子 |

## 現有機制（擴充點，已驗證檔案位置）
朗讀比對走「字→toneless pinyin→同音折疊→比對命中率」：
- 後端：`backend/app/services/stt/pinyin.py`（`get_pinyin` / `is_homophone`）、`backend/app/services/stt/algorithm.py`（`correct_homophones` / `compute_match_rate`）、`backend/app/services/stt/normalization.py`
- 前端：`frontend/src/utils/pinyin/normalize.ts`（`getPinyin`）+ `frontend/src/utils/pinyin.ts`
- 現況：已有 toneless 同音（媽/馬/嗎/麻→ma，3,869 字）+ 短文閾值補償（見 PRD §朗讀評分架構）；前後鼻音/捲舌是否已折疊 **待確認**（會議提到已通融 ang/an、eng/en，需驗證覆蓋範圍）

## 怎麼改（規劃，非最終）
在「toneless pinyin 比對」之上再加一層 **口音折疊（accent-fold）正規化**：比對前把 confusable 音歸一，讓口音變體命中同一 key。前後端邏輯必須同步（現行 pinyin 正規化就是前後端各一份、必須一致）。

| 類別 | 折疊規則（pinyin 層）| 風險 |
|------|---------------------|------|
| 前後鼻音 | 韻尾 `-n` ↔ `-ng` 視為相同（in↔ing, en↔eng, an↔ang…）| 過寬可能把真的不同字判成對（如 in/ing 有辨義的少數對）|
| 捲舌 | 聲母 zh↔z, ch↔c, sh↔s, r↔l 視為相同 | r↔l 較激進，需抽樣驗 |
| 兒化 | 去掉/弱化 `er` 尾與獨立 `er`（兒化 optional）| 影響小 |

## TDD（regression lock，來自真實 case）
- golden set：用教授的例子（清楚/親楚、電影/電癮、老師/老斯、兒子/鵝子）+ 真實學生朗讀壞例，斷言「口音變體 → 判對」
- **負向控制**：真正念錯的字（非上述 3 類）仍要判錯——證明沒把通融開太寬（過寬 = 全部都對 = 失去評分意義）
- 先讓 test 紅（現行判錯）再實作折疊變綠；禁 special-case

## 開放問題（需產品拍板）
1. **通融到多少**（會議未決）：判咬字正確 vs 流暢度到就好？教授傾向流暢率為主 → 傾向從寬通融這 3 類
2. r↔l、in↔ing 這類「偶爾辨義」的對，要不要全折疊，或保留少數例外
3. 是否對不同年級/程度採不同嚴格度（低年級更寬）

## 關聯
- 重點朗讀主線 → `docs/reading-key-passage-TODO.md`（Phase 2 含本項）
- 朗讀評分架構（LCS + Gemini 校正 + pinyin_groups）→ `docs/PRD.md` §朗讀評分架構
