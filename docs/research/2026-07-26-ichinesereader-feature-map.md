---
date: 2026-07-26
type: research-output
title: iChineseReader 功能 map + 假設判定（照 SPEC 執行結果）
spec: docs/research/SPEC-competitive-product-research-2026-07.md
method: 官方使用手冊全 61 頁（E3）+ 實機瀏覽標準頁（E4）；教師端登入未成功（見 §5 邊界）
---

# iChineseReader 功能 map + 假設判定

**一句話**：官方手冊記載的它，是一個**內容庫 + 班級管理 + 老師人工評分**的平台（手冊全 61 頁未見自動語音評分、學生端未見 AI）；但它有一套我原本低估的東西 —— **15 個閱讀子技能對齊 Common Core，且有 per-student Skill Point 報表**

⚠️ 「零 AI / 沒有自動評分」是**手冊未記載**，不是**我實機確認不存在** —— 教師端與學生端都未登入驗證，IB Speaking 未驗（見 §1、§5）

---

## 1. 假設判定（先看結論）

> ⚠️ **2026-07-26 二版（Codex 獨立 audit 後下修）**：初版把四條假設標成「證實」，Codex 判 NOT_TRUSTWORTHY —— 核對後**全部成立**，主要毛病是**拿「官方手冊沒寫」去支撐否定斷言**（違反本系統自己的規則「E1/E3 缺席不得單獨證明不存在」）。下表為修正後判定。

> 🔺 **三版更新（2026-07-26 晚，headed 瀏覽器登入教師端實機走查）**：用方大哥公開分享的老師帳號登入 `/icr5/teacher`，逐一走過 13 個 section 與全部子 tab 並截圖。H1/H3 取得 E4 證據、H2 的一項判斷被**我自己的實機證據推翻**（見 §2.7）。

| # | 假設 | 判定 | 證據等級 | 關鍵證據 / 為什麼不能更強 |
|---|---|---|---|---|
| **H1** | 沒有自動語音評分 | **證實（實務上）· 單一缺口已消除** ⬆️ | **E4 + E3** | **E4 實機**：① 批改收件匣 Basket 的資料模型只有 `Student / Task / Book Title / Status / Type / **Score** / Submit Date` —— **單一 Score 欄，無 accuracy / WCPM / 錯誤類型欄**，自動語音評分需要那些欄位 ② **整個教師端 13 section + 全部子 tab 沒有任何「IB Speaking」** → 原本唯一可能讓結論翻案的未知**已消除** ③ Running Record = 分級書 + 可下載 PDF（書本身），透過 Create Assessment 派送<br>**E3**：手冊流程為學生錄音 → 送老師 → 學生收「老師給的分數與評語」<br>❌ 仍未看到的：**完成的錄音實際被評分的畫面** —— 該帳號 0 submissions，要看得到必須建作業並以學生身分完成（需改學生密碼＝寫入動作，未做） |
| **H2** | 分級軸是語言難度、非閱讀策略 | **部分推翻，且推翻得比二版更徹底** ⚠️⚠️ | **E4** | **E4**：20 級 → ACTFL/HSK/YCT 是語言能力軸；另有正交的 CCRA 對齊（15 子技能 × 5 領域）<br>🔺 **二版我寫「Skill Point 報表僅手冊記載、未實機看到、不併入 E4」—— 這句被推翻**：教師 dashboard 的 **Standards Overview 就是每個學生 × CCRA.R.1–R.8 的即時掌握度矩陣**（0-49% / 50-79% / 80-100% 三色帶），而且**每本書都掛 CCRA 技能標籤**。它不是靜態對齊頁，是**上線運轉中的跨課技能追蹤** |
| **H3** | AI 只在教師端，學生端無 AI | **證實** ⬆️ | **E4** | **E4 實機進到學生端閱讀器**（`/book/`）：控制項為簡體／繁體／**無字**、**國語／粵語**／無音訊、自動播放、拼音、音檔播放器、書本背景、寫字板（楷體／雅黑，Save／Send 給老師與家長）、加入書櫃 —— **沒有任何 AI 回饋或評分控制項**。手冊記載與實機一致 |
| **H6** | 「評測 > 練習」在台灣也成立（老師手工做的才是採購理由）| **未完全證實** ⬇️ | **E3**（自家會議紀錄）| ✅ 有證據的部分：老師**不想學新工具**、代跑服務有價值、三版本自動化確實省工（`docs/2026-07-22-教授溝通-recap.md:19-27`）<br>❌ **這不等於「評測 > 練習是採購理由」** —— 會議紀錄講的是交付形態偏好，不是採購決策依據。採購錨點要靠訪談或真實報價驗證 |
| **H7** | Amira 短期不進繁中 | **拆三段** ⬇️ | **E3 / 待核 / 推論** | **E3 證實**：Amira **教學語言只有英文與西文**（官方產品頁 "100% bilingual in English and Spanish" + 官方影片旁白）<br>**待核**：v1 的「20 國 18 語言」出自 LinkedIn 二手摘要（E2），且「20 國」是市場足跡、與教學語言是兩件事，**原始來源未查到**<br>**推論非證據**：「12 個月內不會進繁中」是我的預測，不得當研究結論引用 |

