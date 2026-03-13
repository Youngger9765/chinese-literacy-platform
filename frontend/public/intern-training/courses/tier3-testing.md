# Tier 3：測試

「我已經測試過了，沒問題。」這句話讓很多工程師出過事。手動測試只能保護「你當下測的那個路徑」，測試程式碼保護的是「未來每次有人改動程式碼時，確認你測過的路徑沒有被破壞」。

---

## 為什麼要寫測試？

不是因為你不信任自己，而是因為你無法預測未來。

假設你今天寫了 `calculateScore` 函式，它正常運作。三個月後，另一個實習生（或未來的你）在改別的功能，不小心改壞了 `calculateScore` 的邊界條件，但他不知道。

有測試的話：CI 跑測試 → 紅燈 → 知道出問題了。
沒測試的話：bug 上了 production → 500 個學生看到錯誤的分數。

> 💡 提示：測試是「寫給未來的自己的信」。現在多花 20 分鐘，未來省下 2 小時的 debug。

---

## 測試金字塔

```
          ╱ E2E 測試 ╲          ← 少，慢，貴
         ╱─────────────╲         （Playwright）
        ╱ 整合測試       ╲       ← 中，測元件互動
       ╱─────────────────╲
      ╱ 單元測試           ╲     ← 多，快，便宜
     ╱─────────────────────╲     （Vitest）
```

- **單元測試**：測一個函式或一個簡單元件。快，不需要瀏覽器。
- **整合測試**：測幾個元件組合在一起的行為。
- **E2E 測試**：用真正的瀏覽器，模擬完整的使用者流程。慢但最真實。

LingoLeap 用 **Vitest** 做單元測試，**Playwright** 做 E2E 測試。

---

## Vitest 基礎

```typescript
// frontend/src/utils/scoring.test.ts

import { describe, it, expect } from 'vitest';
import { calculateScore } from './scoring';

describe('calculateScore', () => {
  it('正確計算分數', () => {
    const result = calculateScore(10, 8);  // 10 題，答對 8 題
    expect(result).toBe(80);
  });

  it('全部答對回傳 100', () => {
    expect(calculateScore(5, 5)).toBe(100);
  });

  it('全部答錯回傳 0', () => {
    expect(calculateScore(10, 0)).toBe(0);
  });

  it('題目數為 0 時回傳 0（不能除以零）', () => {
    expect(calculateScore(0, 0)).toBe(0);
  });
});
```

執行測試：

```bash
cd frontend
npm run test           # 跑一次
npm run test -- --watch  # 監聽模式，改檔案自動重跑
```

### 常用的 expect 方法

```typescript
expect(result).toBe(80);              // 嚴格相等（===）
expect(result).toEqual({ score: 80 }); // 深度比較物件
expect(result).toBeNull();            // 是 null
expect(result).toBeTruthy();          // 是 truthy
expect(result).toContain('朗讀');     // 字串或陣列包含某值
expect(mockFn).toHaveBeenCalledWith('arg1'); // 函式被呼叫時傳入的參數
expect(fn).toThrow('error message');  // 函式會 throw 錯誤
```

---

## Mock：模擬外部依賴

測試時不能真的呼叫 API（慢、不穩定、需要網路）。用 `vi.fn()` 建立假函式。

```typescript
import { describe, it, expect, vi } from 'vitest';

describe('loadStory', () => {
  it('成功載入課文時更新 state', async () => {
    // 假的 fetchStory
    const mockFetchStory = vi.fn().mockResolvedValue({
      id: '1',
      title: '小木偶的故事',
      content: ['段落一', '段落二'],
    });

    // 用 mock 替換真實函式
    vi.mock('../../services/api', () => ({
      fetchStory: mockFetchStory,
    }));

    // 測試你的元件或邏輯
    const story = await loadStory('1');

    expect(mockFetchStory).toHaveBeenCalledWith('1');
    expect(story.title).toBe('小木偶的故事');
  });

  it('API 失敗時設定 error 狀態', async () => {
    const mockFetchStory = vi.fn().mockRejectedValue(new Error('Network error'));

    // 測試錯誤處理邏輯
    // ...
  });
});
```

---

## Given/When/Then 思維

這是寫測試前最好用的思考框架：

```
Given（前提）：系統在什麼狀態下
When（操作）：使用者（或程式）做了什麼
Then（結果）：預期結果是什麼
```

```typescript
// 用 Given/When/Then 結構化你的測試描述

it('Given 學生答對 8/10 題 When 計算分數 Then 回傳 80', () => {
  // Given：設定前提條件
  const totalQuestions = 10;
  const correctAnswers = 8;

  // When：執行要測試的動作
  const score = calculateScore(totalQuestions, correctAnswers);

  // Then：驗證結果
  expect(score).toBe(80);
});
```

---

## Playwright E2E 基礎

E2E 測試用真實瀏覽器跑完整流程。LingoLeap 的 E2E 測試在 `tests/e2e/`。

```typescript
// tests/e2e/vocab-practice.spec.ts
import { test, expect } from '@playwright/test';

test('學生可以完成生字練習', async ({ page }) => {
  // 前往頁面
  await page.goto('http://localhost:3000');

  // 選課文
  await page.click('[data-testid="story-card-1"]');
  await page.click('[data-testid="btn-start-learning"]');

  // 跳到生字練習步驟
  await page.click('[data-testid="step-vocab"]');

  // 確認生字卡顯示
  await expect(page.locator('[data-testid="vocab-card"]')).toBeVisible();

  // 點擊翻轉
  await page.click('[data-testid="vocab-card"]');

  // 確認答案顯示
  await expect(page.locator('[data-testid="vocab-definition"]')).toBeVisible();
});
```

```bash
# 執行 E2E 測試
npx playwright test

# 有 UI 的模式（看得到瀏覽器）
npx playwright test --ui
```

---

## 練習：為 LingoLeap 工具函式寫測試

**任務**：為以下三個函式各寫至少 3 個測試案例

```typescript
// frontend/src/utils/scoring.ts

// 函式一：計算分數
export function calculateScore(total: number, correct: number): number {
  if (total === 0) return 0;
  return Math.round((correct / total) * 100);
}

// 函式二：格式化時間（秒數 → mm:ss）
export function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

// 函式三：判斷是否通過（分數 >= 60）
export function isPassing(score: number): boolean {
  return score >= 60;
}
```

建立 `frontend/src/utils/scoring.test.ts`，至少涵蓋：
- 正常情況
- 邊界值（0、最大值）
- 異常情況（0 除以 0、負數）

```bash
# 跑你的測試確認都通過
npm run test -- scoring.test.ts
```

截圖測試全部通過的畫面給 Young。
