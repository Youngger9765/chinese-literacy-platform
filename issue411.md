## 背景
部分頁面有 skeleton loading，但大多數頁面用 spinner 或空白。Skeleton loading 比 spinner 給使用者更好的感覺（perceived performance）。

## 你要做什麼
建立統一的 skeleton loading 系統，改善各頁面的載入體驗。

## 思考方向
- 先在網站上到處點點看，哪些頁面的載入體驗最差？（loading 時白屏或跳動的）
- Skeleton 的形狀應該模擬真實內容的 layout。怎麼設計才能讓 skeleton → 真實內容的過渡自然？
- 要做成可複用元件嗎？如果做，API 怎麼設計最靈活？（props 要有哪些？）
- `TeacherDashboard.tsx` 裡已經有一個 `SkeletonCard`，可以參考但想想有什麼能改進的
- 動畫效果：`animate-pulse` vs shimmer gradient，哪個看起來比較好？

## 驗收標準
- [x] 有可複用的 Skeleton 元件
- [x] 至少改善 3 個頁面的載入體驗
- [x] Skeleton 與實際內容形狀相符

## 本次修改內容

### 1) 建立統一可複用 Skeleton 系統
- 新增 `frontend/src/components/ui/Skeleton.tsx`
	- `Skeleton`: 基礎骨架區塊，支援 `animation: 'shimmer' | 'pulse'`
	- `SkeletonText`: 文字行骨架，可設定 `lines` 與 `lineClassName`
	- `SkeletonCircle`: 圓形骨架
- 在 `frontend/src/index.css` 新增 `@keyframes sk-shimmer`，提供 shimmer 掃光效果。

### 2) 建立統一 Loading 指示元件（更明顯的載入狀態）
- 新增 `frontend/src/components/ui/LoadingIndicator.tsx`
	- 顯示旋轉圓圈
	- 顯示「載入中」文字
	- 顯示「...」點點動畫（透過 `loading-dot` keyframes）
- 在 `frontend/src/index.css` 新增 `@keyframes loading-dot`。

### 3) 改善至少 3 個頁面的載入體驗
- `frontend/src/pages/teacher/TeacherDashboard.tsx`
	- 原先分散的 skeleton 卡片改為共用元件。
	- loading 區塊新增 `LoadingIndicator`，並保留對應版型的骨架卡片。
- `frontend/src/pages/teacher/TeacherAssignmentsPage.tsx`
	- 將 loading 畫面改為「指示器 + 標題/篩選/列表」對應骨架。
- `frontend/src/pages/student/StudentClassroomDashboard.tsx`
	- 將原本簡單文字載入改為「指示器 + 班級卡片版型骨架」。

### 4) 修正路由切換時下半部空白問題
- `frontend/src/components/ui/PageLoader.tsx`
	- 原本僅顯示中央 spinner，改為「LoadingIndicator + 骨架卡片」組合。
	- 避免 Suspense fallback 期間出現大面積空白，降低「畫面壞掉」感。

## 動畫策略
- 骨架預設使用 `shimmer`（視覺回饋較明顯）。
- 若頁面需要低干擾，可用 `animation='pulse'` 切換。
- 載入文字使用點點動畫加強「系統正在工作中」的感知。

## 驗證
- 已執行：`cd frontend && npm run build`
- 結果：build 成功，無編譯錯誤。