# 實習生技能樹 — Claude MD Cheat Sheet

> 快速參考：怎麼用 Claude Code 管理實習生技能樹

---

## 📁 檔案結構

```
frontend/public/intern-training/   ← SOT（staging dashboard 從此讀）
├── dashboard.html               ← 互動式技能樹儀表板（staging 可見）
├── CHEATSHEET.md                ← 本文件
└── interns/
    ├── raymond.json             ← 靖杭進度 (skills, lastReview, history)
    └── xiung.json               ← 啟翔進度

docs/intern-training/            ← ⚠️ DEPRECATED（舊版 mirror，不要更新這裡）
```

---

## 🚀 常用指令

### 評估技能

```
# 在 Claude Code 中說：
"review 靖杭的 commit，更新技能樹"
"review 啟翔最近的進度"
"/skill-tree-review raymond"
"/skill-tree-review steven"
```

Claude 會：
1. `git log --author` 查 commit
2. `gh pr list --author` 查 PR
3. 比對 20 個技能完成條件
4. 更新 `interns/*.json`
5. 輸出中文評估報告

### 查看技能樹

```bash
open docs/intern-training/skill-tree.html
```

### 指派任務

```
# 根據技能樹建議：
"靖杭下一個可以做什麼 issue？"
"啟翔的 TypeScript 還沒解鎖，有什麼適合練的？"
```

---

## 📊 技能一覽表

### Tier 1 — 基礎入門 (60 XP)

| # | 技能 | XP | 怎麼算通過 |
|---|------|-----|-----------|
| 1 | Git 基礎 | 10 | 有 commit push 到 remote |
| 2 | HTML/CSS | 10 | 改過 HTML/CSS 或 Tailwind 樣式 |
| 3 | JavaScript | 15 | 用過事件處理、陣列方法、async |
| 4 | 開發環境 | 10 | 本地前後端跑得起來 |
| 5 | 讀懂程式碼 | 15 | 能正確修改現有 React 元件 |

### Tier 2 — 實戰技能 (110 XP)

| # | 技能 | XP | 前置 | 怎麼算通過 |
|---|------|-----|------|-----------|
| 6 | React 元件 | 25 | 3,5 | 用 state/props 建立或修改元件 |
| 7 | TypeScript | 20 | 3 | 使用 type annotation、interface |
| 8 | Tailwind | 20 | 2 | 有意義地使用 utility classes |
| 9 | Git 工作流 | 20 | 1 | feature branch + PR + conventional commits |
| 10 | Bug 修復 | 25 | 4,5 | 重現 → 定位 → 修復 → 驗證 |

### Tier 2.5 — Claude Code 技能 (NEW — 對應 VCA 課程)

> 教材：`courses/claude-code-foundations.md`
> VCA 課程：https://young-tsai.vercel.app/zh-TW/private/vca-curriculum

| # | 技能 | XP | 前置 | 怎麼算通過 |
|---|------|-----|------|-----------|
| 21 | Claude Code 基礎 | 15 | 9 | 用 Claude Code 完成一個 issue（PR 是 Claude 幫寫的） |
| 22 | CLAUDE.md 撰寫 | 20 | 21 | 在個人專案寫一份 CLAUDE.md |
| 23 | Skill 撰寫 | 25 | 22 | 寫一個 global skill 並實際使用 |
| 24 | Hook 撰寫 | 25 | 22 | 寫一個防護 hook，實際擋住一次錯誤 |
| 25 | Agent 使用 | 20 | 21 | 用 worktree 平行做兩個 issue |
| 26 | Agent 撰寫 | 30 | 23,24 | 寫一個自訂 agent 能獨立完成任務 |

### Tier 3 — 進階能力 (155 XP)

| # | 技能 | XP | 前置 | 怎麼算通過 |
|---|------|-----|------|-----------|
| 11 | React 進階 | 35 | 6 | 正確用 useEffect/useRef/useMemo |
| 12 | API 串接 | 30 | 6,7 | 串接後端 API（fetch + error handling）|
| 13 | 設計模式 | 35 | 6,11 | 抽元件、寫 custom hooks |
| 14 | 測試 | 30 | 10 | 寫過 Vitest 或 Playwright 測試 |
| 15 | Code Review | 25 | 9 | 有建設性地 review 過別人 PR |

### Tier 4 — 獨立開發者 (210 XP)

| # | 技能 | XP | 前置 | 怎麼算通過 |
|---|------|-----|------|-----------|
| 16 | 獨立開發 | 50 | 11,12,14 | Issue → PR → merge 完整流程 |
| 17 | 效能優化 | 40 | 11,13 | 用 Profiler 量測 + React.memo/lazy |
| 18 | 架構理解 | 40 | 12,13 | 畫出完整資料流圖 |
| 19 | 技術文件 | 30 | 15 | 寫過有意義的 ADR 或技術文件 |
| 20 | 指導他人 | 50 | 15,16 | 帶人 pair programming 或 review |

**總計 600 XP**

---

## 👥 目前進度 (2026-05-14)

> 最新進度請看 staging dashboard：
> https://lingoleap-frontend-staging-958347263300.asia-east1.run.app/intern-training/dashboard.html

### Raymond (靖杭 @if-else-master)

5 週 33 個 merged PR，新解鎖 #11（React 進階）、#16（獨立開發）、#19（技術文件），Git #9 升 level 4，測試 #14 升 level 3

### Steven (啟翔 @stgst)

5 週 11 個 merged PR，新解鎖 #12（API 串接）、#13（設計模式）、#14（測試）、#18（架構理解），React 進階 #11 升 level 5，Tailwind #8 升 level 4

---

## 🔧 Agent 和 Skill

| 類型 | 名稱 | 用途 |
|------|------|------|
| Agent | `skill-tree-reviewer` | 分析 git log → 評估技能 → 更新 JSON |
| Skill | `/skill-tree-review` | 觸發評估的快捷指令 |

### 手動更新 JSON

如果要手動調整（不透過 agent）：

```bash
# SOT path（staging dashboard 從此讀）
vim frontend/public/intern-training/interns/raymond.json

# 啟翔
vim frontend/public/intern-training/interns/xiung.json
```

JSON 格式（現行 schema）：
```json
{
  "name": "Raymond",
  "lastReview": "2026-05-14",   // 上次評估日期
  "skills": {
    "1": {
      "level": 3,
      "maxLevel": 5,
      "history": [{ "date": "...", "level": 3, "reason": "..." }]
    }
  },
  "recommendations": ["建議"],
  "summary": "本次評估摘要"
}
```

---

## 📅 建議週期

| 頻率 | 動作 |
|------|------|
| 每週五 | `/skill-tree-review` 更新進度 |
| 每月一次 | 1-on-1 回顧（看技能樹 + 討論成長） |
| 每次 PR merge | 檢查是否有新技能可解鎖 |

---

*Cheat Sheet v1.0 | 2026-03-13*
