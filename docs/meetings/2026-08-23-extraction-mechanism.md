# 現在的萃取機制：從一份 DOCX 到學生畫面

> 2026-08-23 · 給啟翔 @stgst、靖杭 @if-else-master
> 寫這份是因為抽取層 8/21 之後整個換過，**你們手上的 skill 現在住在新架構的哪一格、
> 以及要自己檢查什麼**，需要講清楚。
> 有任何一段跟你實際看到的不一樣，直接在 Slack 說 —— 那代表這份寫錯了。

> ### ⚠️ 先切 branch，不然下面每一條指令都會說檔案不存在
>
> 這份文件放在 `main`（所以連結穩定），但**抽取層的程式碼目前全在 `staging`**
> —— `main` 落後 105 個 commit，`scripts/` 底下那些工具在 `main` 上一個都沒有。
>
> ```bash
> git fetch origin && git checkout staging && git pull
> ```

---

## 一、為什麼要換：v2/v3 那次撞車

8/21 記錄裡那句「v2/v3 是你跟 Young 同時改撞出來的」，
根因不是誰不小心，是**當時沒有邊界** —— 朗讀的規格只有一份檔，
兩個人同時改就會變成兩份規格並存，然後要有人決定留哪份。

換架構的目的只有一個：**讓「內容規格」和「派工流程」變成兩個不會互相踩的東西。**

---

## 二、整條路：DOCX → yml → API → 學生畫面

```
① 原稿 DOCX（案主給的學習單）
      │   private/curriculum-source/_SOT/<年級>/<檔名>.docx
      ▼
② 轉 PDF（scripts/docx_to_pdf.sh）
      │   ⚠️ LibreOffice 排版不穩：同一份轉兩次可能 8 頁也可能 9 頁
      │   → 所以一輪只轉一次，全程共用同一份
      ▼
③ 判斷有哪幾個大題 + 各在第幾頁
      │   ③a LLM 看整張 → 回「有哪幾個大題」（不抽內容）
      │   ③b 腳本拿那些名字去 PDF 定位頁碼（決定性）
      ▼
④ 派工單 _manifest.yml
      │   backend/data/lessons/<UID>/v3/_manifest.yml
      │   sections: [{no: 二, name: 念順順, module: key_reading, pages: [2,3]}, ...]
      │   ⚠️ 衍生檔不是真相：name 來自 lesson.yml 的 sections_present，
      │      module 歸屬來自 specs/modules/section-to-module.yml，改了那兩者要重產
      ▼
⑤ 派工前對帳（assert_pdf_matches_manifest.py）
      │   手上這份 PDF == 算頁碼那份嗎？比每頁文字指紋，不只比頁數
      │   ⛔ 對不上就不派工（頁碼會整體位移，而抽取器讀到一半仍會回報成功）
      ▼
⑥ 扇出：一個大題 = 一支 skill = 一份 yml
      │   extract-keypoints  → keypoints.yml
      │   extract-spotlight  → spotlight.yml
      │   extract-key-reading→ key_reading.yml
      │   （共 23 種模組，一對一）
      ▼
⑦ 五道驗證門
      │   ⑦a 形狀    schema（specs/modules/schemas/<mod>.schema.json）
      │   ⑦b 逐字    抽出來的字跟原稿一字不差嗎
      │   ⑦c 著落    學習單印的大題，每一個都有對應 yml 嗎
      │   ⑦d 涵蓋率  原稿有多少字沒被任何 yml 收走（偵測器，不是判準）
      │   ⑦e 必要欄位 這個模組少了哪一欄就等於沒做
      ▼
⑧ yml → API
      │   lesson_uid_loader.py  把 <UID>/v3/*.yml 讀成一個 lesson dict
      │   lesson_indexes.py     轉成前端要的舊形狀
      │       vocab_application → fill_in_blank + vocab_bank
      │       comprehension     → multiple_choice
      │       spotlight         → spotlight_v2
      ▼
⑨ API → 前端
      │   frontend/src/services/api.ts  對映成 camelCase
      │   stepConfig.ts                 決定這課有哪幾關、順序
      ▼
⑩ 學生畫面
```

### 🔴 第 ⑧ 步是最容易出事的一段，而且沒有門在守

⑦ 那五道門全部在問「**抽出來的東西對不對**」。
它們**不問**「這些東西到得了學生面前嗎」。

實際踩過兩次（都是這一段）：

