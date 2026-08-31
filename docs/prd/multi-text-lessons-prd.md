# PRD：多文本課重構 —— 一課 = 一份有序的文章清單

> 2026-08-24。取代「一課一篇」的隱含假設。
> 架構背景與 dry run 證據見 `multi-text-lessons-architecture.md`，本文只寫**怎麼改**。

## 0. 狀態：定稿（2026-08-24）

經過一輪 codex 對抗式審查（六點全部「有問題」）＋ 五件實地調查，本文已定案。
下面每一個 🔴 都附了**實際檔案行號**，不是推測。

### 🔴 改名：`texts` → `parts`（調查發現的撞名）

`text_id` 這個名字**已經被佔用**：`backend/app/models/assignment.py:42` 的 `text_id`
指的是「老師／學校擁有、存在 `texts` 資料表（`models/text.py:32`）的課文」——
可編輯、派作業時會 fork，跟「一份學習單裡的第幾篇」是**完全不同的東西**。

```
story_id  平台的 YAML 課文（不可編輯）      ← 既有
text_id   資料庫裡老師擁有的課文（會 fork）  ← 既有，不要碰
part_id   一份學習單裡的第幾篇               ← 本文新增
```

沿用「part」還有一個好處：**教材印的就是「篇次 N/M」= part N of M**，
而既有側檔本來就叫 `multi_text_parts.yml`、欄位是 `part_no` / `part_of`。

## 1. 三條不可違反的約束

| # | 約束 | 為什麼 |
|---|---|---|
| A | **已上架的 QR URL 一個字都不能改** | prod 現在印著 106 個全文 + 147 個段落 QR，紙已經在教室裡 |
| B | **單篇課的行為必須逐字不變** | 175 課裡 170 課是單篇；任何回歸都是 170 課的回歸 |
| C | **不拆課** | 拆課會動到完成記錄與作業引用（CLAUDE.md 記過：新增 step 會讓完成記錄寫錯 step → 作業交不出去）|

> 驗收方式：每一層都要拿**多文本課 + 單篇課**兩組跑，單篇課那組的輸出必須與改動前**逐字相同**。

## 2. 資料模型

```yaml
# lesson.yml
parts:
  - id: k3f9x                    # 身分：不透明、指派一次、永不重用、永不修改
    label: 大衛與歌利亞（故事）     # 可讀性：隨便改
  - id: m7qxv
    label: 為什麼小的能贏（分析）
```

| | 住哪 | 可以改嗎 |
|---|---|---|
| 順序 | **yml 清單的排列**（不存 `order`）| ✅ 搬上搬下 |
| 身分 | `id` | ⛔ 永不修改、永不重用 |
| 可讀性 | `label` | ✅ 隨便改 |

**單篇課也要有 `parts`**，長度 1。⛔ 不要讓「有沒有 texts」變成分岔 —— 那會讓每個消費端都要寫兩套。

### id 產生規則

```
字元集  34679acdefhjkmnpqrtuvwxy      24 個
        去掉 0 O · 1 l I · 2 Z z · 5 S s · 8 B b · g q（紙本掃不到時老師要手打）
長度    5 碼（796 萬組合）
產法    隨機 → 檢查全庫沒撞過 → 寫進 yml 就定案
```

**禁令的正確寫法**（審查指出我原本寫窄了）：

```
⛔ id 不得帶有 order / title / content hash / lesson number 的語意
```

不是「不能從 uid 衍生」—— `lesson_uid + 隨機後綴` 也可以夠不透明。
真正的問題是**混淆 identity 與 order**，禁令要針對那個。

**🔴 安全性不能寄託在「隨機」** —— 要有 registry：

```yaml
# backend/data/part_ids_registry.yml
k3f9x: { status: active,  lesson_uid: L0063, label_snapshot: 大衛與歌利亞（故事） }
m7qxv: { status: retired, lesson_uid: L0063, retired_at: 2026-09-01 }
```

