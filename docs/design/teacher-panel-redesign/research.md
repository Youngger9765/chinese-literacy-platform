# 教師面板重設計 — 競品研究

> 🤖 由 Claude AI 代發（非 Young 本人）— Epic #3357。本文件只做競品 UX 研究，版面規格與線框圖見 `README.md` / `wireframes/`（由另一位協作者負責，不在本檔重複）。
> 方法：WebSearch 官方文件/說明頁/部落格評測，每條標來源 URL；沒找到實際畫面截圖或官方畫面說明的，標「未見實物」。

## 1. Google Classroom（Gradebook / 成績表）

- **作業 vs 自學分離**：Classroom 本身沒有「自學」概念——所有東西都是教師指派的 Assignment，天生不會發生「自學混進作業報表」這種問題，因為平台設計上根本沒有自學軌。
- **矩陣**：Gradebook 是標準 rows=學生、cols=作業的網格，cell 直接顯示分數；**顏色編碼**：紅＝缺交、綠＝已交/草稿、黑＝已退回。可以依作業/日期/學生/成績類型篩選。
- **下鑽**：點 cell 旁的「更多」選單直接開啟該學生該份作業的提交內容，是 cell→submission 的一對一下鑽，沒有「大題」層級（因為 Classroom 的作業本身就是附件/表單，沒有結構化子題概念）。
- **需要關注的學生**：沒有內建風險評分或建議文字，純粹用「缺交」顏色當唯一訊號。
- **行為訊號**：無。
- **最值得抄**：顏色編碼一眼辨識（紅/綠/黑三色，不需要看數字）。
- **最大的坑**：完全沒有「為什麼」——缺交以外沒有任何診斷，老師要自己猜。
- 來源：[View or update your gradebook](https://support.google.com/edu/classroom/answer/9199710?hl=en)、[Managing Grades in Google Classroom](https://www.usna.edu/CTL/Programs/Technology_Workshop_Content/One_Pagers/Setting_Up_and_Managing_Gradebook_in_Google_Classroom.pdf)

## 2. Khanmigo / Khan Academy 教師報表

- **作業 vs 自學分離**：明確分離——「Activity Overview」同時涵蓋 assigned 與 unassigned（自學）內容，但**用篩選器區分**，不會預設混在同一張表；「Assignments - Scores」是獨立、只看老師指派內容的報表。
- **矩陣**：沒有單一矩陣畫面，而是拆成多個報表入口（Mastery Goals 進度／Assignment Scores／Activity Overview），各自可依學習時間、技能精熟度等多指標下鑽。
- **下鑽**：Assignment Scores 報表可下鑽到個別學生的完成狀況。
- **需要關注的學生**：未見明確的「風險標籤」機制描述（未見實物 — 以下為文字描述推測：Mastery Goals 進度落後可能間接反映落後學生，但沒查到專門的 at-risk 列表）。
- **最值得抄**：把「老師指派的」跟「學生自己做的」在資料來源就分成兩個獨立報表入口，而不是同一張表加一個篩選鈕——從老師的角度，點進哪個報表本身就已經回答了「我在看哪一種資料」。
- **最大的坑**：報表入口多（Activity Overview / Mastery Goals / Assignment Scores / 多個 Khanmigo 專屬報表），需要老師知道該去哪個報表找答案，資訊架構偏向工具導向而非任務導向。
- 來源：[What reporting options are available on Khan Academy](https://support.khanacademy.org/hc/en-us/articles/360031129891)、[What teacher reports are available on Khanmigo Classroom](https://support.khanacademy.org/hc/en-us/articles/38554738905997)

## 3. IXL Analytics

- **作業 vs 自學分離**：IXL 的核心是「Real-Time Diagnostic」（持續性的適性診斷，非作業制），報表體系本身就是圍繞診斷等級設計，不是作業制平台，因此沒有「作業 vs 自學」這組對立概念——所有練習都算進診斷等級。
- **矩陣**：Real-time 報表是即時監控整班「現在在做什麼」的即時畫面（適合課堂中），Assessment tab 顯示每個學生的 Diagnostic 等級。
- **下鑽**：Diagnostic Overview 報表可從整班等級下鑽到個別技能。
- **需要關注的學生**：未見明確文字化建議（未見實物）。
- **最值得抄**：Dashboard 首頁本身就是一個「報表目錄 + 每個報表一句話說明」的導覽頁，降低老師「該去哪裡找」的認知負荷——這正是本次重設計「今日總覽」想解決的同一個問題。
- 來源：[IXL Analytics information](https://au.ixl.com/analytics/dashboard)、[Rev up your IXL implementation](https://blog.ixl.com/2023/08/13/rev-up-your-ixl-implementation-with-the-teacher-dashboard/)

## 4. Newsela 教師端報表

- **作業 vs 自學分離**：Class Overview 報表的統計口徑是「學生看過的所有文章」（含自由閱讀），Reports tab／Assignments tab 則是按「已指派文章」分開看。
- **矩陣**：Class Overview 是「平均閱讀等級 + 高於/低於/等於班級等級的文章數」這種摘要式總覽，不是學生×文章矩陣。
- **下鑽**：可匯出含「學生、文章、等級、寫作分數、標註數、測驗分數、停留時間」的試算表——**這組欄位本身就是我們矩陣展開想要的大題分解雛形**（寫作/標註/測驗/時間，四個維度並列）。
- **需要關注的學生**：未見專門的風險標籤機制（未見實物）。
- **行為訊號**：有「停留時間 (time in article)」這個欄位，等同粗略的參與度訊號，但不是逐題層級。
- **最值得抄**：CSV 匯出的欄位設計——一列一個學生、多個維度並列，是可以直接拿來參考「矩陣展開大題」要放哪些欄位的現成範本。
- 來源：[Classroom Data Report](https://help.newsela.com/en/articles/13928499-classroom-data-report)、[Ways to Review Work](https://support.newsela.com/article/ways-to-review-work/)

## 5. Edpuzzle（教師端）

- **作業 vs 自學分離**：Edpuzzle 幾乎全部內容都是「指派」的（影片作業制），沒有自學軌，跟 Google Classroom 類似不存在這組對立。
- **矩陣**：Gradebook tab 彙整「過去 30 天」所有影片作業的結果，是學生 × 作業的網格。
- **下鑽（本次研究裡下鑽做得最細的一家）**：點進單一作業可看「Graded answers → Show all」，直接列出**每一題**有多少學生選哪個選項（item analysis），並可依「Questions」重新排序整份報表——也就是矩陣可以整個轉置成「以題目為列」而非「以學生為列」，兩種視角都有。
- **需要關注的學生**：未見專門風險標籤（未見實物）。
- **最值得抄**：**兩種轉置視角**（學生為列 / 題目為列）同時提供——我們的矩陣展開目前設計成「點 cell 展開該生的大題分解」，Edpuzzle 多了「直接把整張表轉成題目視角」這個互補視角，值得納入後續迭代（不在本次 wireframe 範圍內）。
- 來源：[How do I view students' progress and grade questions?](https://support.edpuzzle.com/hc/en-us/articles/360007261192)

## 6. Wayground（原 Quizizz）教師端報表

- **作業 vs 自學分離**：Wayground 的報表是「每一場 session（live 或 homework）各自一份報表」，天生就是以活動為單位分開，不會發生跨活動混淆。
- **矩陣**：報表預設是學生列表（含 accuracy／completion／分數／平均作答時間）。
- **下鑽**：切到「Questions」tab 看逐題正確率，可依正確率排序（**item analysis**，跟 Edpuzzle 同款模式），還可以「依時間排序」找出耗時異常長的題目。
- **需要關注的學生**：有 **AI 分析**（"Analyze w/ AI" → "Generate Analysis"）——把報表丟給 AI 生成文字摘要，這是本次研究中唯一一家明確把「原始數字」轉成「給老師看的建議文字」的產品，概念上最接近我們想要的「早期介入給建議而不只是標籤」。
- **行為訊號**：有「平均作答時間」，是本次研究中少數真的把「作答時間」當成報表欄位的產品之一。
- **最值得抄**：AI 生成文字摘要這個模式——把 risk_factors 數據轉成人話建議，正是我們 `prediction_service.py` 已經在做但被 UI 收合藏起來的那件事，Wayground 證明「把數字講成一句話建議」是業界已驗證的方向。
- **最大的坑**：依賴 AI 生成摘要，若 AI 判斷不穩定/喊錯，老師可能得不到一致的建議（這點我們的規則引擎反而更可預測，是相對優勢，不必照抄 AI 摘要這條路，純粹借鏡「文字化建議」這個概念）。
- 來源：[Reports on Wayground](https://help.wayground.com/support/solutions/articles/158000404058-reports-on-wayground)、[Analyze Reports with Wayground AI](https://help.wayground.com/support/solutions/articles/158000404060-analyze-reports-with-wayground-ai)、[Understand How Accuracy Is Measured](https://help.wayground.com/support/solutions/articles/158000404051-understand-how-accuracy-is-measured-on-wayground)

## 7. Seesaw（教師端）

- **作業 vs 自學分離**：Seesaw 是作品集／作業制平台，沒有強烈的自學軌概念，但 Activities View 本身是針對「已指派的 Activity」設計，跟自由貼文（journal post）在介面上是分開的兩個區塊。
- **矩陣**：Activities View（在 Gradebook 內）提供完成狀態／總成績／標準對照，可用篩選看「班級趨勢」或「個別進度」兩種聚合層級。
- **下鑽**：點「Review」可看全班在某個 Activity 的摘要結果。
- **即時性**：**老師後台即時顯示完成狀態**（誰交了、誰還在做、誰還沒開始）——這點直接對應我們 README §4.2 的三態設計（未開始/進行中/已完成），Seesaw 證明這是業界已驗證的必要狀態機，不是我們自創。
- **需要關注的學生**：未見專門風險標籤（未見實物）。
- **最值得抄**：live completion 的三態顯示，與班級趨勢/個別進度的篩選切換。
- 來源：[Using the Activities View in the Gradebook](https://help.seesaw.me/hc/en-us/articles/360060511831)

## 8. Lexia Core5 / Amplify 閱讀報表

- **作業 vs 自學分離**：Lexia Core5 本質是自適性練習系統（非教師指派制），報表邏輯是「系統自動排程 + 老師監督」，跟我們的「老師指派 vs 學生自學」二分法不完全對應，但它示範了「單一班級總覽表」怎麼設計。
- **矩陣**：**Class Overview 的 Class Table** 是本次研究裡跟我們目標最接近的範本——rows=學生，呈現每個學生的整體狀態，並有 **Action Plan 篩選**：需要用量提醒／需要老師介入教學／已準備好離線練習／值得嘉獎，四個分類直接對應「老師下一步該做什麼」而非單純的分數高低。
- **需要關注的學生**：**這是本次研究中最成熟的早期介入設計**——除了風險等級，還有 **Instructional Priority icon**（預測性，標示「這個學生今年結束時很可能達不到年級水準」），且明確定位為「不用停下來正式評量就能監控成長」。
- **最值得抄**：Action Plan 的四分類（需用量/需指導/可離線/可嘉獎）把「風險等級」直接翻譯成「老師下一步動作」，比我們現在「高/中/低風險」三個顏色徽章更有行動指引價值，值得之後把 `recommended_actions[]` 的呈現方式往這個方向靠（不只是列建議句子，而是分類成「現在該做哪種介入」）。
- 來源：[Core5 Class Overview (myLexia PDF)](https://www.lexialearningresources.com/core5/licensed/mylexia_reports_guides/myLexia_Reports_Class_Overview_Core5.pdf)、[myLexia Reports: Core5 Class Skill Progress](https://community.lexialearning.com/student-progress-reports-97/mylexia-reports-core5-class-skill-progress-1563)
- Amplify mClass：未見實物，搜尋沒有取得其教師報表的具體畫面描述，此處誠實標註缺席，不補位描述。

## 9. ReadTheory

- **作業 vs 自學分離**：ReadTheory 是適性練習制（類似 Lexia），學生在自己帳號裡持續練習，老師從「Progress Reports」儀表板看彙總資料。
- **矩陣**：「Class Overview」提供高層次總覽快照，「Student Progress Snapshot」才下鑽到個別學生趨勢——是先總覽、後下鑽的兩層結構。
- **行為訊號**：報表含 Lexile 等級變化曲線、Common Core 標準精熟度、測驗歷史，圖表上有「班級平均虛線」當對照基準（這是 Tufte 式的 small-multiples／對照基準做法，老師不需要自己心算「這個分數算不算正常」）。
- **需要關注的學生**：未見明確風險標籤（未見實物）。
- **最值得抄**：圖表上疊一條「班級平均」虛線當參照——我們的「學生自學總覽」/「作業矩陣」目前都只顯示絕對分數，沒有相對於班級的對照線，這是一個低成本、高價值可以抄的小改動。
- 來源：[How Do I Analyze the New Progress Reports?](https://help.readtheory.org/new-progress-reports)、[Locating and Analyzing Benchmark Scores](https://help.readtheory.org/locating-and-analyzing-pretest-scores)

## 10. 均一教育平台（教師後台）

- **作業 vs 自學分離**：「指派任務」跟「班級數據」是分開的功能入口；任務用顏色狀態（綠=完成、黃=未完成、紅=已截止未完成）呈現進度，自學活動另外在「班級數據」裡看最近學習活動。
- **矩陣**：「學習診斷」系統會依題目分析找出學生的學習痛點，呈現學習歷程而非單一分數。
- **需要關注的學生**：有「教練功能」讓老師/家長掌握個別學生即時學習歷程，但未見明確結構化的風險分級列表（未見實物，以官方說明文字推測居多）。
- **最值得抄**：紅/黃/綠三色狀態（完成／未完成／逾期未完成）跟 Google Classroom 的紅/綠/黑概念相近，但多了「逾期」這個第三態，直接對應我們 README §4.2 設計的「未開始/進行中/已完成」三態——可以再加一個「已逾期未交」當第四態的著色提示。
- 來源：均一教師資源影片（[均一線上測驗與遠端評量工具（下篇）](https://www.junyiacademy.org/junyi-teacher-resources/tr01-guide/v/nnQnWg5YdS0)）、[翻轉教育：小益老師](https://flipedu.parenting.com.tw/article/008675)

## 11. 因材網（教育部）

- **作業 vs 自學分離**：教師透過「任務指派」明確指派三類任務（知識結構學習／單元診斷測驗／縱貫診斷測驗），可選全班/多班/個別學生，並設定共享範圍（不分享/校內/私人）——這是分類最精細的一家，但也代表老師要先理解三種任務類型的差異才會用，認知負荷較高（對應 Sweller：intrinsic load 來自任務類型本身的複雜度，無法簡化只能排序引導）。
- **矩陣**：核心賣點是「跨年級縱貫式適性診斷」——如果學生某個基礎概念錯誤，系統會往下診斷到更基礎的知識點，等於是把「這題錯」自動連結到「真正的知識缺口在哪一個年級的哪個概念」，比單純顯示分數更進一步。
- **需要關注的學生**：這套往下追知識結構根因的機制，概念上接近我們想做的「不只是 0 分，還要看錯在哪」，但它做得更深——不只到「這一題」，而是到「這個概念的先備知識」。
- **最值得抄**：把「分數低」自動歸因到「知識結構裡更底層的缺口」，而不是停在單一題目的對錯——這對我們的錯字總表／理解子分數可以有啟發：生字錯誤是不是能回溯到「部首/部件」這種更底層的缺口，是未來可以探索的方向（本次不在範圍內，列入 README 待補）。
- 來源：[因材網基本功能(簡易版) 教師](https://cbes.hcc.edu.tw/var/file/36/1036/img/18/562216327.pdf)、[教育部因材網簡介](https://sites.google.com/jres.tc.edu.tw/adaptive-jres/)

## 12. PaGamO（教師/家長後台）

- **行為訊號（本次研究唯一一家明確做到「逐題作答時間+錯誤次數」的產品）**：官方說明教師後台可以查看「答題的具體時間、用時長度和錯誤次數」，可用來推測孩子的使用行為；測驗模式結束後也會呈現每位學生的成績與每一題的答題情況。
- **矩陣**：以遊戲化分數/答題率呈現，強調「素養能力清晰呈現，更容易釐清學習痛點」。
- **最值得抄**：**這是我們 README §6「猜題/作答時間訊號」資料缺口段落最直接的業界先例**——PaGamO 證明「逐題作答時間+錯誤次數」是可落地的功能，不是空想。它的存在本身是支持我們把這個訊號列為「值得投資的第二階段資料缺口」而非「邊緣需求」的證據。
- 來源：[PaGamO 素養學習｜常見問題](https://school.pagamo.org/faq)、[幫助您快速查看學習狀況](https://learning.pagamo.org/how-to-check-learning-progress-with-pagamoapp/)

---

## 13. 綜合分析：為什麼「參考過別人的版面，但都不太直覺」

跨 12 個產品歸納出 3 個共通反模式，直接呼應現場老師「參考過別人的版面，但覺得大家的設計都不太直覺」：

1. **報表入口分散、沒有單一「今天該看哪裡」的起點**——Khanmigo（4+ 個獨立報表入口）、因材網（3 種任務類型各自獨立）、Lexia（多種報表並列）都把「資料」攤開得很完整，但沒有一個「今天這堂課/這週，我該先看哪個」的任務導向起點，老師得先學會系統的資訊架構，才能回答自己的問題。這正是本次重設計新增「今日總覽」tab 的理由（README §2），不是跟著業界做法抄，而是刻意反著做：**先問老師的問題，再決定要不要連到完整報表**。
2. **把「風險/落後」講成分數或顏色，但很少真的講成一句人話建議**——12 家裡只有 Wayground（AI 生成摘要）跟 Lexia（Action Plan 四分類）真正做到「這個學生 → 具體下一步」。多數產品（Google Classroom、IXL、Seesaw、均一）停在「红色代表缺交/低分」，剩下的推理工作留給老師自己做。我們現有的 `prediction_service.py` 其實已經贏過半數同業（有 `risk_factors` + `recommended_actions` 文字），只是被前端的收合互動藏起來——這個反模式不是我們獨有，是整個業界的通病，但也代表我們離「做對」只差一個 UI 決定（README §5.2）。
3. **作業/自學的分離程度，取決於產品的底層商業模式，不是單純的 UI 選擇**——作業制平台（Google Classroom、Edpuzzle、Seesaw）天生沒有這個問題；適性練習制平台（IXL、Lexia、ReadTheory）天生也沒有，因為沒有「作業」這個對立概念；真正會撞到這個問題的是**同時支援兩種模式的平台**（Khanmigo／均一／因材網／我們自己），而這幾家的共同解法都是「用篩選器或獨立報表分流，不是做成同一張表加顏色」。這直接印證 README §4.2 的過濾方案（matrix 預設只吃 `session_mode == assignment`）方向正確，而不是在既有矩陣上加一個「只看作業」的 checkbox。

---

## 14. 給 README 的結論（設計決策依據，按協作者要求寫在此處）

> design-principles 協作者如需引用，以下三點可直接摘入 README 對應章節，附上本檔案連結當來源。

- **「今日總覽」是刻意反業界慣例的設計**，不是抄來的模式——12 家競品沒有一家把「老師今天該看什麼」做成第一個畫面，多數停在「報表目錄」層級。這呼應 README §2 新增 Tab1 的決定，理由可以直接寫「競品普遍缺乏任務導向起點，詳見 research.md §13-1」。
- **早期介入的呈現方式應該往 Lexia 的 Action Plan 分類靠，而不是維持現在的「風險等級徽章 + 收合清單」**——把 `recommended_actions[]` 分類成「需要用量提醒／需要我介入教學／可以放給他自己練／值得嘉獎」這種行動分類，而不是條列句子。這是比單純「預設展開」更進一步的改動，建議列為 README §5.2 的下一輪迭代選項（本次 wireframe 若時間允許可以先做文字分類的版面，不強制）。
- **矩陣/自學總覽圖表上應該疊一條「班級平均」參考線**（仿 ReadTheory），讓老師不用心算「這個分數算不算正常」——低成本、高價值的小改動，可併入 README §4.2 的矩陣設計。
- **錯字總表可以探索「錯字回溯到部首/部件缺口」的方向**（仿因材網的往下追知識結構根因），但明確屬於本次範圍外的未來方向，不在這次 wireframe 裡實作，避免 over-engineering（這點僅供記錄，不建議這次就做）。

## 15. 範圍與誠實揭露

- 12 個產品中，**7 個（Google Classroom／IXL／Newsela／Edpuzzle／Wayground／Seesaw／Lexia）** 找到官方文件或說明頁對畫面的具體文字描述，可信度較高；**5 個（Khanmigo／ReadTheory／均一／因材網／PaGamO）** 部分段落標了「未見實物」，是因為搜尋結果沒有回傳實際畫面截圖或逐像素的畫面說明，只能依官方文字說明推測佈局，已在對應段落逐一標註，不混充為已見畫面。
- 本研究全程未開啟任何瀏覽器視窗（純 WebSearch 文字檢索），未對任何競品帳號做實際登入測試，所有結論僅供版面設計參考，不構成法律/商業上的競品分析意見。
