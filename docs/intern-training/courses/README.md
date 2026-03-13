# LingoLeap 實習生課程索引

歡迎加入 LingoLeap 開發團隊！這份課程是專門為你們設計的，不是教科書，是我們在這個專案上真實會用到的東西。

每個課程都有實際的 LingoLeap 程式碼範例，學完就能直接用在工作上。

---

## 學習路徑總覽

```
Tier 1 (基礎)  →  Tier 2 (工具)  →  Tier 3 (實戰)  →  Tier 4 (進階)
  4-6 週             4-6 週             6-8 週             持續學習
```

建議順序：先把 Tier 1 全部跑完，再進 Tier 2，不要跳。每個 Tier 都有練習題，**做完才算學會**。

---

## Tier 1 — 基礎建設

| 課程 | 檔案 | 你會學到 |
|------|------|---------|
| 開發環境設定 | [tier1-dev-environment.md](tier1-dev-environment.md) | VS Code、終端機、Node.js、跑起 LingoLeap |
| Git 基礎 | [tier1-git-basics.md](tier1-git-basics.md) | 版本控制、clone/commit/push、解決 conflict |
| HTML/CSS 基礎 | [tier1-html-css.md](tier1-html-css.md) | DOM、語意標籤、Flexbox、DevTools |
| JavaScript 基礎 | [tier1-javascript.md](tier1-javascript.md) | 變數、陣列方法、async/await、事件 |
| 讀懂現有程式碼 | [tier1-reading-code.md](tier1-reading-code.md) | 追蹤程式流程、VS Code 技巧、畫元件圖 |

**完成 Tier 1 你可以做到**：把 LingoLeap 跑起來、看懂現有程式碼、做出第一個 commit。

---

## Tier 2 — 開發工具

| 課程 | 檔案 | 你會學到 |
|------|------|---------|
| React 元件開發 | [tier2-react-components.md](tier2-react-components.md) | JSX、Props、State、事件處理 |
| TypeScript | [tier2-typescript.md](tier2-typescript.md) | 型別、interface、為什麼型別很重要 |
| Tailwind CSS | [tier2-tailwind.md](tier2-tailwind.md) | Utility classes、Responsive、實際範例 |
| Git 工作流 | [tier2-git-workflow.md](tier2-git-workflow.md) | 分支策略、PR 流程、Conflict 解決 |
| Bug 修復 | [tier2-bug-fixing.md](tier2-bug-fixing.md) | DevTools、console.log、Breakpoint |

**完成 Tier 2 你可以做到**：寫一個 React 元件、開 PR 給 Young review、自己 debug 常見錯誤。

---

## Tier 3 — 實戰開發

| 課程 | 檔案 | 你會學到 |
|------|------|---------|
| React 進階 | [tier3-react-advanced.md](tier3-react-advanced.md) | useEffect、useRef、useMemo、useContext |
| API 串接 | [tier3-api-integration.md](tier3-api-integration.md) | REST API、fetch、Loading 三態、Error handling |
| 元件設計模式 | [tier3-component-patterns.md](tier3-component-patterns.md) | Container/Presentational、Custom Hooks |
| 測試 | [tier3-testing.md](tier3-testing.md) | Vitest、Playwright、Given/When/Then |
| Code Review | [tier3-code-review.md](tier3-code-review.md) | 怎麼給回饋、怎麼收回饋 |

**完成 Tier 3 你可以做到**：獨立實作一個需要 API 串接的功能、寫測試、review 別人的 PR。

---

## Tier 4 — 進階能力

| 課程 | 檔案 | 你會學到 |
|------|------|---------|
| 獨立開發功能 | [tier4-feature-development.md](tier4-feature-development.md) | Issue → Branch → PR 完整流程 |
| 效能優化 | [tier4-performance.md](tier4-performance.md) | React Profiler、lazy loading、Web Vitals |
| 架構理解 | [tier4-architecture.md](tier4-architecture.md) | 前後端完整資料流、LingoLeap 架構圖 |
| 技術文件 | [tier4-documentation.md](tier4-documentation.md) | README、ADR、程式碼註解原則 |
| 指導他人 | [tier4-mentoring.md](tier4-mentoring.md) | Pair Programming、提問引導法 |

**完成 Tier 4 你可以做到**：從頭到尾獨立完成一個功能、帶新人、寫得出 ADR。

---

## 怎麼用這份課程

1. **每天**：選一個課程，讀完 + 做練習題
2. **卡住了**：先自己試 15 分鐘，再問 Young
3. **練習題**：不是選填，是真的要做（開 branch、寫 code、push）
4. **提問格式**：「我在做 X，發生了 Y，我試過 Z，但還是不行」

> 💡 提示：每次遇到問題，先用 Chrome DevTools 看 Console 和 Network tab。90% 的問題答案就在那裡。

---

## LingoLeap 技術棧快速參考

| 層級 | 技術 |
|------|------|
| 前端框架 | React 19 + TypeScript |
| 前端建構 | Vite |
| 樣式 | Tailwind CSS v3 |
| 後端 | FastAPI (Python) |
| 資料庫 | PostgreSQL |
| AI | Vertex AI Gemini 2.5 Flash |
| 部署 | GCP Cloud Run |
| CI/CD | GitHub Actions |
