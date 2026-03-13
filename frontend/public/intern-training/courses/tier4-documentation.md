# Tier 4：技術文件

寫程式碼是在告訴電腦「怎麼做」。寫文件是在告訴人類「為什麼這樣做」。好的文件讓你三個月後還能讀懂自己的程式碼，也讓新人上手更快。

---

## 文件的種類

### README

專案的門面。任何人第一次看到這個 repo 就會先看 README。

好的 README 包含：
- 這個專案是什麼（1-2 句話）
- 怎麼在本地跑起來（步驟要能直接執行）
- 重要的技術選擇
- 怎麼貢獻（提 PR、跑測試）

### ADR（Architecture Decision Record）

記錄重大技術決策。「我們為什麼選 Tailwind 而不是 CSS Modules？」「為什麼用 React Context 而不是 Zustand？」

三個月後有新人問「為什麼這樣做」，你可以直接丟 ADR 連結，不用重新解釋。

### API 文件

後端提供的 API 格式。LingoLeap 用 FastAPI，它自動生成 Swagger 文件：`http://localhost:8000/docs`

### 程式碼註解

「程式碼說怎麼做，註解說為什麼」。

---

## 程式碼註解原則

**不需要寫**：程式碼本身已經很清楚的地方。

```typescript
// 不好的註解（廢話）
// 把 score 設為 0
const score = 0;

// 遍歷所有課文
stories.forEach(story => {
  // ...
});
```

**需要寫**：做了「反直覺的決定」，或者「複雜的業務邏輯」。

```typescript
// 好的註解（解釋「為什麼」）

// 用 isComposing 避免中文輸入法選字時意外觸發 Enter 送出
// 詳見 Issue #216：IME input bug
if (e.nativeEvent.isComposing) return;

// 這裡故意不用 async/await，因為我們不需要等待結果
// 記錄學習行為是 fire-and-forget，失敗了不影響主流程
trackLearningEvent(sessionId, 'step_completed').catch(console.error);

// max_output_tokens 設為 1024（不是預設的 256）
// 256 會造成 JSON 截斷問題（實測：gemini-2.5-flash 的 JSON 輸出常超過 256 token）
// 詳見 backend/app/services/ai_service.py 的頂部說明
```

---

## ADR 格式

```markdown
# ADR-001：使用 Tailwind CSS 而非 CSS Modules

**日期**：2026-01-15
**狀態**：已採用

## 背景

LingoLeap 前端需要一個樣式解決方案。候選方案：
1. Tailwind CSS（Utility-first）
2. CSS Modules（Scoped CSS）
3. styled-components（CSS-in-JS）

## 決定

採用 Tailwind CSS。

## 理由

- 開發速度快：不需要在 JSX 和 CSS 之間切換
- 響應式語法直觀：`md:grid-cols-2` 比 `@media` query 易讀
- 打包後體積小：Tailwind 只包含用到的 class
- 實習生學習曲線較低：class 名稱接近直覺（`text-red-500` vs `color: #ef4444`）

## 後果

- 每個元件的 className 會比較長
- 設計系統的顏色、間距要透過 `tailwind.config.js` 統一管理
- 動態 class 需要注意 PurgeCSS 的限制（不能用字串拼接 class 名稱）
```

---

## 練習一：寫一份功能說明文件

選一個你做過的功能（或者 LingoLeap 現有的功能），寫一份技術說明文件。

**格式模板**：

```markdown
# [功能名稱] 技術說明

**最後更新**：YYYY-MM-DD
**負責人**：你的名字

## 功能說明

這個功能做什麼？解決了什麼使用者問題？（2-3 句）

## 架構圖

（用文字或 ASCII 畫出資料流）

## 主要檔案

| 檔案 | 說明 |
|------|------|
| `frontend/src/components/Xxx.tsx` | ... |
| `backend/app/routes/xxx.py` | ... |

## 重要決策

**為什麼選 X 而不是 Y**：...

## 已知限制

- 目前不支援 Z 情境
- 當 A 發生時，行為是 B（不是最理想，但是 MVP 決定先這樣）

## 相關 Issue

- #300 原始功能需求
- #312 後續改善
```

---

## 練習二：寫一個 ADR

選 LingoLeap 裡一個你覺得「為什麼要這樣做？」的技術決策，用 ADR 格式記錄下來。

可以問 Young 背景（「為什麼 Gemini 要跑在 us-central1 而不是 asia-east1？」），然後把他的回答整理成 ADR。

把你的 ADR 存在 `docs/adr/ADR-XXX-你選的主題.md`，開 PR 讓 Young review。

> 💡 提示：寫 ADR 不是要讓決策看起來「正確」，而是誠實記錄「當時為什麼這樣判斷」，包含限制和取捨。
