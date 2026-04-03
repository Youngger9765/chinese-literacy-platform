# Claude Code 基礎 — 實習生必修

> VCA 課程：https://young-tsai.vercel.app/zh-TW/private/vca-curriculum
> 目標：從「手動寫 code」升級到「管 AI 幫你做事」

---

## 為什麼要學

你們已經會寫 React、會修 bug、會開 PR

但你有沒有發現，你花最多時間的不是「寫 code」，而是：
- 查怎麼寫（Google / Stack Overflow）
- 找 bug 在哪（console.log 到處放）
- 重複做一樣的事（開 branch、commit、push、開 PR）

Claude Code 可以幫你做這些。但你要學的不是「怎麼跟 AI 聊天」，而是**怎麼管 AI**

就像你不會讓一個新同事自己亂做事，你會：
1. 給他公司規則（CLAUDE.md）
2. 給他 SOP（Skill）
3. 設紅線不能踩（Hook）
4. 讓他獨立出任務（Agent）

---

## Level 1：會用 Claude Code

**前置**：你已經會用 Git（技能 #9）

### 1.1 安裝

```bash
npm install -g @anthropic-ai/claude-code
```

裝好後在 terminal 打 `claude`，看到歡迎畫面就成功了

### 1.2 第一次用：讀懂一個 component

打開 LingoLeap 專案，跟 Claude 說：

```
讀一下 frontend/src/components/reading-steps/VocabPractice.tsx
告訴我這個 component 做了什麼
```

Claude 會讀這個檔案然後跟你解釋。**你不用自己一行一行看了**

### 1.3 讓 Claude 修 bug

找一個你被 assign 的 issue，例如 #924（進度條顏色改綠色），跟 Claude 說：

```
看一下 issue #924，進度條的「已完成」顏色要從黃色改成綠色
幫我找到相關的 code 並修改
```

Claude 會：
1. 搜尋 codebase 找到進度條的 component
2. 找到顏色定義的地方
3. 幫你改好
4. 你 review 後 commit

**你的第一個 PR 就是 Claude 幫你寫的**

### 1.4 Plan Mode：大任務先想再做

如果任務比較大（改 3 個以上的檔案），先進 Plan Mode：

```
/plan
```

Claude 會先列出計畫，你確認後再執行。這比直接讓它亂改安全得多

### 1.5 LingoLeap 真實範例

今天 Young 用 Claude Code 做了什麼：
- 6 項 UI 改善（52 個檔案）— 用 3 個平行 agent 同時改
- 55 課 vocab_bank 自動生成 — 寫 Python 腳本 + Gemini AI 配對
- 報告頁 422 修復 — Claude 找到根因 + 修 + 寫測試

這些如果手動做，大概要 2-3 天。用 Claude Code 幾個小時就搞定

### ✅ 通過標準

- [ ] Claude Code 裝好能跑
- [ ] 用 Claude 讀懂一個 LingoLeap component
- [ ] 至少一個 PR 的主要程式碼是 Claude 幫寫的

---

## Level 2：會寫 CLAUDE.md

CLAUDE.md 就是你給 AI 的「公司章程」。Claude Code 每次啟動都會讀它

### 2.1 讀 LingoLeap 的 CLAUDE.md

```bash
cat CLAUDE.md
```

注意看這些 section：
- **專案背景** — Claude 需要知道這是什麼專案
- **技術架構** — 用什麼技術、部署在哪
- **Git Branch Strategy** — 怎麼開 branch、怎麼 merge
- **開發規則** — Conventional Commits、不能 commit secrets

**問自己**：如果你是新來的工程師，看完這份文件你能開始工作嗎？

### 2.2 寫自己的 CLAUDE.md

挑一個你自己的 side project（或新建一個），寫一份 CLAUDE.md：

```markdown
# CLAUDE.md — [你的專案名]

## 專案背景
這是一個 [幹什麼的] 專案

## 技術架構
- 前端：React / Next.js / ...
- 後端：...
- 部署：...

## 開發規則
- Commit message 用 conventional commits
- 不要 commit .env
```

寫完後用 Claude Code 在這個專案裡工作，看它是不是真的遵守你的規則

### 2.3 Rules 目錄

LingoLeap 有 `.claude/rules/` 目錄，裡面放路徑規則。例如：

```
# .claude/rules/frontend.md
前端檔案在 frontend/src/ 下
用 Tailwind CSS 不要寫 inline style
component 不超過 300 行
```

你也在自己的專案試試看

### ✅ 通過標準

- [ ] 能說出 LingoLeap CLAUDE.md 每個 section 的用途
- [ ] 在個人專案寫了一份 CLAUDE.md，Claude 實際遵守你的規則
- [ ] 至少寫了 1 條 rule

---

## Level 3：會寫 Skill

Skill = 你教 AI 的 SOP。你做過 3 次以上的事，就該寫成 skill

### 3.1 Skill 跟 Agent 差在哪

| | Skill | Agent |
|---|---|---|
| 執行方式 | 在主對話裡執行 | 開新的隔離 session |
| 用途 | 流程模板（研究、審查） | 需要獨立工作的任務 |
| 觸發 | `/skill-name` | 自動或手動 spawn |
| Context | 共用主對話 | 獨立 context |

**簡單說**：skill 是你教 AI 的食譜，agent 是你派出去的外送員

### 3.2 你的第一個 Skill

想想你重複做最多的事。例如：

**「每次做 issue 都要：開 branch → 改 code → commit → push → 開 PR」**

