# E2E 測試指南（實習生版）

## 快速開始

### 1. 安裝依賴

```bash
cd frontend
npm install
npx playwright install chromium
```

### 2. 跑全部測試

```bash
npm run test:e2e
```

### 3. 跑單一模組

```bash
npm run test:e2e:m1   # M1: 教師驗證流程 (7 tests)
npm run test:e2e:m2   # M2: 教師班級管理 (17 tests)
npm run test:e2e:m3   # M3: 學生核心功能 (17 tests)
npm run test:e2e:m4   # M4: 系統管理員   (42 tests)
npm run test:e2e:m5   # M5: 非功能性測試 (4 active tests)
npm run test:e2e:m6   # M6: 六步驟學習   (19 tests)
```

### 4. 查看 HTML 測試報告

```bash
npm run test:e2e              # 跑測試（自動產生 playwright-report/）
npm run test:e2e:show-report  # 開啟瀏覽器查看 HTML 報告
```

報告包含：每個測試的截圖、失敗截圖、執行時間、錯誤訊息。

### 4. 用 UI 模式 debug（推薦！）

```bash
npm run test:e2e:ui
```

這會打開 Playwright 的互動 UI，可以看到每個 step 的截圖。

### 5. 用有頭瀏覽器跑（看到實際操作）

```bash
npm run test:e2e:headed
```

---

## 架構說明

### 模組化架構（m1-m6）

```
e2e/
├── auth.setup.ts          # 全局 setup — 登入 3 個角色，存 storageState
├── fixtures.ts            # 共用 helpers（takeScreenshot, withScreenshotOnFailure, ...）
├── m1-auth.spec.ts        # M1: 教師驗證流程（旅程 A）
├── m2-teacher.spec.ts     # M2: 教師班級管理（旅程 B~D）
├── m3-student.spec.ts     # M3: 學生核心功能（旅程 E, G）
├── m4-admin.spec.ts       # M4: 系統管理員（旅程 H）
├── m5-infra.spec.ts       # M5: 非功能性測試（N.1~N.10）
├── m6-learning.spec.ts    # M6: 六步驟學習流程（旅程 F）
├── screenshots/           # 里程碑截圖（按模組分類）
│   ├── teacher/           # teacher-* 截圖
│   ├── student/           # student-* 截圖
│   ├── admin/             # admin-* 截圖
│   └── infra/             # infra-* 截圖
└── .auth/                 # storageState 檔案（gitignored）
    ├── teacher.json
    ├── admin.json
    └── student.json
```

### 截圖策略

| 截圖類型 | 位置 | 說明 |
|---------|------|------|
| 里程碑截圖 | `e2e/screenshots/{module}/` | `takeScreenshot()` 手動呼叫 |
| 失敗截圖 | `test-results/failure-screenshots/` | `withScreenshotOnFailure()` 自動觸發 |
| Playwright 內建截圖 | `test-results/` | `screenshot: 'on'` 每個 test 後自動截圖 |

### 失敗自動截圖（withScreenshotOnFailure）

所有 m1-m6 測試都用 `withScreenshotOnFailure()` 包裝：

```ts
test('我的測試', withScreenshotOnFailure('my-test-fail', async ({ page }) => {
  // 如果這裡有錯誤，會自動截全頁截圖到 test-results/failure-screenshots/
}));
```

### Legacy 檔案（已停用，保留歷史）

```
auth-flow.spec.ts      # 登入/註冊/登出測試（不用 storageState）
├── teacher-flow.spec.ts   # 教師功能測試（用 teacher.json）
├── admin-flow.spec.ts     # 管理員功能測試（用 admin.json）
├── student-flow.spec.ts   # 學生功能測試（用 student.json）
├── .auth/                 # storageState 檔案（gitignored）
│   ├── teacher.json
│   ├── admin.json
│   └── student.json
└── E2E_TEST_STATUS.md     # 測試狀態記錄
```

### storageState 是什麼？

Playwright 的 storageState 會把 localStorage + cookies 存成 JSON。
`auth.setup.ts` 會先跑，登入 teacher/admin/student 各一次，
之後每個 test project 直接載入 JSON，**不需要重新登入**。

好處：
- 不會被 rate limit 擋（後端限制 10 login/min）
- 測試跑更快（省掉每次登入的 30 秒等待）

### 執行順序

