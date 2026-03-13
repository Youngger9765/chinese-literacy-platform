# Tier 1：讀懂現有程式碼

LingoLeap 已經有幾千行程式碼了。剛進來不可能馬上全懂，但有方法快速找到你需要的部分。

---

## 策略：從入口點開始

每個前端專案都有一個入口。LingoLeap 的入口是：

```
main.tsx               ← 最頂層，把 React app 掛到 HTML 的 #root
  └── App.tsx          ← 路由定義 + LearningSession 狀態
        ├── StepperNav ← 上方步驟導航
        ├── HomePage   ← 首頁（選課文）
        ├── Intro      ← 步驟 1：簡介
        ├── LiveTutor  ← 步驟 2：逐段朗讀
        ├── ComprehensionChat ← 步驟 3：課文理解
        ├── VocabPractice ← 步驟 4：生字練習
        ├── DictationPractice ← 步驟 5：聽寫練習
        ├── FullReading ← 步驟 6：全文朗讀
        └── AssessmentReport ← 步驟 7：報告
```

> 💡 提示：先看「大框架」，不要一開始就鑽進細節。先知道「這個元件在哪裡被使用」比「這個函式的每行在做什麼」更重要。

---

## VS Code 技巧

### Cmd+Click（Go to Definition）

看到一個函式或元件，按住 Cmd 再點擊，就能跳到它的定義。

例如在 `App.tsx` 看到 `<StepperNav ... />`，Cmd+Click `StepperNav` 就跳到 `StepperNav.tsx`。

### Cmd+Shift+F（全域搜尋）

在整個專案裡搜尋任何文字。

例如搜尋 `SessionExpiredError`，就能找到所有用到這個 class 的地方。

### Cmd+P（快速開啟檔案）

輸入部分檔名快速跳轉。輸入 `vocabprac` 就能找到 `VocabPractice.tsx`。

### Ctrl+`（開終端機）

在 VS Code 裡直接開終端機，不用切換視窗。

---

## 讀程式碼的順序

**先看 return 的 JSX，再看 state 和 hooks。**

```tsx
// 讀這個元件的順序：
// 1. 先看最下面的 return → 了解它「畫什麼」
// 2. 再看 props → 了解它「需要什麼輸入」
// 3. 最後看 state 和 hooks → 了解它「怎麼運作」

const StepCircle: React.FC<{
  step: number;    // ← Props（輸入）：步驟編號
  status: StepStatus;  // ← Props（輸入）：狀態
}> = ({ step, status }) => {
  // state 和邏輯在這裡...
  const styleMap = {
    disabled: 'bg-gray-200 text-gray-400',
    idle:     'bg-gray-200 text-gray-900',
    active:   'bg-accent text-white',
    completed: 'bg-emerald-500 text-white',
  };

  // return 的 JSX 告訴你這個元件「長什麼樣」
  return (
    <span className={`w-5 h-5 rounded-full ${styleMap[status]}`}>
      {status === 'completed' ? '✓' : step}
    </span>
  );
};
```

---

## 畫元件關係圖

新接觸一個功能區塊時，畫圖比讀程式碼更快理解。

**方法**：在筆記本（或 draw.io）畫：

```
App.tsx
  │ props: currentView, session, selectedStory, onNavigate
  ▼
StepperNav.tsx
  │ 用到: steps (靜態陣列), getStepStatus(), getMiniSummary()
  ├── StepCircle.tsx (子元件：步驟圓圈)
  └── DesktopActiveCircle.tsx (子元件：active 狀態圓圈)
```

---

## 實戰：追蹤 VocabPractice 從使用者點擊到 API 呼叫的完整流程

**目標**：找出「學生點擊某個生字 → 後端回傳注音資料」的完整路徑。

### 步驟一：從使用者行為出發

用戶看到生字練習頁面，點了一個字。在哪個元件處理這個點擊？

```bash
# 在 VS Code 用 Cmd+Shift+F 搜尋
VocabPractice
```

找到 `frontend/src/components/reading-steps/VocabPractice.tsx`，這是主要元件。

### 步驟二：找 onClick 處理

在 VocabPractice.tsx 裡搜尋 `onClick`，找到點擊生字的處理函式。

### 步驟三：找 API 呼叫

搜尋 `fetch` 或 `await`，找到呼叫後端的地方。通常是 `import ... from '../../services/api'`。

### 步驟四：在 api.ts 找對應函式

Cmd+Click 到 api.ts，看這個函式怎麼呼叫後端。

### 步驟五：在 Chrome DevTools 驗證

1. 打開 LingoLeap，進到生字練習頁面
2. F12 → Network tab
3. 點一個生字
4. 看 Network tab 出現了什麼請求，點擊看詳細內容

> 💡 提示：Network tab 是你最好的朋友。任何前後端溝通都能在這裡看到，包含請求內容、回應資料、狀態碼、花了多少時間。

---

## 練習

完成以下三件事：

1. **畫元件圖**：找出 `ComprehensionChat.tsx` 的 props 有哪些，畫出它和父元件的關係
2. **追蹤 API**：打開 LingoLeap，進到「課文理解」頁面，用 Network tab 找出第一個 AI 問題是由哪個 API 回傳的（看 Request URL）
3. **找定義**：在 `App.tsx` 裡，`LearningSession` 這個型別定義在哪個檔案？（Cmd+Click 找）

把三個問題的答案寫在你的筆記裡，下次跟 Young 對答案。
