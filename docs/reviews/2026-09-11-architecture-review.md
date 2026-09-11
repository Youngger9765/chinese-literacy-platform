# 技術產品架構複審（五位專家，2026-09-11）

Young 指示由 DDD、UI/UX、前後端、DevOps、教育科技五個視角同時複審。五份都是**唯讀**分析。

> **怎麼讀這份**：每則發現標了信心度，以及**是誰驗的**。
> 標「工頭實跑」= 我自己跑過指令或執行過真 module，數字以我的為準。
> 標「複審者讀碼」= 專家讀 code 推論，我沒有獨立重跑。外部 finding 也是待驗的斷言，
> 沒重跑的不要當已證實。

---

## 一句話結論

五個視角各自出發，收斂到**同一個根因**：「關卡（step）」這個核心概念在 code 裡有七套互相翻譯的詞彙，其中兩套對同一個 id 給出不同答案 —— 而學生看得到的錯誤，一半是它的下游。

第二個獨立根因是**型別檢查從來沒有在 CI 跑過**，所以「前後端形狀不一致」這一整族問題由結構決定抓不到。

---

## A. 工頭實跑驗證過的（數字以這裡為準）

### A1. 學生的「繼續上次學習」不只沒作用，它每次開課都把紀錄刪掉

執行真 module 取得的值：

| 符號 | 值 |
|---|---|
| `STEP_PATH_TO_NUMBER['full-text-annotate']` | **8** |
| `STEP_PATH_TO_NUMBER['key-passage-reading']` | 6 |
| `STEP_PATH_TO_NUMBER['report']` | 7 |

- `frontend/src/hooks/useLearningSessionBootstrap.ts:193` 學生一打開課文就寫入 `currentStep = 8`
- `frontend/src/components/SessionResumePrompt.tsx:72` 守衛是 `if (saved.currentStep <= 1 || saved.currentStep >= 6) clearActiveSession(...)`
- `8 >= 6` 為真 → **每次開課都清掉**

守衛的註解寫「step 6 = report = 已完成」，但 6 現在是重點朗讀、report 是 7。同一支檔案 `:15-36` 還有兩份寫死對照表，把 2 當逐段朗讀、4 當生字練習 —— 那兩關都是 `enabled: false`。

**後果**：孩子在中間離開，隔天回來紀錄已被清掉，只能自己從書櫃重新找那一課。而他不會抱怨「續學紀錄被刪」，只會覺得這東西記不住他。

**修法**：那兩份寫死表換成 `resolveActiveSteps()`，守衛改用實際 sequence 長度。單檔改動。

### A2. 型別檢查從來沒有進過 CI，151 個型別錯誤活著

- `frontend/package.json` 的 `build` 是裸 `vite build`（esbuild 只轉譯，不做型別檢查）
- `.github/workflows/` 全部檔案裡 `tsc` / `typecheck` 出現 **0 次**
- 實跑 `npx tsc --noEmit`：**151 errors，其中 38 個在非測試的 `src/`**

**後果**：這不是「有技術債」，是**偵測能力缺口**。本專案反覆出現的「抽對了、門全綠、學生看不到」那一族，正是前後端形狀不一致，而唯一能靜態抓到它的工具沒有接線。

**修法**：加 `"typecheck": "tsc --noEmit"` 進 CI，**用棘輪**（錯誤數只能降）而不是要求歸零。要求歸零的門第一天就會被關掉。

### A3. prod 沒有 staging 已經修過的流量保險

- `staging-deploy.yml:89` 與 `:178` 各有一次 `--to-latest`，步驟名寫著 `Fixes #1449`
- `deploy.yml` 全檔 `--to-latest` 出現 **0 次**
- prod 的 post-deploy 檢查第一步是 `sleep 15`

**後果**：只要有人對 prod 下過一次 `update-traffic --to-revisions`，之後每次部署只建 revision、不換流量，而且全綠無警告。本專案有過這個形狀的事故（空轉五天五次部署全綠）。實查目前四個服務都還是 `latestRevision: True`，所以是**潛伏**不是現行。

### A4. 課文數地板寫 50，實際 179 課