`retired` 的 id **永久保留、永不重用**（舊紙本的 QR 會指到不相干的新文章）。
CI gate 擋：id 消失、id 改指到別課、重用 retired 的號。

## 3. 辨識（哪些課是多文本）

三個訊號，**全庫實測 4/4 完整、0 漏網**：

| 訊號 | 例 | 可靠度 |
|---|---|---|
| 檔名 | `G5-L17-18`、`G6-L22-24`、含「多文本」 | 5 課命中 |
| 文字層 `篇次 N/M` | `篇次1/3`（帶標題樣式）| 4 課命中，序號自洽 |
| 段落 `idx` 中途重起 | `[1…9, 1…10]` | 書信體也會命中（L0010 L0012）|

**總篇數取 `篇次 N/M` 的 M，不要自己數段落。**
交叉驗證：分隔句「（請繼續閱讀下篇文章）」應為 M−1（L0144 是 0 → 標出來給人看，**不要自動補**）。

## 4. 分類（寫進 metadata）

`scripts/corpus_profile.py` 已有 `multi_text` 類別。要補的：

```yaml
source_profile:
  class: multi_text
  text_count: 3            # 取自 篇次 N/M 的 M
  text_boundary_known: true
  separator_count: 2       # 應為 text_count - 1
```

**gate**：`text_count` == `parts` 清單長度 == `篇次 N/M` 的 M。三者不合就紅。

## 5. 抽取（每篇各跑一次現有模組）

現況（實測，各課覆蓋完全不一致）：

| 課 | 側檔篇數 | 每篇帶了什麼 | 缺 |
|---|---:|---|---|
| L0029 | **0** | 🔴 沒有側檔 | 全部 |
| L0063 | 2 | body 念順順 語詞×2 重點表 追問 | 理解題 聚光燈 |
| L0111 | 1 | body 聚光燈 | 其餘 |
| L0137 | 1 | body | 其餘 |
| L0144 | 2 | body 理解題 語詞定義 重點表 | 念順順；`part_no: None` |

**要做的**：以「篇次 N/M」那個標題段為切點，把原稿切成 N 塊，**每一塊各跑一次現有的模組抽取器**。

⚠️ **念順順也會重複** —— 每篇有自己的 ☞ 與自己的累計字數欄。
今天做的 `scripts/key_reading_xml_rule.py` 目前是「一課一個」，要改成「一篇一個」：
切篇之後，錨點與計數欄的搜尋範圍限縮在該篇的頁面區間內。

**gate**：每篇該有的模組不可缺；缺就是抽取沒抽完，不是「這篇沒有」。

## 6. 模組 skill 要改什麼

`.claude/skills/lesson-reading-pipeline/SKILL.md`：

1. 第 0 步的普查加一欄「篇數」，並在分類表補 `multi_text` 的處理方式
2. 念順順那一節加：**先切篇，再在該篇範圍內找 ☞ 與計數欄**
3. 明寫：`篇次 N/M` 的 M 是總篇數的權威來源，分隔句只是交叉驗證

## 7. yml

```
lesson.yml                     parts: [...]          ← 新增
<既有模組>.yml                  不動                  ← 單篇課完全不受影響
multi_text_parts.yml           標 deprecated，內容遷入每篇的模組檔
```

**遷移期兩者並存**：loader 先讀 `parts`，讀不到才回退舊路徑。等 4 課遷完再拿掉回退。

## 8. HTML

### 7.1 現況（dry run 實測）

```
/learn/20063/full-text-annotate    第1篇 ✅ 第2篇 ✅ 第3篇 ✅  篇次字樣 ❌  2768 字
```

三篇**都 render 出來了，但沒有任何界線** —— 學生看到一坨。
**這就是「整課音檔混在一起」的直接原因**：頁面沒有界線，音檔照著念。

### 7.2 圈圈（stepper）怎麼設計

