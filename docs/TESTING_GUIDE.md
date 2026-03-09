# 人工測試指南 — User Journey Testing Guide

> **Staging 環境**
> - Frontend: https://lingoleap-frontend-staging-958347263320.asia-east1.run.app
> - Backend API: https://lingoleap-backend-staging-958347263320.asia-east1.run.app

> **測試方式**：按角色走完旅程，每一行就是一個 Issue，測完在 Issue 留言。

---

# 🧑‍🏫 教師旅程

## 旅程 A：註冊 + 首次登入

> 從零開始，教師第一次使用平台

| # | 測試動作 | 預期結果 | 頁面 | Issue |
|---|---------|---------|------|-------|
| A.1 | 註冊教師帳號（Email + 密碼），測試密碼強度檢查、忘記密碼 | 密碼≥8字元英數混合才可送出；忘記密碼可收到重設信 | `/register`, `/forgot-password` | [#255](https://github.com/Youngger9765/chinese-literacy-platform/issues/255) |
| A.2 | 用 Google 帳號 OAuth 登入 | 點 Google 按鈕 → 跳轉 Google → 成功回到首頁 | `/login` | [#27](https://github.com/Youngger9765/chinese-literacy-platform/issues/27) |

---

## 旅程 B：建立班級 + 管理學生

> 教師建好班級、加入學生、設定標籤和教學指示

| # | 測試動作 | 預期結果 | 頁面 | Issue |
|---|---------|---------|------|-------|
| B.1 | 為學生加標籤（如「需關注」「專注力不足」） | 標籤顯示在學生名稱旁，可新增/刪除 | `/teacher/classroom/:id` | [#245](https://github.com/Youngger9765/chinese-literacy-platform/issues/245) |
| B.2 | 對個別學生設定「特別教學指示」 | 輸入文字指示（如「小明需放慢語速」），儲存成功 | `/teacher/classroom/:id` | [#90](https://github.com/Youngger9765/chinese-literacy-platform/issues/90) |
| B.3 | 邀請另一位教師協同管理班級 | 輸入教師 Email 或帳號，對方可看到此班級 | `/teacher/classroom/:id` | [#244](https://github.com/Youngger9765/chinese-literacy-platform/issues/244) |

---

## 旅程 C：上傳課文 + 指派作業

> 教師設定課文目標，派作業給學生

| # | 測試動作 | 預期結果 | 頁面 | Issue |
|---|---------|---------|------|-------|
| C.1 | 為課文設定目標語速（CPM）和正確率門檻 | 設定值儲存成功，學生端看到目標 | `/teacher` | [#84](https://github.com/Youngger9765/chinese-literacy-platform/issues/84) |
| C.2 | 教師端：建立作業，將課文指派給班級 | 作業建立成功，顯示在教師作業列表 | `/teacher` | [#23](https://github.com/Youngger9765/chinese-literacy-platform/issues/23) |
| C.3 | 作業系統：課文指派 + 副本策略 | 作業建立流程完整，副本正確生成 | `/teacher` | [#143](https://github.com/Youngger9765/chinese-literacy-platform/issues/143) |
| C.4 | 學生端：登入後看到教師指派的作業 | 作業列表顯示，可點擊開始練習 | `/assignments` | [#24](https://github.com/Youngger9765/chinese-literacy-platform/issues/24) |

---

## 旅程 D：查看報告 + 學生管理

> 教師查看全班表現，找出需要幫助的學生

| # | 測試動作 | 預期結果 | 頁面 | Issue |
|---|---------|---------|------|-------|
| D.1 | 查看卡點偵測（同一生字錯≥3次） | 卡點學生被標示，顯示卡住的生字和錯誤次數 | `/teacher/classroom/:id` | [#91](https://github.com/Youngger9765/chinese-literacy-platform/issues/91) |
| D.2 | 查看學習預警通知中心 | 顯示「超過7天沒練習」「連續未達標」的學生提醒 | `/teacher` | [#256](https://github.com/Youngger9765/chinese-literacy-platform/issues/256) |
| D.3 | 查看蘇格拉底理解力評分 | 每位學生的三層次理解力分數（表層/推論/批判） | `/teacher/classroom/:id` | [#243](https://github.com/Youngger9765/chinese-literacy-platform/issues/243) |
| D.4 | 匯出班級報表 CSV/Excel | 點擊匯出按鈕，下載檔案包含所有學生成績 | `/teacher/classroom/:id` | [#235](https://github.com/Youngger9765/chinese-literacy-platform/issues/235) |
| D.5 | 查看跨課文學習模式分析 | 學生在不同課文間的表現趨勢圖 | `/teacher/classroom/:id` | [#253](https://github.com/Youngger9765/chinese-literacy-platform/issues/253) |
| D.6 | 查看錯誤訂正機制 | 重複錯誤被偵測，系統推薦對應生字練習 | `/teacher/classroom/:id` | [#248](https://github.com/Youngger9765/chinese-literacy-platform/issues/248) |

---

# 🧑‍🎓 學生旅程

## 旅程 E：登入 + 加入班級

> 學生第一次使用平台

| # | 測試動作 | 預期結果 | 頁面 | Issue |
|---|---------|---------|------|-------|
| E.1 | 首次登入後的 onboarding 引導 | 顯示新手引導教學（介紹平台功能和操作方式） | `/` | [#264](https://github.com/Youngger9765/chinese-literacy-platform/issues/264) |

---

## 旅程 F：六步驟學習流程（核心體驗）

> ⚠️ **最重要的旅程**：選一篇課文，走完六步驟

| # | 測試動作 | 預期結果 | 頁面 | Issue |
|---|---------|---------|------|-------|
| F.1 | 調整閱讀字體大小 | 字體變大/變小，設定在切換頁面後被記住 | `/learn/:storyId/intro` | [#262](https://github.com/Youngger9765/chinese-literacy-platform/issues/262) |
| F.2 | 朗讀錄音功能 | 點擊錄音按鈕 → 錄音指示器 → 停止 → 送出分析 | `/learn/:storyId/tutor` | [#77](https://github.com/Youngger9765/chinese-literacy-platform/issues/77) |
| F.3 | 段落→整篇漸進式朗讀 | 第一段達標才解鎖第二段，所有段落完成後解鎖整篇 | `/learn/:storyId/tutor` | [#85](https://github.com/Youngger9765/chinese-literacy-platform/issues/85) |
| F.4 | 蘇格拉底對話：答錯時正面鼓勵 | 答錯不顯示負面語氣，以鼓勵引導方式繼續 | `/learn/:storyId/comprehension` | [#268](https://github.com/Youngger9765/chinese-literacy-platform/issues/268) |
| F.5 | 蘇格拉底對話：語音輸入 | 點麥克風按鈕 → 語音轉文字 → 自動填入回答框 | `/learn/:storyId/comprehension` | [#217](https://github.com/Youngger9765/chinese-literacy-platform/issues/217) |
| F.6 | 生字練習 UX 改善 | 生字列表清楚、操作流暢、不卡頓 | `/learn/:storyId/vocab` | [#220](https://github.com/Youngger9765/chinese-literacy-platform/issues/220) |
| F.7 | 生字：部件拆解 + 相關字延伸 | 顯示「清 = 氵 + 青」，列出相關字（情、晴、請） | `/learn/:storyId/vocab` | [#88](https://github.com/Youngger9765/chinese-literacy-platform/issues/88) |
| F.8 | 生字：發音練習（錄音比對） | 錄下自己的發音，與正確發音比對 | `/learn/:storyId/vocab` | [#89](https://github.com/Youngger9765/chinese-literacy-platform/issues/89) |
| F.9 | 生字：造句應用（筆順後造二句） | 筆順完成後，系統要求造 2 句，AI 批改 | `/learn/:storyId/vocab` | [#109](https://github.com/Youngger9765/chinese-literacy-platform/issues/109) |
| F.10 | 聽寫 + 書寫練習模組 | 播放語音 → 學生聽後打字 → 自動批改 | `/learn/:storyId/dictation` | [#96](https://github.com/Youngger9765/chinese-literacy-platform/issues/96) |
| F.11 | 聽力理解模組（播放課文→覆述） | 播放課文音檔 → 學生覆述 → AI 評估 | `/learn/:storyId/listening` | [#251](https://github.com/Youngger9765/chinese-literacy-platform/issues/251) |
| F.12 | 報告環節六：AI 詳細分析 | Gemini 生成朗讀診斷建議，內容有參考價值 | `/learn/:storyId/report` | [#241](https://github.com/Youngger9765/chinese-literacy-platform/issues/241) |
| F.13 | 學習完成動畫 + 慶祝效果 | 完成學習後跳出慶祝動畫/星星等級 | `/learn/:storyId/report` | [#272](https://github.com/Youngger9765/chinese-literacy-platform/issues/272) |
| F.14 | Session 中斷恢復 | 學習中途關瀏覽器，重開後可從上次步驟繼續 | `/learn/:storyId/...` | [#271](https://github.com/Youngger9765/chinese-literacy-platform/issues/271) |

---

## 旅程 G：查看學習成果 + 成就

> 學生查看自己的進步和成就

| # | 測試動作 | 預期結果 | 頁面 | Issue |
|---|---------|---------|------|-------|
| G.1 | 學習路徑 + 五模組完成度追蹤 | 顯示完成進度（哪些模組已完成/未完成） | `/progress` | [#257](https://github.com/Youngger9765/chinese-literacy-platform/issues/257) |
| G.2 | 蘇格拉底對話歷史紀錄 | 過去的 AI 對話可重新瀏覽 | `/sessions/:id/dialogue` | [#242](https://github.com/Youngger9765/chinese-literacy-platform/issues/242) |
| G.3 | 遊戲化激勵系統（徽章、排行榜） | 成就頁顯示徽章、積分、排行榜 | `/achievements` | [#26](https://github.com/Youngger9765/chinese-literacy-platform/issues/26) |
| G.4 | AI 個別化學習路徑推薦 | 首頁顯示「推薦你練習…」的課文推薦 | `/` | [#252](https://github.com/Youngger9765/chinese-literacy-platform/issues/252) |
| G.5 | 自學模式優化 | 課文庫可搜尋、自由選課文、不需教師指派 | `/library` | [#25](https://github.com/Youngger9765/chinese-literacy-platform/issues/25) |

---

# 🏫 管理員旅程

## 旅程 H：機構管理

> 學校管理員管理全校

| # | 測試動作 | 預期結果 | 頁面 | Issue |
|---|---------|---------|------|-------|
| H.1 | 機構層級管理系統 | 管理員可建立/編輯機構、學校、班級階層 | `/admin` | [#223](https://github.com/Youngger9765/chinese-literacy-platform/issues/223) |
| H.2 | 機構儀表板統計 | 多校概覽、使用人數、活躍度數據 | `/admin` | [#233](https://github.com/Youngger9765/chinese-literacy-platform/issues/233) |
| H.3 | 機構點數/授權管理 | 扣點邏輯正確、使用記錄完整、餘額顯示 | `/admin` | [#232](https://github.com/Youngger9765/chinese-literacy-platform/issues/232) |

---

# 👨‍👩‍👧 家長旅程

## 旅程 I：查看孩子學習進度

> 家長查看孩子的學習狀況

| # | 測試動作 | 預期結果 | 頁面 | Issue |
|---|---------|---------|------|-------|
| I.1 | 家長端查看孩子進度 | 顯示孩子的正確率趨勢、練習次數、最近表現 | `/parent` | [#95](https://github.com/Youngger9765/chinese-literacy-platform/issues/95) |

---

# 🔧 非功能性測試（基建 / 安全 / 效能）

| # | 測試動作 | 預期結果 | 測試方式 | Issue |
|---|---------|---------|---------|-------|
| N.1 | Production 部署 + 監控 | Health check 返回 `status: "ok"` | `curl /api/health/detailed` | [#29](https://github.com/Youngger9765/chinese-literacy-platform/issues/29) |
| N.2 | E2E 測試 + 效能優化 | Playwright 測試全通過，首頁 < 2 秒 | CI 自動跑 | [#28](https://github.com/Youngger9765/chinese-literacy-platform/issues/28) |
| N.3 | 使用手冊 + 交接文件 | `/help` 頁面有完整教學內容 | 瀏覽 `/help` | [#30](https://github.com/Youngger9765/chinese-literacy-platform/issues/30) |
| N.4 | WCAG 2.1 AA 無障礙 | 鍵盤可導航所有功能、Lighthouse ≥ 90 | Chrome Lighthouse | [#258](https://github.com/Youngger9765/chinese-literacy-platform/issues/258) |
| N.5 | Prompt Injection 防護 | 在 AI 對話輸入惡意字串，被淨化不執行 | 手動輸入攻擊字串 | [#270](https://github.com/Youngger9765/chinese-literacy-platform/issues/270) |
| N.6 | 依賴套件安全掃描 | npm audit + pip-audit 無 critical 漏洞 | CI 自動跑 | [#273](https://github.com/Youngger9765/chinese-literacy-platform/issues/273) |
| N.7 | 壓力測試 30 人同時朗讀 | 30 人同時使用不 crash、回應 < 5 秒 | 負載測試工具 | [#260](https://github.com/Youngger9765/chinese-literacy-platform/issues/260) |
| N.8 | 預測學習困難 ML 模型 | 風險學生被正確標記 | 查看教師端 | [#254](https://github.com/Youngger9765/chinese-literacy-platform/issues/254) |
| N.9 | Beta 文件套件 | 手冊 + FAQ + 影片 + 客服模板齊全 | 檢查文件 | [#263](https://github.com/Youngger9765/chinese-literacy-platform/issues/263) |
| N.10 | 教育部字典 API + 筆順資料庫 | 生字頁正確顯示筆順資料 | 查看生字練習頁 | [#259](https://github.com/Youngger9765/chinese-literacy-platform/issues/259) |

---

# 📋 測試帳號

| 角色 | 帳號 | 密碼 | 說明 |
|------|------|------|------|
| 教師 | （請填入） | （請填入） | staging 測試教師帳號 |
| 學生 | （請填入） | （請填入） | staging 測試學生帳號 |
| 管理員 | （請填入） | （請填入） | staging 管理員帳號 |
| 家長 | （請填入） | （請填入） | staging 家長帳號 |

---

# 📝 如何回報測試結果

1. 找到這一行對應的 **Issue 連結**，點進去
2. 在 Issue 留言：
   - ✅ **測試通過**：留言「測試通過」+ 截圖
   - ❌ **有問題**：留言「測試失敗」+ 截圖 + 描述問題
3. 測試通過的 Issue 會由 Young 關閉

---

# 📊 進度總覽

| 角色 | 旅程 | Issue 數 |
|------|------|---------|
| 🧑‍🏫 教師 | A 註冊登入 | 2 |
| 🧑‍🏫 教師 | B 班級+學生 | 3 |
| 🧑‍🏫 教師 | C 課文+作業 | 4 |
| 🧑‍🏫 教師 | D 報告+管理 | 6 |
| 🧑‍🎓 學生 | E 登入+加入 | 1 |
| 🧑‍🎓 學生 | F 六步驟學習 | 14 |
| 🧑‍🎓 學生 | G 成果+成就 | 5 |
| 🏫 管理員 | H 機構管理 | 3 |
| 👨‍👩‍👧 家長 | I 孩子進度 | 1 |
| 🔧 非功能 | N 基建/安全 | 10 |
| | **合計** | **49 issues** |

---

*最後更新：2026-03-09*
