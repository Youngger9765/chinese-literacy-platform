# 5/1 專家會議 QA Checklist — 實習生分工檢查表

**目的**：5/1 會議專家提了 N 條要改的點。雖然多數已 PR merged，但**沒有逐項 live 驗證過**。這個 checklist 把每項拆成可勾選任務，讓敬行/啟翔在 staging + prod 上一條一條測，找出仍有問題的地方。

**對照源**：
- `docs/meetings/2026-05-01-experts-review.md` — 會議原文
- `docs/meetings/2026-05-01-sprint-recap-table.md` — 已 merged 的 commit/PR 對照

**測試環境**：
- Staging: <https://lingoleap-staging.web.app>（最新 — 含 #1387 MCQ rescue tutor）
- Prod: <https://lingoleap-frontend-958347263320.asia-east1.run.app>（May 1 sync — 不含 #1387）

**測試帳號**：登入頁底部「快速登入」→ 學生 / 教師 / 管理員（測試帳號）

**怎麼填**：
- 認領欄填名字（敬行 / 啟翔 / Young）
- 結果欄：✅ pass / ❌ fail / 🟡 partial / 📷 留截圖在 issue
- fail 的開新 issue + 連結回這格

---

## 一、字體與排版（曾教授 + 陳教授）

| # | 需求 | 對應 PR | 怎麼測 | 預期 | 環境 | 認領 | 結果 |
|---|---|---|---|---|---|---|---|
| 1 | 避免黑體（近視學生會糊在一起）| #1351 / PR #1355 | 任何課文頁→開 DevTools→inspect 課文 \<p\>→看 \`font-family\` | **不是** \`SimHei\`/\`Heiti\`/\`黑體\`，是 \`cwTeXKai\` 楷體系 | prod + staging | | |
| 2 | 字距/行距貼近 Word default（縮短）| #1338 / PR #1345 | 同上→看 \`line-height\` + \`letter-spacing\` | line-height ≤ 1.8（不再是 2.5+）；難字模式沒明顯加寬 | prod + staging | | |
| 3 | 注音僅標難字 | #1346 + #1337 / PR #1376 + #1347 | 課文頁→點右上角注音 toggle 切「無/難字/全」3 段 | 「難字」模式只有 vocabulary 欄位的字有注音 | prod + staging | | |
| 4 | 注音模式不要粗體 | #1440（已 merged + ai-qa-passed）| 切「難字」模式→inspect \`.zhuyin-text\`→看 \`font-weight\` | \`normal\`，font 是 BpmfGenYoGothic-R（不是 Bold） | prod + staging | | |

---

## 二、跟讀 / 朗讀（曾教授）

| # | 需求 | 對應 PR | 怎麼測 | 預期 | 環境 | 認領 | 結果 |
|---|---|---|---|---|---|---|---|
| 5 | 跟讀（逐字標亮）改可選 | #1352 / PR #1356 | 朗讀頁面找「跟讀切換」UI | 有開關，預設關 / 開可選；不強制 | prod + staging | | |
| 6 | AI 朗讀保留 | 已存在 | 朗讀頁→播放 | 有聲音、有逐段控制 | prod + staging | | |
| 7 | 「喝彩」破音字標注修正 | #1357 / PR #1367 | G4-L1〈贏得喝采的輸家〉→看「喝彩」注音 | 不是 ㄏㄜ，應是 ㄏㄜˋ | prod + staging | | |

---

## 三、生字 / 詞彙（陳教授）

| # | 需求 | 對應 PR | 怎麼測 | 預期 | 環境 | 認領 | 結果 |
|---|---|---|---|---|---|---|---|
| 8 | 生字部件用顏色拆解 | #1342 / PR #1381 | 生字練習→看部件區（如「明」拆成「日」「月」）| 不同部件不同顏色；最後合體回到同色 | prod + staging | | |
| 9 | 仿寫第 1 次有左側刺激 | #1342 | 寫字練習進入第 1 次 | 左邊有範例字、灰底引導 | prod + staging | | |
| 10 | 再生回憶第 2 次拿掉左側刺激 | #1342 | 寫字練習進入第 2 次 | 左邊**完全沒有**範例字（強制回憶） | prod + staging | | |
| 11 | 詞彙流程改「理解→應用→（選修）造句」 | #1336 / PR #1339 | 進任何課的學習流程→看 stepper | 順序：詞語理解→詞語應用→造句（造句最後或可隱藏）| prod + staging | | |
| 12 | 詞語定義改名「詞語理解」 | #1336 | stepper 上的 step name | 不再叫「詞語定義」，叫「詞語理解」 | prod + staging | | |
| 13 | 隱藏次要功能（生字 / 造句 / 聽力）以避免 demo 失焦 | #1336 | 學習流程 stepper | 7 課（單元 A + B）的流程不顯示生字 / 造句 / 聽力步驟 | prod + staging | | |