現在 L0063 的 `step_sequence` 是**平的** 9 個 step，跟單篇課一模一樣。

三種做法：

| | 形狀 | 判定 |
|---|---|---|
| A 平鋪加編號 | 讀全文⑴ 念順順⑴ 理解⑴ 讀全文⑵ … | 🔴 3 篇 × 9 步 = 27 個圈圈，手機上不能看 |
| **B 兩層** | **上排選篇（分頁）＋ 下排維持現有圈圈** | ✅ 單篇課上排不出現 → 行為完全不變 |
| C 分組 | 圈圈依篇分組、中間插分隔 | 🟡 仍然很長，且既有元件要大改 |

**選 B**：

```
┌─────────────────────────────────────────┐
│  篇① 大衛與歌利亞   篇② 為什麼小的能贏      │  ← 只有多篇課才出現
├─────────────────────────────────────────┤
│  ①簡介 ②讀全文 ③念順順 ④理解 …           │  ← 現有元件，原封不動
└─────────────────────────────────────────┘
```

- **單篇課：上排不渲染** → DOM 與現在逐字相同（可用既有 render-smoke 驗）
- 切篇 = 換 `?p=`，下排圈圈的完成狀態跟著該篇走
- 上排顯示 `label`（可讀），URL 帶 `id`（不透明）

### 7.3 🔴 `?p=` 會被站內導航吃掉（審查指出，附行號）

```
frontend/src/hooks/useLearningStepNavigation.ts:146 / :157 / :411
frontend/src/routes/learningRoutes.tsx:133-135        （disabled step 的 redirect）
```

這幾處只組 `/learn/${storyId}/${step}`，**query 直接丟掉**。

**怎麼壞**：學生掃第 2 篇的 QR 進來 → 第一步是第 2 篇 → 按「下一步」→ URL 沒有 `?p=`
→ 依定位規則回到第 1 篇 → **學生從此在做錯的篇，而且沒有任何提示**。

✅ 登入導回**不是**雷（`services/sessionGuard.ts:15-19` 有保留 search）。
主雷是站內：step navigation、skip、stepper click、assignment resume。

**gate**：所有 `/learn/:storyId/:step` 的 navigate / redirect / stepper / skip / report back link
**必須 preserve `location.search`**，並加測試：從 `?p=m7qxv` 按下一步、點 stepper、
觸發 disabled redirect、作業 resume 之後，`?p=` 仍在。

### 7.4 🔴 找不到 id：404 不夠，要有明確的 UI 狀態

原本只寫「回 404」。審查指出會誤傷真實使用者：短碼被誤改、環境資料不同步、
快取的舊 HTML、老師手打錯一碼、書籤指到已退役的篇。

**改成 hard invalid-part state**：

```
API      404 / 410
UI       明說「這個篇章代碼不存在」
         ⛔ 不寫進度  ⛔ 不自動播第一篇
         提供「重新掃 QR」與「回課文清單」入口
```

### 7.5 完成記錄

`step_progress` 的 key 從 `{step}` 變成 `{partId}:{step}`；**沒有前綴的舊資料視為第一篇**。

**🔴 但 key 改了不等於語意有了。** 審查指出 PRD 沒定義三個層級的關係：

| 層級 | 意思 | 誰在用 |
|---|---|---|
| `part_step_completed` | 某篇的某一步做完 | stepper 圈圈 |
| `part_completed` | 某篇的所有必要步驟做完 | 上排分頁的完成標記 |
| `lesson_completed` | **所有 required parts 都完成** | 圖書館狀態、作業提交 |

**預設：老師派「整課」= 所有 texts 都完成才算 submitted。**
若要允許派單篇，`assignment` payload 必須有 `target_part_ids` ——
⛔ **不可以靠 `?p=` 偷渡**（那個是定位用的，不是授權用的）。

