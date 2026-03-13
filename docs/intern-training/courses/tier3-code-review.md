# Tier 3：Code Review

Code Review 是工程團隊最重要的學習機會之一。不是找 bug，不是互相批評，而是透過看別人的程式碼和被別人看，讓整個團隊共同進步。

---

## 為什麼要做 Code Review？

**對被 review 的人**：有人幫你抓漏洞，比上線後才發現問題好太多。

**對 reviewer**：讀別人的程式碼讓你看到「別人怎麼解決同一個問題」，這是學習最快的方法。

**對整個團隊**：讓所有人都了解程式碼的走向，降低「只有某一個人懂這段」的風險。

> 💡 提示：當 Young review 你的 PR 並指出問題時，不是在說你不好，是在幫你變更好。這個投資會在你未來省下很多 debug 的時間。

---

## Review 時要看什麼

### 一、邏輯正確性

這段程式碼真的能解決問題嗎？有沒有遺漏的邊界情況？

```typescript
// PR 裡的程式碼
function getScore(answers: boolean[]): number {
  const correct = answers.filter(a => a).length;
  return correct / answers.length * 100;
}

// Review 發現的問題：如果 answers 是空陣列，會 NaN（除以 0）
// 應該要加邊界條件處理：
function getScore(answers: boolean[]): number {
  if (answers.length === 0) return 0;
  const correct = answers.filter(a => a).length;
  return Math.round(correct / answers.length * 100);
}
```

### 二、可讀性

三個月後，陌生人（可能是未來的你）能看懂這段程式碼嗎？

```typescript
// 可讀性差：變數名稱沒意義，邏輯複雜
const r = d.filter(x => x.s > 60).map(x => ({ ...x, p: true }));

// 可讀性好
const passingStudents = students
  .filter(student => student.score > 60)
  .map(student => ({ ...student, isPassing: true }));
```

### 三、效能問題

有沒有不必要的重複計算、大量的 re-render、沒有分頁的大量資料請求？

```typescript
// 問題：每次渲染都重新建立這個大陣列
const allSteps = steps.flatMap(s => s.subSteps).filter(s => s.isActive);

// 改善：用 useMemo
const allSteps = useMemo(
  () => steps.flatMap(s => s.subSteps).filter(s => s.isActive),
  [steps]
);
```

### 四、安全性

有沒有把敏感資料（token、密碼）印到 console？有沒有把用戶輸入直接塞進 SQL 或 HTML（XSS 風險）？

```typescript
// 有問題：把 token 印出來
console.log('使用者資料:', { userId, token, password });

// 安全做法：只印必要資訊
console.log('使用者登入成功:', { userId, role });
```

### 五、命名

變數、函式、元件的名稱有沒有清楚表達它做什麼？

```typescript
// 不好：名稱模糊
const data = await fetch('/api/stories');
const x = (a: number) => a > 60;
const Comp = () => <div>...</div>;

// 好：名稱有意義
const storiesResponse = await fetch('/api/stories');
const isPassing = (score: number) => score > 60;
const StoryCard = () => <div>...</div>;
```

---

## 怎麼給 Review 意見

Review 意見要讓對方「知道怎麼改」，而不只是「你這裡寫錯了」。

### 有問題 + 說明 + 給建議

```
// 不好的 review 意見：
"這樣寫不對"

// 好的 review 意見：
"這裡 `answers.length` 可能是 0，會造成除以零的問題（回傳 NaN）。
建議在開頭加判斷：
```
if (answers.length === 0) return 0;
```
"
```

### 區分「必要」和「建議」

```
// 必要改動（邏輯錯誤、安全問題）
"[必改] 這裡有除以零的風險，請加上邊界條件判斷。"

// 可選建議（可讀性、風格）
"[建議] 這個變數名 `d` 可以改得更有意義，像是 `storyData`？但如果你覺得這個範圍很小、清楚，也可以不改。"
```

> 💡 提示：不要每個小問題都用強硬的語氣說「你必須改」。區分必要和建議，讓對方知道哪些是真正影響功能的問題。

### 給具體的程式碼範例

光說「這樣寫不好」沒用。你能做到的話，直接在 review 裡寫出你覺得更好的寫法。

---

## 怎麼接收 Review 意見

### 不要防衛

收到 review 意見的第一個反應很容易是「但我這樣寫是有原因的...」。先深呼吸，想想對方的建議有沒有道理，再回應。

```
// 不好的回應：
"我就是要這樣寫，這是我的風格。"

// 好的回應（不同意時）：
"我這樣寫是因為 A 原因，你覺得這樣會有什麼問題嗎？"

// 好的回應（同意時）：
"了解，我來改一下。謝謝指出！"
```

### 不懂就問

如果看不懂 reviewer 在說什麼，就直接問：「你說的 `useMemo` 要加在哪裡？可以給個例子嗎？」

---

## 練習：Review 一個真實的 PR

**任務**：找一個 LingoLeap 已合併的 PR，進行事後 review 練習

```bash
# 看最近合併的 PR
gh pr list --state merged --limit 10
```

選一個你看得懂的 PR（建議選前端改動），用以下格式寫 review 報告：

```markdown
## PR Review 練習報告

**PR 編號**：#XXX
**PR 標題**：...

### 我注意到的問題

1. **邏輯問題**（如果有）：
   - 在 `xxx.tsx` 第 N 行，...

2. **可讀性改善**（如果有）：
   - 變數名 `x` 可以改成 `...`

3. **我學到的寫法**：
   - reviewer 用了 `useMemo` 在 X 地方，我之前沒想到這樣用...

### 我覺得寫得很好的地方

- ...
```

寫完後給 Young 看，他會給你回饋。
