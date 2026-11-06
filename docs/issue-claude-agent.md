# 在 issue 裡 @claude：自動開工代理怎麼用

> 完整流程與分工（誰在什麼時候做什麼）→ [issue-claude-agent-flow.md](issue-claude-agent-flow.md)

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
- 它不會自己 merge —— PR 一律由工程師審核後合併。合併進 staging 時預覽環境
  會自動清理；**issue 要等 staging→main 的 release 才會自動關**（GitHub 的
  自動關票只認預設分支），想早點關手動關即可
- 每一則它的留言都以「🤖 由 Claude AI 代發」開頭

## 已知限制與安全設計（工程師必讀）

- **prompt injection 面（2026-11 重設計）**：repo 公開，issue 內文可能
  來自路人；觸發 gate 只擋「誰能觸發」，擋不了「討論串其餘部分是誰
  寫的」——這正是 Claude Security finding `find_01G9Gm8oJ3dRZN4X2HMbQoP7`
  點名的缺口。緩解不再只靠「prompt 叫它不要聽」（模型 judgement），
  改成工具政策本身做不到：
  - agent 這一步**完全沒有 Bash**（也沒有 WebFetch/WebSearch/Agent），
    只有 Read/Grep/Glob/Edit/Write —— 沒有任何管道可以執行指令或對外
    連線
  - 餵給 agent 的討論串文字，由一個**信任的**（不是 agent 的）
    Python 腳本（`.github/scripts/fetch_trusted_issue_context.py`）先
    過濾：只有 issue 本身與留言的作者是 OWNER/MEMBER/COLLABORATOR
    的文字才會進去，且每一段都先剝掉 HTML 註解
  - agent 讀寫範圍鎖在 checkout 裡：擋 `.git/**`／`/proc/**`／
    `~/**`／runner temp，並用官方的
    `blockReadsOutsideWorkingDirectories`/`blockWritesOutsideWorkingDirectories`
    把「checkout 以外的任何路徑」整塊擋死（語法：
    https://code.claude.com/docs/en/permissions#permission-rule-syntax ）
  - **整支 workflow 拆成兩個 job**（對抗式複審抓到的洞：agent 雖然
    沒有 Bash，但仍有 Edit/Write 能碰到 `.github/scripts/*.py` 這些
    信任腳本自己的原始碼——如果信任腳本跟 agent 共用同一個
    checkout，後面執行的就可能是被 agent 竄改過的版本）：
    - `agent` job：讀 issue、想、寫報告，**從不 commit/push/開 PR**，
      job 權限只有 `issues: write`。結束後把「agent 實際改了什麼」
      封裝成 artifact（純 `git -c core.quotepath=false diff --cached
      --binary` 產生的 patch 檔，沒有自訂腳本）。
    - `publish` job：在**全新的 runner、全新的 checkout**（釘住
      agent job 開始時的那個 commit）上跑，agent 的 Edit/Write 從來
      沒機會碰過這裡的任何檔案。只看 patch 檔的**文字內容**（從
      `diff --git` header 解析出改了哪些路徑）做決定：拒絕動到
      `.github/**`、`.git/**`、任何 `conftest.py`、`scripts/**`、
      `entrypoint.sh`、`Dockerfile*`；對**整份 patch 文字**跑
      gitleaks（sha256 驗證過下載檔）＋ 不需網路的 regex 掃描
      ——連 agent 自己寫的報告文字（留言、PR 標題/內文）也要過
      同一套掃描才能發佈，連「沒有檔案改動」那條路徑都要掃。
      三關都過才 apply patch、commit、push（不無條件 force——只有
      遠端分支目前的 tip 就是這個 bot 自己之前推的，才允許覆蓋）、
      開 PR。
- **GITHUB_TOKEN 開的 PR 不會自動觸發 CI/preview**（GitHub 防遞迴設計，
  這點不受上面的重設計影響 —— 信任步驟一樣是用這個 job 的
  `GITHUB_TOKEN` push/開 PR）。一次性解法：Young 跑 `claude` →
  `/install-github-app` 裝 Claude GitHub App 並改走 app token。
  裝之前的過渡：reviewer 對 agent 的 PR push 空 commit 或
  close/reopen 即可觸發。
- **3 輪上限由信任腳本算，不是模型自己數**：
  `fetch_trusted_issue_context.py` 數 bot 自己發過幾次留言
  （比對 login，不是比對 association —— 實測對這個 repo 自己的歷史
  `gh issue view --json comments` 確認過：bot 用預設 `GITHUB_TOKEN`
  發文時 `author.login` 是 `"github-actions"`、`authorAssociation`
  是 `"CONTRIBUTOR"`，不是猜測的 `NONE`；`CONTRIBUTOR` 剛好也是一般
  外部使用者的 association，所以這條鎖必須比對 login 不能比對
  association），達 3 輪直接跳過 agent 那一步，不交給模型自己判斷
  「這是不是第 4 輪了」。
- **並發**：同一 issue 的重複 @claude 走 concurrency group 排隊不疊跑。
- **額度**：每次觸發吃 Young 的訂閱；timeout 45 分鐘上限。

## 給工程師的維運備註

- workflow：`.github/workflows/claude-issue-agent.yml`（#3055）
- 授權走 `author_association`（OWNER/MEMBER/COLLABORATOR）——
  加人 = 加 collaborator，不改 workflow
- PR 上的 @claude 歸 `claude-pr-review.yml`，兩支條件互斥
- 認證共用 `CLAUDE_CODE_OAUTH_TOKEN` secret
- issue 事件讀 **main** 的 workflow 定義 —— 改這支要上 main 才生效
