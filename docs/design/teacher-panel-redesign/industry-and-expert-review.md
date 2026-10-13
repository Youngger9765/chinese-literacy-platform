# 老師端：業界對比與專家 UI/UX review（滾動更新）

每一輪優化都把新發現寫在這裡，並標狀態（✅ 已上線／🔜 下一輪／⏸ 需要決定或需要後端）。
均一對照截圖放私人 repo `kist-curriculum/benchmarks/junyi-teacher-ui/`（本 repo 公開，不放截圖）。

## 1. 業界怎麼做（2026-10-13 查）

| 產品 | 做法 | 我們 |
|---|---|---|
| Google Classroom | 建班只問名稱等基本資料；學生用 6–7 碼班級代碼、email 邀請或名單匯入加入；派作業可選多班、選部分學生或群組，附評分類別與期限 [1] | 建班可同時建帳號；班級代碼在標題列；派作業可選部分學生、同時派給其他班 ✅；**群組（分組）未做** ⏸ |
| Khan Academy | 每份作業顯示分數與完成情況、可下載 CSV；打開一個項目先看到「各精熟等級各有幾人」，點進去看名單 [2] | 總表欄頭加「已交 N / M」、作業詳情頂部加各狀態人數 ✅；單份作業 CSV 下載 ✅（含試算表公式注入防護） |
| Khan Academy | Activity Overview 可依日期看學習時間與活動 [2] | 我們的數據 API 沒有日期篩選 ⏸（要後端） |
| Seesaw / ClassDojo | 家長邀請可整班一次發：寄 email、簡訊、或印出每位學生的家長代碼 [3] | ⏸ 查證發現家長端（`VITE_PARENT_PORTAL_ENABLED`）在所有環境都關著，邀請碼家長無處輸入；已先把老師端按鈕跟著藏起來 ✅。整班列印要等決定開家長端 |
| Seesaw | 低年級學生用老師發的登入代碼／QR 登入 [3] | 帳密卡＋班級 QR ✅ |

## 2. 專家 review

### Nielsen 十大可用性原則（逐頁對照）

| 原則 | 發現 | 狀態 |
|---|---|---|
| 系統狀態可見 | 作業總表要一格一格數紅綠才知道交了幾人 | ✅ 欄頭直接寫「已交 N / M」 |
| 系統狀態可見 | 作業詳情只寫「0 / 11 人已交」，看不出其他人是進行中還是逾期 | ✅ 頂部各狀態人數 |
| 一致性與標準 | 分頁叫「指派任務」、按鈕叫「建立作業」（任務／作業混用） | ⏸ 分頁名照均一，是否統一成「作業」待決定 |
| 辨識而非回憶 | 班級數據沒有班級切換（只能靠左欄／下拉） | ✅ 已有左欄與下拉 |
| 美觀與極簡 | 指派任務曾有兩組圖例且顏色不一致 | ✅ 已只留一組 |

### Tufte（資料墨水比、視覺誠實）

| 頁面 | 發現 | 狀態 |
|---|---|---|
| 作業總表 | 整片紅色「逾期未交」標籤搶走注意力，真正要看的「誰交了」被淹掉；每欄的彙總數字才是老師第一眼要的資訊 | ✅ 欄頭彙總；✅ 紅色只代表逾期（低分改橘、無分數已交改綠、逾期改淡紅） |
| 學習分析 | 時長缺資料時，大數字放一整句說明（資料墨水比低） | ✅ 改成「—」＋小字原因 |
| 今日總覽 | 三張統計卡的說明文字換三行 | ✅ 改成「數字＋短名稱＋一行小字」 |

## 來源
1. [Create a class – Classroom Help](https://support.google.com/edu/classroom/answer/6020273?hl=en&co=GENIE.Platform%3DDesktop)、[Create an assignment – Classroom Help](https://support.google.com/edu/classroom/answer/6020265?hl=en&co=GENIE.Platform%3DDesktop)
2. [Khan Academy：Reports（Activity、Skills、Assignment scores）](https://support.khanacademy.org/hc/en-us/articles/360031052391-How-do-I-use-Reports-to-view-Activity-Skills-and-Assignment-score-reports)、[Mastery goals progress](https://support.khanacademy.org/hc/en-us/articles/360031123551-How-can-I-view-my-students-progress-towards-their-Mastery-goals)
3. [Seesaw：How to invite family members](https://help.seesaw.me/hc/en-us/articles/203012019-How-do-I-invite-parents-and-families-)、[ClassDojo Parent Account Overview](https://static.classdojo.com/img/2020/Resources/ParentAccountFAQ.pdf)

## 3. QA 巡檢中發現並修好的（2026-10-13）

| 發現 | 影響 | 狀態 |
|---|---|---|
| 截止日存成 UTC 午夜，前端 5 處拿來直接比「現在」 | 截止日當天早上 8 點起老師端、學生端都顯示逾期 | ✅ 一律算到台灣時間當天 23:59 |
| 作業管理完成率分母用「作答次數」 | 10 人的班顯示 4/12 | ✅ 改用指派人數，與總表一致 |
| 作業管理、老師首頁先列已停用的班 | 老師一進來看到不用的班 | ✅ 使用中排前、停用加標籤 |
| 平板 768：學生名單一字一行、熱力圖只剩一條 | 平板無法使用 | ✅ 平板改卡片、選單移上方 |
| 手機：狀態標籤、學生關卡格子斷字 | 「逾期未／交」 | ✅ 不斷行、手機一排 3 格 |
| 學生沒有作業時沒有下一步 | 空白頁 | ✅ 引導去圖書館自己練習 |
| 自學圖書館課文下架時間同樣早 8 小時（後端 `expires_at = due_date`） | 只在管理員手動清除時生效，無排程 | ⏸ 影響極小，延後 |