`backend/specs/test_lesson_loader_spec.py:40` 斷言 `len(lessons) >= 50`，實際 `backend/data/lessons/L*/` 有 **179** 課。掉 129 課照樣過門，而 `health.py` 對課程庫零引用。

---

## B. 教育科技（複審者讀碼，含實際量過的資料）

錨點：Gagné 九大教學事件、Sweller 認知負荷、Mayer 多媒體原則、Tversky 動畫判準、洋蔥學院情感線。

1. **答錯後的補救管道只存在 900 毫秒** —— `MultipleChoiceExercise.tsx:92-95` 的 `setTimeout` 把 `wrongFeedback` 清回 false，而「問 AI 助教」按鈕的顯示條件正是它。後端 `mcq_rescue_agent.py` 是全庫最完整的補救資產（五步鷹架、每筆帶 reasoning、錯誤絕不 auto-pass），等於沒接上。同一套工具在 `GuidedStepsExercise.tsx:306` 沒有 timeout，按鈕是持久的。對應 Gagné 第 7「提供回饋」。
2. **解說只給答對的人看** —— 答錯看不到正解也看不到解說，可無限重選而分數照加。違反 Sweller 的 worked example effect：對還沒有 schema 的人「讓他自己想」是災難。附帶後果是分數對老師失去鑑別力。
3. **畫面顯示的指標不是判成敗的指標** —— `readingScoreDisplay.ts:10` 關掉正確率顯示只留每分鐘字數，但 `fluencyAnalyzer.ts:99` 的 `passed` 仍由固定 0.80 的逐字正確率決定，且不分年級。回饋句照正確率分級卻寫「讀得很流暢」，所以讀得慢但字字唸對的孩子會被告知「很流暢」。
4. **對「讀得慢但讀得懂」的孩子，建議是叫他讀快一點** —— `AssessmentReport.tsx:79-80` 在 `cpm < 90` 給「提升朗讀速度」，自評偏高時再回一次「你給自己的評價偏高」，而那個 AI 評級純由語速推得。
5. **唯一的「下一步」只由三個朗讀訊號長出來** —— `generateSuggestions(wrongTokens, accuracy, cpm)`。聚光燈、文章重點表、詞語理解、語詞應用一概不進。朗讀漂亮但每題推論都錯的孩子，拿到的下一步是「重新朗讀一次」。**這是複審者選出「只能改一處」的那一項**：資料已在 server 端，純顯示層改動，不動 schema。
6. **半數課的聚光燈沒有分段效果** —— 對 173 課實跑分段演算法：只切出一段的 **87/173**，單段互動題 8 題以上的 22 課，最重的 L0150 單段 **30 題**，中位數 3。中位數健康，尾巴很重。違反 Mayer 的 Segmenting。
7. **情感線缺席，而且同理的方向是反的** —— 全庫的同理台詞都是「多練幾次就會進步」這一類：只在低分之後出現、不在難點之前，而且把難歸因於孩子不夠熟而不是材料本身難。沒有一句說「這裡很難」或「很多人在這裡卡住」。
8. **老師端理解側是一團 JSON** —— `TeacherSessionReportPage.tsx:278-292` 直接 `JSON.stringify(step_progress)`，註解自承是 placeholder。只有聚光燈有結構化檢視。至危學生預警的五個訊號與五條建議動作**全是朗讀與筆順**，沒有一條關於理解策略。
9. **兩處持久化的 LLM 判斷沒有 reasoning，缺漏子分數靜默填 50** —— `ai_comprehension.py:195-216` 的 `result.get(key, 50)`。用意是不因 AI 失誤懲罰學生，方向對，但老師看到 50 無法分辨「真的中等」與「AI 沒評」。建議補一個 `imputed: true` 旗標。
10. **Gagné 對照結論** —— 第 4、5、6、8 齊備；第 2 由每個 step 的 `hint` 與學習策略框承擔（160/175 課附 `strategy_explained`）；**第 1 引起注意缺席**（簡介頁只有標題加摘要，沒有懸念）；**第 3 喚起先備知識缺席**（找不到跨課「你上次學過同一個策略」的連結）。