---

## 四、課文理解 / 閱讀聚光燈（核心）

| # | 需求 | 對應 PR | 怎麼測 | 預期 | 環境 | 認領 | 結果 |
|---|---|---|---|---|---|---|---|
| 14 | 「文章重點表」AI 預生成 fast path | #1377 + #1388 + #1398 | 進 G6-L22 課文理解→「文章重點表」tab→看 timing | <100ms 出現（不是 5s+）| prod + staging | | |
| 15 | 「文章重點表」勾選後 panel 不塌掉 | **未修，#1332 仍 OPEN** | 任何課文→「文章重點表」→勾任一 checkbox | ⚠️ 可能會塌（待修）| prod + staging | | 預期 fail，記錄症狀 |
| 16 | 閱讀聚光燈 AI 助教（5 步驟 SOP）| #1387 / PR #1451 + #1454 | G6-L22→閱讀聚光燈→答錯 MCQ | 跳出 5 步驟引導 dialog，AI 用「問題-解決-結果」框架引導 | **staging only** | | |
| 17 | AI 助教「reasoning」欄位每筆都帶 | #1451 schema | DevTools Network→觀察 `/api/learning/mcq-rescue/respond` response | 每個 response JSON 都有 `reasoning` 字串 | staging only | | |

---

## 五、圖文整合（陳教授 + 簡教授眼動研究）

| # | 需求 | 對應 PR | 怎麼測 | 預期 | 環境 | 認領 | 結果 |
|---|---|---|---|---|---|---|---|
| 18 | 文圖左右並陳，可獨立滾動 | #1341 / PR #1406 + #1414 | G7-L28〈看不見的兇手〉課文理解 | 看到 3-pane（課文 / 圖庫 / 題目）布局 | prod + staging | | |
| 19 | G7-L29 多張圖（4 張地球暖化）| #1417 / yml backfill | G7-L29 課文理解→中間圖庫 | 4 張圖 + 對應 caption | prod + staging | | |
| 20 | 圖文整合 AI 助教（看圖→找文→整合）| #1387 strategy_prompts/graphic_text_integration | G7-L28→閱讀聚光燈→答錯 | AI 引導「看右邊那張圖」→「找課文哪段」→「圖+文整合」| staging only | | |

---

## 六、簡介頁（5/1 會後新增的 lesson_intro）

| # | 需求 | 對應 PR | 怎麼測 | 預期 | 環境 | 認領 | 結果 |
|---|---|---|---|---|---|---|---|
| 21 | Intro page 顯示「課程引言」（不是課文第一段）| #1443 / PR #1445 | 進任何課→簡介頁 | 顯示策略導引文字（如 G6-L22:「本課探討品格-堅毅...」） | prod + staging | | |
| 22 | 簡介頁有「📄 查看紙本學習單」按鈕 | #1444 / PR #1448 | 進任何課→簡介頁 | 找到藍色按鈕「查看紙本學習單」 | prod + staging | | |
| 23 | 點按鈕跳出 PDF popup | #1444 | 點按鈕 | modal 開啟、iframe 載 PDF、Esc/X/backdrop 都能關 | prod + staging | | |
| 24 | 沒對應 PDF 的課（如 G4-L20-22）按鈕**不顯示** | #1444 | 進 G4-L20-22 簡介頁 | 沒有按鈕（不要顯示斷掉的連結）| prod + staging | | |
| 25 | Intro page **不**再有 ⑨ 知識補給站 YouTube embed | #1445 / PR #1437 | 簡介頁完整滑到底 | **沒有** YouTube iframe 區塊（之前有，要被刪掉）| prod + staging | | |

---

## 七、流暢性朗讀（曾教授論文 ref）

| # | 需求 | 對應 PR | 怎麼測 | 預期 | 環境 | 認領 | 結果 |
|---|---|---|---|---|---|---|---|
| 26 | 4 次練習折線圖 | #1386 / PR #1389 | 全文朗讀完成→報告頁 | 折線圖顯示 4 次練習 cpm 變化 | prod + staging | | |
| 27 | 自評功能 | #1386 | 報告頁 | 學生可自評「順暢」/「卡頓」 | prod + staging | | |
| 28 | 流暢度 silent bug 修復（cpm 計算 / 重練覆蓋）| #1378 / PR #1382 | 連續做兩次全文朗讀 | 第 1 次紀錄不會被第 2 次蓋掉，顯示在折線圖上 | prod + staging | | |

