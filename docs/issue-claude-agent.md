# 在 issue 裡 @claude：自動開工代理怎麼用

> 給方大哥、Hans、老師們 —— 不用會寫程式。

## 怎麼用（兩步）

1. **開一張 issue**，把問題講清楚：
   - 你在哪一頁、做了什麼、看到什麼（bug）
   - 或你希望多什麼功能、為什麼（feature）
2. 內文或留言裡加上 **@claude** —— 它就會開工，之後的進度都會
   留言在同一張 issue 裡

## 它會做什麼

| 情況 | 它的行為 |
|---|---|
| bug | 先在測試環境**重現**，重現到才修；重現不了會留言問你重現步驟 |
| feature | 先留言**規模評估與 PRD**（要改什麼、怎麼驗收），小的直接做 |
| 太大的 feature | 不硬做 —— 留言說明為什麼超標，請找工程師實作 |
| 看不懂／誤發 | 留言請你補充，不會猜著做 |

做完會開 PR 並部署一個**預覽環境**，把連結和驗收步驟留言給你 ——
你點連結實際看，對就說對，不對就回哪裡不對。

## 護欄（設計如此，不是壞掉）

- **同一張 issue 修 3 輪還沒好就會停手**，留言總結並建議找工程師
  —— 它不會無限鬼打牆
- 只有**專案協作者**的 @claude 會觸發；路人可以發 issue 但叫不動它
- 它不會自己 merge —— PR 一律由人審核後合併，合併後 issue 自動關閉、
  預覽環境自動清理
- 每一則它的留言都以「🤖 由 Claude AI 代發」開頭

## 已知限制與安全設計（工程師必讀）

- **prompt injection 面**：repo 公開，issue 內文可能來自路人；gate 只擋
  「誰能觸發」，擋不了「內文誰寫的」。緩解：prompt 明令內文是資料不是
  指令＋可疑指令即停＋ **allowedTools 沒有 curl**（2026-05 Microsoft
  披露的同型攻擊正是注入後用網路工具外送 runner secrets）。
  觸發前仍建議人先掃一眼 issue 內文有沒有奇怪的指令字句。
- **GITHUB_TOKEN 開的 PR 不會自動觸發 CI/preview**（GitHub 防遞迴設計）。
  一次性解法：Young 跑 `claude` → `/install-github-app` 裝 Claude GitHub
  App，action 改用 app token 後 PR 會正常觸發。裝之前的過渡：reviewer
  對 agent 的 PR push 空 commit 或 close/reopen 即可觸發。
- **並發**：同一 issue 的重複 @claude 走 concurrency group 排隊不疊跑。
- **額度**：每次觸發吃 Young 的訂閱；timeout 45 分鐘上限。

## 給工程師的維運備註

- workflow：`.github/workflows/claude-issue-agent.yml`（#3055）
- 授權走 `author_association`（OWNER/MEMBER/COLLABORATOR）——
  加人 = 加 collaborator，不改 workflow
- PR 上的 @claude 歸 `claude-pr-review.yml`，兩支條件互斥
- 認證共用 `CLAUDE_CODE_OAUTH_TOKEN` secret
- issue 事件讀 **main** 的 workflow 定義 —— 改這支要上 main 才生效
