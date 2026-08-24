# 一份多課：待處理清單（2026-08-25 滾動更新）

> 起因：明珠老師對講義時發現 G5-L17 其實是 L17+18、G6-L22 其實是 L22+23+24，
> 整課音檔把幾篇黏在一起。淑麗老師要求拆成獨立文件、不用 YouTube 整課／段落音檔。
> 全庫掃過之後是 **5 課**，不是 2 課。

## 五課的 yml 拆分

| 課 | 篇數 | 原稿 | 狀態 |
|---|---|---|---|
| L0029 | 2 | G5-L17-18 牧羊少年的逆轉勝 | ✅ 拆完（課文／念順順／語詞×2／重點整理／閱讀理解）|
| L0063 | 3 | G6-L22-24 物以稀為貴 | ✅ 拆完（19 列帳本、每篇 5 個大題各自成檔）|
| L0111 | 2 | G8-L13-14 雨林裡的奇蹟藥物＋最後一隻旅人鴿 | ✅ 拆完（課文／聚光燈）|
| L0137 | 2 | G9-L16-17 巨石陣＋摩艾石像 | ✅ 拆完（課文）|
| L0144 | 3 | G9-L23 馬拉松王者 | 🔴 **未拆** —— 課文／語詞我最棒／重點整理／閱讀理解各要 3 份 |

## 🔴 待處理

### 1. L0144 還沒拆
`full_text_annotate` / `vocab_definitions` / `keypoints` / `comprehension` 各要 3 份。
⚠️ 這課的 `multi_text_parts` 的 `part_no` 是 **None**，要先補篇次才能對到 slug。

### 2. L0029 有一個孤兒檔
`comprehension.n3qxn.yml`（篇2 的 2 題）在硬碟上但帳本沒有它的列 ——
那 2 題印在「◎請依據第二篇文章的內容，選出正確答案」底下，不是編號大題。
要決定：帳本加一列無編號的，還是併進篇2 的文章重點整理。

### 3. 整課音檔仍然是黏在一起的
`scripts/build_demo_reading.py::plan_demo_audio`：

```python
full_text = "\n".join(paragraphs)          # 整課所有段落黏成一條
passage_text = key_reading.get("passage")  # 單數，一課只取一個念順順
```

要改成**按篇（round）產**。
✅ 好消息：句子級 mp3 是用 `sha256(句子文字)` 定址的，拆課**不會讓任何既有音檔失效**，
只有「整課黏起來那一條」要重切，不需要重錄。

### 4. 🔴 prod 的朗讀音檔 bucket 是空的
```
lingoleap-reading-audio-prod      0 個物件
lingoleap-reading-audio-staging   912 個物件
lingoleap-tts-cache               28391 個物件（句子級，共用）
```
兩個環境是**不同的 bucket**。所以「QR 改指 prod」在音檔補上去之前，
掃進去會沒有聲音。合成只需做一次，另一邊用 `gsutil cp` 複製即可。

### 5. QR code 把三樣東西焊死在紙上
詳見 `docs/prd/qr-addressing-prd.md`。摘要：

| 焊進去的 | 後果 |
|---|---|
| `window.location.origin` | PM 在 staging 按下載 → **每一張 QR 都指向測試站** |
| `/learn/{id}/{step}` | step 名改過一次就靠別名撐著，再改紙本就廢 |
| `{id}` = 抽取流水號 20011 | 不是課碼 |
| 一課固定兩張 | 一課多篇時不夠用 |

owner 已定：入口用 `https://lingoleap-prod.web.app/...`，轉址做在後端。

### 6. 後台音檔總表排序／課號用錯欄位
`LessonAudioTable` 用 `lesson_number`（抽取流水號 20001–20175）排序又當課號顯示，
所以第一列是「十秒的背後 / L20001」，而圖書館第一課是「贏得喝采的輸家」。
要改用 `lesson_seq`，否則交給教材端的 Excel 課號跟老師手上的紙本對不起來。

### 7. 前台完全沒驗過
後端資料層驗得很細（帳本兩向對帳、逐字對回 DOCX、單篇對照），
但「學生打開 L0063 會看到三篇」**沒有任何證據**。frontend 的 node_modules 剛裝好，還沒跑起來。

---

## 8. 🔴 34 課的閱讀理解題在服務端是空的（既有缺陷，非本次造成）

2026-08-25 量測（帶正向對照：沒動過的 L0001 乾淨，所以量測有效）：

```
帳本說有這個大題、但服務端拿不到的：34 課
  其中 33 課本次 commit 只改了 _manifest.yml，一個內容檔都沒動
```

那 34 課的 `comprehension.yml` 都在硬碟上、都有 5 題，內容 key 是 **`items`**；
而 row 的 `multiple_choice` 走 `_mcq_from()`，它期待的是另一種形狀。
於是**題目抽出來了，學生看不到**——跟 #2683 那批（options 是 dict、
欄名叫 videos 不叫 items）是同一個病：來源全對、門全綠、東西到不了學生面前。

受影響的課（前 12）：L0055 L0056 L0076 L0077 L0078 L0079 L0080 L0081
L0097 L0098 …（完整清單重跑量測即可）

⛔ 沒有在 #2916 這一輪處理 —— 它跟一課多篇無關，範圍是另一件事。

## 9. 文言文的 QR 掃進去是登入牆（2026-08-25 抽樣走 QR 才看到）

**現況**：交付面沒有問題 —— 後台對 10 課文言文**兩種碼都不印**（實測 10/10），
所以老師手上不會有指向登入牆的紙。已由
`test_classical_lessons_print_no_codes_yet` 鎖住這個「不印」。

**但代號本身解得開**：`/q/jp6dx` → `/learn/20153/classical-text`，而

- `classical-text` 不在 `PUBLIC_LEARNING_STEPS` 裡 → 訪客被導去 `/login`
- 文言文的課文在 `detail.classical_text`，不是 `detail.paragraphs`；
  `GuestReadingPage` 讀的是後者，所以就算放行也會是空白頁
- 那 8 課的朗讀計時 `key_reading` 在 API 是 `null`（帳本有「朗讀計時」這一節，
  但沒有 passage 內容）

**要做的話是兩件事一起**：把 `classical-text` 加進訪客白名單 **並且** 讓
`GuestReadingPage` 認得 `classical_text` 的形狀。只做前者會得到一個
打得開的空白頁 —— 那比登入牆更糟，因為它看起來像成功。

**先不做的理由**：這是新功能，不在「把一課多篇做完並驗證」的範圍內。
放寬印製規則之前要先補這個，`test_no_printed_code_points_at_a_page_a_guest_cannot_read`
會在那個順序做錯時變紅。
