# CHANGELOG — LingoLeap 國語文閱讀學習平台

產品變更記錄，每次 merge to main 時更新。

---

## [Unreleased]

- Preview 環境自動清理 + 每週定期掃描

## 2026-02-27

### Features
- StepperNav 顯示完成狀態 + mini summaries (#167)
- 錯字詞清單新增「前往生字練習」按鈕 (#81)
- AI 助教人格門檻統一至前端 personaConfig (#54)
- 教師/學生 JWT 驗證系統 (#82)（已 revert，待重做）

### Bug Fixes
- StepperNav 步驟順序修正：課文理解↔生字練習對調 (#198)
- 前端英文 UI labels 翻為繁體中文 (#199)
- 報告頁 Section 2 空白 fallback（accuracy=0% 時）(#173)
- Step 6 報告頁空狀態提示 (#137)
- Header 導航字體加大 (#130)
- VocabPractice 無朗讀結果時顯示正確訊息 (#139)

### Documentation
- 新增 MRD 市場需求文檔 (#195)
- 新增 TRD 技術規格文檔 (#196)
- BRD / PRD 加入交叉引用 + docs/README.md 索引頁 (#197)

## 2026-02-26

### Features
- Step 6 朗朗上口六環節診斷報告 (#107)
- Exit Ticket 出場卷小測驗 (#106)
- 流暢度分析引擎 — correct-chars CPM 公式 (#78)
- LCS 文字差異比對演算法 (#80)
- 課文資料從前端 JSON 遷移至後端 YAML + Stories API (#142, #149)
- Step 6 LearningSession state 架構 (#144)

### Bug Fixes
- ExitTicket 缺字也觸發出題 (#106)
- 報告 Section 2 邏輯 + 全文朗讀 intro + Exit Ticket 干擾項 (#168, #170, #172)

### Chores
- 移除前端舊課文 JSON 資料 (#154)

## 2026-02-24 – 2026-02-25

### Features
- RWD 響應式設計：手機/平板/桌面三種佈局 (#125)
- StoryLibrary 搜尋 + skeleton loading
- Step 6 報告頁 LearningSession state 架構 (#144)

### Bug Fixes
- 注音字型行距修正：absolute rem line-height (#116, #118, #120, #122, #126)
- 段落垂直間距加大 (#114)
- 文字色彩對比度提升 (#111)

## 2026-02-23

### Features
- 57 篇課文 + AI 縮圖整合上線 (#55, #58, #59)
- 全站從 dark theme 切換為 light theme (#61, #62)
- AI 助教人格「溫暖但堅定」統一 (#54)
- 主題色 CSS 變數抽取 (#72)
- ZhuyinToggle 共用元件重構 (#69)
- Intern onboarding quest (#60, #65)
- CODEOWNERS + CONTRIBUTING.md (#56)
- Firebase Hosting 設定
- GitHub Actions: production deploy 自動關閉 issue

### Bug Fixes
- FullReading 聽寫文字可讀性 (#100, #104)
- Onboarding: light theme、XP 累計、拖放排序、挑戰說明

## 2026-02-22

- 朗讀結果→蘇格拉底對話串接 (#17)
- 蘇格拉底對話答錯判定加嚴 (#44)
- Gemini 升級 2.5-flash
- 跳過朗讀進對話不再 422 (#48)
- 422 expired 後自動重建 session (#49)

- Gemini API region 從 asia-east1 改為 us-central1 (#32)
- CI/CD 改為 async Cloud Build + polling，解決 deploy timeout (#35)
- 聊天氣泡行距與排版修正 (#31, #42)

## 2026-02-21

- 完整六步驟學習流程上線（簡介→朗讀→生字→理解→全文→報告）
- 蘇格拉底式 AI 對話（Vertex AI Gemini）
- 注音符號切換（BpmfIansui 字型）+ 筆順練習
- 語音辨識 + 文本比對（Web Speech API）
- GCP Cloud Run 部署 + 三環境 Git 策略 + CI/CD
