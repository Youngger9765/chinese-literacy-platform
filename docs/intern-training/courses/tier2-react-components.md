# Tier 2：React 元件開發

React 是 LingoLeap 前端的核心框架。它讓你用「元件」的方式組織 UI，就像積木一樣。

---

## JSX 語法

JSX 看起來像 HTML，但其實是 JavaScript。有幾個關鍵差異：

```tsx
// HTML 寫法
<div class="step-circle" onclick="handleClick()">

// JSX 寫法（React）
<div className="step-circle" onClick={handleClick}>
//   ↑ class → className     ↑ onclick → onClick（駝峰命名）
//                           ↑ 用 {} 傳入 JS 表達式
```

```tsx
// 在 JSX 裡可以用 {} 嵌入任何 JavaScript 表達式
const step = 3;
const label = '課文理解';

return (
  <div>
    <span>{step}</span>          {/* 數字 */}
    <span>{label}</span>         {/* 字串 */}
    <span>{step * 2}</span>      {/* 運算 */}
    <span>{label.length}</span>  {/* 方法呼叫 */}
  </div>
);
```

---

## Props：父傳子的資料流

Props 是父元件傳給子元件的資料，子元件不能修改它。

```tsx
// 父元件（App.tsx 呼叫 StepperNav）
<StepperNav
  currentView={currentView}       {/* 傳入 currentView */}
  session={session}               {/* 傳入 session */}
  selectedStory={selectedStory}
  onNavigate={handleNavigate}     {/* 傳入函式（回呼） */}
/>

// 子元件（StepperNav.tsx 接收）
interface StepperNavProps {
  currentView: AppView;
  session: LearningSession | null;
  selectedStory: Story | null;
  onNavigate: (view: AppView) => void;  // 函式型別
}

const StepperNav: React.FC<StepperNavProps> = ({
  currentView,
  session,
  selectedStory,
  onNavigate,
}) => {
  // 這裡可以用這些 props
  return <nav>...</nav>;
};
```

> 💡 提示：Props 流向是單向的：父 → 子。子元件想「通知」父元件，要透過父元件傳下來的 callback 函式（像 `onNavigate`）。

---

## State：useState 完整教學

State 是元件「自己的記憶」。State 改變時，元件會重新渲染。

```tsx
import { useState } from 'react';

const VocabCard = () => {
  // useState 回傳 [目前的值, 改變這個值的函式]
  const [isFlipped, setIsFlipped] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);

  return (
    <div>
      {/* 點擊翻轉卡片 */}
      <button onClick={() => setIsFlipped(!isFlipped)}>
        {isFlipped ? '顯示答案' : '顯示問題'}
      </button>

      {/* 翻到下一張 */}
      <button onClick={() => setCurrentIndex(currentIndex + 1)}>
        下一個字
      </button>
    </div>
  );
};
```

**State 不要直接修改！**

```tsx
// 錯誤：直接修改 state 不會觸發重新渲染
const [messages, setMessages] = useState([]);
messages.push('新訊息');  // 不對！

// 正確：用 set 函式，傳入新值
setMessages([...messages, '新訊息']);  // 用展開運算子建立新陣列
```

---

## 事件處理

```tsx
// onClick
<button onClick={() => handleSubmit()}>送出</button>
<button onClick={handleSubmit}>送出</button>  // 等效（函式引用）

// onChange（輸入框）
const [inputText, setInputText] = useState('');

<input
  value={inputText}
  onChange={(e) => setInputText(e.target.value)}
  className="border rounded px-2 py-1 text-gray-900 bg-white"
/>

// onSubmit（表單）
const handleSubmit = (e: React.FormEvent) => {
  e.preventDefault();  // 阻止頁面重新整理
  // 處理送出邏輯
};

<form onSubmit={handleSubmit}>
  <input ... />
  <button type="submit">送出</button>
</form>
```

---

## 條件渲染

```tsx
const isLoading = true;
const error = null;
const data = ['課文A', '課文B'];

// 方法一：&& 運算子（「如果 X 就顯示 Y」）
{isLoading && <div>載入中...</div>}

// 方法二：三元運算子（「如果 X 就顯示 Y，否則顯示 Z」）
{isLoading ? <Spinner /> : <Content />}

// 方法三：early return（元件層級的條件）
const VocabPractice = ({ story }) => {
  if (!story) return <div>請先選擇課文</div>;  // 提前返回
  if (isLoading) return <Spinner />;

  return (
    <div>正式內容</div>  // 走到這裡保證有 story 和不在 loading
  );
};
```

---

## 列表渲染：map + key

```tsx
const steps = [
  { step: 1, label: '簡介', view: AppView.INTRO },
  { step: 2, label: '逐段朗讀', view: AppView.TUTOR },
  // ...
];

return (
  <nav>
    {steps.map((stepDef) => (
      // key 必須是唯一的，React 用它來追蹤哪個元素改變了
      <button key={stepDef.view} onClick={() => onNavigate(stepDef.view)}>
        {stepDef.step}. {stepDef.label}
      </button>
    ))}
  </nav>
);
```

⚠️ 注意：`key` 不要用陣列 index（`key={i}`），因為陣列重新排序時 React 會搞錯。用唯一的 ID 或固定的識別符。

---

## 練習：寫一個「學習小提示」彈窗元件

需求：
- 一個按鈕「顯示提示」
- 點擊後彈出一個小視窗，顯示隨機提示文字
- 視窗右上角有 X 關閉按鈕

```tsx
// 從這個骨架開始
const TIPS = [
  '朗讀時放慢速度，讓每個字都清晰',
  '不確定的字可以先跳過，繼續往下讀',
  '理解題沒關係，多讀幾次課文再試',
];

const LearningTipModal: React.FC = () => {
  // TODO：加入 isOpen state
  // TODO：加入隨機選 tip 的邏輯
  // TODO：寫 return 的 JSX

  return (
    <div>
      {/* 你的實作 */}
    </div>
  );
};

export default LearningTipModal;
```

完成後，把這個元件加到 LingoLeap 的某個頁面上，截圖給 Young。
