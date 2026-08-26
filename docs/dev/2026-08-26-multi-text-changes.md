# 給工程團隊：一課多篇改動說明（#2916 / #2930）

> 2026-08-26 已上 production。
> **開始寫 code 之前請先 `git pull`** —— 這次動到的東西很基礎，
> 用舊的分支繼續開發會一直撞到衝突，而且可能寫出跟新架構打架的邏輯。

```bash
git checkout staging && git pull
# 你自己的分支：
git checkout <你的分支> && git rebase staging
```

## 1. 這次改了什麼（一句話）

**一份學習單可能印了好幾篇課文。** 系統以前假設「一課 = 一篇」，現在不是了。

有五課是這樣（G5-L17、G6-L22、G8-L13、G9-L16、G9-L23），
其中 G6-L22 印了三篇。以前三篇的朗讀、題目、進度會混在一起或互相覆蓋。

## 2. 三個必須先懂的概念

### 2.1 slug 是身分，`text_ref` 是引用

每一份模組 yml 有**自己的** slug，寫在檔名裡：`key_reading.9a7x4.yml`。
需要用到某篇課文的節，用 `text_ref` 指向**那篇課文的** slug。

**課文那一節沒有 `text_ref`** —— 因為它就是被指的那個。
（這點踩過兩次：用「有沒有 text_ref」判斷是不是多篇，結果課文永遠判成單篇。）

### 2.2 帳本 `_manifest.yml` 是順序的唯一來源

三層**同名同形狀**，欄位一路原樣不改寫：

```
_manifest.yml  →  lesson["manifest_sections"]  →  row["manifest_sections"]
欄位：no / name / module / part / slug / file / text_ref / pages
```

⚠️ 統一名字時如果形狀不一致會**互相蓋掉**，而且不會報錯 ——
實際發生過，L0063 每一列的 `type`/`number` 全變 `None`，沒有任何徵兆。

### 2.3 取任何內容都要**連 slug 一起帶進去**

這是這次所有 bug 的同一個根：

| | 舊：`lesson_id` + 模組名 | 新：加上 slug |
|---|---|---|
| 定址到 | 整課頂層 ＝ **第 1 篇** | 指定的那一篇 |
| 單篇課 | 對 | 對 |
| 多篇課 | **靜默取到第 1 篇** | 對 |
| 壞掉的樣子 | 型別全對、每道格式門全綠、頁面正常，**只是內容是別篇** | — |

**判準**：看到 `lesson_id` 跟內容欄位出現在同一個取值式裡，
就要問一句「多篇課會拿到哪一篇？」

## 3. 對你寫 code 的具體影響

### 3.1 前端：不要自己拼 `/learn/...` 路徑

用 `src/config/stepPath.ts` 的 `stepPath(storyId, stepId)`。
它會把 `full-text-annotate#7wavn` 轉成 `/learn/20063/full-text-annotate?p=7wavn`。

自己拼會漏掉篇次，使用者點了會跳回第 1 篇。
有一條靜態鎖（`stepPathIsTheOnlyBuilder.test.ts`）會抓到自己拼的寫法。

### 3.2 前端：目前這一步是哪一篇，用 `useCurrentStepId`

```ts
const stepKey = useCurrentStepId('');        // → 'full-text-annotate#7wavn'
const slug = useCurrentSectionSlug();        // → '7wavn'（單篇課是 null）
```

⛔ **不要用 `currentView`** —— 那裡面只有路徑段，沒有篇次，
三篇同名的步驟會全部對到第一顆（active 圓圈、上一步／下一步都會錯）。

### 3.3 前端：頁面拿到的 story 已經切好篇了

`LearningLayout` 一處統一換（`storyForStep`），所有步驟頁吃 `selectedStory` 就對。
**不要在各步驟頁自己再換一次** —— 散在各頁換一定會有人漏掉，而漏掉看不出來。

⚠️ 例外：**訪客（掃 QR）走 `GuestReadingPage`，不經過 `LearningLayout`**。
改資料層的時候記得那條路是分開的。

### 3.4 前端：朗讀一定要帶篇次

```ts
speakText(text, lessonId, paragraphIdx, roundSlug)   // 第 4 個參數
```

少了它，後端會用 `lesson_id + 段落序號` 去對照表取句子 —— 那是第 1 篇的。
畫面第 3 篇、聲音第 1 篇，不會報錯。
靜態鎖 `everyLessonAddressedCallCarriesRound.test.ts` 會抓漏帶。

### 3.5 前端：QR 的網域用 `QR_ENTRY_ORIGIN`

⛔ **不要用 `window.location.origin`** ——
在 staging 產生的 QR 會指向測試站，印到紙上就收不回來了。

### 3.6 後端：模組名不一定等於 API 欄位名

例：模組叫 `vocab_application`，送到前端的欄位叫 `fill_in_blank` / `vocab_bank`。
組每一輪的資料時只覆蓋同名欄位的話，這一格會退回頂層（三篇共用一份）。
新增模組時請確認兩邊名字對得上，對不上就要在組裝時補。

## 4. 新增的鎖（請不要繞過）

12 條回測鎖，全部 mutation 驗過（把程式故意弄壞，確認測試會紅）。
其中 9 條已經 pin 進 `.github/workflows/frontend-checks.yml` 的具名清單。

**如果你的改動讓某條鎖變紅**，先想「是不是我把某一篇的資料弄丟了」，
再考慮改測試。⛔ 不要為了讓它綠而放寬斷言 —— 那些鎖每一條都對應一個真的壞過的情況。

**你自己新增回測鎖的話**，記得也 pin 進那份清單 ——
沒被執行的鎖等於沒有（那個檔的註解原話：an un-run lock is theatre）。

## 5. 想深入看

| 想知道 | 看哪裡 |
|---|---|
| 十個維度目前驗到哪 | `docs/prd/multi-text-fix-matrix.md`（**這份是活的，每修一格就更新它**） |
| 人工 QA 怎麼跑 | `docs/qa/2026-08-26-multi-text-manual-qa.md` |
| 還沒解決的 | `docs/prd/multi-text-open-issues.md` |
| 步驟設定的真相 | `frontend/src/config/stepConfig.ts` —— **讀每個 step 上方的決策註解**，那才是答案 |

## 6. 有問題怎麼問

回報時請寫三件事，少一項都很難查：

1. 哪一課、第幾篇、第幾步
2. 你預期看到什麼、實際是什麼
3. **網址列的完整網址**（含 `?p=` 那一段）—— 那一段是判斷篇次的關鍵
