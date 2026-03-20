# Tier 1：HTML/CSS 基礎

網頁是由「結構（HTML）」和「樣式（CSS）」組成的。HTML 說「這裡有個標題」，CSS 說「標題要是藍色、字體大小 24px」。

---

## 瀏覽器怎麼渲染網頁

你在 Chrome 輸入 `lingoleap-dev.web.app`，瀏覽器做了什麼？

```
1. 下載 HTML 檔案
2. 解析 HTML → 建立 DOM Tree（元素樹）
3. 下載 CSS → 計算每個元素的樣式
4. 下載 JS → 執行、可能修改 DOM
5. 畫出來（Render）
```

**DOM Tree 長這樣**：
```
document
  └── html
        ├── head
        │     └── title ("LingoLeap")
        └── body
              ├── header
              │     └── nav (StepperNav)
              └── main
                    └── div (課文內容)
```

> 💡 提示：在 Chrome 按 F12 打開 DevTools，點「Elements」tab，就能看到這個 DOM Tree，還能即時改它。

---

## 語意標籤

HTML 有很多標籤，但要選「有意義」的，不要什麼都用 `<div>`。

```html
<!-- 不好的寫法：全部用 div，看不出結構 -->
<div>
  <div>LingoLeap</div>
  <div>步驟導航</div>
</div>
<div>
  <div>課文標題</div>
  <div>課文內容...</div>
</div>

<!-- 好的寫法：語意清楚 -->
<header>
  <h1>LingoLeap</h1>
  <nav>步驟導航</nav>
</header>
<main>
  <article>
    <h2>課文標題</h2>
    <section>課文內容...</section>
  </article>
</main>
```

| 標籤 | 用途 |
|------|------|
| `<header>` | 頁首區域 |
| `<nav>` | 導航選單（LingoLeap 的 StepperNav 就是 `<nav>`） |
| `<main>` | 頁面主要內容 |
| `<section>` | 一個主題區塊 |
| `<article>` | 可獨立的完整內容（一篇課文、一則訊息） |
| `<footer>` | 頁尾 |
| `<button>` | 按鈕（不要用 `<div>` 模擬按鈕！） |

⚠️ 注意：`<button>` 要用 `<button>`，因為它自帶鍵盤 focus、Enter 鍵觸發等無障礙功能。用 `<div onClick>` 會讓鍵盤用戶無法使用。

---

## CSS 選擇器

```css
/* class 選擇器（最常用） */
.step-circle {
  border-radius: 50%;
}

/* id 選擇器（每頁只用一次） */
#main-nav {
  position: sticky;
  top: 0;
}

/* 後代選擇器（空格） */
nav button {
  /* nav 裡面所有的 button */
  cursor: pointer;
}

/* 直接子元素（>） */
nav > button {
  /* nav 的直接子 button（不包含更深層的） */
}

/* 偽類 */
button:hover {
  background-color: #f3f4f6;
}

button:focus {
  outline: 2px solid blue;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
```

---

## Flexbox 完整教學

Flexbox 是最常用的排版方式。LingoLeap 的 StepperNav 就是用 Flexbox 把所有步驟按鈕排成一排。

看 `StepperNav.tsx` 裡的這段 class：

```tsx
// frontend/src/components/StepperNav.tsx
<nav className="flex items-center gap-1 text-sm font-medium">
```

對應的 CSS 概念：

```css
/* 主容器 */
.stepper-nav {
  display: flex;          /* 開啟 flexbox */
  align-items: center;    /* 垂直置中 */
  gap: 4px;               /* 子元素間距 */
}
```

**Flexbox 軸線圖**：

```
主軸 (main axis) ──────────────────────►
  [步驟1] [步驟2] [步驟3] [步驟4] [步驟5]
交叉軸
(cross axis)
↕
```

| 屬性 | 效果 |
|------|------|
| `justify-content: center` | 主軸方向置中 |
| `justify-content: space-between` | 主軸方向兩端對齊 |
| `align-items: center` | 交叉軸方向置中 |
| `flex-direction: column` | 改為垂直排列 |
| `flex-wrap: wrap` | 超出寬度時換行 |

**實際範例**：

```css
/* 把課文卡片排成三欄 */
.story-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
}

.story-card {
  flex: 1 1 300px;  /* 最小寬度 300px，會自動伸縮 */
}
```

---

## Grid 基礎

Grid 適合二維排版（同時控制行和欄）。

```css
/* 三欄等寬格線 */
.cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}

/* 響應式：小螢幕一欄，大螢幕三欄 */
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
}
```

> 💡 提示：不確定要用 Flex 還是 Grid？一維排列（一行或一欄）用 Flex，二維排列（同時有行和欄）用 Grid。

---

## 練習：用 DevTools 修改 LingoLeap 的配色

1. 打開 `https://lingoleap-dev.web.app`
2. 按 F12 打開 DevTools
3. 點 Elements tab，找到 StepperNav 的 nav 元素
4. 在右側 Styles 面板找到背景色
5. 點擊顏色方塊，改成不同顏色
6. 截圖（DevTools 裡的改動不會影響真實網站，重新整理就恢復）

試著改：
- 把「active」步驟的顏色從藍色改成綠色
- 把 header 的背景改成深色主題
- 找到一個 button，加上 `border: 2px solid red`