現有實作沒有 part 維度，會被打到的點：
```
backend/app/models/session.py:186-217    由 steps_completed 推導 current step，只認 step
frontend/src/services/progressApi.ts:239-247   圖書館狀態是 story_slug → status
```

### 7.6 🔴 快取與暫存也要有 part 維度（不然兩篇會互相污染）

```
frontend/src/services/learningStorageScope.ts:7-10   localStorage 只有 storyId / assignmentId
frontend/src/services/ttsApi.ts:30-32 / :304-310     TTS 快取鍵只有 lessonId + 段號 + 句子
```

**後果**：第 1 篇與第 2 篇**共用標註、練習暫存、音檔快取**。

所有 key 一律納入 `{storyId}:{partId}`。
⚠️ **單篇課的 partId 不得讓既有 key 失效** —— 否則 170 課的學生暫存全部清空。

## 9. QR code

現在 `buildQrManifestRows` 是 `stories.map(...)` —— 一課一列、最多兩個 QR。

**改成走訪 `parts`：一篇一列。**

```
單篇課       full_url = /learn/20011/full-text-annotate           ← 逐字不變
多篇課第1篇   full_url = /learn/20063/full-text-annotate           ← 也不變
多篇課第2篇   full_url = /learn/20063/full-text-annotate?p=m7qxv   ← 純新增
```

**定位規則**

```
沒帶 ?p=      → 取清單第一個
?p=<id>       → 照 id 找，跟排第幾無關
找不到該 id    → ⛔ 回 404，不准 fallback 到第一篇
```

最後一條是硬的：靜默退回第一篇，等於印錯的 QR 會播**別篇內容**而沒人發現。

**gate**（延伸既有 `verify_qr_manifest`）：
- 每個 QR 指到的音檔必須存在（既有規則）
- 每個 `?p=` 的 id 必須在該課的 `parts` 裡
- **單篇課輸出的列與改動前逐字相同**

## 10. 驗收：兩組都要跑

| | 多文本組 | 單篇對照組 |
|---|---|---|
| 課 | L0029 L0063 L0111 L0137 L0144 | L0011 L0013 L0015 L0035 L0173（含今天的邊緣樣本）|
| yml | `parts` 長度 == 篇次 M | `parts` 長度 == 1 |
| API | 每篇模組齊全 | **回應與改動前逐字相同** |
| HTML | 篇次標記出現、上排分頁可切 | **DOM 與改動前逐字相同**（上排不渲染）|
| QR | 一篇一列、`?p=` 正確 | **列輸出與改動前逐字相同** |
| 完成記錄 | 各篇獨立 | 舊資料仍讀得到 |

> 「逐字相同」是可機器驗的：改動前先存一份 baseline，改動後 diff。
> ⛔ 不要用「看起來沒壞」當驗收 —— 170 課的回歸不會有人一課一課看。

### 🔴 「逐字不變」要拆成兩種，否則它自相矛盾

審查指出：§1 要求單篇課也帶 `parts`，§9 又要求 API 回應逐字相同 —— **兩者不可能同時成立**。

| 對象 | 標準 |
|---|---|
| **legacy endpoint · QR manifest · 學生頁 DOM** | **byte-identical**（單篇課）|
| 新 endpoint／opt-in 的回應 | 才允許出現 `parts` |

其他「看似相同實際不同」的陷阱（審查列的）：
- Pydantic 預設值把 absent 變成 `parts: []` 或 `null`
- YAML dump 重排 key → golden diff 大面積紅但行為沒變
- 前端 query cache key 沒變，舊頁吃到新 shape

### 🔴 漏掉的層（審查補的，全部附行號）

