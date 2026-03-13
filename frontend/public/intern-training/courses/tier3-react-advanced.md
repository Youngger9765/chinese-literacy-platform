# Tier 3：React 進階

你已經會 `useState` 和 `props` 了。這一課講的是「複雜功能怎麼處理」— API 呼叫、計時器、DOM 操作、效能優化。

---

## useEffect：處理副作用

「副作用」是指「不只是渲染畫面」的動作：呼叫 API、設定計時器、監聽事件。

```typescript
import { useEffect } from 'react';

// 最基本的 useEffect
useEffect(() => {
  // 這裡的程式碼會在「元件渲染後」執行
  console.log('元件渲染了');
});
// ↑ 沒有第二個參數：每次渲染都執行（幾乎不會這樣用）

useEffect(() => {
  console.log('只在第一次渲染後執行');
}, []);
// ↑ 空陣列：只執行一次（元件出現時）

useEffect(() => {
  console.log('每次 storyId 改變時執行');
}, [storyId]);
// ↑ 有依賴：依賴的值改變時才執行
```

### 實際案例：載入課文資料

```typescript
const [story, setStory] = useState<Story | null>(null);
const [isLoading, setIsLoading] = useState(false);

useEffect(() => {
  if (!storyId) return;  // 沒有 ID 就不呼叫

  setIsLoading(true);
  fetchStory(storyId)
    .then((data) => setStory(data))
    .catch((err) => console.error('載入課文失敗:', err))
    .finally(() => setIsLoading(false));
}, [storyId]);  // storyId 改變時重新載入
```

---

## Cleanup 函式：防止記憶體洩漏

useEffect 可以回傳一個「清理函式」，當元件消失時（或 effect 重新執行前）會被呼叫。

```typescript
// 不加 cleanup 的計時器 — 有 bug！
useEffect(() => {
  const timer = setInterval(() => {
    setCount(count + 1);
  }, 1000);
  // 元件消失了，但計時器還在跑，繼續更新一個不存在的 state
  // → 記憶體洩漏 + React 警告
}, [count]);

// 加上 cleanup — 正確做法
useEffect(() => {
  const timer = setInterval(() => {
    setCount(c => c + 1);  // 用函式式更新，不依賴外部 count
  }, 1000);

  return () => {
    clearInterval(timer);  // 元件消失時清除計時器
  };
}, []);  // 只執行一次
```

⚠️ 注意：只要你在 useEffect 裡用了 `setInterval`、`addEventListener`、`setTimeout`，就一定要記得在 cleanup 裡清除。

### 事件監聽的 cleanup

```typescript
// LingoLeap 的拖曳調整面板寬度
useEffect(() => {
  const handleMouseMove = (e: MouseEvent) => {
    if (!isDraggingRef.current) return;
    const delta = e.clientX - dragStartXRef.current;
    // ...更新寬度
  };

  const handleMouseUp = () => {
    isDraggingRef.current = false;
  };

  document.addEventListener('mousemove', handleMouseMove);
  document.addEventListener('mouseup', handleMouseUp);

  return () => {
    document.removeEventListener('mousemove', handleMouseMove);  // 一定要移除！
    document.removeEventListener('mouseup', handleMouseUp);
  };
}, []);
```

---

## useRef：DOM 操作 + 跨渲染保存值

`useRef` 有兩個用途：

### 用途一：操作 DOM 元素

```typescript
const inputRef = useRef<HTMLTextAreaElement>(null);

// 自動 focus 輸入框
useEffect(() => {
  inputRef.current?.focus();
}, []);

// 手動捲動到最下面
const chatEndRef = useRef<HTMLDivElement>(null);

const scrollToBottom = () => {
  chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
};

return (
  <div>
    {messages.map(msg => <MessageBubble key={msg.id} {...msg} />)}
    <div ref={chatEndRef} />  {/* 捲動目標點 */}
  </div>
);
```

### 用途二：保存不需要觸發重新渲染的值

```typescript
// 注意：useRef 的值改變不會觸發重新渲染
// 適合存「不影響畫面但需要跨渲染保存」的資料

const initializedRef = useRef(false);  // 記錄是否已初始化

useEffect(() => {
  if (initializedRef.current) return;  // 防止重複初始化
  initializedRef.current = true;
  initializeSession();
}, []);

// 拖曳狀態（每秒更新很多次，不需要重新渲染）
const isDraggingRef = useRef(false);
const dragStartXRef = useRef(0);
```