```
auth.setup.ts  →  存 teacher.json, admin.json, student.json
     ↓
playwright.config.ts  →  各 project 用 dependencies 指定要等 setup 完成
     ↓
teacher-flow / admin-flow / student-flow  →  直接用 storageState（不重新登入）
auth-flow  →  自己處理登入（測試登入功能本身）
```

---

## 測試帳號

| 角色 | Email | 密碼 | 說明 |
|------|-------|------|------|
| Teacher | teacher@test.com | teacher1234 | staging DB 預設帳號 |
| Admin | admin@test.com | admin1234 | staging DB 預設帳號 |
| Student | 每次隨機產生 | Student1234! | setup 時自動註冊 |

---

## 常見問題

### Q: 測試跑失敗怎麼辦？

1. 先看錯誤訊息，通常是 timeout（元素找不到）
2. 用 `npm run test:e2e:headed` 看實際畫面
3. 用 `npm run test:e2e:ui` 看每步截圖
4. 看 `test-results/` 資料夾的 failure screenshot

### Q: 使用條款跳出來擋住了

所有 test 都應該用 `dismissAllModals(page)` 來關掉使用條款和新手引導。
如果你的新測試遇到 modal 擋住，在操作前加：

```ts
import { dismissAllModals } from './fixtures';
// ...
await page.waitForLoadState('networkidle');
await dismissAllModals(page);
```

### Q: Rate limit 被擋

- **不要**在每個 test 裡面都登入，用 storageState
- auth-flow.spec.ts 裡面的註冊測試會消耗 rate limit（5 reg/min）
- 如果被擋了，等 1 分鐘再跑

### Q: 怎麼跑特定的一個測試？

```bash
npx playwright test -g "測試名稱關鍵字"
# 例如：
npx playwright test -g "登入頁載入"
npx playwright test -g "3.6"
```

### Q: 怎麼針對不同環境跑？

```bash
# 預設跑 staging
npm run test:e2e

# 跑 PR preview
PLAYWRIGHT_BASE_URL=https://lingoleap-frontend-pr-123-xxx.run.app npm run test:e2e

# 跑 production
PLAYWRIGHT_BASE_URL=https://lingoleap-frontend-958347263320.asia-east1.run.app npm run test:e2e
```

---

## 寫新測試的模板

### 1. 有角色的頁面測試（推薦）

在對應的 `*-flow.spec.ts` 裡加 test：

```ts
test('X.Y - 功能描述', async ({ page }) => {
  await ensureAuthenticated(page);  // 確保已登入
  // 你的測試步驟...
  await expect(page.locator('text=期望的文字')).toBeVisible();
});
```

### 2. 需要處理 modal

```ts
test('X.Y - 功能描述', async ({ page }) => {
  await page.goto('/some-page');
  await page.waitForLoadState('networkidle');
  await dismissAllModals(page);  // 關掉所有 modal
  // 你的測試步驟...
});
```

### 3. 常用 locator

```ts
// 文字
page.locator('text=按鈕文字')

// 按鈕
page.locator('button:has-text("按鈕文字")')

// input by id
page.locator('#input-id')

// label
page.locator('label:has-text("標籤文字")')

// heading
page.locator('h1:has-text("標題")')

// 第一個符合的
page.locator('button:has-text("管理")').first()
```

### 4. 常用 assertion

```ts
await expect(locator).toBeVisible({ timeout: 15_000 });
await expect(locator).not.toBeVisible();
await expect(locator).toBeEnabled();
await expect(locator).toBeDisabled();
await expect(locator).toHaveValue('expected');
expect(page.url()).toContain('/path');
```

---

## 實習生任務

### 優先任務：補齊以下功能的 E2E 測試

1. **學習流程測試** — 6 步驟的基本 UI 測試（進入/離開/切換步驟）
2. **課文選擇測試** — 圖書館頁面選課文、搜尋
3. **教師儀表板深度測試** — 新增班級、編輯、刪除
4. **學生加入班級** — 輸入正確的 join code 成功加入

### 怎麼分工

每人負責一個 spec 檔案，在 PR 裡面提交：

```
靖杭：learning-flow 測試補齊
啟翔：story-selection 測試補齊
```

### PR 流程

1. 從 `staging` 建 feature branch：`git checkout -b feature/e2e-xxx staging`
2. 寫測試，本地跑通：`npm run test:e2e:headed`
3. Push + 開 PR to `staging`
4. PR preview 會自動部署，可以在 preview 上跑測試確認
