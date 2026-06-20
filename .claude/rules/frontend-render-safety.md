# Frontend Render-Safety — always-load rule

## Why this exists (#2279 postmortem)

PR #2279 宣告 `const stopPlaybackSync = useCallback(...)` 在引用它的 useEffect deps 之後
→ mount 時 TDZ ReferenceError → 逐段朗讀白屏。`tsc` + `vite build` 抓不到（runtime hoisting），
前端無 eslint，e2e skip tutor 頁、0 pageerror 斷言 → 三道關全空。

## 三道防護

### Gate ① — vitest render-smoke (`frontend/src/__smoke__/render-smoke.test.tsx`)
12 個主要 step 元件（含 LiveTutorControls）mount render 不 throw
TDZ 或 provider 問題 → 測試直接紅（2 failed / 11 passed in before-evidence）

### Gate ② — ESLint (`frontend/eslint.config.js`)
- `no-use-before-define: error` — 靜態偵測 const 宣告順序錯誤（TDZ 形狀）
- `react-hooks/rules-of-hooks: error` — hooks 不在 top level
- CI: `npm run lint`，只有 error 擋 PR（warn 不擋）
- New violations will not have `eslint-disable` comments — only pre-existing patterns do

### Gate ③ — Playwright pageerror fixture (`frontend/tests/e2e/fixtures/pageerror-fixture.ts`)
任何 staging e2e 跑出 uncaught JS error → afterEach 自動失敗
不需要每個 spec 手動加 `page.on('pageerror')`

## CI enforcement

`.github/workflows/frontend-checks.yml` triggers on `frontend/src/**` changes:
1. `npm run lint` — 0 errors required (warnings pass)
2. `npm run test` — all vitest tests (including smoke) must pass

## Verified = 證據不是 code-read

改 `*.tsx` 後要宣稱「verified / 完成 / 測試通過」：
- 必須有：`npm run test` 輸出（vitest smoke 綠）
- 必須有：`npm run lint` 輸出（0 errors）
- 必須有：`/qa` 截圖 + console 乾淨（affected page，not staging 舊版）
- 禁止：只讀 code 推斷「應該沒問題」

## 反模式
- 把 `const foo = useCallback/useMemo` 放在引用 `foo` 的 useEffect deps 之後
- skip LiveTutor / tutor 頁不做 e2e（現在有 pageerror fixture 會抓到）
- 說「build pass = render safe」（build 是編譯期，TDZ 是 runtime）
- 讓 intern 提 PR 沒跑 lint（lint 現在在 CI 擋）
- 在新程式碼中加 `eslint-disable no-use-before-define`（只有 pre-existing patterns 才有）