| 層 | 現況 | 會怎麼壞 |
|---|---|---|
| 圖書館／搜尋 | `pages/student/StoryLibrary.tsx:95-107` 以 story 為卡片 | 多篇課要不要展開成篇？沒定義 |
| 作業 | `pages/student/MyAssignments.tsx:138 / :176 / :195` start/resume/report 只 navigate 到 story+step | **完全沒有 partId** |
| 學習報告 | `backend/app/models/session.py:144-147` 每種 result 只有一份 | 多篇**互相覆蓋**或混成一份報告 |
| 音檔／TTS 管線 | ✅ **已查**（§12④）：`plan_demo_audio` 是純函式，加篇約 15 行 | 但各課 `paragraphs` 裝的東西不一致 → 階段 1 要一併統一 |
| spec module | `specs/registry.yaml:120-128 / :537-552 / :730-745`（content-schema · reading-transcription · tts）| PRD 沒要求更新 INTENT 與 spec tests |

## 11. 順序（不可調換）

**🔴 我原本的順序是錯的。** 原本把「完成記錄」排最後，審查指出那會在中間版本
**把第 2、3 篇的進度寫進「一課一份」的舊欄位** —— 第 2 篇做完 `full-text-annotate`，
回第 1 篇看起來也完成了；報告可能拿到別篇的 step_data；老師看到錯的完成狀態。

**原則：資料寫入邊界必須早於可見入口。**

| 階段 | 做什麼 | 為什麼是這個位置 |
|---|---|---|
| 1 | 抽取端切篇 + 每篇跑模組（含念順順）| 沒資料，後面都是空殼 |
| 2 | **part-aware 的 progress schema + storage/TTS/annotation key**（read-compatible，**UI 還不開第 2、3 篇**）| 🔴 **寫入邊界先就位**，否則中間版本會污染舊紀錄 |
| 3 | `parts` 進 lesson.yml + loader 讀它（單篇課長度 1）| 讀取層相容 |
| 4 | API 吐 `parts`（新 endpoint／opt-in），`multi_text_parts` 標 deprecated | legacy 回應維持 byte-identical |
| 5 | 站內導航全面 preserve `location.search` + invalid-part state | 🔴 **必須早於**開放第 2、3 篇，否則學生一按下一步就掉回第 1 篇 |
| 6 | HTML 上排分頁 → 學生看得到第 2、3 篇 | 前面都就位才開入口 |
| 7 | QR manifest 一篇一列 | 教材端可以印 |
| 8 | assignment / report 的完整聚合（`target_part_ids`、三層完成語意）| 風險最高，單獨 PR |

⛔ 不要先做 6 或 7。

## 12. 五件調查的結果（原本是「動工前要查的洞」，已查完）

### ① query param 稽核 —— **要改 18 處**，比審查點名的多

```
navigate(`/learn/…`)  共 22 處
  🔴 站內導航，必須 preserve search   15 處
  ✅ 入口，取第一篇即可                7 處
<Navigate to={`/learn/…`} replace>   2 處   routes/learningRoutes.tsx:135 / :158
handleSkip 的 navigate                1 處   routes/learningRoutes.tsx:110
```

**要改的 15 處站內導航**：

```
components/layout/AppShell.tsx:285              components/reading-steps/StepFooterNav.tsx:42
components/reading-steps/Intro.tsx:446          hooks/useLearningStepNavigation.ts:157 / :411
pages/learning/KeyPassageReadingPage.tsx:46     pages/learning/ComprehensionPage.tsx:38
pages/learning/SentencePracticePage.tsx:35      pages/learning/SpotlightPage.tsx:132
pages/learning/ListeningPage.tsx:28             pages/learning/DictationPage.tsx:35
pages/learning/CharacterPracticePage.tsx:38     pages/learning/ReportPage.tsx:172 / :202
pages/student/PracticeToolbox.tsx:41
```

✅ 登入導回**不用改**（`services/sessionGuard.ts:15-19` 已保留 search）。

**gate**：加一條 lint／測試 —— `/learn/:storyId/:step` 的導航一律走同一個 helper，
該 helper 強制帶上現有的 `location.search`。⛔ 不要靠人記得。

### ② storage / 快取的 key —— 比想像便宜

