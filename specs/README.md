# Modular Spec System

> Issue #2029. 讓 AI 改 feature 時**精準載入該 feature 的 spec**，不用吃整份 PRD +
> 全會議記錄而變笨；同時讓 spec ↔ code/data 的 drift 在 CI 被抓到。
>
> 設計來自 `docs/research/spec-modularization-battle-2026-06-01.md`（Claude vs Codex
> 5-round battle + critic verdict）。**這版是 Phase A：純檔案約定 + deterministic
> 契約，0 MCP server、0 anchor scheme**（critic 警告那兩個會過早 / 會 rot）。

## 一個 module 長什麼樣

```
specs/
  registry.yaml                     ← AUTO-GEN 索引（AI 先讀這個，便宜）
  build_registry.py                 ← 掃 INTENT.md frontmatter → registry.yaml
  modules/<feature>/
    INTENT.md                       ← 人讀 SOT（prose + frontmatter）方大哥/教授/intern
    probes/                         ← LLM-as-judge 語意 drift（policy，暫不接 PR gate）
backend/specs/
    test_<feature>_spec.py          ← 機器可驗契約（pytest，drift = test fail）
```

- **`INTENT.md`** = 真相來源給人看：脈絡、ownership、允許/禁止改動、已知 drift、教學脈絡。
- **`test_*_spec.py`** = 真相來源給機器驗：契約用 pytest 斷言。**意圖正確但 code/data 還沒跟上的**，標 `xfail` + 追蹤 issue（CI 綠、drift 有記錄；修好變 XPASS = 該轉硬斷言的信號）。
- **`registry.yaml`** = 自動生成的索引，AI 一眼看到所有 module 擁有哪些 code/data + spec 在哪。

## AI 怎麼用（context 載入流程）

```
要改某段 backend code / lesson 資料
        ↓
1. 讀 specs/registry.yaml（小，~1 module 幾行）
        ↓
2. 比對「我要動的檔案」落在哪個 module 的 owns_code / owns_data
        ↓
3. 只讀那個 module 的 INTENT.md（+ 需要時讀 test_*_spec.py）
   → 不撈整份 PRD / 全 docs/meetings
        ↓
4. 改完跑：cd backend && python -m pytest specs/ -v
   → 契約 fail = code/data 偏離意圖（修 code 或更新 spec，二擇一，強迫決策）
        ↓
5. 沒有對應 module → 先建 specs/modules/<feature>/INTENT.md 再寫 code（spec-first）
```

## 開發指令

```bash
# 重建索引（改任何 INTENT.md 後必跑）
python specs/build_registry.py

# CI 用：索引有沒有 stale
python specs/build_registry.py --check

# 跑所有 spec 契約
cd backend && python -m pytest specs/ -v
```

CI：`.github/workflows/spec-check.yml` 在 `specs/**`、`backend/specs/**`、
被 spec 擁有的 code/data 變動時，跑 `--check` + spec pytest。

## 目前的 module

| spec_id | 管什麼 | 狀態 |
|---------|--------|------|
| `omo.grader.letter_mapping` | OMO 語詞應用字母作答的對應來源（`vocab_bank` = SOT） | active；抓到 #2015 真實 drift（51 課 / 91% 字母解錯，2 個契約標 xfail） |

## 已知會 rot 的點（critic 提醒）

Spec 真正的失效不是 code 改壞，是**會議講了沒人寫回 INTENT.md**
（repo 有 ~140 個 `docs/meetings/`，spec 卻寥寥可數）。每個 module 的 INTENT.md 有
`source_meetings` 欄；維護觸發點是會議 review，不是 code review。

## 刻意不做（Phase A 範圍外）

- MCP resource server（Phase B：eval metric 達 4/5 再加）
- INTENT.md ↔ spec.py 的 HTML-comment anchor 連結（critic 標：會在更小尺度重現 stale-SOT）
- 全 stack 鋪開（先 OMO pilot 驗證價值）
- LLM-judge probe 接 per-PR gate（先定 latency/budget 政策，見 `modules/omo-assessment/probes/README.md`）

## CI workflow 安裝（需 workflow-scoped token）

`specs/ci/spec-check.yml` 是 CI workflow 模板。本機 PAT 沒有 GitHub `workflow`
scope，無法自動寫入 `.github/workflows/`。請用有 `workflow` scope 的 token / 從
GitHub 網頁，把它複製到 `.github/workflows/spec-check.yml` 啟用：

```
cp specs/ci/spec-check.yml .github/workflows/spec-check.yml
```
