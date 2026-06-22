---
name: pdca-content-qa
description: 內容 QA 的 PDCA 改善迴圈 —— 用 content_evidence_gate 找問題、修 build-keypoints/build-spotlight 抽取器通則(不逐課 overfit)、重跑驗證、更新 golden,迴圈收斂到全 330 真 PASS。當需要「改善內容 QA」「收斂假綠/unknown」「PDCA 重點表/聚光燈」「為什麼還在錯」「集成表收尾」時使用。配合 content-tdd(golden)+ content_evidence_gate(證據)。
---

# pdca-content-qa — 內容 QA 改善迴圈

> **為什麼存在**：內容錯(張冠李戴/假圖/空骨架/缺源)反覆出現,過去靠「打地鼠逐課手修」+「憑感覺說好了」→ 錯了又錯、信任破。本 SKILL 把改善變成 **PDCA 可重複迴圈**,只修根(抽取器通則)+ 用 gate 客觀收斂,不逐課亂修。

## 鐵律(先講)
- **回到源頭修**:錯了改 `build_lesson_schema.py` / build-keypoints / build-spotlight 的**通則**,不改單課輸出。overfit-lint 必過(禁硬編課號/專有名詞)
- **無 gate 證據不得宣稱完成**:任何「修好/驗收通過」必附 content_evidence_gate run_id + ship-gate PASS。禁用「API 綠/render 看一下」當依據(#2397 假綠教訓)
- **golden 由人/cursor 驗,不由 claude 自證**(見 content-tdd)

## P — Plan(找問題,客觀)
1. 跑 `content_evidence_gate.py`(全 330)→ coverage_manifest
2. 讀 review_queue 按 reason_code 分類:`L1_KEYPOINTS_FAIL`(真壞) / `SOURCE_MISSING`/`KEYPOINTS_MANIFEST_MISSING`(缺源) / `FIGURE_ASSET_UNRESOLVED`(圖) / drift(golden 不符)
3. **歸因到通則**:同 reason_code 的多課常是**同一個抽取器 bug**(例:多文本 secondary slot fallback → G4-L20/G5-L24/G9-L15/L17 + 1103 同根),不是 N 個獨立特例

## D — Do(修根,不 overfit)
- 改抽取器**通則**(多文本切分 / SL→id 映射 / figure 綁定 / 缺源 placeholder 處理)
- 有源 DOCX 但沒抽 → 補抽進 `_online-schema`
- 無源 DOCX → 誠實記 **known-gap**(別造假 placeholder 充數,#2388)
- overfit-lint 必跑必過

## C — Check(重跑 + golden diff,真驗證)
1. 重跑 `content_evidence_gate.py` → fail/unknown 應下降
2. **golden 0-diff**:已驗過的課不可被弄壞(改抽取器動到任一 frozen golden → flag,要嘛 bug 要嘛該 re-verify)
3. **PASS 抽樣反證**(cursor P1):每輪強制抽 5-10 個 PASS,人/cursor 對源 DOCX 審;**命中 1 個假綠 → 整批降級 + 收緊 gate 規則**(不放過)
4. spec/pytest 不破契約

## A — Act(更新 + 收斂)
- 修好且抽驗過的課 → 凍/更新 golden(content-tdd)
- 真 known-gap → 文件記錄(課號 + 為何無法驗,如無 DOCX)+ 開 issue 追人工補
- gate 被抓到放水 → 收緊 invariant(把假綠 case 變 fail)+ 記進 content-tdd 反模式
- 迴圈:回 P 重跑,直到 `unknown=0`(全有 golden)+ `fail=0`(全 match)+ 抽驗無假綠

## 收斂定義(Definition of Done)
全 330:有 golden、match golden、anti-cross-lesson 過、figure 真、抽驗無假綠、ship-gate PASS。
**這時的集成表才能當真驗收簽核**,不是之前的「247 pass(混假綠)」。

## 反模式
- ❌ 逐課手修輸出(該修抽取器通則)
- ❌ 沒跑 gate 就說改善了
- ❌ 抽驗命中假綠卻只修那一課(要收緊 gate 規則,讓同類都被抓)
- ❌ 為了降 unknown 把缺源課塞假 placeholder(造假)
- ❌ golden 被弄壞當沒事(regression 必查)