| | 現況 | 要改嗎 |
|---|---|---|
| localStorage | `services/learningStorageScope.ts` 的 `getLearningStorageScope(storyId)` **單一函式**，8+ 元件都經過它 | ✅ **只改這一個函式** |
| 後端 TTS 音檔快取 | `services/tts/normalization.py:341` `_cache_key(text)` —— **句子文字的 hash** | ⛔ **不用改**（兩篇句子不同就是不同鍵）|
| 前端 mapping 快取 | `services/ttsApi.ts` `${lessonId}-${paragraphIdx}` | 🔴 **要改** —— 兩篇的第 1 段都是 `20063-1` |

（審查說「TTS 快取沒有 part 維度」只對一半：後端不需要，前端 mapping 需要。）

### ③ 完成記錄 / 作業 / 報告

🔴 **`LearningSession` 有唯一索引 `(student_id, story_slug)` where `status='in_progress'`**
（`backend/app/models/session.py:95-98`）→ **一個學生一課只能有一個進行中的 session**。

⇒ **「每篇一個 session」做不到。** 結果必須在同一個 session 內按篇分開存：

```
現在（各只有一份，多篇會互相覆蓋）        models/session.py:144-147
  reading_result / comprehension_result / vocab_result / full_reading_result

改成
  results: { <partId>: { reading: …, comprehension: …, vocab: … } }
  舊的四個欄位保留為「第一篇」的相容視圖
```

`current_step_derived`（`session.py:186-217`）由 `steps_completed` 推導，只認 step 不認 part
→ 要改成先選 part 再推導。

**三層完成語意**（審查要求，本文定案）：

| 層級 | 意思 |
|---|---|
| `part_step_completed` | 某篇的某一步 |
| `part_completed` | 某篇的所有必要步驟 |
| `lesson_completed` | **所有 required parts 都完成** ← 圖書館狀態、作業提交用這個 |

老師派「整課」= 所有 parts 完成。要派單篇，`assignment` 要有 `target_part_ids`
（`models/assignment.py` 目前只有 `story_id` / `text_id`，沒有 part 維度）。
⛔ 不可以靠 `?p=` 偷渡授權。

### ④ 音檔 / QR 管線 —— 查完了，能按篇產

`backend/scripts/build_demo_reading.py:60` 的 `plan_demo_audio` 是純函式：
吃課的清單、吐 `AudioPlan`。**加篇的維度約 15 行**（多一層迴圈、路徑加 `{partId}`），
沒有任何外部依賴。

```python
full_text = "\n".join(lesson["paragraphs"])          # :73
object_path = f"demo-reading/{lid}/full.mp3"         # :84 / :95 / :107
```

單篇課的路徑**必須原封不動**（已印出的 QR 導到的頁面會抓它）。

#### 🔴 查出來的比回報的嚴重：同一個問題長出**兩種**壞法

音檔的內容 = `"\n".join(lesson["paragraphs"])`，而各課的 `paragraphs` 裡裝什麼**不一致**：

| 課 | API `paragraphs` | `multi_text_parts` | 產出的整課音檔 |
|---|---|---|---|
| L0029 G5-L17-18 | **19 段 2020 字**（兩篇都在裡面）| 0 篇 | 🔴 **兩篇連著念** |
| L0063 G6-L22-24 | 7 段 800 字（只有第一篇）| 2 篇 | 🔴 **只念第一篇，另外兩篇沒有音檔** |

**教材端只回報了前者**，因為後者「聽起來正常」—— **少念了兩篇，沒有人聽得出來**。

⇒ 這也回答了「五課會不會很花時間」：真正要處理的不是重生 QR，
是**先讓 `paragraphs` 與 `parts` 的關係一致**，否則按篇產音檔會照著錯的來源產。

### ⑤ 單篇課 byte-identical baseline

改動前先存三份，改動後 diff：

