# LingoLeap 實習生第一次開會

**日期**：2026/02/27

---

## 一、專案介紹（10 min）

- 我們在做什麼：幫國小學生練習朗讀的 AI 平台
- 快速 demo 網站，跑一遍學習流程
- https://lingoleap-frontend-958347263320.asia-east1.run.app

## 二、Onboarding 確認（10 min）

- 確認大家有沒有完成 [onboarding.html](../onboarding.html) 的內容
- 環境建好了嗎？Git / Node / VS Code
- 有沒有卡關的地方？

## 三、開發流程說明（10 min）

- `git clone` + `npm install` + `npm run dev`
- Git flow：`feature branch` → `PR` → `staging` → `main`
- 怎麼認領 issue、怎麼開 PR

## 四、MVP 實測（15 min）

每個人打開 production 網站，自己跑一遍完整的學習流程：

https://lingoleap-frontend-958347263320.asia-east1.run.app

**測試步驟**：
1. 選一篇課文
2. 簡介 → 逐段朗讀 → 生字練習 → 課文理解 → 全文朗讀 → 報告
3. 走完整個流程

**記錄問題**：每人至少提出 3 個問題，開成 GitHub Issue
- 看到什麼覺得怪的？
- 哪裡卡住了？
- 哪裡看不懂？
- 文字太小？按鈕不好按？

**Issue 格式**：
- 標題：`[Bug/UI] 簡短描述`
- 內容：截圖 + 重現步驟 + 你覺得應該怎樣比較好

## 五、任務分配（10 min）

可認領的任務（每人先挑一個）：

