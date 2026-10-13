# 老師端：業界對比與專家 UI/UX review（滾動更新）

每一輪優化都把新發現寫在這裡，並標狀態（✅ 已上線／🔜 下一輪／⏸ 需要決定或需要後端）。
均一對照截圖放私人 repo `kist-curriculum/benchmarks/junyi-teacher-ui/`（本 repo 公開，不放截圖）。

## 1. 業界怎麼做（2026-10-13 查）

| 產品 | 做法 | 我們 |
|---|---|---|
| Google Classroom | 建班只問名稱等基本資料；學生用 6–7 碼班級代碼、email 邀請或名單匯入加入；派作業可選多班、選部分學生或群組，附評分類別與期限 [1] | 建班可同時建帳號；班級代碼在標題列；派作業可選部分學生、同時派給其他班 ✅；**群組（分組）未做** ⏸ |
| Khan Academy | 每份作業顯示分數與完成情況、可下載 CSV；打開一個項目先看到「各精熟等級各有幾人」，點進去看名單 [2] | 總表欄頭加「已交 N / M」、作業詳情頂部加各狀態人數 ✅（本輪）；**單份作業 CSV 下載未做** 🔜 |
| Khan Academy | Activity Overview 可依日期看學習時間與活動 [2] | 我們的數據 API 沒有日期篩選 ⏸（要後端） |
| Seesaw / ClassDojo | 家長邀請可整班一次發：寄 email、簡訊、或印出每位學生的家長代碼 [3] | 我們只能一位一位按「家長邀請碼」 🔜 |
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
| 作業總表 | 整片紅色「逾期未交」標籤搶走注意力，真正要看的「誰交了」被淹掉；每欄的彙總數字才是老師第一眼要的資訊 | ✅ 欄頭彙總；🔜 考慮逾期改成較淡的紅、已交用實心 |
| 學習分析 | 時長缺資料時，大數字放一整句說明（資料墨水比低） | ✅ 改成「—」＋小字原因 |
| 今日總覽 | 三張統計卡的說明文字換三行 | 🔜 精簡說明文字 |

## 來源
1. [Create a class – Classroom Help](https://support.google.com/edu/classroom/answer/6020273?hl=en&co=GENIE.Platform%3DDesktop)、[Create an assignment – Classroom Help](https://support.google.com/edu/classroom/answer/6020265?hl=en&co=GENIE.Platform%3DDesktop)
2. [Khan Academy：Reports（Activity、Skills、Assignment scores）](https://support.khanacademy.org/hc/en-us/articles/360031052391-How-do-I-use-Reports-to-view-Activity-Skills-and-Assignment-score-reports)、[Mastery goals progress](https://support.khanacademy.org/hc/en-us/articles/360031123551-How-can-I-view-my-students-progress-towards-their-Mastery-goals)
3. [Seesaw：How to invite family members](https://help.seesaw.me/hc/en-us/articles/203012019-How-do-I-invite-parents-and-families-)、[ClassDojo Parent Account Overview](https://static.classdojo.com/img/2020/Resources/ParentAccountFAQ.pdf)
