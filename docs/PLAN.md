# PLAN — 閱讀聚光燈 / 教授 audit 收尾（滾動更新）

**最後更新**：2026-07-07
**維護者**：Young Tsai（本檔由 Claude 代記錄）

> 這份是「現在在哪、下一步做什麼」的滾動計畫。歷史脈絡見 `docs/PRD.md` §閱讀聚光燈 EDD、`docs/qa/2026-07-06-professor-checklist-matrix.md`、記憶 `project_2515_lesson_content_container_path`。

## 1. 現況快照（staging/dev + prod 皆同）

| 項目 | 狀態 |
|------|------|
| 8 策展課聚光燈新 renderer（G5-L8 + G6-L22~25 + G7-L28~30） | ✅ 已生效（staging + prod 驗過）|
| #2515 容器路徑修 | ✅ 上 staging（#2516）+ 上 prod（#2517 promote，91 commits，無 migration/model）|
| 其餘 ~109 帶 spotlight_v2 課 | 仍舊版 BlockSequenceRenderer（Part-2 暫緩）|
| 教授 6/5 checklist | render/結構層 + 部分互動層已驗；朗讀 STT / 拖曳類 / 老師報告端到端留真人 audit |

## 2. 已完成（2026-07-06~07）

- **#2515**：loader repo-layout 路徑陷阱 → 容器內 lesson_content 全 null → 全站聚光燈退舊版。修 `parent.parent.parent`，加 2 regression test。staging + prod 皆驗（策展課 populated / 非策展課 legacy）
- **prod promote #2517**：staging→main 91 commits（聚光燈 EDD + 朗讀 PR 批次 + hygiene），無 DB 風險，prod health 200
- **教授 checklist 矩陣**：`docs/qa/2026-07-06-professor-checklist-matrix.md`
  - ✅ 驗過：級別 #1 / 學習策略黃框 #2 / 開始學習 #3 / 下一步 #7 / 重點表階層 #9 / 聚光燈新 renderer+即時批改 #10/#10b / 圖文並排 #11 / 理解 5 題 #12 / 語詞應用 #6 / 填空題號 #8 / 報告架構 #13 / 字搜 #14 / Word+PDF #15 / 老師端看作答 #10c（code+可導覽）

## 3. 暫緩：Part-2 全站聚光燈點亮（Young 2026-07-07「先不要」）

**為什麼緩**：本機實測 117 非策展課 → 49 valid / **68 needs_review（58%）** / 0 crash。全站點亮會讓 58% 課顯示「需人工檢核」（spotlight 源↔`_parsed` 綁定對不上）。對齊教授 6/5「聚光燈先盤點分類再排程」。

**要 flip 時的技術修法（已規劃、未做）**：
1. `git mv scripts/spotlight_to_lesson_content.py backend/app/services/`（riding `COPY app/` 進 image）
2. 修 adapter 內 repo-layout 路徑 → `parent.parent.parent`（同 #2515）
3. `_get_adapter()` 改 `from app.services import spotlight_to_lesson_content`
4. 加 site-wide gate flag `SPOTLIGHT_ADAPTER_SITEWIDE`（預設 OFF）— 非策展課只在 flag ON 時走 adapter
5. 更新 caller：`batch_corpus_dryrun.py` + 2 個 adapter test import 路徑
6. **前置條件**：先盤點分類修那 68 課的 content-source 綁定，再翻旗

## 4. 下一步（audit 現場 / audit 後）

- [ ] **audit 現場（真人）**：#3 朗讀 STT 辨識可用性、#4 閱讀標記拖曳操作說明、#5 詞語理解拖拉配對、#10c 老師報告端到端 render（登老師端點進有 session 的學生）
- [ ] **audit 後**：68 needs_review 課 content-source 綁定盤點分類 → 修完再做 Part-2 flip
- [ ] 教授 audit 回饋 → 回填本檔 + 開對應 issue

## 5. 不需啟翔判斷的事（2026-07-07 釐清）

Part-2 = 我方自己做，不外包實習生：設計意圖讀 code 即知（adapter 專轉任何 spotlight_v2）、技術修法純工程、排程 Young 決。唯一真人決策（Young＋教授，非啟翔）= 那 68 課要不要用 adapter 自動產出點亮 → 已決「先盤點分類」。
