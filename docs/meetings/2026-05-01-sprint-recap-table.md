# 5/1-5/2 衝刺對照表 — 需求 vs 已交付

**目的**：把 5/1 會議前後的 36 個 commit + 會議共識做結構化盤點，避免遺失要做的事。
**範圍**：5/1 凌晨 ~ 5/2 早上（5/1 專家會議於 5/1 下午舉行，會議記錄 commit 於 18:28）
**對照源**：[`docs/meetings/2026-05-01-experts-review.md`](2026-05-01-experts-review.md)

---

## 一、會議共識 → 交付對照（11 大需求）

| # | 需求 (Why + What) | 做了啥 (How + commit) | 完成度 | 備註 |
|---|---|---|---|---|
| 1 | **介面：避免黑體** — 近視學生會糊在一起 | `87eb87fe` zhuyin-off article 改非黑體 (#1351, PR #1355) | ✅ done | 全平台套用 |
| 2 | **介面：字距行距** 縮短貼近 Word default | `494a2144` tighten line-height + letter-spacing (#1338, PR #1345) | ✅ done | 全平台套用 |
| 3 | **介面：注音僅標難字** | `4d066a60` difficult-char-only mode using vocabulary field (#1346, PR #1376) + `a87425c2` 注音 3-state UI 切換（無/難字/全）(#1337, PR #1347) | ✅ done | 兩 PR：邏輯 + UI |
| 4 | **介面：跟讀（逐字）改可選** — 不強制 | `ced4cd2a` karaoke per-word tracking optional toggle (#1352, PR #1356) | ✅ done | |
| 5 | **詞彙流程重排** — 理解→應用→造句（選修）| `b7cb2006` hide 3 secondary steps + rename vocab-definition + reorder (#1336, PR #1339) | ✅ done | stepConfig 重構 |
| 6 | **生字部件拆解 + 再生回憶** — 第 2 次拿掉左側 reference | `be40bf56` radical color decomposition + recall round 2 (#1342, PR #1381) | ✅ done | |
| 7 | **隱藏次要功能** — 生字/造句/聽力暫關（demo 失焦）| 同 #1336（hide 3 secondary steps）| ✅ done | stepConfig disabled |
| 8 | **課文理解：PSR 結構表 fast path** — AI 預生成不打 Gemini | `df967429` YAML-first structure (#1377, PR #1379) + `8a194661` parser coverage 9.3%→19.9% (#1388, PR #1392) + `5dc82872` AI 預生成 185 lessons → 98.1% (#1398, PR #1401) | ✅ done | 60-80x 延遲下降（5s → 85ms）|
| 9 | **AI 助教 prompt template** — 林校長 5 步驟 SOP per-strategy | `1a8445ed` prompt spec doc (#1373, PR #1372) + `36887b6d` plugin pattern scaffold + 3 yaml + loader (#1404, PR #1405) | 🟡 spec + plumbing done，**implementation 0 行 code** | #1387 等實作 |
| 10 | **AI 助教語音化** — 林校長最想許願 | 暫無 | ⏳ Phase 2 (7/2+) | spec 留 hook |
| 11 | **圖文整合介面** — 文圖左右並陳，可獨立滾動 | spec doc `docs/specs/graphic-text-integration-spec-2026-05-02.md` + 7 課 yml `layout_mode=graphic-text` field | 🟡 spec + plumbing done，**implementation 0 行 code** | #1341 等實作 |

---

## 二、教材整合（會議後送達 158 課）

| # | 需求 | 做了啥 | 備註 |
|---|---|---|---|
| 12 | 解析 7 課 docx → YAML（單元 A 4 課 + 單元 B 3 課）| `2a771dd4` parse 7 docx (#1350, PR #1361) | 教授指定 |
| 13 | 解析 Excel 策略總表 → curriculum-index.json | `1530d4a4` parse Excel all columns (#1348, PR #1354) | 158 課 metadata |
| 14 | Excel metadata 拆 per-lesson source YAML | `15ff8254` split per-lesson (#1366, PR #1368) | 雙層架構 |
| 15 | bulk parse 158 課 docx → YAML | `4adfd1c3` bulk parse 158 教師版 docx (#1369, PR #1369) | |
| 16 | 接 151 parsed + 158 metadata 進 lesson loader | `f5418c4c` wire into platform (#1370, PR #1371) | 165 課可訪問 |

---

## 三、AI 呼叫優化（同步降低 cost）

| # | 需求 | 做了啥 | 備註 |
|---|---|---|---|
| 17 | YAML fast path（有預存就不打 AI）| `df967429` (#1377, PR #1379) | 邏輯 |
| 18 | docx parser 擴充覆蓋 | `8a194661` (#1388, PR #1392) | 9.3% → 19.9% |
| 19 | AI 預生成 185 lessons | `5dc82872` (#1398, PR #1401) | 19.9% → 98.1% |
| 20 | Exit ticket 也走 YAML fast path | `9f14373a` (#1402, PR #1403) | exit ticket cost fix |

---

## 四、Bug fixes / Sev-1 regression

| # | Bug | 做了啥 | 備註 |
|---|---|---|---|
| 21 | G7-L28~30 全 500（schema dict vs list mismatch）| `4a133690` (#1390, PR #1391) | 5/1 16:19 deploy 後爆，#1382 引發 |
| 22 | Stories list default 60 hides 7 課 | `6e40c762` page_size cap 100→300 (#1394, PR #1395) | 學生看不到 7 課 |
| 23 | CI preview DATABASE_URL 過期 | `cc937a0b` refresh from GH secret (#1396, PR #1397) | preview 自動 refresh |
| 24 | 流暢度 3 個 silent bugs | `3cd4e0a7` (#1378, PR #1382) | 曾教授論文 ref |
| 25 | 喝彩 破音字標注 | `2fd203bb` add pattern (#1357, PR #1367) | + audit script |
| 26 | ReadingAnnotation 選字偏移 | `8040ebb7` PUA selectors fix (#1325, PR #1326) | |
| 27 | FullReading UX + report nav | `212a891a` (#1320, PR #1324) | 會前 morning 修 |
| 28 | 造句語音輸入即時顯示 | `7a919a59` (#1327, PR #1329) | 會前 |
| 29 | StepperNav dots/chevron 放大 2x | `c5f72094` (#1319, PR #1321) | 會前 |
| 30 | toolPicker 順序對齊 stepConfig | `6afc1dbd` (#1333, PR #1334) | |

---

## 五、Architecture / scaffolding（為 P0 implementation 鋪路）

| # | 需求 | 做了啥 | 備註 |
|---|---|---|---|
| 31 | Schema-driven step composition | `a637a980` step_sequence override (#1374, PR #1375) | #1374 落地 |
| 32 | 策略 → 步驟組合 demo (3 課) | `85c2ac2a` (#1384, PR #1385) | 證明 schema-driven 動 |
| 33 | ComprehensionChat 拆 3 個 step | `b6d45e8a` (#1335, PR #1349) | 解 #1332 layout 跳動 |
| 34 | **Plugin pattern (策略 + step 雙軸)** | `36887b6d` strategy_prompts loader + 3 yaml + 7 課 layout_mode + arch doc (#1404, PR #1405) | 5/2 凌晨補完，未來新策略/新模組零成本加 |

---

## 六、Documentation

| # | 文件 | commit | 用途 |
|---|---|---|---|
| 35 | 5/1 會議記錄 | `362038d6` `c8588e36` `3f73401a` `01773200` | source of truth |
| 36 | CEO 60-day roadmap | (PR #1400 含) `docs/ceo-review-2026-05-02.md` | 戰略路線 |
| 37 | QA evidence pack | `docs/qa-evidence-2026-05-02-7-lessons-readiness.md` | 派人 QA 用 |
| 38 | AI 助教 implementation spec | `docs/specs/ai-tutor-implementation-spec-2026-05-02.md` | #1387 接手用 |
| 39 | 圖文介面 implementation spec | `docs/specs/graphic-text-integration-spec-2026-05-02.md` | #1341 接手用 |
| 40 | Plugin pattern arch doc | `docs/architecture/strategy-step-plugin-pattern.md` | 未來新策略/新模組指南 |
| 41 | 字體顏色 + 對比度研究 | `0c7a17f3` (#1358, PR #1359) | 近視兒童閱讀友善 |
| 42 | Reading fluency 量化研究 | `88371b18` (#1378, PR #1380) | 曾教授論文 ref |

---

## 七、Open / 等實作（7/1 必達 P0）

| # | 項目 | issue | 預估 |
|---|---|---|---|
| 43 | **AI 助教 implementation**（文字版 Phase 1）| #1387 | 1.5 週（CEO doc Week 4-6） |
| 44 | **圖文整合介面 implementation** | #1341 | 1 週（CEO doc Week 2-3） |
| 45 | 流暢度 UI（4 次練習折線圖）| #1386 | 隔壁工程師處理中（PR #1389 OPEN）|
| 46 | G7-L29/L30 結構表 22-25 行純文字 | #1393 follow-up | 7/1 後處理（不擋 demo）|

---

## 八、Decisions waiting Young（CEO doc §11，未答）

| # | 問題 | 影響 |
|---|---|---|
| 47 | Q1：7/1 demo 給誰看？教授 / 校長 / 真實學生 / 募資？ | 砍誰可活 |
| 48 | Q2：AI 助教 7/1 必須語音版嗎？ | effort 2x |
| 49 | Q3：7/1 deadline 是硬的嗎？ | 整體節奏 |
| 50 | Q4：真實學生實測哪一週開始？ | feedback loop |

---

## 九、Out-of-scope（5/1 會議共識砍掉，不做）

| # | 項目 | 砍的理由 |
|---|---|---|
| 51 | 老師批改 UI | 陳教授「系統批改即可」 |
| 52 | 學生答題時間/正確率 → AI 推薦下一篇 | 7/1 後做 |
| 53 | 班級作業 + 教師後台儀表板 | 7/1 後做 |
| 54 | 年級代號改 ABCDE | 命名可後改 |
| 55 | 文言文模組 | P3 暫緩（#1365）|
| 56 | OMO Cold Start（紙本拍照）| 教授肯定，但非 demo 必含 |

---

## 整體統計

```
36 commits (5/1 13:44 ~ 5/2 15:12)
~ 28 PRs merged
~ 11 個會議需求覆蓋（≥80%）：6 完成、3 部分（spec done, 0 implementation）、2 砍
~ 3 個 Sev-1 regression 修掉
~ 4 個 Architecture / scaffolding ship 完
~ 7 個文件 / spec 寫完
~ 4 個 P0 implementation 等做
~ 4 個 strategic 問題等 Young 答
```

**結論**：基礎建設層完成 ~80%，剩 user-facing 兩塊核心（AI 助教 + 圖文介面）需要 Young 親自掛帥決定 + 監督 implementation。
