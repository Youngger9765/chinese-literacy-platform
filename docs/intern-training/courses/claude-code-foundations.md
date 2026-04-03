# Claude Code 基礎 — 實習生必修

> 對應 VCA 課程：https://young-tsai.vercel.app/zh-TW/private/vca-curriculum
> 目標：讓實習生從「手動寫 code」升級到「管 AI 幫你做事」

---

## 為什麼要學

你們現在已經會寫 React、會修 bug、會開 PR。但接下來的效率瓶頸不是「你寫得多快」，而是「你能不能讓 AI 幫你做事，而且做對」

這不是學 prompt，是學**治理**——怎麼讓 AI 不失控、怎麼用物理限制取代口頭提醒、怎麼從踩坑中長出規則

---

## 學習路徑（對應 VCA M0-M5）

### Level 1：會用 Claude Code（對應 VCA M0）

**前置**：Git 工作流（技能 #9）已完成

| 項目 | 怎麼練 | 通過標準 |
|------|--------|---------|
| 安裝 Claude Code | `npm install -g @anthropic-ai/claude-code` | 能在 terminal 跑 `claude` |
| 基本對話 | 問 Claude 問題、讓它讀檔案 | 能讓 Claude 讀懂一個 component |
| 讓 Claude 改 code | 給 issue，讓 Claude 修 | 一個 PR 是 Claude 幫你寫的 |
| Plan Mode | 大任務先 plan 再做 | 用過一次 plan mode |

### Level 2：會寫 CLAUDE.md（對應 VCA M1）

| 項目 | 怎麼練 | 通過標準 |
|------|--------|---------|
| 理解 CLAUDE.md 結構 | 讀 LingoLeap 的 CLAUDE.md | 能說出每個 section 的用途 |
| 寫自己的 CLAUDE.md | 在個人專案寫一份 | 包含：專案背景、技術架構、開發規則 |
| Rules 目錄 | 寫 `.claude/rules/` 路徑規則 | 至少 1 條 rule |

### Level 3：會寫 Skill（對應 VCA M2）

| 項目 | 怎麼練 | 通過標準 |
|------|--------|---------|
| 理解 Skill 是什麼 | 讀 `~/.claude/skills/` 裡的範例 | 能說出 skill vs agent 的差別 |
| 寫一個 global skill | 把你常做的事寫成 skill | 能用 `/my-skill` 觸發 |
| 用 skill 自動化工作流 | 例如 commit + push + PR 一鍵完成 | 實際省下重複操作 |

### Level 4：會寫 Hook（對應 VCA M3）

| 項目 | 怎麼練 | 通過標準 |
|------|--------|---------|
| 理解 Hook 是什麼 | 讀 LingoLeap 的 hooks（`.claude/hooks/`） | 能說出 PreToolUse vs PostToolUse |
| 寫一個防護 hook | 例如：禁止在 main branch 直接編輯 | hook 實際擋住一次錯誤操作 |
| 從踩坑中長出 hook | 犯了一個錯 → 寫 hook 防止再犯 | postmortem → hook 的完整流程 |

### Level 5：會用 Agent（對應 VCA M4）

| 項目 | 怎麼練 | 通過標準 |
|------|--------|---------|
| 理解 Agent 是什麼 | 讀 `~/.claude/agents/` 裡的範例 | 能說出 agent vs skill 的差別 |
| 用 worktree 平行開發 | 同時做兩個 issue | 兩個 worktree 不互相干擾 |
| 寫一個自訂 agent | 例如：code-review agent | agent 能獨立完成一個任務 |

---

## 怎麼開始

1. 先確認你有 Claude Code（問 Young）
2. 從 Level 1 開始，每個 level 大約 1-2 週
3. 每完成一個 level，在 PR 留言說「我完成了 Claude Code Level X」
4. Young 會更新你的技能樹

---

## VCA 完整課程參考

如果想深入學：
- 修練場（按順序學基礎）：https://young-tsai.vercel.app/zh-TW/private/vca/curriculum
- RPG 模式（設定目標，動態安排）：https://young-tsai.vercel.app/zh-TW/private/vca/rpg
- 課程架構總覽：https://young-tsai.vercel.app/zh-TW/private/vca-curriculum

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

這六層就是你管 AI 的工具。學會了，你就不只是「會寫 code」，你是「會管 AI 幫你做事」
