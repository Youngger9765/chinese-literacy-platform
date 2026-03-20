# Tier 2：Bug 修復

每個開發者每天都在 debug。這不是能力不足的表現，這就是工作本身。能快速找到 bug 的人，才是真正有價值的工程師。

---

## Bug 修復的四個步驟

```
1. 重現 (Reproduce)  →  2. 定位 (Locate)  →  3. 修復 (Fix)  →  4. 驗證 (Verify)
```

這個順序很重要。很多人會直接跳到第三步「改程式碼」，但如果還沒確認能穩定重現，你根本不知道有沒有真的修好。

---

## 步驟一：重現 Bug

**目標**：找到「每次做 A → 就一定會發生 B」的步驟。

```
好的 bug 重現步驟：
1. 進入 VocabPractice，選課文「小木偶的故事」
2. 點「注音顯示」切換開關
3. 切換兩次以上
4. 生字卡的注音文字消失不見

不好的 bug 描述：
「注音有時候不顯示」
```

能穩定重現的 bug，才能驗證你的修復有沒有效。

> 💡 提示：先在瀏覽器手動重現，截個圖或錄個影，貼到 GitHub Issue。讓 Young 確認你重現的是同一個問題。

---

## 步驟二：用 Chrome DevTools 定位

按 `F12` 或 `Cmd+Option+I`（Mac）開啟 DevTools，這是你最重要的 debug 工具。

### Console Tab：看錯誤訊息

```
紅色錯誤 = 程式當掉了（最優先處理）
黃色警告 = 有問題但沒當掉
白色 log = 你自己加的 console.log
```

常見錯誤訊息：

```
TypeError: Cannot read properties of null (reading 'name')
→ 意思：你在 null 上讀取 .name，代表某個物件是 null 但你沒預期到

Cannot find module './api'
→ import 路徑錯了

Warning: Each child in a list should have a unique "key" prop.
→ 列表的 .map() 沒加 key
```

### Network Tab：看 API 請求

1. 點 Network tab
2. 重新操作觸發 bug 的步驟
3. 看有沒有失敗的請求（紅色 = 4xx/5xx 錯誤）
4. 點進去看 Request（你送了什麼）和 Response（後端回了什麼）

```
常見狀態碼：
200 = OK
400 = 你送的資料格式有問題（看 Response body 的錯誤訊息）
401 = 沒登入或 token 過期
404 = API endpoint 不存在（路徑打錯了）
422 = 資料驗證失敗（FastAPI 的 Pydantic 報錯）
500 = 後端程式錯誤（這個要去找後端 log）
```

### Elements Tab：看 DOM 結構

當你懷疑是 CSS 問題，點 Elements tab，找到那個元素，右側 Styles 面板會顯示套用的 CSS。可以直接在這裡修改數值預覽效果（不會儲存）。

---

## console.log 技法

`console.log` 是最簡單的 debug 工具，善用它：

```typescript
// 基本：印出值
console.log('session:', session);

// 同時印多個值
console.log('story:', story, 'step:', currentStep);

// 印物件（展開顯示）
console.log('vocab item:', { word, definition, index });

// 加上位置標記（方便知道是哪行印的）
console.log('[VocabPractice] handleFlip called, isFlipped:', isFlipped);

// 確認某段程式碼有沒有跑到
console.log('[ComprehensionChat] useEffect triggered, sessionId:', sessionId);
```

> 💡 提示：log 訊息加上元件名稱前綴（`[VocabPractice]`），在 Console 裡更容易搜尋。

⚠️ 注意：debug 完後要把 `console.log` 拿掉，不要 commit 進去。

---

## Breakpoint 除錯

比 `console.log` 更強大的方法：在程式執行到某一行時「暫停」，查看當下所有變數的值。

```typescript
// 方法一：在程式碼裡加 debugger
const handleSubmit = (text: string) => {
  debugger;  // 執行到這行會暫停，DevTools 自動開啟
  const result = processText(text);
  setResult(result);
};
```

```
方法二：在 DevTools Source Tab 直接點行號
1. 打開 DevTools → Sources tab
2. 找到你的檔案（可以用 Cmd+P 搜尋檔名）
3. 點行號左邊，會出現藍色箭頭（breakpoint）
4. 重新觸發 bug
5. 程式暫停在那行，右側可以看所有變數的值
```

暫停後的操作：
- `F10`：執行下一行（不進入函式）
- `F11`：進入函式內部
- `F8`：繼續執行直到下一個 breakpoint

---

## LingoLeap 案例：#216 IME 輸入 Bug

這是一個真實的 bug 修復案例，給你參考整個過程是怎麼進行的。

**Bug 描述**：學生用注音輸入法（或倉頡、嘸蝦米）在 ComprehensionChat 輸入框打字，按 Enter 會意外送出，而不是確認選字。

**重現步驟**：
1. 打開 ComprehensionChat
2. 輸入法切換到注音
3. 開始輸入「ㄊㄧ」（天的注音）
4. 在選字的下拉列表還開著的時候按 Enter
5. 本來應該確認選字「天」，結果變成送出訊息

**定位**：

```typescript
// 找到 ComprehensionChat 的 handleKeyDown
const handleKeyDown = (e: React.KeyboardEvent) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    handleSend();  // 按 Enter 就送出
  }
};
```

問題在這裡。輸入法選字過程中按 Enter，React 也收到了 `keydown` 事件，就去 `handleSend()` 了。

**修復**：

```typescript
// 加上 isComposing 判斷
const handleKeyDown = (e: React.KeyboardEvent) => {
  if (e.nativeEvent.isComposing) return;  // IME 選字中，不要處理
  if (e.key === 'Enter' && !e.shiftKey) {
    handleSend();
  }
};
```

`isComposing` 是瀏覽器 API，在 IME 輸入法「合成」字元的過程中是 `true`。

**驗證**：
1. 手動重現 bug → 確認已修好
2. 試一般 Enter（直接確認送出）→ 確認正常功能沒壞
3. 試 Shift+Enter（換行）→ 確認也沒受影響

---

## 練習

**任務**：找一個 bug-labeled 的 GitHub Issue，試著重現它

```bash
# 看現有的 bug issues
gh issue list --label bug
```

選一個你看得懂的 issue，按照以下格式回報：

```
1. 我重現了嗎？（是 / 否）
2. 重現步驟（一步一步列出來）
3. DevTools Console 有什麼錯誤訊息？（截圖）
4. Network Tab 有失敗的 API 請求嗎？（如果有，截圖）
5. 我猜問題在哪個檔案的哪個函式？
```

把這份報告留言在 Issue 下，然後告訴 Young。你不一定要能修好，但「能重現 + 能定位」就已經很有價值了。
