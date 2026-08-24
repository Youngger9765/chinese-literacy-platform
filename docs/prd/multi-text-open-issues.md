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
