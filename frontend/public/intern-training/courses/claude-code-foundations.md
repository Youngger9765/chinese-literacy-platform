# Claude Code 學習指南

---

## 學習資源

| 資源 | 用途 | 連結 |
|------|------|------|
| **Anthropic 官方文件** | 權威參考，所有功能的完整說明 | https://code.claude.com/docs/en/overview |
| **claude.nagdy.me** | 互動練習，有 terminal simulator + quiz | https://claude.nagdy.me |
| **VCA 進階課程** | AI Agent 治理，Young 的課程 | https://young-tsai.vercel.app/zh-TW/private/vca-curriculum |

---

## 11 個模組

### 基礎（第 1-2 週）

#### 模組 1：Slash Commands

| | |
|---|---|
| 學什麼 | `/help` `/compact` `/clear` `/plan` 等內建指令 |
| 官方文件 | [CLI Reference](https://code.claude.com/docs/en/cli-reference) |
| 互動練習 | [nagdy.me/learn/slash-commands](https://claude.nagdy.me/learn/slash-commands) |
| 技能樹 | #21 Claude Code 基礎 |

**重點指令**：
- `/help` — 看所有可用指令
- `/compact` — 壓縮對話（context 太長時用）
- `/clear` — 清除對話重新開始
- `/plan` — 進入 Plan Mode（大任務先規劃再做）
- `Esc+Esc` — 從 cursor 位置壓縮

**驗證**：你在 terminal demo 給 Young 看，能流暢使用 5 個以上指令

---

#### 模組 2：Memory & CLAUDE.md

| | |
|---|---|
| 學什麼 | CLAUDE.md 結構、auto memory、instructions |
| 官方文件 | [Store instructions and memories](https://code.claude.com/docs/en/memory) |
| 互動練習 | [nagdy.me/learn/memory-claude-md](https://claude.nagdy.me/learn/memory-claude-md) |
| 技能樹 | #22 CLAUDE.md 撰寫 |

**重點**：
- CLAUDE.md 是 Claude Code 每次啟動都會讀的「公司章程」
- 三層 CLAUDE.md：`~/.claude/CLAUDE.md`（global）→ 專案根目錄 `CLAUDE.md` → `.claude/rules/`（路徑規則）
- Auto memory：Claude 自動記住你的偏好，存在 `.claude/memory/`

**作業**：讀 LingoLeap 的 `CLAUDE.md`，能回答「Git Branch Strategy 那段在說什麼」「為什麼不能在 main branch 直接改 code」

**驗證**：口頭問答

---

#### 模組 3：Project Setup

| | |
|---|---|
| 學什麼 | `.claude/` 目錄結構、settings、permission modes |
| 官方文件 | [Explore the .claude directory](https://code.claude.com/docs/en/claude-directory) · [Permission modes](https://code.claude.com/docs/en/permission-modes) |
| 互動練習 | [nagdy.me/learn/project-setup](https://claude.nagdy.me/learn/project-setup) |
| 技能樹 | #22 CLAUDE.md 撰寫 |

**重點**：
```
.claude/
├── CLAUDE.md          ← 專案指令
├── rules/             ← 路徑規則
├── settings.json      ← 權限設定
├── memory/            ← auto memory
└── hooks/             ← hook 腳本
```

**作業**：在自己的 side project 建一份 CLAUDE.md + `.claude/` 結構

**驗證**：`ls 你的專案/.claude/` + `cat 你的專案/CLAUDE.md`

---

#### 模組 4：Commands Deep Dive

| | |
|---|---|
| 學什麼 | Plan Mode、context window 管理、進階指令 |
| 官方文件 | [Common workflows](https://code.claude.com/docs/en/common-workflows) · [Best practices](https://code.claude.com/docs/en/best-practices) · [Context window](https://code.claude.com/docs/en/context-window) |
| 互動練習 | [nagdy.me/learn/commands-deep-dive](https://claude.nagdy.me/learn/commands-deep-dive) |
| 技能樹 | #21 Claude Code 基礎 |

**重點**：
- Plan Mode：大任務（3+ 檔案）先 plan 再做
- Context 管理：用 `/compact` 壓縮、`/clear` 重開
- `--add-dir`：跨 repo 工作
- `--bare`：自動化腳本用（跳過 CLAUDE.md + MCP）

**作業**：用 Plan Mode 完成一個 LingoLeap issue（至少改 3 個檔案）

**驗證**：git log 裡有 Claude Code 產出的 commit

---

### 中級（第 3-4 週）

#### 模組 5：Skills

| | |
|---|---|
| 學什麼 | 寫 SKILL.md、global vs project skill、觸發設計 |
| 官方文件 | [Custom commands (Skills)](https://code.claude.com/docs/en/skills) |
| 互動練習 | [nagdy.me/learn/skills](https://claude.nagdy.me/learn/skills) |
| Config Builder | [nagdy.me/config-builder](https://claude.nagdy.me/config-builder)（生成 skill 模板） |
| 技能樹 | #23 Skill 撰寫 |

**Skill vs Agent**：
- Skill = SOP 手冊（在主對話裡按流程做）
- Agent = 員工（獨立 session，自己做完回報）

**作業**：寫一個 global skill（例如 `/do-issue` 自動化 issue→branch→commit→PR）

**驗證**：`ls ~/.claude/skills/*/SKILL.md` 有你的 skill，且實際用過

---

#### 模組 6：Hooks

| | |
|---|---|
| 學什麼 | PreToolUse / PostToolUse / Stop hooks，bash hook vs prompt hook |
| 官方文件 | [Hooks](https://code.claude.com/docs/en/hooks) |
| 互動練習 | [nagdy.me/learn/hooks](https://claude.nagdy.me/learn/hooks) |
| 技能樹 | #24 Hook 撰寫 |

**Hook 種類**：

| Event | 觸發時機 | 用途 |
|-------|---------|------|
| PreToolUse | AI 要用工具之前 | 擋住危險操作 |
| PostToolUse | AI 用完工具之後 | 檢查結果 |
| UserPromptSubmit | 你送出訊息時 | 加上下文 |
| Stop | AI 說完成時 | 強制驗證 |

**LingoLeap 真實範例**：`pre-edit-branch-guard.sh` — 禁止在 main/staging 直接改 code

**作業**：寫一個 hook，從踩坑中長出來（犯錯 → postmortem → 寫 hook）

**驗證**：hook 實際擋住過一次錯誤（截圖）

---

#### 模組 7：MCP Servers

| | |
|---|---|
| 學什麼 | Model Context Protocol，讓 Claude 連接外部工具 |
| 官方文件 | [MCP](https://code.claude.com/docs/en/mcp) |
| 互動練習 | [nagdy.me/learn/mcp-servers](https://claude.nagdy.me/learn/mcp-servers) |
| 技能樹 | — |

**重點**：MCP 讓 Claude Code 可以操作瀏覽器、DB、API 等外部服務。LingoLeap 用 Chrome MCP 做 QA

**作業**：看懂 LingoLeap 的 `.mcp.json` 設定

**驗證**：口頭問你 MCP 跟直接 curl API 差在哪

---

#### 模組 8：Subagents

| | |
|---|---|
| 學什麼 | spawn agent、worktree、平行開發 |
| 官方文件 | [Sub-agents](https://code.claude.com/docs/en/sub-agents) |
| 互動練習 | [nagdy.me/learn/subagents](https://claude.nagdy.me/learn/subagents) |
| 技能樹 | #25 Worktree · #26 Agent 撰寫 |

**重點**：
- Worktree：`git worktree add` 讓你同時做多個 issue
- Subagent：spawn 獨立 agent 做任務（review PR、research、bug fix）
- 平行：同時跑 3-5 個 agent，各自在 worktree 裡工作

**作業**：用 worktree 同時做兩個 issue，兩個 PR 各自 merge

**驗證**：`git worktree list` 有記錄

---

### 進階（有興趣再學）

#### 模組 9：Advanced Features

| | |
|---|---|
| 官方文件 | [Features overview](https://code.claude.com/docs/en/features-overview) |
| 互動練習 | [nagdy.me/learn/advanced-features](https://claude.nagdy.me/learn/advanced-features) |

`--add-dir` 跨 repo · vim mode · remote control · scheduled tasks

---

#### 模組 10：Workflows

| | |
|---|---|
| 官方文件 | [Common workflows](https://code.claude.com/docs/en/common-workflows) |
| 互動練習 | [nagdy.me/learn/workflows](https://claude.nagdy.me/learn/workflows) |

CI/CD 整合 · GitHub Actions · code review 自動化

---

#### 模組 11：Plugins

| | |
|---|---|
| 官方文件 | [Extend Claude Code](https://code.claude.com/docs/en/features-overview) |
| 互動練習 | [nagdy.me/learn/plugins](https://claude.nagdy.me/learn/plugins) |

Plugin = command + skill + hook + agent 打包成一個可分享的套件

---

## 六層架構

```
CLAUDE.md  — 公司章程     ← 模組 2, 3
Rules      — 路徑規則     ← 模組 3
Skills     — SOP 手冊     ← 模組 5
Hooks      — 合規部門     ← 模組 6
Agents     — 員工         ← 模組 8
Verifiers  — 稽核         ← 模組 10, 11
```

---

## 工具

| 工具 | 用途 | 連結 |
|------|------|------|
| Playground | 練指令（不用裝） | https://claude.nagdy.me/playground |
| Config Builder | 生成 CLAUDE.md / skill / hook 模板 | https://claude.nagdy.me/config-builder |
| Cheat Sheet | 快速參考表 | https://claude.nagdy.me/cheat-sheet |
| Feature Index | 搜尋所有功能 | https://claude.nagdy.me/feature-index |