**值得保留不要退化的兩處**：`live_monitor_service.py:6-15` 明確拒絕讓「沒有資料」塌陷成「表現正常」；`OmoResultPage.tsx:319-415` 把 reasoning 與 AI 信心度攤給老師並提供「批改有誤」入口 —— 那是全庫最好的 LLM 可覆核範例，標準已經存在，只是沒套到別處。

---

## C. UI/UX（複審者讀碼，未跑瀏覽器）

1. **A1 那條**（續學紀錄被刪）是這位複審者選出「只能修一處」的那一項，理由是它唯一**已經在傷害資料**且完全不可見。
2. **對照表會把孩子丟進停用的關卡** —— 逃過 A1 的狀態（`currentStep` 2–5）按「繼續」會進入 StepperNav 上不存在、底部「第幾步」算不出來的關卡。
3. **每課關卡數實際是 2 到 20，不是 11** —— 那份 16 項（啟用 11）只在課文**沒有** `manifest_sections` 時生效，而 179 課全都有帳本。實際分布：9 列 138 課（10 關）、8 列 20 課（9 關）、1–7 列 16 課（2–8 關）、L0063/L0144/L0029 分別 20/19/18 關。**孩子的認知負擔不是「11 關很多」，是數量與順序每一課都不一樣**，而那是他判斷「我還剩多少」的唯一依據。
4. **iPad 上詞語配對點選會把自己取消掉** —— `VocabDefinitionMatchDragDrop.tsx:456` 是 toggle，`:578` 的 `onTouchStart` 與 `:579` 的 `onClick` 都呼叫它且都沒 `preventDefault`。iOS 一次點擊依序發兩個事件，選中後立刻被取消。影響面是「詞語理解」在 iPad 上的一半（`VocabDefinitionMatch.tsx:301` 要求兩段都完成）。`reading-steps/__tests__` 一條 touch 測試都沒有。
5. **`h-screen` 只修了學習外殼，主外殼還在** —— `AppShell.tsx:419` 的學習外殼已改 `h-viewport`，但同檔 `:61` 的一般外殼仍是 `h-screen`，其 `main` 的 `pb-14 md:pb-0` 在 iPad 直向剛好落在 `md`，56px 緩衝被拿掉。老師端表單與書櫃底部同形狀。另有兩處寫死 `100vh` 的捲動框。
6. **標記模式的 `pan-y` 還留著斜拖的縫** —— 孩子把詞語拖到換行處時手指往下飄，那一刻瀏覽器把手勢收去捲動，記號在半途結束。建議前 8–10px 判方向再動態切 `none`。
7. **`StepperNav.tsx` 整支 202 行沒有人 import，而且邏輯是錯的** —— 用 `view` 當 key，多篇課文的三個「念順順」共用同一個 `AppView`，三顆會同時亮、完成狀態收斂成最後一篇。活著的 `ImmersiveTopBar` 已改用 `step.id`。同族還有 `useLearningStepNavigation.ts:430-444` 兩支沒有呼叫者的函式，會從「讀全文-做記號」按下一步進到停用的「逐段朗讀」。**建議刪掉，不要留著等人接線。**
8. **老師端「指派」一個詞管兩件事** —— 課文管理分頁的「指派課文」與作業分頁的「建立作業」用同一個動詞指不同對象，唯一提示是另一個分頁裡一行 13px 灰字。**這是資訊架構問題不是文案問題。**
9. **手機上圈圈沒有名字** —— 768px 以下步驟名與 tooltip 都 `hidden`，孩子看到十個單字沒有任何說明。iPad 直向剛好過 `md`，真機不踩。

---

## D. 前後端邊界（複審者讀碼，第 1 項為實跑）