---

## 八、StepperNav / 全域 UX（會前 + 會中）

| # | 需求 | 對應 PR | 怎麼測 | 預期 | 環境 | 認領 | 結果 |
|---|---|---|---|---|---|---|---|
| 29 | StepperNav dots/chevron 放大 | #1319 / PR #1321 | 任何學習頁→看頂部 stepper | dots 至少 8px 直徑、chevron 明顯（不是小到看不到）| prod + staging | | |
| 30 | toolPicker 順序對齊 stepConfig | #1333 / PR #1334 | 圖書館左下 tool picker | 順序跟學習流程一致 | prod + staging | | |
| 31 | ReadingAnnotation 選字偏移修正 | #1325 / PR #1326 | 讀全文做記號→點選一個字 | 選中的就是被點的那字（不偏移）| prod + staging | | |

---

## 九、Issue 仍 OPEN（會議要求但還沒完成）

| # | 需求 | issue | 預期狀態 | 認領 | 行動 |
|---|---|---|---|---|---|
| 32 | AI 助教**語音化**（林校長最想許願）| 未開 issue（spec 留 hook in #1373）| ⏳ Phase 2 (7/2+) | — | 不在 7/1 範圍 |
| 33 | OMO Cold Start（紙本拍照上傳）| spec 待開 | ⏳ 7/2+ | — | 不在 7/1 範圍 |
| 34 | G7-L29/L30 結構表 22-25 行純文字 | #1393 | 已用 graphic_text_integration AI 助教 prompt 處理 | — | 已涵蓋於 #16/#20 |
| 35 | 文章重點表 panel 塌掉 | **#1332**（5 次 attempts 失敗）| ⚠️ 仍 OPEN，需 browser repro | 啟翔 | 用 React DevTools profile + 提案修法 |

---

## 十、AI 預生成資料品質（會後送達 158 課）

| # | 需求 | 對應 PR | 怎麼測 | 預期 | 認領 | 結果 |
|---|---|---|---|---|---|---|
| 36 | 158 課 metadata 從 Excel 進 platform | #1370 / PR #1371 | 圖書館頁→看課數 | ≥ 165 課可訪問 | | |
| 37 | 141 課 lesson_intro 從 docx + excel | #1443 / PR #1445 | 隨機抽 5 課簡介頁 | 都有引言（非課文第一段） | | |
| 38 | 146 課 worksheet_pdf_url 已 backfill | #1444 / PR #1448 | 隨機抽 5 課簡介頁 | 都有「查看紙本學習單」按鈕（除多課合併 yml）| | |
| 39 | 7 課 demo 的 strategy_exercises（單元 A + B）| #1417 + #1421 | 進 G6-L22 / G7-L28 | 文章重點表有結構化資料（不是空 / 不是 1 段純文字）| | |

---

## 拆分建議

**敬行**（強：data flow / state / 後端整合 / 進度同步）
- 一、二、三（字體 / 朗讀 / 詞彙流程）= #1-13
- 六（簡介頁）= #21-25
- 八（stepper / 全域）= #29-31

**啟翔**（強：UI / 視覺 / 元件 / 互動）
- 四（課文理解，含 #1332 panel 塌掉這個 hard bug）= #14-17
- 五（圖文整合）= #18-20
- 七（流暢性 UI）= #26-28

**Young**（決策 / 整合）
- 九（仍 OPEN 的）= #32-35
- 十（資料品質抽樣）= #36-39
- review 兩位實習生的 fail report

---

## 怎麼用

1. **fork 這個 checklist** 或直接在 PR 內以 review comment 形式逐項勾
2. 每行 fail → 開 issue（標題格式：`fix: [#N from 會議 checklist] 簡述`）+ 在這格貼 issue 連結
3. 留意 staging vs prod 差異（#1387 / #1451 系列只在 staging，prod 等下次 sync）
4. **截圖 = 第一證據**，不要用「應該沒問題」結案

---

## 統計（截至 2026-05-03 已驗證）

CLI 驗證的 prod live 狀態：
- 字體：✅ `cwTeXKai`（非黑體）
- lesson_intro：✅ `excel`-source 在 prod
- worksheet_pdf_url：✅ `https://storage.googleapis.com/lingoleap-assets/worksheets/G6-L22.pdf`
- layout_mode（圖文整合）：✅ `graphic-text` for G7-L28
- MCQ rescue endpoints：⏳ staging only（prod 等下次 staging→main sync）

**未經 browser 實測**的有 39 項——這份 checklist 就是要拆給實習生補完。
