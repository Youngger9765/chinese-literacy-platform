# CHANGELOG — LingoLeap 國語文閱讀學習平台

產品變更記錄，每次 merge to main 時更新。

---

## [Unreleased]

- 朗讀結果→蘇格拉底對話串接 (#17)
- 蘇格拉底對話答錯判定加嚴 (#44)
- Gemini 升級 2.5-flash-preview

## 2026-02-22

- Gemini API region 從 asia-east1 改為 us-central1 (#32)
- CI/CD 改為 async Cloud Build + polling，解決 deploy timeout (#35)
- 聊天氣泡行距與排版修正 (#31, #42)

## 2026-02-21

- 完整六步驟學習流程上線（簡介→朗讀→生字→理解→全文→報告）
- 蘇格拉底式 AI 對話（Vertex AI Gemini）
- 注音符號切換（BpmfIansui 字型）+ 筆順練習
- 語音辨識 + 文本比對（Web Speech API）
- GCP Cloud Run 部署 + 三環境 Git 策略 + CI/CD