- 子練習（◎牛刀小試 / ◎詞義辨識）抽對了、存在 yml 裡，
  但 `lesson_indexes` 只讀頂層 `items`，**三課的題目從來沒送到學生面前**
- `key_reading` 少了 `passage` 時，loader 會 `lesson.pop("key_reading")` ——
  **整個模組被丟掉，學生那一關直接不見**，而八道門全綠

⇒ **改完 yml 一定要真的登入看一次**，不能只看門綠。

---

## 三、邊界：誰擁有什麼

| | 擁有 | 檔案 |
|---|---|---|
| **靖杭** | 朗讀的內容規格 | `.claude/skills/lesson-reading-pipeline/SKILL.md`（318 行）|
| **啟翔** | 重點表、聚光燈的內容規格 | `.claude/skills/build-keypoints/`（241 行）· `build-spotlight/`（174 行）|
| **Young** | 派工層 | `extract-*` 轉接 · `_manifest.yml` · ⑤⑦ 那些門 |

### 三支 `extract-*` 是**薄轉接**，不是第二份規格

```
extract-key-reading (89 行) ──→ lesson-reading-pipeline   ← 真規格在這
extract-keypoints   (85 行) ──→ build-keypoints
extract-spotlight   (85 行) ──→ build-spotlight
```

轉接裡**沒有任何內容規格**，只有兩件事：指到真規格 + 補派工層的介面契約
（只讀派工單那幾頁 / 先過 PDF 對帳 / schema 自驗 / 判不出來標 needs_review）。

**這就是防撞機制**：Young 改派工層碰不到你們的檔，你們改內容規格碰不到派工層。

而且有鎖擋著（`backend/tests/test_every_module_has_a_skill_2843.py`，共 9 條，其中兩條顧這件事）：

- 轉接**超過 90 行就紅** —— 逼它不能把內容抄過去變成第二份規格
- 轉接**指到已停用的規格就紅** —— `build-key-reading` 現在整份是停用說明，
  而它明文寫的規則正是 #2712（朗讀範圍比教授畫的多一倍）的成因。
  指到一份停用的規格比沒有轉接更糟：名字解得到，內容是有害的。

### 什麼時候要先講一聲

**只有一種**：要改「這個模組的欄位形狀」（新增/改名/刪欄位）。
那會同時動到 `schema` + `essential-fields.yml` + `lesson_indexes` 的消費端。

其餘（改判斷規則、補版面辨識、寫踩坑紀錄）**不用等任何人**，直接改。

---

## 四、請你們各自檢查的事

### 共同：先跑一次，看你那塊現在什麼狀態

```bash
# 你的模組現在跟原稿逐字一致嗎（全庫）
python3 scripts/skill_dryrun_diff.py --module keypoints      # 啟翔
python3 scripts/skill_dryrun_diff.py --module spotlight      # 啟翔
python3 scripts/skill_dryrun_diff.py --module key_reading    # 靖杭

# 必要欄位有沒有缺
python3 scripts/essential_fields_check.py

# 你那塊的形狀有多穩（N=175，不是跑三次）
python3 scripts/shape_stability_report.py
```

現況（2026-08-23 實測）：

```
keypoints    150 課 · 逐字一致 150 · 對不上 0 · 受檢 2125 字串
spotlight    168 課 · 逐字一致 168 · 對不上 0 · 受檢 8877 字串
key_reading  157 課 · 逐字一致 157 · 對不上 0 · 受檢 1517 字串
```

⚠️ **全綠不代表 skill 是對的。** 這支比的是「**現有 yml** 跟原稿一不一致」，
而現有 yml 是二修時用舊的整包抽取器產的 —— 綠的是資料，不是你的 skill。
真正要驗 skill，要拿一課**照 skill 重抽一份**再比（見下）。

### 靖杭：朗讀

1. **`lesson-reading-pipeline` 描述的做法，跟現在真的在跑的一樣嗎**
   （8/21 之後有沒有哪段已經被改掉、規格還停在舊的）
2. **`passage` 是這個模組的命門** —— 少了它 loader 會丟掉整個模組，
   學生那一關直接不見，而八道門全綠。已經寫進 `essential-fields.yml`，
   但請你確認判準對不對（例外那 10 課是刻意不給，還是抽漏？）
3. `extract-key-reading` 那份轉接（89 行）有沒有寫錯你的東西 —— 有錯直接改
4. 手上那幾張（`#2805` `#2803` `#2743` `#2720`）跟新機制有沒有衝突

