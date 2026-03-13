# Tier 3：元件設計模式

寫出「能動的程式碼」不難，寫出「別人看得懂、能維護、能修改」的程式碼才是難題。這一課介紹幾個常見的設計模式，LingoLeap 裡都有用到。

---

## Container vs Presentational 分離

這是最基礎也最重要的設計原則：**把「取資料的邏輯」和「顯示畫面的邏輯」分開**。

```tsx
// 不好的寫法：一個元件同時負責取資料 + 顯示
const StoryList = () => {
  const [stories, setStories] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    setIsLoading(true);
    fetchStories().then(data => {
      setStories(data.stories);
      setIsLoading(false);
    });
  }, []);

  if (isLoading) return <div>載入中...</div>;

  return (
    <div>
      {stories.map(story => (
        <div key={story.id} className="p-4 bg-white rounded shadow">
          <h2>{story.title}</h2>
          <p>{story.genre}</p>
        </div>
      ))}
    </div>
  );
};
```

```tsx
// 好的寫法：分成兩個元件

// Presentational：只管顯示，資料從 props 來
const StoryCard = ({ story }: { story: Story }) => (
  <div className="p-4 bg-white rounded shadow">
    <h2 className="text-lg font-bold text-gray-900">{story.title}</h2>
    <p className="text-sm text-gray-500">{story.genre}</p>
  </div>
);

// Container：只管取資料，不寫 HTML
const StoryListContainer = () => {
  const [stories, setStories] = useState<Story[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setIsLoading(true);
    fetchStories()
      .then(data => setStories(data.stories))
      .catch(() => setError('載入失敗'))
      .finally(() => setIsLoading(false));
  }, []);

  if (isLoading) return <Spinner />;
  if (error) return <ErrorMessage message={error} />;

  return (
    <div className="grid grid-cols-2 gap-4">
      {stories.map(story => <StoryCard key={story.id} story={story} />)}
    </div>
  );
};
```

好處：
- `StoryCard` 可以在任何地方重用（只需要傳 `story`）
- 測試 `StoryCard` 不需要真的呼叫 API
- 改顯示樣式不用碰 API 邏輯，改 API 邏輯不用碰顯示

---

## Compound Components（組合元件）

就像 HTML 的 `<select>` 和 `<option>` 要搭配使用，你也可以設計這種「成對元件」。

```tsx
// HTML 的設計：
<select>
  <option value="1">第一課</option>
  <option value="2">第二課</option>
</select>

// 你可以設計類似的 Card 元件組合
<Card>
  <Card.Header>課文理解測驗</Card.Header>
  <Card.Body>
    <p>請回答以下問題...</p>
  </Card.Body>
  <Card.Footer>
    <button>送出答案</button>
  </Card.Footer>
</Card>
```

```tsx
// 實作
const Card = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => (
  <div className={`bg-white rounded-lg shadow ${className}`}>{children}</div>
);

Card.Header = ({ children }: { children: React.ReactNode }) => (
  <div className="px-6 py-4 border-b border-gray-200 font-semibold text-gray-900">
    {children}
  </div>
);

Card.Body = ({ children }: { children: React.ReactNode }) => (
  <div className="px-6 py-4">{children}</div>
);

Card.Footer = ({ children }: { children: React.ReactNode }) => (
  <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-2">
    {children}
  </div>
);
```

> 💡 提示：這個模式讓使用者自由組合 Header/Body/Footer，比傳一堆 props 靈活很多。

---

## Custom Hooks：抽出可重用邏輯

當你發現多個元件都在做同樣的事（比如「載入資料 + 管理 loading 和 error 狀態」），就把這個邏輯抽出來變成 Custom Hook。

```typescript
// 抽出前：在每個元件重複這段邏輯
// VocabPractice.tsx
const [story, setStory] = useState(null);
const [isLoading, setIsLoading] = useState(false);
const [error, setError] = useState(null);

useEffect(() => {
  setIsLoading(true);
  fetchStory(storyId)
    .then(setStory)
    .catch(e => setError(e.message))
    .finally(() => setIsLoading(false));
}, [storyId]);

// DictationPractice.tsx（完全一樣的模式）
// ...
```

```typescript
// 抽出後：useFetch hook（放在 frontend/src/hooks/useFetch.ts）
function useFetch<T>(fetchFn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setIsLoading(true);
    setError(null);
    fetchFn()
      .then(setData)
      .catch(e => setError(e instanceof Error ? e.message : '未知錯誤'))
      .finally(() => setIsLoading(false));
  }, deps);  // eslint-disable-line react-hooks/exhaustive-deps

  return { data, isLoading, error };
}

// 使用
const { data: story, isLoading, error } = useFetch(
  () => fetchStory(storyId),
  [storyId]
);
```

LingoLeap 已有的 Custom Hooks（在 `frontend/src/hooks/`）：
- `useIsMobile` — 判斷是否在手機上
- `useSpeechRecognition` — 語音辨識封裝
- `useAppView` — 頁面路由狀態

---

## 設計原則

### 單一責任原則（SRP）

一個元件只做一件事。如果你的元件名稱需要加「And」（「顯示生字 And 管理學習進度」），就是時候拆分了。

### 組合優於繼承

React 鼓勵用「把元件組合在一起」來複用邏輯，而不是用 class 繼承。

```tsx
// 組合的方式
const PracticeLayout = ({ children }: { children: React.ReactNode }) => (
  <div className="flex flex-col h-full">
    <PracticeHeader />
    <div className="flex-1 overflow-auto">{children}</div>
    <PracticeFooter />
  </div>
);

// 使用
<PracticeLayout>
  <VocabContent />
</PracticeLayout>
```

---

## LingoLeap 案例

### StepperNav 的設計

`StepperNav` 是 Presentational 元件，它：
- 不呼叫任何 API
- 接收 `currentView`、`session`、`onNavigate` 等 props
- 只負責渲染 UI 和呼叫 callback

所有決策（要不要允許跳到某一步、步驟是否完成）都由父元件 `App.tsx` 決定，然後透過 props 傳下來。

### api.ts 的封裝

`api.ts` 本身就是一種「Service Layer」模式：所有 HTTP 請求的細節（URL、headers、錯誤處理）都封裝在這裡，元件只呼叫 `fetchStory(id)` 而不是直接寫 `fetch('http://...')`。

---

## 練習：拆分一個大元件

**任務**：找到 LingoLeap 裡一個超過 300 行的元件，把它拆成 3 個以上的小元件。

建議挑 `VocabPractice.tsx` 或 `DictationPractice.tsx`。

拆分前，用文字描述你的計畫：

```
原本：VocabPractice（350 行，負責所有事情）

拆分後：
1. VocabCard（純顯示，接收 word/definition 等 props）
   - 負責：卡片的 UI、翻轉動畫

2. VocabProgress（顯示進度條和統計）
   - 負責：幾張學會了、還剩幾張

3. VocabPractice（Container，原本的主元件）
   - 負責：管理狀態、呼叫 API、組合上面兩個元件
```

先把計畫寫出來給 Young 確認，再開始改程式碼。拆完後確認功能沒有壞掉。
