---
name: content-tdd
description: 對每一課的重點表(story-structure)與聚光燈(reading-strategy)做 per-lesson TDD 驗收 —— 每課凍一份驗證過的 golden,內容 match golden 才算 PASS,沒 golden 一律 fail-closed。當需要「驗收重點表/聚光燈」「每課內容對不對」「content TDD」「真驗收不做假」「防假綠」時使用。配合 content_evidence_gate(全 330 證據)+ qa-keypoints/qa-spotlight(單課 eval)。
---

# content-tdd — 每課內容的 TDD 驗收

> **為什麼存在(#2397 假綠 postmortem)**：舊 gate 只查「內部格式一致性」(guide/option/struct)+ 對沒 golden 的課直接 PASS(fail-open),導致 **內容錯也能綠**(實證:G4-L20 title 供給需求、聚光燈卻是「天才是練出來的」張冠李戴卻 PASS;G4-L24 paragraphs 是「一 二 三」骨架卻 PASS)。cursor 獨立 QA 證實 247 pass 混進假綠。
> **核心原則**：PASS = 該課內容 match **它自己驗證過的 golden**,不是「格式對」。**沒 golden = 不得 PASS**(fail-closed,release-blocking)。

## 範圍
- 重點表 = `story-structure` step,API `story_structure_table`
- 聚光燈 = `reading-strategy` step,API `spotlight_v2.blocks`
- 165 課 × 2 步驟 = 330 格,每格一份 golden

## Golden 結構(SOT)
每課每步驟一份凍結 golden:`backend/data/curriculum_qa/golden/<lesson_code>/<step>.golden.json`
```json
{
  "lesson_code": "G8-L4",
  "step": "reading-strategy",
  "story_id": 1115,
  "verified_by": "human|cursor|claude+human",   // 誰驗的,不可只 claude 自己
  "verified_at": "2026-06-22T...",
  "source_docx": "G8-SL4玻璃娃娃....docx",         // golden 來源(可追溯)
  "title_tokens": ["玻璃娃娃","陳同學","顏同學"],   // 本課關鍵詞(anti-cross-lesson 用)
  "semantic_hash": "sha256-<16>",                  // 內容指紋(drift 偵測)
  "interaction_profile": {...},                    // 結構(題型/題數/figure)
  "screenshot_ref": "...png"                       // 驗收當下的畫面
}
```
> golden = **驗證過正確**的內容,不是「抽出來的」(抽取可能錯,那正是要驗的)。建 golden = 人/cursor 對照源 DOCX 看過一次。

## TDD 斷言(每格,format 之外的真內容檢查)
1. **golden-match**:現況 `semantic_hash` == golden → 無 drift。不等 → FAIL(內容變了,要嘛抽取器壞、要嘛 golden 過期)
2. **anti-cross-lesson(張冠李戴)**:內容 token 跟**本課** title/paragraphs 重疊,且**不比任何別課重疊更高**。低自重疊 + 高他課重疊 → FAIL(這就是 G4-L20/1103 那類)
3. **source-present**:有可追溯 golden + source_docx。沒有 → **不得 PASS** → `unknown`(release-blocking,不是中立)
4. **figure-real**:figure asset md5 ∉ 佔位圖黑名單(P1 再加 vision OCR 抓非佔位但錯圖)
5. **base-text-quality**:paragraphs 非骨架(非「一 二 三」純標號)。骨架 → FAIL

## 建 golden(verify-once → freeze)
1. 抽該課(`build_lesson_schema.py` 從源 DOCX)→ 候選內容
2. **人/cursor 對照源 DOCX 看過一次**(真驗收,不可只 claude 說對)
3. 確認對 → 凍 golden(寫 `golden/<code>/<step>.golden.json`,記 verified_by/source_docx)
4. 確認錯 → 修抽取器**通則**(見 pdca-content-qa)再凍

## 跑 TDD
`content_evidence_gate.py` 對每格跑上面 5 斷言 + L3 render 截圖。
- 全 330 都有 golden 且 match → 整批 PASS(真驗收)
- 任一無 golden / drift / 張冠李戴 / 骨架 → fail-closed

## fail-closed 鐵律(殺假綠)
- **沒 golden → 一律不得 PASS**(→ unknown,且報表標 release-blocking,視覺上不可像中立)
- **不准 proxy**:story-structure 不可只信 keypoints_manifest 的 `L1.pass` bool —— 必須對 staging payload 直接比 golden
- **N/A no docx / no source = 沒 golden = 不得 PASS**(不是「已驗證正確」)

## 反模式(cursor 抓到的假綠,明列禁止)
- ❌ 只查格式一致性(guide/option/struct)就算內容驗過
- ❌ 沒 golden 的課給 PASS(fail-open)
- ❌ story-structure 信 manifest bool,不重算 payload
- ❌ 把「N/A no docx keypoints table」當 PASS
- ❌ claude 自己說「內容對」就凍 golden(必須人/cursor 對源)
- ❌ figure 只靠 md5 黑名單就說圖對(非佔位但錯圖抓不到 → P1 vision)
