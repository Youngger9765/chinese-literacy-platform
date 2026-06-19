---
name: ui-pr-verify
description: UI PR 驗證 SOP — frontend *.tsx 改動前後的完整驗證流程。改完 tsx 要宣稱完成前必走此流程。
---

# UI PR Verify — Frontend *.tsx Change Verification SOP

## When to use

改動任何 `frontend/*.tsx` 檔案後，在宣稱「完成 / verified / 測試通過」前必走此 SOP。

背景：#2279 postmortem — 只讀 code、只跑 build 都抓不到 TDZ ReferenceError。

## Step 1: ESLint (靜態，~2 秒)

```bash
cd frontend && npm run lint
```

- 0 errors → 繼續
- 有 `no-use-before-define` errors → const 宣告順序錯，可能是 TDZ — 修掉再繼續
- 有 `react-hooks/rules-of-hooks` errors → hooks 在 condition/early-return 之後 — 修掉

**不要加 `eslint-disable`** 到新寫的程式碼（只有 pre-existing patterns 才有 disable 註解）。

## Step 2: vitest render-smoke (~15 秒)

```bash
cd frontend && npm run test -- src/__smoke__/ --reporter=verbose 2>&1 | tail -20
```

- 13/13 pass → 繼續
- Any TDZ failure → 找 mount crash root cause，修掉再跑

也可以跑完整 test suite 確認沒有 regression：
```bash
cd frontend && npm run test 2>&1 | tail -10
```

## Step 3: /qa on affected page

針對你改動的 page/component：

```
goto <preview-url>/login
# 用學生小明登入（懶人登入按鈕）
goto <preview-url>/learn/<story-id>/<affected-step>
# 檢查 console
console --errors
```

- console errors = 0 → 繼續
- 有 error → 找 root cause，修掉

## Evidence 格式

在 PR description 或 issue comment 貼：

```
### Frontend Render-Safety Verification (#2289 net)
- ESLint: ✅ 0 errors (`npm run lint`)
- vitest smoke: ✅ 13/13 pass (`npm run test -- src/__smoke__/`)
- Page console: ✅ 0 errors on [affected page at preview URL]
- Screenshot: [attached]
```

## 禁止的 "verified" 聲明

- ❌ 「code 看起來沒問題」
- ❌ 「build 過了所以 OK」
- ❌ 「tsc 沒報錯」（tsc 抓不到 runtime TDZ）
- ✅ 只有跑完以上三步且有輸出才能說 verified

## 快速 cheatsheet

```bash
# 完整驗證三步
cd frontend
npm run lint                        # Step 1: 0 errors
npm run test -- src/__smoke__/      # Step 2: 13 pass
# Step 3: /qa + console check on preview URL
```
