# 一份多課：待處理清單（2026-08-27 逐條對現況重驗）

> 起因：明珠老師對講義時發現 G5-L17 其實是 L17+18、G6-L22 其實是 L22+23+24，
> 整課音檔把幾篇黏在一起。淑麗老師要求拆成獨立文件、不用 YouTube 整課／段落音檔。
> 全庫掃過之後是 **5 課**，不是 2 課。

> ⚠️ **這份文件本身過期得很快**。2026-08-27 逐條對現況重驗時，
> 8/25 那版的九項裡**六項已經不成立** —— 東西修掉了、檔案刪掉了、
> 或量測的方法本來就有問題。引用之前先自己驗一次，不要當現況權威。

## 五課的 yml 拆分（2026-08-27 對 prod API 實測）

拿 `repeat_rounds` 的 key 數與各篇課文字數比對，三篇內容互不相同才算拆開：

| 課 | 篇數 | 原稿 | 狀態 |
|---|---|---|---|
| L0029 | 2 | G5-L17-18 牧羊少年的逆轉勝 | ✅ 拆完 |
| L0063 | 3 | G6-L22-24 物以稀為貴 | ✅ 拆完（19 列帳本、每篇 5 個大題各自成檔）|
| L0111 | 2 | G8-L13-14 雨林裡的奇蹟藥物＋最後一隻旅人鴿 | ✅ 拆完 |
| L0137 | 2 | G9-L16-17 巨石陣＋摩艾石像 | ✅ 拆完 |
| L0144 | 3 | G9-L23 馬拉松王者 | 🟡 **課文拆完，缺兩個模組**（見下方第 1 項）|

---

## 🔴 還沒做的

### 1. L0144 缺「念順順」與「語詞我最棒」

課文本身**已經拆好**（8/25 那版寫「未拆」是過時的）。prod 實測三篇各自獨立：

```
wdnd7  1131 字  「你覺得100公尺跑17秒，這樣速度快不快？」
4ymn7   547 字  當代馬拉松名將基普喬吉，2019年「跑出歷史」…
dvxj6  1437 字  1936年美國選手歐文斯（J. Owens）在奧運…
```

三篇都有 `comprehension` / `full_text_annotate` / `keypoints` /
`story_structure_table` / `vocab_definitions` / `vocabulary`。

**缺的是** `key_reading`（念順順）與 `vocab_application`（語詞我最棒）—— 三篇都沒有。

### 2. prod 的朗讀音檔 bucket（2026-08-27 **未驗證**）

8/25 量到的是：

```
lingoleap-reading-audio-prod      0 個物件
lingoleap-reading-audio-staging   912 個物件
```

⚠️ 8/27 想複驗時 gcloud token 過期，`2>/dev/null | wc -l` 把 auth 錯誤吞成
一個看起來很有把握的 `0` —— **兩邊都回 0，而 staging 明明有 912 個**。
是正向對照（拿已知有 28391 個物件的 `lingoleap-tts-cache` 去問）才識破。

所以這一項的現況**不明**，要重新量。量之前先 `gcloud auth login`，
並且一定要帶正向對照 —— 否則 auth 失敗會偽裝成「bucket 是空的」。

兩個環境是**不同的 bucket**。若 prod 真的是空的，掃 QR 進去會沒有聲音；
合成只需做一次，另一邊 `gsutil cp` 複製即可。

### 3. 27 課的閱讀理解題在服務端是空的 → **現在剩 3 課**

**issue：#2922**（不關，但數字要更新）

2026-08-27 對 prod 全庫 175 課重量（帶正向對照：有題的課拿得到 5 題，證明查法有效）：

```
閱讀理解為空：3 課    有題：172 課
  20044  G5-L5
  20070  G6-L3
  20106  G7-L9
```

從 34 → 27 → **3**。歷次修復把絕大多數通了，剩這 3 課要個別看。

> 這個病的形狀是：`comprehension.yml` 內容 key 是 `items`，而 row 的
> `multiple_choice` 走 `_mcq_from()`，它期待另一種形狀 → 題目抽出來了、
> 門全綠、學生看不到。跟 #2683 那批（options 是 dict、欄名叫 videos）同族。

### 4. 文言文的 QR 掃進去是登入牆

**現況**：交付面沒有問題 —— 後台對 10 課文言文**兩種碼都不印**（實測 10/10），
所以老師手上不會有指向登入牆的紙。已由
`test_classical_lessons_print_no_codes_yet` 鎖住這個「不印」。

**但代號本身解得開**：`/q/jp6dx` → `/learn/20153/classical-text`。
2026-08-27 複驗（帶正向對照，確認 grep 抓得到 `PUBLIC_LEARNING_STEPS`）：

```
RouteGuards.tsx      classical        0 處
GuestReadingPage.tsx classical_text   0 處
```

兩件都還沒做：

- `classical-text` 不在 `PUBLIC_LEARNING_STEPS` 裡 → 訪客被導去 `/login`
- 文言文的課文在 `detail.classical_text`，不是 `detail.paragraphs`；
  `GuestReadingPage` 讀的是後者，所以就算放行也會是空白頁
- 那 8 課的朗讀計時 `key_reading` 在 API 是 `null`

**要做的話是兩件事一起**。只做前者會得到一個打得開的空白頁 ——
那比登入牆更糟，因為它看起來像成功。
`test_no_printed_code_points_at_a_page_a_guest_cannot_read` 會在順序做錯時變紅。

---

## ✅ 已解決（2026-08-27 逐條驗過後移除）

留下處置與驗法，方便日後回溯；不要再當待辦。

| 原第幾項 | 內容 | 驗法與結果 |
|---|---|---|
| L0144 未拆 | 課文要拆 3 份 | prod API：三篇課文 1131／547／1437 字且開頭互異 → **已拆** |
| 2 | L0029 孤兒檔 `comprehension.n3qxn.yml` 帳本沒有它的列 | `_manifest.yml:64` 與 `:76` 都有 `n3qxn` → **帳本已收錄** |
| 3 | 整課音檔黏在一起（`build_demo_reading.py::plan_demo_audio`）| 該檔在工作樹與 `origin/staging` 都不存在 → **整條管線已刪**（無消費端）|
| 5 | QR 把網域／路由名／流水號焊死在紙上 | 已改 `/q/<代號>` + 後端 307 轉址；入口走 `QR_ENTRY_ORIGIN` 不是 `window.location.origin`（`LessonAudioTable.tsx:349` 有註解寫明原因）→ **已修** |
| 6 | 後台音檔總表用 `lesson_number` 排序又當課號 | `LessonAudioTable.tsx:291` 已改 `lesson_seq ?? lesson_number`，`:87` 有註解 → **已修** |
| 7 | 前台完全沒驗過 | 2026-08-27 在 **production** 用真瀏覽器連按八步（不是打 `?p=` 直連）：第一篇五步走完才換第二篇、沒有中途跳報告頁、進度 key 帶篇次 7 個 → **已驗** |
