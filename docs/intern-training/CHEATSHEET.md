# 實習生技能樹 — Claude MD Cheat Sheet

> 快速參考：怎麼用 Claude Code 管理實習生技能樹

---

## 📁 檔案結構

```
docs/intern-training/
├── skill-tree.html              ← 互動式技能樹（瀏覽器開啟）
├── PBL-curriculum.md            ← PBL 課程綱要
├── CHEATSHEET.md                ← 本文件
├── interns/
│   ├── raymond.json             ← 靖杭進度 (completed, reviewNotes)
│   └── xiung.json               ← 啟翔進度
└── courses/                     ← 20 堂教材
    ├── README.md                ← 教材索引
    ├── tier1-git-basics.md
    ├── tier1-html-css.md
    ├── tier1-javascript.md
    ├── tier1-dev-environment.md
    ├── tier1-reading-code.md
    ├── tier2-react-components.md
    ├── tier2-typescript.md
    ├── tier2-tailwind.md
    ├── tier2-git-workflow.md
    ├── tier2-bug-fixing.md
    ├── tier3-react-advanced.md
    ├── tier3-api-integration.md
    ├── tier3-component-patterns.md
    ├── tier3-testing.md
    ├── tier3-code-review.md
    ├── tier4-feature-development.md
    ├── tier4-performance.md
    ├── tier4-architecture.md
    ├── tier4-documentation.md
    └── tier4-mentoring.md
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

## 👥 目前進度 (2026-03-13)

### Raymond (靖杭 @if-else-master)

```
已解鎖：6/20 (85 XP)
Tier 1: ████████████████████ 5/5
Tier 2: ██                   1/5 (#10 Bug修復)
Tier 3: ─────────────────── 0/5
Tier 4: ─────────────────── 0/5
```

**強項**：積極嘗試新功能、能獨立修 bug
**建議**：學 React 元件開發 (#6)、改善 commit message 格式

### Steven (啟翔 @stgst)

```
已解鎖：10/20 (215 XP)
Tier 1: ████████████████████ 5/5
Tier 2: ████████████████     4/5 (缺 #7 TypeScript)
Tier 3: ████                 1/5 (#11 React 進階)
Tier 4: ─────────────────── 0/5
```

**強項**：程式碼品質高、React hooks 理解深、UX 改善有深度
**建議**：學 TypeScript (#7)、嘗試 API 串接 (#12)

---

## 🔧 Agent 和 Skill

| 類型 | 名稱 | 用途 |
|------|------|------|
| Agent | `skill-tree-reviewer` | 分析 git log → 評估技能 → 更新 JSON |
| Skill | `/skill-tree-review` | 觸發評估的快捷指令 |

### 手動更新 JSON

如果要手動調整（不透過 agent）：

```bash
# 編輯靖杭的進度
vim docs/intern-training/interns/raymond.json

# 編輯啟翔的進度
vim docs/intern-training/interns/xiung.json
```

JSON 格式：
```json
{
  "completed": [1, 2, 3],       // 已完成的技能 ID
  "lastReview": "2026-03-13",   // 上次評估日期
  "reviewNotes": { "1": "證據" }, // 每個技能的通過證據
  "recommendations": ["建議"]    // 下一步建議
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