| Issue | 說明 | 難度 |
|-------|------|------|
| [#130](https://github.com/Youngger9765/chinese-literacy-platform/issues/130) | Header 文字太小 | ⭐ |
| [#137](https://github.com/Youngger9765/chinese-literacy-platform/issues/137) | 報告頁 empty state 改善 | ⭐ |
| [#139](https://github.com/Youngger9765/chinese-literacy-platform/issues/139) | 生字練習 bug — 沒朗讀卻顯示「讀得很棒」 | ⭐⭐ |
| [#156](https://github.com/Youngger9765/chinese-literacy-platform/issues/156) | 文字比對顏色渲染測試 | ⭐ |
| [#110](https://github.com/Youngger9765/chinese-literacy-platform/issues/110) | 朗讀錯字 → 生字練習連動 | ⭐⭐ |

## 六、Q&A（5 min）

---

## 會議記錄

### Onboarding 回顧與技術背景盤點

主講人確認新成員已經上線測試平臺，並回顧 Onboarding 進度與卡關點。成員回報的主要技術障礙集中在 GCP 初次使用與登入指令的設定（需先下載工具與處理網路認證）；靖杭表示已能解決。主講人強調目前重點在於熟練流程。

為利後續分工，主講人盤點大家的資料庫與後端經驗：

- **啟翔**：有雲端 DB 使用經驗（MongoDB Atlas），早期使用 SQLite，後因黑客松轉向 NoSQL。對 Schema 有聽過且能在 AI 輔助下操作，但若從零開始會較慢。
- **靖杭**：曾用 AWS 免費版資料庫，過去以 SQL 指令直接建立結構；現階段多以 AI 生成 SQL 操作，未深入 Schema 設計。未使用過關聯式資料庫、亦未親自建立 Schema。

主講人補充關聯式資料庫與 SQLite/MongoDB 等的差異在結構化設計（後者偏 Dictionary/Hash、key-value 模式）。

主講人初步歸納：
- 啟翔在後端（API 與 DB）具一定經驗與可操作性
- 靖杭以往偏前端開發為主
- 現有基礎建設已備妥，不需從零開始

### 開發流程與 Git 協作模式詳解

團隊採用 **GitHub Issues** 進行任務管理：Issue 可視為待辦清單，用以記錄新功能、bug 與待解問題。建立 Issue 時可先簡要撰寫 title 並指派（assign），label 初期不強求完整；AI 可協助補全敘述格式。開發過程可於 Issue 留言更新進度，完成後由主講人關閉 Issue。

**Git Branch 的工作流**：
- Main/Master 為主線，避免直接在主線推送，以免多人協作時相互影響且難回溯
- 對應 Issue 建立 Feature Branch（如 Feature A、Feature B），各自獨立開發，必要時在 Feature 下再開子 Branch（A1、A2、A3）做細分
- 功能完成後以 Pull Request（PR）排隊準備合併至 Staging 或 Main；Merge 時可能產生 Conflict，需解決

**環境與部署**：
- Main 為使用者實際使用的線上版本；Staging 為上線前的最後測試與反悔機會
- 現行策略為：所有 Feature 先合併至 Staging 測試，確認無誤後再統一上線至 Main
- 為避免誤操作，Staging 與 Master 已鎖定，不允許直接開發與推送
- 透過 CI/CD 自動部署至 GCP：系統保存 Secret Key 與 API Key 以授權部署；外部伺服器無法像 GitHub Pages 直接連動，需 CI/CD 串接
- 自動化尚可拓展為半夜累積 bug 自動寫成 Issue、費用監控等

**文件維護**：
- PRD 可透過 Issue 進行討論與修改
- 若前端 Web Speech API 未來升級至 Azure，PRD 需相應更新，避免文件與實作脫節

**工具與操作提示**：
- 主講人使用 Cursor 並在 CLAUDE.md 撰寫 Guideline；成員可使用 VSCode 或其他 Copilot 介面
- 主講人提及即便開發十年也不常死背 Git 指令（如 git fetch）；鼓勵以 AI 推動意圖導向的指令執行，並請 AI 協助補救錯誤分支操作（如誤在 Staging 改動，請 AI 將變更移至正確 Branch）
- 建議在終端機顯示 Branch 名稱、善用 AI 將破碎敘述整理為完整 Issue

### 現有產品問題盤點與改善方向探討

針對中文學習平台進行實測後，團隊聚焦兩大問題：

#### 1. 朗讀功能的 UI/UX 引導不清

- 目前介面在點「開始朗讀」後顯示「準備好了，請開始朗讀」，但使用者不易理解要朗讀哪一段文本，需在左右欄間分心確認，導致流程不明確與體驗不佳
- 主講人與成員均在測試中遇到不一致與莫名錯誤訊息（瀏覽器支援跳錯、講話輸入混亂），判定存在 BUG 與引導不足
- **建議**：在 Issue 中清楚描述使用者體驗問題，並請 AI 協助剖析流程，提出改善方向；亦可思考是否移除右側側欄，改用更貼近國中小使用者習慣的角色引導（類 Vtuber），提升動機與專注度

#### 2. 語音辨識（STT）過於嚴格、容錯率低

- 使用者口音與重複朗讀（如「等」念三次）常被視為錯誤，造成挫折；主講人與成員在測試中皆遇到「捲舌音」判斷失敗的問題，顯示為廣泛現象
- 現行 STT 非 Whisper，使用瀏覽器原生方案；免費技術可能準確度不足

**潛在解法**：
1. **更換技術**：尋找更精準的開源或付費模型（如 OpenAI、Azure）
2. **後端彈性比對**：將標準答案與前端辨識結果丟給後端 Gemini，以「溫和堅定的國文老師」的寬鬆準則比對，容許小口音、重複朗讀等瑕疵，降低判定門檻（調整 threshold），以節省成本且免重新訓練
3. **自行訓練模型**：可行但成本高，須評估時間、費用與適用範圍（是否全站可用）

主講人建議先把遇到的事實開成 Issue，不預設解法的對錯；後續再討論技術選型、成本與擴展性。

#### MVP 優先策略

- 現階段主流程不需登入即可使用，資料不會持久化
- 後續主講人再處理班師生持久化與派作業、批改（含 AI 批改）等擴充
- 團隊現階段應集中火力改善「選課文→1-2-3-4-5-6」核心體驗
- 可思考遊戲化（像打怪）以提升學習動機
- Onboarding 與文件亦列入改善範疇：若覺得說明不清，可直接開 Issue 優化

### 任務指派與 AI 輔助開發實務

主講人示範如何以 AI 輔助開發，提高效率、降低手動操作複雜度：
- 以 Cursor/Copilot 搭配 CLAUDE.md 的預設腳本，根據 Issue 自動建立並切換至對應的開發分支
- 鼓勵以破碎自然語言描述需求，交由 Copilot 整理為規範化 Issue
- 若誤操作（如在 Staging 分支上改動），可請 AI 生成指令將變更移轉到正確 Branch

**任務管理規則**：
- Issue 建立要有目標與結果，過程中於 Issue 留言更新進度；完成後通知主講人以便 Merge
- PRD、Docs 為活文件，前端技術變更（如 Web Speech API 升級至 Azure）需同步更新文件，避免規格與實作不一致
- 專案代碼主要在 frontend 與 backend；DB 位於 backend 且權限由主講人掌管

**工具額度與授權**：
- 成員目前可能使用教育版 Copilot；Cursor 的 Copilot Pro 額度消耗較快
- 若一個月試用後確定需求強烈，公司將協助採購付費工具

### 專案架構、自動化部署與後續協作規劃

**技術架構與部署**：
- 程式碼主要分為 frontend 與 backend 兩部分；DB 藏於 backend
- 以 CI/CD 將 GitHub 上的 Code 自動 Deploy 至 GCP Server；CLAUDE.md 中記載 workflow，讓 AI 理解如何開 Feature 等
- 測試檔案集中於 Test 目錄；部分模組由 AI 自動設計，即便設計動機未完全明晰，主講人認為整體設計優於手工

**協作模式與會議**：
- 每週五晚上固定開會；若當週已有實體見面並完成任務分派，則當週可免開線上會議
- 下週維持週五晚上會議；之後待課表確定可另約實體時間
- Slack 為主要非同步溝通管道；遇到問題需即時提出與回報

**長期規劃與 MVP 重點**：
- 目前為最小 MVP：無需登入即可使用，但資料不會持久化
- 後續主講人將處理班師生持久化與作業派發、批改（含 AI）等功能
- 產品核心在於「選課文→1-2-3-4-5-6」的體驗品質與遊戲化設計
- 右側側欄可能不符合國中小使用者習慣，建議探索角色引導（類 Vtuber）以提升動機

**文件維護與開發節奏**：
- PRD 在 Docs 中，開發變更需同步更新文件；維護文件雖痛苦，但對一致性至關重要
- 以 AI 推動自動化（例如半夜累積 bug 寫成 Issue、監控 AI 花費），降低重複勞務

---

## Action Items

### @Young Tsai（主講人）

- [ ] 示範使用 AI 工具（Cursor、Copilot）與 CLAUDE.md 腳本，開 Branch 實作 Issue 108
- [ ] 後續處理班師生資料持久化與派作業／批改（含 AI）框架
- [ ] 週五固定會議主持與議程安排；如當週已實體分派任務則視情免開線上會議
- [ ] 一個月後評估團隊開發工具（Copilot、OpenAI 等）額度是否不足，必要時協助公司採購

### @開發團隊成員（@啟翔 @張靖杭）

- [ ] 先開三個 Issue 並開始解決（可涵蓋 Onboarding、文件、MVP 實測問題）
- [ ] 開完三個 Issue 後，在 Slack 上對焦與回報：列出開了哪些 Issue 以及預計處理方式
- [ ] 測試完整 Onboarding 流程，記錄並開 Issue 描述卡點與不清楚之處
- [ ] 在產品學習流程中提出可遊戲化的具體建議並開 Issue
- [ ] 開 Issue 詳述朗讀功能的使用者體驗問題，並討論解法（含後端 Gemini 彈性比對以調降判定門檻的方案）
- [ ] 完成任務後在 Slack 告知 Young，以便進行 Merge

### 開發日常需求

- [ ] 善用 CLAUDE.md 檔案提供給 Copilot 參考 workflow
- [ ] 試用一個月觀察 Copilot 或 OpenAI 額度使用情況，不足則在 Slack 告知主講人以便公司協助購買
- [ ] 於週五會議前，如需請假或更改時間，提前在 Slack 告知