1. **A2 那條**（tsc 從未進 CI，151 錯誤）是這位複審者選出「最危險」的那一項，理由是它讓第 2、3 條這一族由結構決定抓不到。
2. **契約手寫三遍，零產生器，零 parity gate** —— schema → route 逐欄列舉 → 前端手寫 interface 加手寫 mapping。後端漏列一行等於該欄永遠送不出去且無紅燈，**這件事已經發生兩次**，註解就寫在 `stories.py:637`（`repeat_rounds`）與 `:679`（`vocab_review`/`resources`）。
3. **第 1 條的活標本** —— `video_links` 的元素形狀已漂掉：前端宣告 `{title,url}[]`，後端會送 `url: None`（5 課 QR 未解碼）並在等長時多送 `source`/`duration`。`KnowledgeStation.tsx:58,59` 讀那兩個欄位 → tsc 報錯、runtime 拿到 undefined、**17 課影片的來源與長度不顯示**。
4. **朗讀評估端點的 LLM 輸入無上限** —— `learning_reading.py:336-337` 的 `spoken_text` 與 `target_text` 都**沒有 `max_length`**，而兄弟端點全都有。`spoken_text` 下游砍到 2000，**`target_text` 沒消毒也沒上限**，直接進 prompt；無 body-size middleware。已登入帳號可 POST 5MB 的 `target_text`，10 次/分鐘全進 Gemini，同時是未消毒的注入面。
5. **課程庫靜默變空時服務仍回 200** —— 一份壞掉的 yml 讓該課從圖書館消失且無訊號；helper import 失敗則 `/api/stories` 回空陣列配 200。地板 50、實際 179（見 A4）。
6. **N+1 三處都是真的但全部有界**，且**沒有任何 LLM 或 TTS 呼叫在迴圈裡**。

---

## E. DevOps（複審者實查 CLI ＋ 讀 workflow）

1. **所有 preview 共用一顆資料庫，每次部署都跑 migration** —— `preview-deploy.yml:105` 掛同一顆 `lingoleap-preview-db` 且 `RUN_MIGRATIONS=true`；`entrypoint.sh:15-38` 在 preview 且 alembic 失敗時會 `TRUNCATE alembic_version` 再 stamp。A 的 migration 改到 B 的 schema，兩個 preview 同時啟動時 TRUNCATE 互打。**代價不出現在該 PR 的 CI 上，而是出現在別人的 preview 上，那個人會以為是自己的 code 壞了。**
2. **只動前端或只動文件的 PR，preview 可能接到 staging 後端** —— reopen 或後端被 cleanup 之後，`VITE_API_URL` 會 build 成 staging，於是 preview 上的操作**寫進 staging 資料庫**，而 preview 前端帶著 `VITE_SHOW_DEMO_LOGIN=true`。那段 fallback 還有一個永遠不成立的 prod 分支是死碼。
3. **A3 那條**（prod 缺 `--to-latest`，健康檢查只打根路徑）。
4. **`--set-env-vars` 整組覆蓋，已造成實查到的漂移** —— `ENABLE_TEST_SEED` 只有 prod 有（`seed.py:239` 預設 true 屬 fail-open，靠第二道 `ENVIRONMENT` 判斷擋住）；`READING_AUDIO_GCS_BUCKET` 在 preview 缺漏，會讓上傳**靜默停用**，於是 preview 那道 e2e 門抓不到朗讀上傳的回歸。另實查 staging 服務掛著兩個 Cloud SQL socket 而 workflow 只寫一個（`--add-cloudsql-instances` 是累加）。三個 `ENVIRONMENT` 值本身都設對。
5. **閒置燒錢的是資料庫不是 Cloud Run** —— 四個常駐服務 `minScale` 皆 0、`maxScale` 都有天花板（prod 3 / staging 1 / preview 1）；但三顆 Cloud SQL 全是 `ACTIVATION_POLICY=ALWAYS`，`lingoleap-preview-db` 不論有幾個 preview 都 24 小時計費。

---

## 建議順序

| 順位 | 動作 | 理由 |
|---|---|---|
| 1 | 修 A1（續學紀錄被刪） | 唯一**已經在傷害資料**且學生不會抱怨的。單檔改動 |
| 2 | 修 B1（900 毫秒補救按鈕）與 B2（解說只給答對的人） | 後端補救資產已經蓋好，只差接線；兩者都是幾行 |
| 3 | 加 typecheck 棘輪進 CI（A2） | 不修任何 bug，但把整族 bug 從「抓不到」變成「抓得到」 |
| 4 | 補 prod 的 `--to-latest`（A3） | 潛伏風險，一行 |
| 5 | 修 D4（`target_text` 無上限） | 花錢面與注入面，加一個 `max_length` |
| 6 | preview 資料庫隔離（E1、E2） | 最貴但影響所有人的開發體驗 |
| 7 | 抽出跨語言的 step registry | 上面一半發現的共同根因，但要動 schema，排在有了 typecheck 保護之後 |