```
1. API      GET /api/stories/{id}  ×175 課的完整 JSON
2. DOM      學生頁 innerText  ×抽樣（含今天的邊緣樣本 L0011 L0013 L0015 L0035 L0173）
3. QR       buildQrManifestRows 的完整輸出
```

**單篇課那 170 課，三份都必須逐字相同。** ⛔ 不准用「看起來沒壞」。

## 13. 實際要做的量（量出來的，2026-08-24）

### 音檔與 QR：25 支（現在 11 支）

| 課 | 年級 | 篇 | 每篇 | 小計 |
|---|---:|---:|---|---:|
| L0010 把球打好，就夠了嗎 | 4 | 2 | 全文+段落 | 4 |
| L0012 想讀書，該從哪裡著手 | 4 | 2 | 全文+段落 | 4 |
| L0029 牧羊少年的逆轉勝 | 5 | 2 | 全文+段落 | 4 |
| L0063 物以稀為貴 | 6 | 3 | 全文+段落 | 6 |
| L0111 雨林裡的奇蹟藥物 | 8 | 2 | 只有段落 | 2 |
| L0137 未解之謎──石頭的祕密 | 9 | 2 | 只有段落 | 2 |
| L0144 馬拉松王者──基普喬吉 | 9 | 3 | 只有段落 | 3 |
| **合計** | | **16 篇** | | **25** |

全部平台自產（Azure TTS），不經 YouTube —— 教材端「不要用 YouTube」那條順便滿足。

### 念順順：已經抽對了，沒有缺口

⚠️ 數的時候要用「請用計時器，從指定段落」當節數 ——
**「念順順」四個字在版面上每節印兩次**（標題重複），拿它當分母會誤判成缺一半。

```
L0029  2 個念順順 → 每篇一個   已抽出 2  ✅
L0063  3 個念順順 → 每篇一個   已抽出 3  ✅
L0010  1 個（書信體兩篇共用）  已抽出 1  ✅
L0012  1 個（同上）            已抽出 1  ✅
L0111 · L0137 · L0144  0 個（這三課本來就沒有這一節）  ✅
```

⇒ **不是每一篇都一定有自己的念順順** —— 多文本閱讀課是每篇一個，書信體是整課共用。
渲染時要照資料走，不要假設「N 篇就有 N 個念順順」。

## 14. 定案的資料形狀（owner 2026-08-24 逐次修正後）

### 不要「篇」這個抽象層 —— section 本來就是平的

`sections_present` 早就是一路排下來的平清單，L0029 就是 16 個大題：

```
一讀全文 二念順順 三語詞我最棒 四語詞應用 五文章重點整理 六閱讀理解
一讀全文 二知識補給站 三念順順 四語詞我最棒 五語詞應用 六文章重點整理 七綜合練習 …
```

編號重新從「一」起算而已，**沒有巢狀**。
⛔ 本文早期版本設計了 `parts:` 這個課級的抽象層 —— **那是錯的**，owner 指出：
「就是所有都是獨立的 section 就好，今天只是因為課文是重複的，所以給他 id as slug」。

### 重複的不只課文（實測）

| 課 | 重複的大題 |
|---|---|
| L0029 | 讀全文×2 念順順×2 語詞我最棒×2 語詞應用×2 文章重點整理×2 |
| L0111 | 讀全文×2 閱讀聚光燈×2 |
| L0137 | 讀全文-做記號×2 |
| L0144 | 讀全文×3 語詞我最棒×3 文章重點整理×2 閱讀理解×3 閱讀接力×3 |

⇒「一課多篇」這個說法不精確，真相是**某些大題在一課裡出現多次**。

### 一個模組一份 yml —— 重複就是多一份檔案

沿用既有慣例，⛔ 不要把清單塞進同一個檔：

```
v3/
  full_text_annotate.yml          第 1 輪    ← 單篇課只有這些，一個字都不改
  key_reading.yml
  vocab_definitions.yml

  full_text_annotate.m7qxv.yml    第 2 輪    ← 檔名帶 slug
  key_reading.m7qxv.yml
  vocab_definitions.m7qxv.yml
```