> 💡 提示：`useState` vs `useRef` 的選擇：「這個值改變時，畫面需要更新嗎？」需要 → `useState`，不需要 → `useRef`。

---

## useMemo / useCallback：效能優化

這兩個 hook 都是「記住計算結果，避免重複計算」。**但要謹慎使用**，不是所有地方都需要。

### useMemo：記住計算結果

```typescript
// 沒有 useMemo：每次渲染都重新計算
const filteredStories = stories.filter(s => s.grade === selectedGrade);

// 有 useMemo：只有 stories 或 selectedGrade 改變才重算
const filteredStories = useMemo(
  () => stories.filter(s => s.grade === selectedGrade),
  [stories, selectedGrade]
);
```

什麼時候需要 useMemo？計算量很大、或者陣列/物件會被傳給子元件（每次新建物件會讓子元件不必要地重新渲染）。

### useCallback：記住函式

```typescript
// 沒有 useCallback：每次渲染產生新的函式，子元件也跟著重新渲染
const handleNavigate = (view: AppView) => {
  setCurrentView(view);
};

// 有 useCallback：函式引用穩定，子元件不會無謂重渲染
const handleNavigate = useCallback((view: AppView) => {
  setCurrentView(view);
}, []);  // setCurrentView 本身是穩定的，所以依賴陣列為空
```

⚠️ 注意：**不要什麼都包 useMemo/useCallback**。這兩個 hook 本身也有成本。只在：
1. 計算量真的大（例如處理幾百個字的文字）
2. 有用 `React.memo` 的子元件 + 你傳給它函式或物件時

才需要。

---

## useContext：跨元件共享資料

當你需要把資料從很深的父元件傳到很深的子元件，不想一層一層 props 傳遞（「prop drilling」），就用 Context。

```typescript
// 1. 建立 Context
const AuthContext = React.createContext<AuthContextType | null>(null);

// 2. 建立 Provider（包在最外層）
const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);

  return (
    <AuthContext.Provider value={{ token, user, setToken }}>
      {children}
    </AuthContext.Provider>
  );
};

// 3. 任何子孫元件都可以讀取
const { token, user } = useAuth();  // LingoLeap 封裝成 useAuth hook
```

LingoLeap 的 `AuthContext` 就是這樣運作的，任何元件都能拿到登入的 token，不需要一層一層傳。

---

## LingoLeap 案例：ComprehensionChat 的 useEffect

打開 `frontend/src/components/reading-steps/ComprehensionChat.tsx`，可以看到多個 useEffect：

```typescript
// effect 1：載入注音資料（只執行一次）
useEffect(() => {
  PolyphonicProcessor.instance.loadPolyphonicData()
    .then(() => setZhuyinReady(true))
    .catch((err) => console.error('Failed to load zhuyin data:', err));
}, []);

// effect 2：對話新增時自動捲到最底
useEffect(() => {
  chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
}, [conversation]);  // conversation 改變（新訊息）時觸發

// effect 3：拖曳事件監聽（含 cleanup）
useEffect(() => {
  document.addEventListener('mousemove', handleMouseMove);
  document.addEventListener('mouseup', handleMouseUp);
  return () => {
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  };
}, []);
```

每個 useEffect 只負責一件事。不要把所有的 side effects 塞進一個 useEffect 裡。

---

## 練習：倒數計時器

**任務**：建立一個倒數計時元件，用在 LingoLeap 的練習題限時功能

```typescript
// 需求：
// - 接收 totalSeconds: number 作為 props
// - 從 totalSeconds 倒數到 0
// - 每秒更新畫面
// - 到達 0 時呼叫 onTimeUp 回呼
// - 元件消失時計時器要停止（cleanup）
// - 剩下 10 秒以內，數字變紅色

interface CountdownTimerProps {
  totalSeconds: number;
  onTimeUp: () => void;
}

const CountdownTimer: React.FC<CountdownTimerProps> = ({ totalSeconds, onTimeUp }) => {
  // TODO：實作倒數邏輯
  // 提示：用 useState 存剩餘秒數，用 useEffect + setInterval 倒數
  // 提示：記得 cleanup！
  // 提示：剩 0 時呼叫 onTimeUp，記得清除計時器

  return (
    <div>
      {/* 顯示剩餘時間，格式：mm:ss（例如 01:30） */}
      {/* 剩 10 秒以內變紅色 */}
    </div>
  );
};
```

完成後測試：元件顯示時計時器開始跑，切換到其他步驟（元件消失）時不再跑（看 Console 不再有 log）。