---

## 沒有人查證的（誠實列）

- **全部五份都是靜態讀碼，沒有人開瀏覽器**。iPad 那兩條（C4、C6）要真機實測才算數
- `graphify-out/` 不存在，所以「誰呼叫誰」全是 grep 推論而非呼叫圖
- **Artifact Registry cleanup policy 與 public bucket egress 查不到** —— `claude-readonly` SA 缺 `artifactregistry.repositories.get` 與 `storage.buckets.list`，兩者都 PERMISSION_DENIED。所以 CLAUDE.md 記載的 Layer 1 policy 無法確認存在，「沒有公開 bucket」也給不出答案
- 帳單金額、Actions 用量都沒查（只查了規格）
- `reading-steps/` 73 支共 18172 行只精讀 4 支，「各關卡邏輯重複多少」沒有結論
- 62 個沒有 `response_model` 的 route 沒逐一比對前端消費者
- 靜默失敗只逐一讀了 3 處，另外空 catch 25 處、`?? []` 134 處只有統計沒判讀
- `specs/registry.yaml` 實際 41 個 module 而 CLAUDE.md 寫 27，差額原因未查
- 課文數 179（檔案樹）與 CLAUDE.md 記的 175 有差，未追
- 文言文四關、三個停用步驟的 ToolPicker 側門都沒看

---

## F. 資安（工頭自己做，兩個 agent 都掛了）

派出的資安 agent 掛了兩次 —— 第一次網路錯誤（開頭就死），第二次額度用盡，而它最後一句話是「我的掃描器漏掉了簽名裡的 `require_role`，我要修它並加正向對照」。那句話後來成了這一節的主軸。

### F1. Public repo 沒有曝光憑證（否定結論，配了會動的對照）

- `gh repo view`：`visibility=PUBLIC`
- `gitleaks detect` 掃**全歷史** 3609 個 commit、184MB → **0 筆**
- `gitleaks dir .` 掃工作目錄 → 242 筆，但**落在 git 追蹤檔案裡的是 0**（237 在 `frontend/node_modules`、3 在 `.gstack`、1 在 `.env`、1 在 `backend/` 的未追蹤檔）

⚠️ **這個 0 一開始不算證據**。我第一次做正向對照時掃描器沒抓到 canary，我差點以為掃描器是瞎的 —— 結果是**我的 canary 形狀錯了**（GitHub token 是前綴後接剛好 36 碼，我多給了兩個字元）。改成正確形狀後 canary 命中 3 筆，才證明那把尺是會動的。

### F2. `is_admin` 當全域 bypass 的既有風險，已經有防線

`is_admin` 全 repo 只出現 8 次，而 `backend/app/auth/policies.py:41` 就明文寫著「這個不要當 org-scope 敏感操作的全域 bypass」；正確的 `is_system_admin` 有 28 處使用。`backend/app/routes/classrooms/classroom_crud.py:133` 還留著上次修掉那個洞的紀錄（「was is_admin → any org_admin saw the whole platform's classroom metadata」）。

**這是好消息，不是壞消息。** 這條風險被點名過、修過、而且把理由寫在 code 裡。

### F3. 越權：檢查過的端點都有歸屬防護（讀碼結論，非滲透測試）

我自己寫了一支掃描器找「拿 id 當路徑參數、但沒有任何授權檢查」的端點。**它連續三次過度報告**，每次都是因為我不知道這個 codebase 的授權寫法有幾種：

| 輪次 | 報告數 | 我漏掉的寫法 |
|---|---|---|
| 1 | 28 | 各路由自己的本地 helper（`_assert_can_view` 等，十幾個名字） |
| 2 | 21 | **inline 歸屬比較** —— `if session.student_id != current_user.id: raise 403` |
| 3 | 16 | **在查詢裡過濾歸屬的 fetch helper** —— 名字像 getter（`_get_upload_or_404`、`get_user_org_ids`） |