**同一個 slug = 同一輪。** `?p=m7qxv` 就圈起那一輪的全部模組。

⛔ **不需要 `of_text` 之類的交叉引用** —— 一個念順順就對應一篇文章，一對一。
它的 `start_idx` 就是**它自己那份課文**的段號，沒有「哪一份」的問題。
（本文早期版本寫了 `of_text`，是想歪了。）

### 🔴 Dry run：實際放一個 `key_reading.m7qxv.yml` 進去會怎樣

**三處全部靜默忽略 —— 不是壞掉，是加了等於沒加，而且沒有人會發現：**

| 誰 | 結果 | 為什麼 |
|---|---|---|
| loader | ❌ **完全看不到** | `lesson_uid_loader.py:39` 的 `MODULES` 是寫死的清單，只讀 `{mod}.yml` |
| schema gate | ⚠️ 沒紅，但**沒把關** | `test_module_schemas_2843.py:73` 用 `schemas.get(path.stem)`，stem 是 `key_reading.m7qxv` → 查不到 schema → 跳過 |
| 形狀 ratchet | ⚠️ 沒紅，但**沒把關** | `test_yml_shape_ratchet_2843.py` 也按 `path.stem` 分組 → 當成一個只有 1 種形狀的新模組 |

### 本來的機制要調整的四處

| # | 檔 | 改什麼 |
|---|---|---|
| 1 | `backend/app/services/lesson_uid_loader.py:39` `MODULES` / :170 迴圈 | 除了 `{mod}.yml`，還要撈 `{mod}.<slug>.yml`，並把 slug 帶進資料 |
| 2 | `backend/tests/test_module_schemas_2843.py:73` | 查 schema 前先把 slug 從 stem 剝掉（`key_reading.m7qxv` → `key_reading`），**否則新檔永遠不受 schema 管** |
| 3 | `backend/tests/test_yml_shape_ratchet_2843.py` | 同上，按剝掉 slug 的 stem 分組，否則每個 slug 都變成一個假的新模組 |
| 4 | `scripts/build_lesson_manifest.py` | `sections_present` 有重複大題時，manifest 要指到帶 slug 的那份檔 |

**⛔ 1 沒做的話，後面全部是空的** —— 檔案在硬碟上，但 API 不會吐、畫面不會出現、QR 指過去是空白。

### 順序

**就是 `sections_present` 的排列**，不另外存 order —— 現況就是這樣，不用改。

## 15. 現在可以動工了嗎

**可以，按 §11 的順序，而且第 2 階段（part-aware 寫入邊界）不能跳。**

五件調查全部有答案，**沒有剩下的未知**。

⚠️ 唯一要先處理的前置在 §12④：**各課 `paragraphs` 裡裝什麼並不一致**
（L0029 裝兩篇、L0063 只裝一篇），所以階段 1（抽取切篇）必須連同
「把 `paragraphs` 與 `parts` 的關係統一」一起做 —— 否則後面按篇產音檔會照著錯的來源產。


**不能直接進 feature implementation。** 先做這五件（spike / gate，不是功能）：

1. **query param preservation audit** —— 掃出所有會丟 `location.search` 的 navigate/redirect，補測試
2. **part-aware progress / storage schema** —— progress、localStorage、TTS 快取、標註的 key 一律納入 partId
3. **assignment / report 語意** —— 三層完成定義 + `target_part_ids`
4. **TTS / QR pipeline contract** —— 音檔能不能按篇重生（這條在 #2591，要先確認）
5. **單篇課 byte-identical baseline** —— 改動前先存 API 回應、DOM、QR manifest 三份 baseline

> 沒先定這些就照 PRD 做，會**把第 2、3 篇開給學生，卻用第 1 篇的進度、快取、報告與作業模型去記** ——
> 那比現在三篇連著 render 更難救。
