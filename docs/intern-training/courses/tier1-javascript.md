# Tier 1：JavaScript 基礎

JavaScript 是讓網頁「動起來」的語言。HTML 是骨架，CSS 是外觀，JS 是肌肉。

---

## 變數：let vs const vs var

```javascript
// const：值不會改變（大多數時候用這個）
const API_BASE = 'http://localhost:8000';
const MAX_QUESTIONS = 5;

// let：值會改變（計數器、狀態等）
let currentStep = 1;
let isLoading = false;

// var：舊語法，不要用
// var 有奇怪的作用域問題，現代 JS 已棄用
```

> 💡 提示：預設用 `const`，只有當你知道這個值之後會改變時，才改用 `let`。

---

## 型別

```javascript
// String（文字）
const title = '蟋蟀和螞蟻';
const greeting = `你好，${title}`;  // 模板字串，用反引號

// Number（數字）
const score = 95.5;
const step = 3;

// Boolean（真/假）
const isCompleted = true;
const needsStory = false;

// Array（陣列）
const steps = ['簡介', '逐段朗讀', '課文理解', '生字練習'];
const grades = [4, 5, 6];

// Object（物件）
const story = {
  id: '42',
  title: '蟋蟀和螞蟻',
  grade: 5,
  isCompleted: false,
};
```

---

## 函式

```javascript
// 宣告式函式（function declaration）
function getStepLabel(stepNumber) {
  const labels = ['簡介', '逐段朗讀', '課文理解', '生字練習', '聽寫練習', '全文朗讀', '報告'];
  return labels[stepNumber - 1];
}

// 箭頭函式（arrow function）— 更簡潔，LingoLeap 主要用這個
const getStepLabel = (stepNumber) => {
  const labels = ['簡介', '逐段朗讀', '課文理解', '生字練習', '聽寫練習', '全文朗讀', '報告'];
  return labels[stepNumber - 1];
};

// 單行箭頭函式（省略 return）
const double = (n) => n * 2;
const greet = (name) => `你好，${name}！`;
```

---

## 陣列方法（最重要的四個）

### `map`：把每個元素轉換成新值

LingoLeap 在 `api.ts` 裡把 API 回傳的原始資料轉換成前端用的格式：

```javascript
// api.ts 裡的真實程式碼
const stories = data.stories.map(apiListItemToStory);

// 這是什麼意思？
// data.stories 是 API 回傳的原始陣列
// .map() 把每個元素「套一個轉換函式」
// 結果是一個新陣列，每個元素都被轉換過

// 簡單範例：
const scores = [80, 90, 75];
const grades = scores.map((score) => {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  return 'C';
});
// grades = ['B', 'A', 'C']
```

### `filter`：篩選符合條件的元素

```javascript
const allStories = [
  { title: '蟋蟀和螞蟻', grade: 5 },
  { title: '烏鴉喝水', grade: 4 },
  { title: '愚公移山', grade: 6 },
];

// 只要五年級的課文
const grade5Stories = allStories.filter((story) => story.grade === 5);
// [{ title: '蟋蟀和螞蟻', grade: 5 }]
```

### `find`：找第一個符合條件的元素

```javascript
// 找特定課文
const story = allStories.find((s) => s.title === '烏鴉喝水');
// { title: '烏鴉喝水', grade: 4 }

// 找不到時回傳 undefined
const notFound = allStories.find((s) => s.title === '不存在的課文');
// undefined
```

### `reduce`：把陣列摺疊成一個值

```javascript
// 計算總分
const scores = [80, 90, 75, 85];
const total = scores.reduce((sum, score) => sum + score, 0);
// total = 330

// 計算平均
const average = total / scores.length;
// average = 82.5
```

---

## 事件處理

```javascript
// 最基本的點擊事件
const button = document.getElementById('start-btn');
button.addEventListener('click', () => {
  console.log('按鈕被點了！');
});

// React 裡的寫法（Tier 2 會深入學）
<button onClick={() => console.log('點了！')}>開始學習</button>

// 表單輸入事件
const input = document.getElementById('answer-input');
input.addEventListener('input', (event) => {
  console.log('目前輸入：', event.target.value);
});
```

---

## async/await — 為什麼 API 呼叫要等？

想像你在餐廳點餐：你不會叫完餐馬上就拿到食物，要等廚師做完。

API 呼叫也一樣。你請求後端給你課文列表，要等後端查資料庫、回傳資料。

如果不等，程式會在資料還沒到之前就繼續跑，結果是 `undefined`。

```javascript
// 錯誤寫法（不等）
function loadStories() {
  const stories = fetch('/api/stories');  // 馬上繼續
  console.log(stories);  // 印出 Promise，不是真正的資料！
}

// 正確寫法（用 async/await 等待）
async function loadStories() {
  try {
    const response = await fetch('/api/stories');   // 等 fetch 完成
    const data = await response.json();             // 等解析 JSON 完成
    console.log(data.stories);                      // 這才是真正的資料
  } catch (error) {
    console.error('載入失敗：', error);
  }
}
```

`api.ts` 裡的真實寫法：

```typescript
// frontend/src/services/api.ts
export async function fetchStories(token?: string) {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}/api/stories`, { headers });
  if (!res.ok) throw new Error(`fetchStories failed: ${res.status}`);
  const data = await res.json();
  return {
    stories: data.stories.map(apiListItemToStory),
    total: data.total,
    grades: data.grades,
  };
}
```

---

## 練習：在 Browser Console 操作 LingoLeap 頁面

1. 打開 `https://lingoleap-dev.web.app`
2. 按 F12 → Console tab
3. 在 Console 輸入以下程式碼，按 Enter 執行：

```javascript
// 找到頁面上所有的 button
const buttons = document.querySelectorAll('button');
console.log('頁面上有幾個按鈕：', buttons.length);

// 把所有按鈕的文字印出來
buttons.forEach((btn) => {
  console.log(btn.textContent.trim());
});

// 試著用 JS 模擬點擊第一個按鈕
buttons[0].click();
```

思考：點了之後發生什麼？和你手動點一樣嗎？為什麼？