最後 16 個裡，**凡是用「使用者擁有的資源 id」定址的 5 個我全部逐一讀過，全部有歸屬檢查**：

- `omo/lifecycle.py` 的 PATCH flag、**DELETE upload**、GET crops，以及 `omo/grade.py` 的 GET —— 全走 `_get_upload_or_404`，那支在查詢裡就 `OmoUpload.student_id == user.id`，是紮實的寫法
- `schools.py:144` 用 `get_user_org_ids(current_user)` 比對 `school.organization_id`

其餘 11 個用的是**教材內容 id**（`{story_id}` / `{lesson_id}` / `{tool_id}`），那些不需要個人化歸屬檢查。

**所以：沒有找到已證實的水平越權。** 但這個結論的邊界要講清楚 ——

- 這是**讀碼結論，不是滲透測試**。我沒有用 A 帳號去打 B 的資源看回什麼
- 我只逐一讀了 5 個，另外 11 個是靠「那是內容 id」的判斷排除，沒有逐一讀
- 三個對照組（合成的無檢查 handler 要命中、具名檢查與 inline 檢查都不准命中）都過了，而 inline 那條是拿真 code 裡的寫法驗出來的，不是循環對照

### F4. 限流是 per-process，prod 實際上限是設定值的 3 倍

`backend/app/auth/rate_limiter.py` 的 `InMemoryRateLimiter` 用 `dict` 存在**單一 process 記憶體**裡。實查 Cloud Run `maxScale`：prod backend = **3**、staging = 1。

所以標成「10 次/分鐘」的 AI 端點限流，在 prod 的實際上限是 **30 次/分鐘**（每個 instance 各數一份）。staging 沒有放大。

**放大是真的，但被 maxScale 封住** —— 它不會擴到 100 個 instance。嚴重度中，不是高。

### F5. 花錢面：無上限輸入 × 3 倍限流

`learning_reading.py:336-337` 的 `target_text` 沒有 `max_length`、沒有消毒、直接進 LLM prompt，而 `main.py` 沒有 body-size middleware。配上 F4 的 3 倍放大，一個已登入帳號可以持續灌大 payload 進 Gemini。

同時那也是**未消毒的注入面** —— 使用者控制的字串直接拼進 prompt。

**修法最小**：給那兩個欄位加 `max_length`（兄弟端點全都有，`learning_comprehension.py:32` 是 10000）。

### 最該先堵的一個

**F5 的 `max_length`。** 一行 schema 改動，同時關掉花錢面與注入面，而且它是這一節唯一「攻擊者讀完 public repo 就能直接用」的洞。

### 風險被高估或其實已有防線的地方

這節最重要的結論其實是**壞消息比預期少**：

- 授權沒有找到已證實的洞，而且用了三種紮實寫法（其中「在查詢裡過濾歸屬」是最不容易寫錯的那種）
- public repo 全歷史零憑證洩漏
- `is_admin` 那條既有風險已被點名、修過、理由寫進 code
- per-instance 限流有放大但被 maxScale 封在 3 倍

⚠️ 也就是說，**我自己的掃描器三次都比真實情況悲觀**。如果我沒有逐一讀 code 就把第一版的 28 個報上來，那會是一份誤導性的資安報告。

### 沒查證的地方

- **完全沒做執行期測試**。沒有用 A 帳號打 B 的資源，所以「沒有越權」是讀碼結論
- 16 個候選裡只逐一讀了 5 個，另外 11 個靠「內容 id」判斷排除
- **JWT 的演算法、過期、撤銷完全沒看**
- **GCS bucket 的 IAM 與 signed URL 範圍沒查**（唯讀 SA 缺 `storage.buckets.list`，PERMISSION_DENIED）
- `input_sanitizer.py` 涵蓋範圍沒逐一比對；除了 `target_text` 之外還有哪些輸入進 prompt 沒掃
- 兒童個資的跨帳號回傳只查了 OMO 與 schools 兩條路徑
- 前端 XSS 面完全沒看