寫成 skill：

```bash
mkdir -p ~/.claude/skills
```

建立 `~/.claude/skills/do-issue/SKILL.md`：

```markdown
---
name: do-issue
description: 從 issue 到 PR 的完整流程
user-invocable: true
---

# /do-issue

當 user 說 /do-issue #N：

1. `gh issue view N` 讀 issue 內容
2. 從 staging 開 feature branch: `git checkout -b fix/issue-N staging`
3. 根據 issue 描述修改程式碼
4. `git add` + `git commit` (conventional commits)
5. `git push -u origin fix/issue-N`
6. `gh pr create` 開 PR 到 staging
```

然後用用看：

```
/do-issue #924
```

Claude 就會照你的 SOP 做。**你從打 10 個指令變成打 1 個**

### 3.3 Global vs Project Skill

```
~/.claude/skills/        ← global（所有專案都能用）
.claude/skills/          ← project（只有這個專案能用）
```

**會議上 Young 說的**：盡量做 global，這樣換專案不用重寫

### ✅ 通過標準

- [ ] 能說出 skill vs agent 的差別
- [ ] 寫了一個 global skill
- [ ] 實際用這個 skill 完成一個任務

---

## Level 4：會寫 Hook

Hook = 物理限制。不是「提醒」AI 不要做，是「讓它做不到」

### 4.1 Hook 的種類

| Event | 什麼時候觸發 | 用途 |
|-------|------------|------|
| PreToolUse | AI 要用工具之前 | 擋住危險操作 |
| PostToolUse | AI 用完工具之後 | 檢查結果 |
| UserPromptSubmit | 你送出訊息時 | 加上下文提醒 |

### 4.2 LingoLeap 的真實 Hook

我們有一個 `pre-edit-branch-guard.sh`：

```bash
# 如果在 main 或 staging branch，禁止直接編輯原始碼
BRANCH=$(git branch --show-current)
if [[ "$BRANCH" == "main" || "$BRANCH" == "staging" ]]; then
  echo "❌ 不能在 $BRANCH 直接改 code，請用 feature branch"
  exit 2  # exit 2 = 擋住這個操作
fi
```

這個 hook 讓 Claude **物理上不可能**在 main branch 改 code。不是靠提醒，是直接擋住

### 4.3 從踩坑長出 Hook

流程：
1. 你犯了一個錯（例如：不小心在 staging push 了未完成的 code）
2. 事後反省：「怎麼防止下次再犯？」
3. 寫一個 hook 擋住這個操作
4. 下次 Claude 想做同樣的事，hook 擋住，你就安全了

**這就是 Anthropic 說的「Postmortem 驅動」**

### 4.4 你的第一個 Hook

在 `~/.claude/hooks.json` 加：

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "command": "echo '⚠️ 確認你在正確的 branch'"
      }
    ]
  }
}
```

這個 hook 每次 Claude 要跑 bash 指令前都會提醒你。之後你可以改成更有用的檢查

### ✅ 通過標準

- [ ] 能說出 PreToolUse vs PostToolUse 的差別
- [ ] 寫了一個防護 hook
- [ ] 這個 hook 在真實情境中擋住了一次錯誤

---

## Level 5：會用 Agent + Worktree

### 5.1 Worktree：同時做兩個 Issue

問題：你在做 issue A，做到一半想先做 issue B。但 branch 切換會弄髒 working tree

解法：

```
跟 Claude 說：
"用 worktree 幫我做 issue #927，不要影響我現在的 branch"
```

Claude 會：
1. `git worktree add` 建一個新資料夾
2. 在新資料夾裡做 issue B
3. 你的 issue A 完全不受影響

**你同時有兩個 Claude 在幫你做事**

### 5.2 Agent：讓 AI 獨立完成任務

Agent 跟 Skill 的差別：Skill 是你在旁邊看著做，Agent 是你派出去自己做

```
跟 Claude 說：
"spawn 一個 agent 幫我 review PR #913"
```

Claude 會開一個獨立的 session，讀 PR diff，給 review 意見，完全不打擾你現在的工作

### 5.3 寫自己的 Agent

建立 `~/.claude/agents/my-reviewer.md`：

```markdown
---
name: my-reviewer
description: Review PR for code quality
tools: ["Read", "Grep", "Bash"]
---

你是一個 code reviewer。

收到 PR 號碼後：
1. `gh pr diff N` 看 diff
2. 檢查：有沒有 bug？style 一致嗎？有沒有安全問題？
3. 給出具體的修改建議
```

### ✅ 通過標準

- [ ] 用 worktree 同時做過兩個 issue
- [ ] 寫了一個自訂 agent
- [ ] agent 獨立完成了一個任務

---

## Anthropic 六層架構（背下來）

```
CLAUDE.md    — 公司章程（永遠載入）
Rules        — 路徑規則（按目錄載入）
Skills       — SOP 手冊（按需載入）
Hooks        — 合規部門（物理限制）
Agents       — 員工（獨立工作）
Verifiers    — 稽核（驗證產出）
```

這六層就是你管 AI 的完整工具箱

---

## VCA 課程連結

想深入學，去 Young 的 VCA 課程：
- 修練場：https://young-tsai.vercel.app/zh-TW/private/vca/curriculum
- RPG 實戰：https://young-tsai.vercel.app/zh-TW/private/vca/rpg
- 課程架構：https://young-tsai.vercel.app/zh-TW/private/vca-curriculum
