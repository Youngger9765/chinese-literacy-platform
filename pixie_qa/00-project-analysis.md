# 00 — Project analysis

## What the software does
LingoLeap content-QA **multimodal vision judge**(`scripts/spotlight_vision_judge.py`)。
對「閱讀聚光燈(reading-strategy)/ 文章重點表(story-structure)」這兩個高度客製化內容+排版的學習步驟,
**render 該課該步驟的 staging 網頁截圖**,把截圖(多模態,不是 API 文字)+ 該課權威 title/paragraphs
餵 Gemini 2.5-flash vision,判該頁 render 出來的內容/排版是否忠實服務本課。

Why vision not text:聚光燈/重點表是客製內容+排版,文字 token overlap 比對 ~85% 誤判;
假佔位圖/破圖/視覺張冠李戴只有看畫面才抓得到。

## Target users
平台內容 QA(Young / coordinator / 內容團隊)。最終守 152 課 × 2 步驟 = 304 cell 的內容品質。

## Capability inventory(judge 要分辨的 4 類)
1. **faithful** — 內容+排版忠實本課(含合法通用教學鷹架語:小試身手/論據檢核/問重要問題)
2. **cross_lesson** — 張冠李戴:頁面主體被分析的文本是「別課」
3. **skeleton** — 純骨架(編號空殼無實質內文)
4. **figure_broken** — 「圖片載入失敗」框/破圖 icon(非「圖醜但有載入」)

## Realistic input characteristics
- 輸入 = (story_id, step)。story_id 跨 4-9 年級 152 課;step ∈ {reading-strategy, story-structure}
- render 出的頁面長度不一(短鷹架頁 ~1 屏 → 多題長頁需 full-page 截圖)
- 內容可能:正確 / 整段是別課 / 內嵌借用他課練習文本 / 有真實圖 / 有通用 clip-art / 有破圖

## Hard problems / failure modes
1. **張冠李戴 vs 合法鷹架**:scaffold 裡 incidental 提到別課人名(如背影課舉「作者是林玫伶」格式範例)
   ≠ cross_lesson;但整段主體是別課 = cross_lesson。judge 要分清「主體」vs「夾帶範例」。
2. **figure_broken false positive**:通用/低畫質/模糊但「有載入」的圖 ≠ 破圖;只有「載入失敗框」才算。
3. **skeleton 錯層**:base text 是骨架,但 render 的鷹架頁可能被填成有內容 → skeleton 屬資料層,
   不一定能從 render 認出。
4. **borrowed practice text**:策略課故意內嵌另一篇當練習文本(旅人鴿課內嵌雨林文)→ faithful or cross 模糊。
