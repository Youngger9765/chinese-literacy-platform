# Code Review Guidelines — LingoLeap

## 專案技術棧
- Frontend: React 19 + Vite + TypeScript + Tailwind CSS
- Backend: FastAPI + SQLAlchemy + PostgreSQL
- AI: Vertex AI Gemini (gemini-2.5-flash, us-central1)
- Deploy: GCP Cloud Run

---

## 🔴 必擋（一定要 request changes）

### Security
- hardcoded secrets、API keys、密碼
- SQL injection / XSS / 未消毒的 user input
- CORS 設定被改動
- 新 API endpoint 沒有 auth 保護

### Silent Failures（來自 silent-failure-hunter）
- `catch` block 吞掉 error 不 re-throw 也不 log
- API error 回傳 fallback 假資料讓 UI 以為成功
- `try/catch` 裡 return default value 掩蓋問題
- `?.` optional chaining 過度使用，掩蓋 null 問題

### AI/LLM Trust Boundary（來自 ai-output-validation）
- AI 回應直接信任，沒做 schema validation
- AI error fallback 用 `understood=True` → 必須用 `understood=False`
- AI JSON 回應沒處理截斷/不完整的情況
- Gemini 回應沒有 circuit breaker（3 次連續 error → 停止）

### React Anti-patterns（來自 react-doctor）
- conditional hooks（if 裡面呼叫 useState/useEffect）
- hooks dependency array 缺少 dependency
- useEffect 裡直接改 state 造成無限 re-render
- 在 render 裡做 heavy computation 沒用 useMemo

### 資料一致性
- localStorage 存了資料但沒同步到 DB
- 前端 state 和後端 state 不一致的可能性
- API 呼叫沒走 `frontend/src/services/api.ts`，直接用 fetch/axios

---

## 🟡 建議改善

### Code Quality
- `console.log` 殘留在 production code
- TypeScript `any` type（除非有註解說明原因）
- 元件超過 300 行 → 建議拆分
- 重複邏輯可抽共用
- Tailwind class 過長 → 建議用 `cn()` 或抽 component
- useEffect 裡有不必要的 dependency

### 效能
- 大 list 沒用 virtualization
- 不必要的 re-render（props 傳新 object/array reference）
- API 呼叫沒有 loading/error state

### 型別
- 缺少 TypeScript type 定義
- interface 比 type 更適合 object shape
- API response 沒有 type guard

---

## 🟢 值得讚賞
- 良好的 error handling（catch + user-facing message + log）
- 清楚的命名
- 適當的 TypeScript typing
- 好的元件拆分
- 有處理 loading / error / empty state

---

## 專案慣例
- 中文 UI 文字直接寫，不用 i18n
- 注音用 BpmfIansui 字體，不用 HTML ruby tags
- API service layer 在 `frontend/src/services/api.ts`
- Step 元件在 `frontend/src/components/reading-steps/`
- 課文資料在 `backend/data/lessons/` (YAML)
- TTS 用 Google Chirp3-HD，fallback Azure
- Session 機制：Cloud Run redeploy 會清 in-memory session → 前端要處理 SessionExpiredError

## Review 語言
用中文留言，技術術語可用英文
