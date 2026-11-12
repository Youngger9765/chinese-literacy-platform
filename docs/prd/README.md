# PRD 總覽（SOT 索引）

> 這份是所有功能 PRD 的**唯一入口**。要知道某個功能「規格在哪、做到哪、在哪個環境」，先看這張表。
> 規格本身以各 PRD 為準；狀態以本表為準，每次合併或上線後更新這裡。
> 最後更新：2026-10-18

## 一、產品總綱

| 文件 | 內容 |
|---|---|
| [`docs/PRD.md`](../PRD.md) | 產品目標、目標用戶、閱讀科學基礎、市場策略（總綱，不含個別功能細節） |
| [`docs/BRD.md`](../BRD.md) | 商業需求 |
| [`docs/launch/2026-10-launch-plan.md`](../launch/2026-10-launch-plan.md) | 產品發表會準備清單 |
| [`docs/launch/TODO.md`](../launch/TODO.md) | 發表會進度表（隨時更新） |

## 二、學習模式與遊戲化（2026-10）

| 功能 | 工程代號 | PRD | 狀態 | 環境 | 票 |
|---|---|---|---|---|---|
| 課堂搶答（類 Kahoot，老師帶全班） | `live_quiz` | [class-quiz-prd](2026-10-14-class-quiz-prd.md) | 基本功能已上線待 Hans 驗收（prod）；頒獎台高質感改版（#3630）＋ P0 六項改善（#3631，讀題速度/看解析/前五名分數/學生名次/跳過排行直進頒獎台/音效）已上 staging，驗收步驟併入 #3551，待 Hans 驗收後一併上 prod | prod（基本功能）／staging（#3630+#3631） | #3551、#3630、#3631 |
| 跨班賽季（兩班比幾週，平常讀課文就累積） | `league` | [chinese-star-league-prd](2026-10-14-chinese-star-league-prd.md) | 新畫面＋劇情包已合併，staging 驗證中 | staging | #3554、#3594 |
| 劇情包（故事、寶箱、徽章可整包替換） | `story_packs` | 見 league PRD 劇情包一節 | MVP 五包：上古神話（預設）、唐、宋、武俠、偵探劇 | staging | #3594 |
| 雙人 PK（同學或 AI 文學家，1 對 1） | `pk` | [pk-mode-prd](2026-10-16-pk-mode-prd.md) | 第一版在 staging，6 個 bug 修正中 | staging | #3586、#3602 |
| 2D 劇情模式（NPC 對話、表情、素材） | — | [story-mode-design](2026-10-16-story-mode-design.md) | 設計與素材完成，尚未接進畫面 | staging（素材） | #3595 |
| 迷城密室（AI 隊友合作闖關） | `escape_room` | [escape-room-prd](2026-10-16-escape-room-prd.md) | 只有 PRD；遊戲化前幾項上 staging 並指派 Hans 驗收後開工（Young 2026-10-17 更新，取代「完整上線後才開工」），新增資料表需 Young 核准 | — | #3599 |
| 五人對抗賽（5 人小隊輪流答題、兩隊推塔對抗） | `team_arena` | [team-arena-prd](2026-10-18-team-arena-prd.md) | 只有 PRD；發表會後排程。新增 3 張資料表需 Young 核准 | — | #3632 |

### 跨功能的共同規則（各 PRD 都適用）

- **老師控制班級功能**：`classrooms.feature_settings`（目前只有 `pk_human`，預設關）。AI PK 不受班級限制
- **孩子之間沒有互動管道**：真人對戰、組隊都不提供聊天或表情
- **不抽卡、不花錢**；計分以答對為主，速度只用來決勝
- **劇情內容中立**：故事設定在「書中世界」；禁用字由劇情包驗證器擋（中華、中國、祖國、民族、我國、統一、收復、大一統、炎黃子孫）；反派抽象化
- **圖片**用 codex 產生，出圖 prompt 存在圖檔旁的 `_prompts.json`；程式碼不外包

### 待辦（不排進目前 MVP）

- 劇情包第二批：西遊記、封神榜、宇宙漫遊、台灣原住民族（需查證出處並請原住民族教育者審）
- 迷城密室實作、PK 畫面遊戲化之後的劇情模式接入

## 三、內容與抽取（課文資料）

| 主題 | 文件 |
|---|---|
| 多篇課文 | [multi-text-lessons-prd](multi-text-lessons-prd.md)、[architecture](multi-text-lessons-architecture.md)、[open issues](multi-text-open-issues.md)、[fix matrix](multi-text-fix-matrix.md) |
| 注音單一來源 | [zhuyin-single-source-of-truth](zhuyin-single-source-of-truth.md) |
| 抽取流程 | [extraction-pipeline-map](extraction-pipeline-map.md)、[extractor-skill-architecture](extractor-skill-architecture.md)、[multimodal-extraction](2026-08-17-multimodal-extraction.md) |
| 二修重抽進度 | [second-edition-reink-progress](2026-08-14-second-edition-reink-progress.md) |
| YAML 形狀 | [yml-shape-normalization](yml-shape-normalization.md) |
| QR 定址 | [qr-addressing-prd](qr-addressing-prd.md) |

## 四、現場回饋

| 主題 | 文件 |
|---|---|
| 老師端可見度 | [hans-feedback-teacher-visibility](2026-09-hans-feedback-teacher-visibility.md) |
| 遊戲化與標記 | [hans-feedback-gamification-annotation](2026-09-hans-feedback-gamification-annotation.md) |

## 怎麼維護這份索引

1. 新增功能 PRD → 放進 `docs/prd/`，並在第二或第三節加一列
2. 功能合併進 staging、上線、或 Hans 驗收後 → 更新「狀態」與「環境」兩欄
3. 個別 PRD 開頭的「狀態」一行跟這裡不一致時，以這裡為準，並順手把那行改掉
