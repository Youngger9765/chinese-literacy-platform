# CHANGELOG — LingoLeap 國語文閱讀學習平台

All notable changes to this project will be documented in this file.
Format based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased] (staging)
- feat: 朗讀結果→蘇格拉底對話串接 (#17, PR #45)
- fix: stricter eval — reject vague/common-sense answers + add eval test suite (#44)
- fix: strict number/name accuracy rules to Socratic evaluation (#44)
- fix: reduce chat bubble line-height (#42)

## [v0.2.6] - 2026-02-22
### Fixed
- fix: Gemini API region 改為 us-central1 (#32)
- fix: CI/CD async Cloud Build + polling (#35, PR #36)
- fix: deploy.yml duplicate --tag 修復
### Changed
- fix: UI 文字排版間距優化 (#31, PR #34)

## [v0.2.0] - 2026-02-21
### Added
- feat: 完整六步驟學習流程（簡介→逐段朗讀→生字練習→課文理解→全文朗讀→報告）
- feat: 蘇格拉底式 AI 對話 + 答錯判定 + 段落引用 (#1, #2, #3)
- feat: Agent 安全加固 — input validation, retry, rate limiting (#37)
- feat: 注音符號切換（BpmfIansui 字型）
- feat: 筆順練習（WriteCharacter）
- feat: 語音辨識 + 文本比對（Web Speech API）
- feat: GCP Cloud Run 部署 + GitHub Actions CI/CD
- feat: 三環境 Git 策略（feature→staging→main）
