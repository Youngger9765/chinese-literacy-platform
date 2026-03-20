# Tier 2：Tailwind CSS

Tailwind 是 LingoLeap 用的 CSS 框架。你不需要寫 `.css` 檔案，直接在 HTML/JSX 上加 class 就搞定樣式。

---

## Utility-First 概念

傳統 CSS 的寫法是「先幫一個元素命名，再去寫樣式」：

```css
/* 傳統 CSS */
.step-button {
  padding: 8px 16px;
  background-color: #3b82f6;
  color: white;
  border-radius: 4px;
  font-weight: 600;
}
```

```html
<button class="step-button">下一步</button>
```

Tailwind 的寫法是「把樣式直接寫在 class 裡」：

```html
<button class="px-4 py-2 bg-blue-500 text-white rounded font-semibold">
  下一步
</button>
```

初看起來 class 很多、很亂，但好處是：
- 不用取名字（不用想「這個按鈕要叫什麼 class」）
- 不用在 JSX 和 CSS 兩個檔案之間切換
- 刪掉一個元件，樣式也一起消失，不會有殘留的 CSS

> 💡 提示：裝 VS Code 套件「Tailwind CSS IntelliSense」，打 `bg-` 就會自動補全，也能看到顏色預覽。

---

## 常用 Class 速查

### 間距：padding / margin

Tailwind 的間距數字是 `4px` 的倍數（`1 = 4px, 2 = 8px, 4 = 16px`）。

```html
<!-- padding（內邊距） -->
<div class="p-4">   四邊都有 16px padding</div>
<div class="px-4">  左右 16px</div>
<div class="py-2">  上下 8px</div>
<div class="pt-2 pb-4">  上 8px，下 16px</div>

<!-- margin（外邊距） -->
<div class="m-4">   四邊都有 16px margin</div>
<div class="mx-auto">  左右自動（水平置中）</div>
<div class="mt-8">  上方 32px</div>
```

### 尺寸：width / height

```html
<div class="w-full">     寬度 100%</div>
<div class="w-1/2">      寬度 50%</div>
<div class="w-64">       寬度 256px（64 × 4）</div>
<div class="max-w-2xl">  最大寬度 672px</div>
<div class="h-screen">   高度 100vh（滿版）</div>
<div class="h-16">       高度 64px</div>
```

### 顏色：text / background

Tailwind 顏色格式是 `顏色名稱-深淺`（深淺 50-950）：

```html
<p class="text-gray-900">深色文字（主內容）</p>
<p class="text-gray-500">中灰文字（說明文字）</p>
<p class="text-blue-600">藍色文字（連結）</p>

<div class="bg-white">白底</div>
<div class="bg-amber-50">淡橙底（LingoLeap 常用）</div>
<div class="bg-blue-500">藍底</div>
<div class="bg-red-100">淡紅底（錯誤提示）</div>
```

⚠️ 注意：**所有 `input`、`select`、`textarea` 都必須明確指定顏色**，否則在 Windows 暗黑模式下文字會變成透明。

```tsx
// 錯誤：沒有顏色 class
<input className="border rounded px-3 py-2" />

// 正確：明確指定文字色 + 背景色 + placeholder 色
<input
  className="border rounded px-3 py-2
             text-gray-900 bg-white placeholder-gray-400
             dark:text-gray-100 dark:bg-gray-800 dark:placeholder-gray-500"
/>
```

### Flex 排版

```html
<!-- 水平排列 -->
<div class="flex gap-4">
  <button>按鈕一</button>
  <button>按鈕二</button>
</div>

<!-- 垂直置中 + 兩端對齊 -->
<div class="flex items-center justify-between">
  <span>左邊</span>
  <span>右邊</span>
</div>

<!-- 垂直排列 + 置中 -->
<div class="flex flex-col items-center gap-2">
  <h1>標題</h1>
  <p>說明文字</p>
</div>
```

### Grid 排版

```html
<!-- 三欄 grid -->
<div class="grid grid-cols-3 gap-4">
  <div>卡片一</div>
  <div>卡片二</div>
  <div>卡片三</div>
</div>

<!-- 自適應欄數 -->
<div class="grid grid-cols-2 md:grid-cols-4 gap-4">
  <!-- 手機 2 欄，桌面 4 欄 -->
</div>
```

---

## 響應式：sm: md: lg:

Tailwind 的響應式是「手機優先」。沒有前綴 = 所有尺寸。加上前綴 = 該尺寸以上才套用。

```
sm:   640px 以上
md:   768px 以上
lg:   1024px 以上
xl:   1280px 以上
```

```html
<!-- 手機 1 欄，平板 2 欄，桌面 3 欄 -->
<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3">

<!-- 手機隱藏，桌面顯示 -->
<nav class="hidden lg:flex">

<!-- 手機全寬，桌面自動寬度 -->
<button class="w-full md:w-auto px-6 py-2">
```

---

## 互動狀態：hover: focus: active:

```html
<!-- hover 變色 -->
<button class="bg-blue-500 hover:bg-blue-600 text-white">
  懸停變深藍
</button>

<!-- focus 顯示邊框（輸入框） -->
<input class="border border-gray-300 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200" />

<!-- active（按下去的瞬間） -->
<button class="bg-blue-500 active:bg-blue-700">按我</button>

<!-- disabled -->
<button class="bg-gray-300 cursor-not-allowed" disabled>無法點擊</button>
```

---

## LingoLeap 範例：StepperNav 的 Tailwind 組合

打開 `frontend/src/components/StepperNav.tsx`，步驟圓圈的樣式大概長這樣：

```tsx
// 根據步驟狀態切換不同 class
const getStepClass = (stepView: AppView) => {
  if (stepView === currentView) {
    // 目前步驟：藍色填滿
    return 'bg-blue-500 text-white border-blue-500 font-bold';
  }
  if (isCompleted(stepView)) {
    // 已完成：綠色
    return 'bg-green-500 text-white border-green-500';
  }
  // 未完成：灰色空心
  return 'bg-white text-gray-400 border-gray-300';
};

return (
  <div
    className={`
      w-8 h-8 rounded-full border-2 flex items-center justify-center
      text-sm transition-colors duration-200
      ${getStepClass(step.view)}
    `}
  >
    {step.number}
  </div>
);
```

> 💡 提示：把動態 class 抽出成函式（像 `getStepClass`），讓 JSX 保持乾淨。不要在 JSX 裡寫一大堆三元運算子。

---

## 練習：用 Tailwind 重做一張學習卡片

**任務**：在 LingoLeap 任何一個頁面，找到一張「白底卡片」的 UI，用 Tailwind 重做它。

目標樣式（不用完全一樣，重點是練習 class 組合）：

```tsx
// 一張課文卡片，要包含：
// - 白底，有圓角，有陰影
// - 課文標題（大字，深色）
// - 課文說明（小字，灰色）
// - 右下角有一個「開始學習」按鈕（藍色，hover 變深）
// - 手機全寬，桌面最大 400px

const StoryCard = ({ title, description }: { title: string; description: string }) => {
  return (
    <div className="/* 你的 Tailwind class */">
      <h2 className="/* 標題樣式 */">{title}</h2>
      <p className="/* 說明樣式 */">{description}</p>
      <div className="flex justify-end mt-4">
        <button className="/* 按鈕樣式 */">
          開始學習
        </button>
      </div>
    </div>
  );
};
```

完成後截圖，和 LingoLeap 現有的卡片樣式比對，告訴 Young 你覺得哪裡還可以改進。