### 啟翔：重點表 + 聚光燈

1. **`#2859`（`ai-lesson-extract` 被繞過了，哪些還有效）現在可以回答了**：
   `ai-lesson-extract` 是舊的整包抽取器路線，新架構是**一個模組一支 skill**。
   `build-keypoints` / `build-spotlight` 這兩份**還有效**，而且是真規格；
   `extract-keypoints` / `extract-spotlight` 只是指過去的轉接。
2. **`build-keypoints` / `build-spotlight` 寫的做法跟現在跑的一樣嗎**
3. 聚光燈那張根因票（抽取錯 vs render 錯）—— 現在有工具可以分：
   `skill_dryrun_diff` 綠 = 抽取沒問題 → 那就是 ⑧ 或 ⑨ 那段（render/對映）
4. 重點表驗證器 `#2716` 的白名單，跟 `essential-fields.yml` 的 `except`
   是同一件事的兩種寫法 —— 看要不要合併，或至少不要互相打架

---

## 五、後面的操作：怎麼跑一課

```bash
# 1. 派工（會自己重算頁碼，② 不穩就靠這個收斂）
python3 scripts/run_extraction_pipeline.py plan --uid L0011 --refresh-pages
#    → 印出「哪幾架飛機讀哪幾頁」+ 一個 PDF 路徑
#    ⚠️ 把那份 PDF 釘住，後面全程只用它

# 2. 照 extract-<module> skill 逐架抽，產出放同一個目錄

# 3. 收（schema + 必要欄位 + 見證對帳，逐個模組）
python3 scripts/run_extraction_pipeline.py verify --uid L0011 --out <產出目錄>
```

### 看懂 verify 的三個燈

```
✅  過
🟡  驗不了   這道門在這一頁上沒有判斷力（多半是 pdftotext 還原不出版面順序）
🔴  對不上   真的有問題
```

⚠️ **🟡 不是壞掉。** 10 課實跑時有 4 課出現紅燈，逐一查 exit code 才發現
四個都是「驗不了」不是「對不上」—— 已經改成三態了，但看的時候還是要分清楚。

### 逐字要回 DOCX 取，不要讀 `pdftotext -layout`

第一次真的用 skill 抽一課（L0011 語詞我最棒）時掉了一個頓號：

```
我抽出來   形容眼睛盯著非常專心的樣子。
原稿       形容眼睛盯著、非常專心的樣子。
```

`-layout` 為了排版把那格折成兩行，**折點正好在標點上**，接起來標點就沒了。
⛔ 讀起來完全通順、schema 過、題數也對 —— **沒有任何症狀**。

⇒ `-layout` 只拿來**認版面**（哪一題在哪、雙欄怎麼分），
逐字內容一律回 DOCX 的 `<w:t>` 流取：

```bash
python3 -c "
import importlib.util
sp=importlib.util.spec_from_file_location('dw','scripts/docx_witnesses.py')
dw=importlib.util.module_from_spec(sp); sp.loader.exec_module(dw)
for t in dw.docx_paragraphs('<原稿.docx>'):
    if '<關鍵字>' in t: print(repr(t))"
```

---

## 六、有兩個共識沿用 8/21 的，這裡再寫一次

**一、撞到不用不好意思講。** 並行開發本來就會撞，這是選擇不是意外。
重點是撞完之後選一條「下次不會用同樣理由再撞」的路 ——
這次選的是把邊界做成物理的（薄轉接 + 兩條鎖），不是靠大家記得。

**二、少用 sub agent，token 約 5 倍。** 最多同時 3 個、開了就不要關、
當常駐 worker 用（餵 3 課 → idle → 10 分鐘回來檢查 → 再餵 3 課）。

---

## 附：這份的證據

文中所有數字都是 2026-08-23 實際跑出來的，不是估的：

| 說法 | 怎麼驗 |
|---|---|
| 三個模組逐字一致 150/168/157 | `scripts/skill_dryrun_diff.py --module <mod>` |
| 必要欄位 1696 實例 PASS | `scripts/essential_fields_check.py` |
| 核心欄位一致率 91~100% | `scripts/shape_stability_report.py` |
| 大題著落 1467/1467 | `scripts/section_completeness_gate.py` |
| 逐字忠實度 174 課 · 0 失敗 | `scripts/content_fidelity_attest.py --verify-all` |
| 轉接 ≤90 行、不准指到停用規格 | `backend/tests/test_every_module_has_a_skill_2843.py` |
