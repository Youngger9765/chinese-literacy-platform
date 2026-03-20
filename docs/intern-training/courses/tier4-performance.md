# Tier 4：效能優化

LingoLeap 的使用者是國小學生，很多人用的是低階 Android 平板。效能不是「讓快的電腦更快」，而是「讓慢的設備也能用」。

---

## React 渲染機制

要優化效能，先要了解 React 怎麼決定「要不要重新渲染一個元件」。

```
使用者操作
    ↓
state 或 props 改變
    ↓
React 重新執行元件函式（re-render）
    ↓
React 比較新舊 Virtual DOM
    ↓
只更新真正改變的 DOM 節點（Reconciliation）
```

**Virtual DOM**：React 在記憶體裡維護一份「虛擬的 DOM 樹」，每次 render 後和上一次的比較，只把差異更新到真實 DOM。這比「每次都重建整個 DOM」快很多。

**問題**：如果父元件 re-render，所有子元件也跟著 re-render，即使子元件的 props 沒有改變。這就是效能問題的來源。

---

## React.memo：避免不必要的 re-render

```tsx
// 沒有 React.memo：父元件任何 state 改變，StepCircle 都會重新渲染
const StepCircle = ({ label, isActive }: { label: string; isActive: boolean }) => {
  console.log('StepCircle rendered:', label);
  return (
    <div className={`w-8 h-8 rounded-full ${isActive ? 'bg-blue-500' : 'bg-gray-200'}`}>
      {label}
    </div>
  );
};

// 有 React.memo：只有 label 或 isActive 改變時才重新渲染
const StepCircle = React.memo(({ label, isActive }: { label: string; isActive: boolean }) => {
  return (
    <div className={`w-8 h-8 rounded-full ${isActive ? 'bg-blue-500' : 'bg-gray-200'}`}>
      {label}
    </div>
  );
});
```

⚠️ 注意：`React.memo` 本身也有成本（每次 render 要比較 props）。只在「這個元件渲染代價高」或「父元件很頻繁 re-render」時才用。

---

## useMemo / useCallback 複習（效能角度）

```tsx
// 問題：每次 App 重新渲染，steps 都是新建的陣列
// → 就算內容沒變，StepperNav 也跟著 re-render（因為 props reference 變了）
const steps = [
  { step: 1, label: '簡介', view: AppView.INTRO },
  { step: 2, label: '逐段朗讀', view: AppView.TUTOR },
  // ...
];

// 解法：useMemo 讓陣列 reference 穩定
const steps = useMemo(() => [
  { step: 1, label: '簡介', view: AppView.INTRO },
  { step: 2, label: '逐段朗讀', view: AppView.TUTOR },
], []);  // 沒有依賴，只建立一次

// 同理：傳給子元件的函式要用 useCallback
const handleNavigate = useCallback((view: AppView) => {
  setCurrentView(view);
}, []);  // setCurrentView 本身穩定
```

---

## Code Splitting：React.lazy + Suspense

LingoLeap 的 `App.tsx` 已經用了這個技巧。打開來看：

```tsx
// 這些頁面「按需載入」，不會在首頁一次全部下載
const TeacherDashboard = lazy(() => import('./pages/teacher/TeacherDashboard'));
const VocabPage = lazy(() => import('./pages/learning/VocabPage'));
const ComprehensionPage = lazy(() => import('./pages/learning/ComprehensionPage'));

// 使用時包在 Suspense 裡，載入時顯示 fallback
<Suspense fallback={<PageLoader />}>
  <Routes>
    <Route path="/teacher" element={<TeacherDashboard />} />
    <Route path="/vocab" element={<VocabPage />} />
  </Routes>
</Suspense>
```

**效果**：學生首次進入 LingoLeap，只下載首頁需要的 JS。進入生字練習頁面時，才下載那個頁面的 JS。總下載量沒變，但**首頁載入速度快很多**。

> 💡 提示：Heavy 元件（圖表、複雜動畫、編輯器）適合用 `React.lazy`。小元件（按鈕、輸入框）就不用了，反而增加請求次數。

---

## Web Vitals

Google 定義的網頁效能指標，也是 SEO 排名的一部分。

```
LCP (Largest Contentful Paint)  — 最大內容渲染時間
  目標：< 2.5 秒
  意義：主要內容（大圖、大標題）出現在畫面上的時間
  常見問題：大圖片沒有優化、首頁 JS 太大

FID (First Input Delay)  — 首次輸入延遲
  目標：< 100ms
  意義：使用者第一次點擊到頁面有反應的時間
  常見問題：主執行緒被長時間的 JS 任務佔用

CLS (Cumulative Layout Shift)  — 累計版面配置位移
  目標：< 0.1
  意義：頁面元素突然移位的程度（圖片載入後把文字往下推）
  常見問題：圖片或嵌入元素沒有設定寬高
```

---

## 工具：React DevTools Profiler

1. 安裝 Chrome 擴充套件：「React Developer Tools」
2. 打開 DevTools → Profiler tab
3. 點 Record（圓形按鈕）
4. 在 LingoLeap 操作（例如點幾個步驟、輸入文字）
5. 停止 Recording
6. 看哪些元件花時間最長（橘色/紅色的 bar）

```
Profiler 怎麼讀：
- 每個長條 = 一次 re-render
- 顏色越深 = 渲染時間越長
- 灰色 = 這次沒有 re-render（被 React.memo 攔住了）
```

### 工具：Lighthouse

在 Chrome DevTools 的 Lighthouse tab 可以跑效能測試，會給你 0-100 的分數和具體改善建議。

```bash
# 或用命令列（更精準，因為沒有擴充套件干擾）
npx lighthouse http://localhost:3000 --output html --output-path ./report.html
```

---

## 練習：找出不必要的 re-render

**任務**：用 React DevTools Profiler 找出 LingoLeap 裡一個不必要 re-render 的元件

```
步驟：
1. 本地啟動 LingoLeap（npm run dev）
2. 打開 React DevTools → Profiler
3. 點 Record
4. 在 StepperNav 上點幾個步驟
5. 停止 Record
6. 看有哪些元件在「你沒有改它的 props」的情況下還是重新渲染了
```

找到後，寫出：

```markdown
## 不必要 re-render 報告

**元件名稱**：XXX
**觸發時機**：每次 YYY state 改變時
**為什麼不必要**：這個元件的 props 沒有改變
**建議解法**：用 React.memo 包住 / 用 useCallback 讓 handler 引用穩定
```

把報告給 Young 看，如果他確認這確實是個問題，就可以開 PR 修它。