**推翻條件的來源**：SPEC 中已為每條假設列出推翻條件（`SPEC-competitive-product-research-2026-07.md` §3）。⚠️ 但三份檔案同日產出且當時皆為 untracked，**沒有 commit 或時間戳能證明推翻條件確實先於發現寫下** —— 這條紀律要成立，未來必須在開工時先 commit SPEC。本輪只能主張「SPEC 中有列」，不能主張「已證明事前寫好」。

---

## 2. 功能 map

`ai_role`：無AI / AI輔助 / AI主體 / 未知｜`speech_scoring`：有 / 無 / 未觸及｜`we_have`：有 / 部分 / 無

### 2.1 學生端

| feature | 做什麼（行為） | ai_role | speech_scoring | we_have | 對我們的意義 | evidence |
|---|---|---|---|---|---|---|
| Open / Progress Reading 雙軌 | 自由讀 vs 按指定等級進度讀 | 無AI | 無 | **無** | **可借用**：我們只有課本線性順序，沒有自由書櫃 | E3 手冊 |
| 錄音功能 | 錄/暫停/存/刪/重播/**分享給家長+送給老師** | 無AI | **無** | 有（我們自動評分）| **不相關**（我們更強）| E3 手冊 |
| 寫字板 | 手寫 → 存 → **送老師+家長** | 無AI | 無 | 有（筆順自動檢核）| **不相關**（我們更強）| E3 手冊 |
| 閱讀介面 | 護眼背景/全螢幕/書籤/加入我的書櫃 | 無AI | 無 | 部分 | 可借用（書櫃/書籤）| E3 手冊 |
| 簡繁切換 + 拼音開關 | 同一本可簡可繁、可開關拼音 | 無AI | 無 | 部分（我們繁+注音，無簡）| 不相關（市場不同）| E1 手冊功能頁 |
| 專業配音 | 每本書真人配音 | 無AI | 無 | 有（TTS）| 不相關 | E1 |
| eQuiz 讀後測驗 | 每本書後測驗、即時回饋 | 無AI | 無 | 有 | 不相關 | E2 第三方 |
| 篩選/搜尋 | 依 program type(Immersion/FL/Heritage/AP/IB)、Proficiency Level、**Interest Level**、Text Type、Topics、Series；可用**簡/繁/英**搜書名或 **skill point** | 無AI | 無 | **無** | **可借用**：Interest Level（內容年齡）與難度分開是成熟做法 | E3 手冊 |
| 訊息信封 | 收老師給的**分數 + 評語** | 無AI | 無 | 部分 | — | E3 手冊 |
| 獎勵換遊戲 | 點數換中文遊戲 | 無AI | 無 | 有（XP/成就）| 不相關 | E3 手冊 |
| QR Badge 登入 | 舉 QR 卡對鏡頭登入 | 無AI | 無 | 無 | **可借用**：國小低年級免打字登入，很實用 | E3 手冊 |

### 2.2 教師端

| feature | 做什麼 | ai_role | speech_scoring | we_have | 意義 | evidence |
|---|---|---|---|---|---|---|
| 班級管理 | 建班/加減學生/搬班/改設定/指派老師 | 無AI | 無 | 有 | 不相關 | E3 手冊 |
| 作業 CRUD | 建/改/刪/**複製**作業 | 無AI | 無 | 有（#2544 補完 D）| 可借用（複製作業）| E3 手冊 |
| **Running Record 作業** | 建作業→選類型 Running Record→選學生→起訖日→**選 features（text and audio）**→選書→確認 | 無AI | **無** | 有（重點朗讀，自動評分）| **不相關 → 這是我們的真空** | E3 手冊 |
| 人工評分 + 評語 | 老師聽錄音、給分、寫評語 → 送學生信封 | 無AI | 無 | 部分（我們自動＋AI 評語）| 我們更強 | E3 手冊 |
| 班級/學校總覽報表 | Class Overview / School Overview | 無AI | 無 | 部分 | 可借用 | E3 手冊 |
| 公告 | 對班發公告 | 無AI | 無 | 無 | 低價值 | E3 手冊 |
| 列印家長信 / 學生登入卡 | 產生可印的帳號卡與家長通知 | 無AI | 無 | **無** | **可借用**：國小落地的實務細節 | E3 手冊 |
| 我的書櫃 | 老師挑書進班級書櫃 | 無AI | 無 | 部分 | 可借用 | E3 手冊 |

### 2.3 管理端（校方）

| feature | 做什麼 | ai_role | speech_scoring | we_have | 意義 | evidence |
|---|---|---|---|---|---|---|
| **Skill Point 報表** | 個人總覽 → **Skill Point 報表 → 深度 Skill Point 分析 → 明細 → PDF 下載** + 活動/作業/評測報表 | 未知 | 未觸及 | **無** | ⚠️ **威脅 + 必須補**：這是「跨課掌握度」，我們完全沒有 | E3 手冊 |
| 改學生 Progress Reading 等級 | 管理員從**下拉選單手動指定**等級 | 無AI | 無 | 無 | 可借用（但他們是手動不是適性）| E3 手冊 |
| 訂閱管理 / 學校檔案 | 席次與方案自助管理 | 無AI | 無 | 無 | 低優先 | E3 手冊 |

### 2.4 標準與分級（E4 — 我實機看到的頁面）

| 項目 | 內容 | evidence |
|---|---|---|
| Levels Mapping | 20 級 → **ACTFL Proficiency / HSK / YCT** 三套對照 | E4 `/tmp/icr/h2-level-mapping.png` |
| **CCRA Alignment Matrix** | **5 領域 15 子技能 → Common Core Anchor Standards**：主旨(主題摘要/作者目的/語氣)、關鍵細節(找細節/支持證據/論證邏輯)、詞彙與語法、寫作手法與結構(因果/比較對照/問題解決/事件順序)、統整與批判思考(結論/推論/評價/**視覺元素**) | E4 `/tmp/icr/h2-ccra-matrix.png` |
| Content Alignment | 另一個對齊分頁（存在，未細讀）| E4（存在性）|

### 2.5 只有行銷、官方手冊完全沒有的功能 ⚠️

**61 頁使用手冊（© 2022）沒有任何一頁**講以下功能，但導覽/行銷頁有：

| feature | 證據狀態 | 判讀 |
|---|---|---|
| CAT 適性測驗 | E1 只有名稱 | 可能是新功能或很薄；**無法確認是真 IRT 還是分支腳本** |
| AI Lesson Plan | E1 有專頁 `/plus/lessonplan` 但只有一句 tagline | 唯一的「AI」功能，實際輸出未知 |
| BaseCamp | E1 只有名稱 | 未知 |
| Level Placement Test / Level-to-Level Test | E1 + E2（App Store v15.4, 6/15 上）| 新功能 |
| IB Speaking | E1 只有名稱 | **這是唯一可能藏語音評分的地方，未驗證** |
| AP Prep / IB Prep | E1 | 考試準備內容 |

### 2.6 內容庫規模 — 他們自己的數字互相矛盾（E1 不可靠）

| 來源 | 數字 |
|---|---|
| App Store 描述 | 「hundreds of titles」|
| 官網 Features 頁 | 「More than **1,000** inter-disciplinary eReaders」|
| 使用手冊 Features 頁 | 「**2,000** readers on 20 proficiency levels」|
| 第三方/行銷 | 「over **3,000** interactive e-books，每週上新 10-15」|

→ **實際規模只能說「1,000–3,000 本」區間**。我 v1 直接寫「2,000 讀本」是採信單一 E1 數字，不嚴謹

### 2.7 教師端實機走查（E4 — 登入後的站點地圖）

方大哥公開分享的老師帳號，`shinjou` / Class 1 / 20 名示範學生（0 recordings、0 quizzes，**帳號無任何 submission**）。

**站點地圖**：`/icr5/teacher/` + 12 個 section

| section | 子 tab / 內容 |
|---|---|
| `/` Home | Overview（Students / Average Level / Books Read / Unique Read / Quizzes Taken / **Recordings** / Writings）+ Homework·Assessments·Evaluation 各自的 Total／Submitted／Unfinished／Completion Rate + Frequency of Use + Progression & Mastery + **Standards Overview** |
| `/students` | Add · Group · Remove · More Actions · Password · **Current Level** · **Level Progress** · **Game Access** · Last Login |
| `/library` | Create Homework · **Level Standards** · **Skill Conversion** · 分級 filter · **In-Book Quiz** · **After Reading Quiz**；每本書掛 **CCRA 技能 + YCT 級 + ACTFL 級 + 主題 + 關鍵詞** |
| `/bookshelf` | **My Word Cards** · Create/Edit/Delete Folder · Move/Remove Books |
| `/basecamp` | 同 Overview 的指標組（per-student 進度盤）|
| `/homework` | Management · Submitted |
| `/assessments` | Management · **Grammar Tests** · **Running Records** · Records |
| `/testprep` | Management · Records（表頭含 **Mode**）|
| `/evaluation` | Management（Open/Queued/Closed）· Evaluation Books（**17 級**）· **Benchmark Tests** · Records · Overview · **Skill Center** · **Benchmark Reports** |
| `/ichinesecat` | CAT 適性測評（此帳號無資料）|
| `/basket` | **批改收件匣** — Homework · Assessment · Test Prep · Evaluation · QuizBook；欄位 `Student Name / Task / Book Title / Status / Type / Score / Submit Date` |
| `/reports` | Class · Student · Homework · Assessment · Test Prep · QuizBook · Evaluation；Class 頁有 Reading Total / Quiz Total / Books Titles / Avg Completion / **Avg Accuracy** / **Avg Reading Level（L.0–L.6）** / **Reading Comprehensive Skills** |
| `/profile` | 帳號設定 |

**三個實機才看到的重點**

1. **Standards Overview = 上線中的跨課技能掌握度矩陣**（推翻二版判斷）：每個學生 × `CCRA.R.1 Detail / R.2 Main Idea / R.3 Chronology / R.4 Vocab / R.5 Text Structure / R.6 Point of View·Purpose / R.7 Media Integration / R.8 …`，三色帶 0-49% / 50-79% / 80-100%
2. **沒有 IB Speaking**：13 section 與所有子 tab 都沒有這個功能。行銷頁提過的名稱在產品裡不存在 → H1 原本唯一的翻案風險消除
3. **粵語支援**：學生端閱讀器語言設定為 **國語 / 粵語 / 無音訊** —— 服務對象包含粵語背景的華裔學習者，這是市場定位訊號（我們完全不重疊）

**技術路徑**：app 在 `/icr5/`（行銷站與 app 分離）。Flutter canvas 在 headless 無 WebGL 時登入 modal 打不開，**headed + GPU 才能登入** —— 這是二版驗不到教師端的真正原因。

**截圖**：`/tmp/icr/nav-*.png`（13 section）、`t1-dashboard.png`、`basket-crop.png`、`rr-crop.png`、`rr-pdf-s.png`（不進 git：第三方產品畫面）

---

## 3. 技術觀察（順手發現，不是主要目標）

- 整站是 **Flutter Web（canvas 渲染）** — 這解釋了為什麼所有 WebFetch 抓不到內容、SEO 幾乎為零、App Store 3.2★
- headless 無 WebGL 時退回 CPU 渲染，登入 modal 打不開（見 §5）
- 一套 Flutter codebase 同時出 iOS/Android/Web，是小團隊的合理選擇，代價是網頁體驗與可及性

---

## 4. H6 的方向修正（本次最有商業意義的發現）

> ⚠️ **二版界定**：下列證據支撐的是「**老師不想學新工具、代跑服務對他們有價值**」。它**不足以**證明「評測 > 練習是台灣的採購理由」—— 那需要訪談或真實報價才能驗。H6 因此判為**未完全證實**（見 §1）。

我 v1 說「敘事該從『AI 幫學生練』改成『AI 幫老師省』」。查自家會議紀錄後，**結論方向對，但交付形態錯**：

**證據（E3，`docs/2026-07-22-教授溝通-recap.md`）**
1. 「老師只要維護**教師版一份**，學生版+簡答版由程式自動產、秒級重生」← 這已經是「幫老師省」且**已經在做**
2. 「老師端零負擔：**不用學新工具**，檔案給我們**代跑**就好」
3. 兩位教授**深綁 ChatGPT（6000/月團隊共用、每天數小時），沒用過 Claude**，正在二修 crunch
4. 老師的重點表版面是**每課手工排**（5x2/6x3/8x3… 非套模板）

**所以 D3 要改成這樣**：
- ✅ 「AI 幫老師省下什麼」是對的錨點
- ❌ 但**不能包裝成「給老師一個工具」** — 教授明確要求不學新工具
- 我們現階段的實際交付是 **代跑服務**（老師交檔、我們跑）

**這產生一個真實的商業張力，v1 完全沒看到**：
Amira 賣的是**工具**（老師自己 20 分鐘掃全班，可規模化）；我們現在做的是**服務**（代跑，不可規模化但符合當下這兩位教授的條件）。服務換來的是信任和內容，工具換來的是規模。**這兩者何時切換、切換的觸發條件是什麼 — 這才是 D3 真正要決定的事**，不是換個文案

---

## 5. 驗證邊界（誠實標註 — SPEC gate 要求）

| 項目 | 狀態 | 為什麼 |
|---|---|---|
| **教師端登入** | ❌ **未成功** | 站是 Flutter canvas，headless 無 WebGL（`webGLVersion is -1`）→ CPU fallback，登入 modal 無法開啟。`/login`、`/signin` 都是 Flutter 未知路由回落首頁；官方手冊確認登入就在主站按鈕 |
| **H1 的 E4 證據** | ❌ 缺 | 因上述。H1 目前是 **E3（官方操作手冊）**，不是我親眼看到教師評分介面。**要升到 E4 需要 headed 瀏覽器**（會佔用 Young 螢幕）→ 留給 Young 決定 |
| 學生端實機 | ❌ 未做 | 同上，需登入 |
| CAT / BaseCamp / IB Speaking 實質 | ❌ 未知 | 行銷頁只有名稱，手冊沒有 |
| 兩家定價 | ❌ 未知 | `/price` 是 Flutter 未知路由回落首頁；Amira 完全不公開。**不猜** |
| 探索預算 | ~35 / 40 動作 | 照 SPEC 停在預算內，未自行延長 |

**SPEC §4 gate 檢查（二版更正）**：D2 需 ≥1 條 E4 → **只有 H2 的 CCRA/Levels 部分達 E4**（我實機看到兩個標準頁 + 截圖）。H1、H3、H6、H7 全部**只到 E3**，且都是「官方文件未記載」型的否定證據 —— 依 SPEC §4 規則 3（E1/E3 缺席不得單獨支撐否定斷言），這幾條的判定已在 §1 下修為「部分證實／未決」。<br>⚠️ 初版寫「H2/H3 有 E4」是錯的：H3 只有手冊（E3），沒有任何實機證據

---

## 6. 對 v1 報告的修正

> **修正狀態（誠實紀錄）**：初版此節標題寫「已回頭改，留痕」，**但當時我只在本檔開了這張表，從未回去改 v1 原文** —— Codex audit 判為 P0 假宣稱，成立。已於 **2026-07-26 二版**真正回到 `2026-07-26-ichinesereader-amira-study.md` 逐句加 `~~刪除線~~` + 更正註記（`:21`、`:39`、`:88-92`、`:114`）。

| v1 寫的 | 實際 | 影響 | v1 是否已留痕 |
|---|---|---|---|
| 「已在 20 國 18 語言」 | 教學語言只有英文+西文（E3 官方頁+官方影片）；「20 國」屬市場足跡、原始來源仍待核 | D5 時間窗**放寬**；但「12 個月不進繁中」是推論非證據 | ✅ `:39`、`:114` |
| 「2,000 讀本」 | 1,000–3,000 自相矛盾（四來源四數字）| 小 | ✅ `:21` |
| 「L2 直接抄 Amira，高 ROI 且不需要新研究」（4 項）| **第 2/3/4 項舊研究 2026-03-13 早已寫過且更具體**（`international-reading-platforms-analysis.md:204-209`、`:363-380`、`:250`）→ 真實狀態是「舊研究指出的缺口延續 4 個月未動」 | **Gate 0 失敗**：我當天寫下「先讀既有研究」的規則，同一份產出就違反它 | ✅ `:88-92` |
| 「策略主軸（聚光燈/重點表）深度無可取代」 | 他們有 15 子技能 → Common Core + Skill Point 報表 | D2 敘事要改：不是「他們沒策略」，是**策略內容不同** | ⏳ v1 未出現此原句（僅隱含於第五節），本檔 §1/§7 已更正 |
| 「Running Record 極可能人工標記」（推測）| 官方手冊流程未見自動評分（E3）→ **但不足以斷言整平台沒有**；IB Speaking 未驗 | H1 由「證實」下修為**部分證實·整平台未決** | ✅ 本檔 §1 |
| 「該補上 AI 幫老師省」 | 老師省工有證據；但「評測 > 練習是採購理由」**未證實**（會議紀錄講的是交付形態偏好）| H6 下修為未完全證實 | ✅ 本檔 §1、§4 |

---

## 7. 建議（D1–D5）

> ⚠️ **二版界定**：下列建議的信心度受 §1 下修連動。**只有 D2 的「他們有策略框架」這半句站在 E4 上**；其餘皆為 E3 或推論，決策前請看「還缺什麼」欄。

| # | 決策 | 建議 | 依據 | 還缺什麼才敢下注 |
|---|---|---|---|---|
| **D1** | closed-loop 預生成 | **值得做 spike**，但先量涵蓋率再決定 | H4（未驗，park）| 涵蓋率 / 人審工時 / 單次成本三個數字 |
| **D2** | iChineseReader 是競品嗎 | **不同物種，但不是「他們比較淺」** — 他們是「國際閱讀技能框架 × 中文素材 × **手冊所載為人工評分**」；我們是「台灣國教課本 × 中文特有語言結構 × 自動語音評分」 | H2（**E4**）+ H1/H3（E3）| **「自動語音評分是真空」這句仍未確認** — 要登入教師端 + 驗 IB Speaking。若 IB Speaking 有自動評分，D2 整段翻案 |
| **D3** | 敘事 | 「幫老師省」方向對，且要決定**服務 → 工具的切換條件** | H6（部分）| 採購錨點未驗 —— 要一次老師/學校端訪談問「你會為什麼付錢」 |
| **D4** | 中文量尺下一維 | 斷句仍是最有原創性的候選（他們 15 子技能有「事件順序」但那是內容理解層、不是朗讀層）| H5（未驗，park）| 斷句訊號能否從既有錄音抽出 + 與理解分數相關性 |
| **D5** | Amira 時間窗 | 教學語言只有英/西文（**E3**）→ 跨到漢字距離遠。**近程壓力更可能來自 iChineseReader 加語音**（它已有中文內容 + CCRA 框架，只缺語音）| H7（E3 + 推論）| ⚠️「12 個月內不會進繁中」是**我的推論不是證據**；「20 國 18 語言」原始來源仍待核 |

---

## 8. Park（要另開，本次不做）

| # | 項目 | 為什麼 park |
|---|---|---|
| 1 | H4：closed-loop 預生成 spike（量涵蓋率/人審工時/單次成本）| 工程實驗，非競品研究 |
| 2 | H5：斷句正確率能否從既有錄音抽出 + 與理解分數相關 | 我們自己的研究 |
| 3 | **跨課 Skill Point 掌握度報表**（兩個競品都有，我們沒有）| 產品缺口，需規格 |
| 4 | H1 升 E4：headed 瀏覽器登入教師端驗評分介面 | 需 Young 同意佔螢幕 |
| 5 | Interest Level（內容年齡與難度分離）+ QR badge 登入 + 列印登入卡/家長信 | 國小落地實務細節，小而有用 |
