---
name: extract-lesson-multimodal
description: 用 LLM 多模態逐頁讀 PDF 抽取一課學習單的全部內容（課文/語詞/重點表/聚光燈/閱讀理解/朗讀範圍），取代讀不到圖形層與文字方塊的 regex/XML 抽取器。總表欄位走決定性讀取、DOCX XML 降級為逐字校對。當需要「多模態抽取」「LLM 讀 PDF 抽教材」「建真值」「重抽某課」「truth yml」「抽取比對」「量抽取正確率」時使用。來源 issue #2736。
---

# extract-lesson-multimodal — LLM 讀 PDF 抽一課

## 為什麼不用舊管線

實測 L0072：9 個大題只有 **2 個**可用（見 `docs/prd/2026-08-17-multimodal-extraction.md`）。
缺掉的 34 個細項在 DOCX 裡 100% 都有 —— 不是教材沒寫，是管線讀不到。

讀不到的原因是**內容有五種載體**，舊管線只讀得到一種半：

| 載體 | 舊管線 | 全庫實測 |
|---|---|---|
| 總表 xlsx | 有讀 | — |
| DOCX 文字流 | 讀，但**漏文字方塊** | 175/175 課有文字方塊，中位 64 個/課 |
| DOCX 圖形層（橘圈、手繪連線、疊印） | **讀不到** | 見下方「☑ 其實在文字層」 |
| DOCX 版面關係（☞ 錨點、印刷段號） | 誤當索引 | #2720 |
| 系統合成（intro） | 拼總表 | 短版 68 課 ⟺ 總表議題欄空 68 課 |

### 🔴 ☑ 其實在文字層，只是不是 `☑` 這個字元

grep `☑` 全庫回 **0**。不是因為勾選不在文字層，是因為它編碼成

```xml
<w:sym w:font="Wingdings" w:char="F0FE"/>
```

沒有 `w:t`，所以任何純文字抽取（含 `python-docx` 的 `.text`）都看不到它。
**全庫 175 份原稿：157 份用 `w:sym F0FE`（共 1807 個），字面 `☑` 0 份。**

→ 找勾選一律 `grep 'w:char="F0FE"'` **搭配**讀圖，兩邊互為對照：

- **XML 補圖的洞**：LibreOffice 會把某些表格疊印壓掉，那幾格在 PDF 上完全看不到勾
  （L0061 有 6 個 F0FE 是這樣救回來的）
- **圖補 XML 的洞**：橘色圈選、手繪連線、答案是「圈住第幾個」這種位置資訊，
  文字層沒有

⚠️ 這條 2026-08-18 才寫進來（ex-f 在 L0061 發現）。在此之前的敘述是
「☑ 只有看圖才拿得到」，那句話錯在**量錯了東西**——量的是字面字元不是編碼。
前 61 課回頭篩檢過（每課 F0FE 數 vs yml 答案數），沒有大規模漏勾。

### 答案有三種載體，三種都要查

| 載體 | 長什麼樣 | 誰讀得到 |
|---|---|---|
| ☑ 勾選 | `<w:sym w:font="Wingdings" w:char="F0FE"/>` | 查 XML（純文字抽取讀不到，見上）|
| 找字圈選 | `roundRect` 圖形（先扣掉錨在紙外的）| 讀圖為主、幾何交叉驗證 |
| **框選語詞** | **`<w:bdr>` 非 auto 顏色的字元框線** | **兩種做法都讀不到** |

第三種是 2026-08-18 在 L0070 發現的：「請圈出各選項表達情感的關鍵詞」的答案，
是三個 run 上的 `<w:bdr w:color="E97132" w:sz="18"/>`（得意／思念／後悔，
沒框的那個就不是答案）。**它不是字元、不是 `w:sym`、也不是圖形** ——
純文字抽取看不到，數圈圈也數不到。

⛔ **不要再加形狀啟發式**（長度門檻、前綴比對、「沒有框的是答案」）。
「沒有框的是答案」之所以曾經有效，是因為被勾中的 `□` 被圖形取代而從文字流消失 ——
那是製作習慣，不是規則。#2555 動了框正規化，312 題答案就跟著變（#2735）。

---

## 流程

```
① 定位來源      lesson.yml 的 source.drive_path → private/curriculum-source/_SOT/<path>
② DOCX → PDF    soffice --headless --convert-to pdf
③ 抽 XML        unzip word/document.xml（校對用，不是主抽取）
④ 逐頁讀 PDF    Read(pages) 全頁不抽樣 ← 主抽取
⑤ 讀總表        自學教材總表0812.xlsx 對應列（決定性，不經 LLM）
⑥ 產 truth.yml
⑦ 三道格式門
⑧ 對照現行產物產 diff.md
```

### ① 定位來源

```bash
UID=L0072                      # lesson_uid
cat backend/data/lessons/$UID/v2/lesson.yml          # 取 source.drive_path
SOT=private/curriculum-source/_SOT
```

SOT 的來源與同步方式見 `$SOT/STAMP.md`。**不要用 archive 裡的一修或 7/21 舊快照。**

### ② ③ 轉檔

```bash
W=<scratchpad>/$UID
mkdir -p $W && cp "$SOT/<drive_path>" $W/src.docx

# ⚠️ **一定要走這支腳本**，不要自己敲 soffice。
#    LibreOffice 預設所有 headless 轉檔共用同一個 user profile 並對它上鎖；
#    第二個進來不報錯、不退出，就掛在那裡等 —— 平行抽取必然全體卡死。
#    實測（三個同時轉）：裸 soffice → **0 個 PDF**、兩個逾時；這支 → 3/3、2.9 秒。
#    腳本內含：樣板 profile（建一次，之後複製，省掉每次 4 分鐘的 bootstrap）、
#    過期殭屍清理、timeout、產出與頁數檢查（0 頁也算失敗）。
scripts/docx_to_pdf.sh $W/src.docx $W $UID     # 印出 `<pdf路徑> pages=N`

cd $W && unzip -o -q src.docx word/document.xml
```

### ④ 逐頁讀 PDF ← 主抽取

用 `Read` 工具帶 `pages`（單次上限 20 頁，教材多為 6~12 頁）。

**鐵律**：
- **每一頁都要讀**，不抽樣。頁數要在報告裡寫成 `9/9`
- 紅色 `☑`／橘色圈選／框線 **就是教師版答案**，這是多模態存在的理由，逐一記下
- 看到的是**印出來的樣子**——教材上印什麼就記什麼，不要腦補、不要潤稿
- 版面會騙人（元素互相遮擋、換行、裁切）。判「缺／錯」前先換基準確認，不要直接寫進差異表

🔴 **PDF 上的簡體字是假的，不要照抄也不要開 bug。**
本機缺那幾套圓體／手寫體字型，LibreOffice 會代換成簡體字型，於是 PDF 印出
「读全文-做记号」「语词我最棒」「文章重点表」「阅读聚光灯」，連教師答案都變簡體
（体育／虽然／数据／沮丧）。**教材本身是正體，`document.xml` 是乾淨的。**
兩個 worker 各自撞到，其中一個差點把它當成教材缺陷寫進 errata。

→ 所有**文字**以 `document.xml` 為準，PDF 只負責提供文字層沒有的東西
（紅色 ☑、橘圈、版面關係）。抽完掃一次有沒有簡體專用字，有就是被字型騙了。

🔴 **PDF 也會漏掉文字層裡明明有的東西。**
有一課兩張結構圖的【 】答案（良好的睡眠／專業且規律的訓練／聽覺／嗅覺…）
**都在 `document.xml` 的文字流裡**，但 LibreOffice 轉出的 PDF 把那幾格畫成空白。
只看 PDF 會判成「這一節沒答案」。

→ 跟簡體字代換同源：**PDF 不可信的地方比想像多**。凡是 PDF 上看起來「空的、缺的、
沒印」的地方，回去查一次文字層再下結論。

🔵 **找字遊戲的圈選用幾何來「交叉驗證」，不是用來取代讀圖。**

⚠️ 這裡先更正一個我寫過的錯誤說法：我一度寫「幾何驗證要當主判準」。
有 worker 拿四課回測**數 roundRect 的個數**，四課有三課對不上目標語詞數
（11 vs 10、8 vs 9、12 vs 9），還有一課數到 0（它的格子排在標題之前）。
所以個數不能當真值。

正確的用法是：**你逐頁讀到路徑之後，把 `cells` 套回 `grid` 拼字**，
拼不回目標語詞就是哪裡錯了。這個驗得動，因為它比對的是內容不是數量。

圈是 `document.xml` 裡的 `roundRect` 圖形，有中心座標與尺寸；把群組尺寸對到
10×10 格，就能把每個框換算回「第幾列第幾欄」，跟你從格子推的路徑逐一對照。

### 個數只能當**單向**警報，而且要先扣掉紙外的殘留

2026-08-18 回測 17 課（只數 `<wp:anchor>` 裡的 `roundRect`，不是全文件）：

| | |
|---|---|
| 扣掉紙外後 **等於**圈選路徑數 | 4 課 |
| 扣掉後 **少於** | 13 課 — 圈選常用別種圖形畫，roundRect 不是全部 |
| 扣掉後 **多於** | **0 課** |

→ 可用的規則只有一條方向：**紙上 roundRect > 圈選路徑數 ⇒ 少抓了一條，去查**。
反過來（少於）什麼都不代表，不要當缺陷。

**紙外殘留怎麼認**：看那個 anchor 的 `<wp:positionH relativeFrom="X"><wp:posOffset>`，
把 `rightMargin` 之類的基準加回去換算成距頁左的絕對位置，**超過頁寬（A4 直式 8.27in
＝ 7563600 EMU）就是印不出來的殘留**。L0069 那個第 10 個框錨在距頁左 13.0in，
而且框線寫死 `E97132`、其餘九個都是佈景色 `accent2` —— 它從來沒被印出來過。

⚠️ **這個過濾正是「>」方向可信的前提**：不扣紙外的話，L0069（10 vs 9）、
L0061（11 vs 10）、L0035（12 vs 11）三課都會誤報 —— 那正是當初讓我放棄
幾何檢查的那種雜訊。

這條在兩種情況下是唯一可靠的做法：
- **格子跨頁**：圈是同一個群組，分頁時整組留在前一頁 → 只看後半頁會判成「這課沒圈任何答案」
- **框的顏色不一致**：有一課 11 個框裡 1 個是黑色（其餘 accent2），顏色不同不代表它不是答案

### ⑤ 總表欄位（不經 LLM）

`$SOT/自學教材總表0812.xlsx`，分頁 `1.總表`／`2.體育生的品格教材`／`3.文言文`：

| 欄 | 用途 |
|---|---|
| 適用年級 + 課次 | `catalog_slot`（`G6-L5`／`體-L3`／`文-L1`） |
| 課名 | 對照 `lesson.yml` 的 title |
| 議題 | intro 的「本課圍繞「X」」；**空白就是空白，不要編** |
| 閱讀聚光燈策略 | strategy |
| 第六大題標題 | spotlight 的 strategy_name |
| 語詞1~14 | vocabulary_bank |

⚠️ 儲存格含 variation selector（`\U000E01xx`）等隱藏字元，比對前先過濾
（`unicodedata.category` 屬 `Cf`/`Mn` 的丟掉）。

### ⑥ truth.yml

骨架見 `qa/content-evidence/2026-08-17-truth-L0072/truth.yml`。
欄位命名刻意貼近現行 artifacts 以便逐項比對。

必含：`meta` / `sections_present`（教材印的一~九）/ 每個大題一個區塊 /
`⚠️` 註記標出現行產物缺或錯的地方。

**每個大題都要出現**，包含現行產物完全沒有的（語詞應用、詞語複習）——
差異表要看得出「整節沒產出」。

### ⑥.5 block type 是**封閉清單**，不可以自己發明

聚光燈的 `blocks[].type` 只能用下面這 14 個。看到教材上有新花樣，**用最接近的既有型別裝**，
不要造新名字。

| type | 裝什麼 |
|---|---|
| `concept_box` | 策略說明框（每課開場的教學說明） |
| `guide` | 段落標題／指示語（「一、找出課文中的A和B」「◎小試身手」） |
| `passage` | 引用的文本段落（`paragraphs: []`） |
| `single` | 單選（`prompt` + `options[]` + `answer`） |
| `multi` | 複選 |
| `free_text` | 自由書寫（必須有 `prompt`） |
| `fill_table` | 填空表格 |
| `table` | 純資訊表格（`rows: [[…]]`） |
| `figure` | 圖（必須有 `referent`） |
| `self_check` | 自我檢核清單 |
| `ordering` | 排序題 |
| `sub_block` | 巢狀小題（可遞迴 `items[]`） |
| `exercise` | 小試身手容器（`option_bank` + `items[]`） |
| `matching` | 連連看（`left` / `right` / `answer`） |

**常見的錯誤命名 → 該用什麼**

| 你想寫的 | 改用 |
|---|---|
| `multi_select` / `multi_choice` | `multi` |
| `choice_group` | `single` 或 `multi`（看單複選） |
| `definition_list` / `example_chain` | `table` 或 `sub_block` |
| `inference_table` / `thought_emotion_table` | `fill_table`（有填空）或 `table` |
| `conclusion` / `closing_box` | `guide`（純文字結語）或 `concept_box` |
| `matching_with_inference` | `matching` |
| `challenge` | `sub_block` |

**為什麼是封閉的**：每個 type 都要有一個 React 元件才畫得出來
（`frontend/src/components/reading-spotlight/BlockSequenceRenderer.tsx`）。
發明一個新名字＝製造一個畫不出來的 block，而且它不會報錯，只是在畫面上消失。
`scripts/render_coverage_gate.py` 會抓，但那是最後一道網，不是設計。

型別放不下的細節寫進欄位（`label` / `note` / `instruction`），不要寫進型別名。

### ⑥.55 段號以**學習單印出來的**為準，未編號的引言另存

課文段落的 `idx` 必須對齊學習單印出來的段號（常是獨立一欄的 `ㄧ二三四五六七`）。
念順順的 `☞` 用那個號碼索引，差一號就會唸到錯的段落（#2555 整批 bug 的形狀）。

有些課在段號欄**之外**還印了一段引言（L0124 的「前言：植物是植物，肉是肉…」）。

```yaml
body:
  preface: 前言：植物是植物，肉是肉，但你聽說過…    # 未編號的引言，獨立欄位
  paragraph_count: 7                                # 只數有編號的
  paragraphs:
    - idx: 1
      text: 近年來，一種由植物製成…                  # 印著「ㄧ」的那一段
```

⛔ **不要把引言併成第 1 段**（v2 就是這樣，導致印著「四☞」的目標實際指到第 3 段）。
⛔ **也不要因為它沒編號就不抽**——L0124 的 v3 整段沒抽到，逐字門 PASS、拆模組成功、
前端畫得出來，沒有任何一道檢查在看這件事。`scripts/coverage_gate.py` 現在會抓。

怎麼分辨：看 DOCX 表格列。段號那一欄是**一個儲存格裝多個號碼**，跟它同列的才是
編號段落；引言自己一列，旁邊配的是「字數」表頭。

### ⑥.53 題幹欄位：聚光燈用 `prompt`，其他大題用 `stem`

**不是統一用一個。** 兩邊的消費端不同，寫錯會靜默變空字串：

| 位置 | 欄位 | 誰在讀 |
|---|---|---|
| `spotlight.blocks[]` | **`prompt`** | `BlockSequenceRenderer.tsx` |
| `comprehension.items[]` | **`stem`** | `lesson_indexes.py:226` → `q.get("stem", "")` |
| `vocab_application.items[]` | **`stem`** | `lesson_indexes.py:176` → `q.get("stem") or q.get("text")` |

⚠️ 我一度在派工單上寫「題幹一律用 `prompt`」，那是錯的 —— 照著改會讓閱讀理解與
語詞應用的題目在畫面上變成空白，而且**不會報錯**（`.get("stem", "")` 回空字串）。
是 worker 回頭查了 service 才擋下來。前 28 課都是 `stem`，維持不動。

### ⑥.54 沒有標準答案的題目要標出來

有些題目學習單上**本來就沒有 ☑** —— 自我覺察類的「哪些是你認同的？」「選出你有過的
感覺」「下列哪些情境你會吃醋？」。情緒覺察、品格力那幾個單元整課都是這種。

```yaml
- type: multi
  prompt: ※吃醋可能混合多種情緒，請從下列中選出你有過的感覺：（可複選）
  options: {1: 生氣, 2: 難過, 3: 羞愧}
  no_correct_answer: true          # ← 這一行
  answer_carrier: 學生自填，原稿無勾選
```

兩個都不可以：

- ⛔ **硬塞一個答案** —— 那是編造，而且看起來跟真答案一模一樣，之後沒人分得出來
- ⛔ **留白不標** —— contract 會把它算進「答案沒抓到」，`answer_recall` 掉下去、整課被擋

判準只有一個：**圖上那題有沒有勾**。沒有勾就標。

⚠️ 順帶一個常見的型別錯用：`self_check` 專指「我做到了嗎」的檢核清單，
`items` 是一串文字（`["1.我能找出文章的大主題", …]`）。
**帶 `options` 的選擇題不是 self_check**，那是 `multi` 或 `single`。

### ⑥.55b 文章重點表：**只有兩種佈局，選一種**

⚠️ 這一節是 2026-08-17 補的，因為前 19 課寫出了 **9 種不同結構**（label/value、
欄位式、items、sub_rows、sub_table、options…）。每多一種，前端就要多接一層；
接不到的那一種**不會報錯**，只是整張表變空的，學生看到空表格也不能作答。
聚光燈的型別是封閉清單，重點表卻一直沒規定 —— 所以它一路漂。

先看學習單印的是哪一種，然後照抄下面對應的骨架。**不要混用、不要自創第三種。**

**佈局 A — 條列式**（左邊是項目名，右邊是內容。多數課是這種）

```yaml
keypoints:
  title: 贏得喝采的輸家          # 表格上方印的標題
  layout: list                  # 必填，只能是 list 或 matrix
  rows:
    - label: 主角
      value: 【　】
      blanks: [{answer: 戴資穎}]          # 空格答案，照 value 裡 【　】 的順序
    - label: 挫折事件
      items:                              # 這一項底下還有小題才用 items
        - label: 雅加達亞運
          value: 比賽結果是（單選）
          options: {1: 驕傲地奪得銀牌, 2: 以微小差距與金牌擦身而過}
          answer: 2                       # 單選填數字；複選填 answers: [1, 3]
```

**佈局 B — 矩陣式**（有欄位表頭，每列在各欄都有內容）

```yaml
keypoints:
  title: 感情小日記2──喜歡是什麼？
  layout: matrix
  columns: [段落, 事件, 感受]      # 照教材印的欄名，**由左到右**
  rows:
    - 段落: 二                     # key **必須跟 columns 完全一樣**（見下）
      事件: 上課時因為太在意他而分心
      感受: 【　】
      感受_blanks: [{answer: 緊張}]        # 旁掛欄位＝`{欄名}_blanks`
      事件_options: {1: 分心, 2: 專心}      # 選項＝`{欄名}_options`
      事件_answer: 1
```

🔴 **key 一定要跟 `columns` 逐字相同**。L0004 的 `columns` 寫中文（段落／事件／感受）
但 row 的 key 寫英文（paragraph／event／feeling），照名字一個都查不到，
**整張表變成空的而且不報錯** —— 這是這一節存在的主因。

**兩種佈局共用的規則**

| 要表達 | 怎麼寫 |
|---|---|
| 學生要填的空格 | 內容寫 `【　】`（全形空格），答案放 `blanks: [{answer: …}]`，順序對應 |
| 單選 | `options: {1: …, 2: …}` + `answer: 2` |
| 複選 | `options: {…}` + `answers: [1, 3]` |
| 答案來自紅色 ☑（圖形層） | 照常寫進 `answer`，另加 `answer_carrier: 紅色 ☑（圖形），文字流無此資訊` |
| 表格下方的星號題 | `tail_question: {star: true, stem: …, options: {…}, answers: [...]}` |
| 某列末尾多一句帶空格的結語 | `tail: …【　】。` + `tail_blank: {answer: …}` |

⛔ 不要用 `sub_rows`、`sub_items`、`sub_table`、`structure: nested` ——
那些是前 19 課各自發明的，橋接器為了不丟資料才容忍，**新抽的課一律不要用**。
三層以上的巢狀就攤平成 `items`，層級關係寫進 `label`（例：`4-1`、`4-2`）。

### ⑥.7 念順順的「字數」欄有兩條 Word 口徑，不要拿它反推段界

右緣那欄累計字數是 **Word 自己算的**，有兩條口徑跟直覺不同：

1. **一串阿拉伯數字算 1 個字**（「1925」算 1 不算 4）。有一課第 3 段實際 230 字，
   含 1925 與 28 兩串，Word 算 226 —— 正好是印出來的數字。
2. **註腳文字會被算進去**。有一課末筆印 389 但第 1 段只有 362 字，
   差的 27 正是註腳「黃曆：又叫做農民曆…」的長度。佐證在中間的異常跳躍
   （148→204 一次跳 56，而一行只有約 30 字）。
3. **不佔段號的分節小標也算進去**。有一課課文中間有四個加框小標，
   第 3 段 165 字 + 小標「寄生蜂片」4 字 = 169，正好是印出來的下一個數字；
   再加第 4 段 208 = 377 = 最後一個數字，兩端精準。

⚠️ 之前有三課因為對不上而被標成 `span_confidence: medium`，其實是口徑差異不是抓錯段落。

另外兩個常見形狀（都是原稿如此，不是漏抽）：
- **字數欄只標到倒數第二段就停了**（已出現 5 課）。最後一個數字**不是全文長度**。
- **數字欄在 PDF 上整體上移一到兩行**，不能照「號碼旁邊那一行」對位。
  要對位就用交叉驗證：第一個數字通常等於 ☞ 那一行的字數。

### ⑥.6 幾個非聚光燈的固定形狀

封閉清單管的是 `spotlight.blocks[].type`。**別的大題也會漂**——同一件事三個人寫三種
形狀，消費端就要寫三套。已經固定下來的：

**詞語複習（找字遊戲）`vocab_review.type: word_search`**

```yaml
vocab_review:
  type: word_search
  instruction: 找一找：請圈出格子內的語詞…
  target_words: [嘲弄, 調侃, 歉疚]
  grid_size: [10, 10]
  grid:                                  # 每列**一個字串**，不是字元 list
    - 瓦礫小心翼翼翻騰本顫
    - 敢怒力不從心稻收顫忐
  answers_are_graphical: true            # 答案是畫上去的圈，文字層沒有
  answer_paths:                          # 沒圈到／沒轉錄就整個省略，不要寫空 list
    - word: 小心翼翼
      cells: [[1, 3], [1, 4], [1, 5], [1, 6]]   # 1-based [列, 欄]，逐格列出
      direction: horizontal
```

`direction` 只有這幾個值：`horizontal` `vertical` `diagonal_down_right`
`diagonal_down_left` `diagonal_up_right` `diagonal_up_left`。

🔴 **格子印錯字是這批教材的通例，不是個案**（目前 4 課：突發**其**想／朝思**慕**想／
愧**咎**／堅不可**催**，全是同音或形近字，而且都藏在格子裡不在詞庫）。

判準：**只要 roundRect 數 ≠ `answer_paths` 數，就回頭逐格取字**，
⛔ 不要把座標塞進去湊數。那一條會拼不回目標語詞，`normalize_word_search` 會 FAIL
而且看不出原因。

格子錯字的處理：`word` 寫**格子實際拼得出來的字**（座標門要的是這個），
目標語詞寫進 `intended_word_note`，並登錄 `source_errata`（kind: 格子錯字）。
如果那個語詞在格子裡**根本沒有正確拼法**（L0039 就是），
`answer_paths` 就少列那一條 + `answers_printed: partial` + `answer_note`。

⚠️ 逐字門**不會**檢查 `answer_paths`（那些字是從座標算出來的不是抄的），
所以不用擔心兩道門打架 —— 那個衝突已經修掉了。

⛔ **不要寫 `起點: 第1列第3欄` 這種散文**：那句話原稿上沒有，逐字門會判 FAIL——
而它判得對，因為那是你算出來的，不是教材印的。中文欄名（`方向` / `起點`）同樣不要用。

⛔ 也不要只寫起點省略中間格。逐格列出才驗得到：`scripts/normalize_word_search.py`
會把 `cells` 套回 `grid` 取字，**拼不回 word 就 FAIL**。這是整個找字遊戲唯一的
正確性檢查——答案在圖片像素裡，除此之外沒有第二個地方可以對。

```bash
python3 scripts/normalize_word_search.py --check    # 交件前必跑

# top-level key 有沒有人搬（2026-08-18 新增）
python3 scripts/orphan_key_gate.py
```

### ⑦ 交件前必跑的門（全部都要綠，缺一不可交）

```bash
python3 scripts/verbatim_gate.py --yaml <抽出的.yml> --docx <原稿.docx>  # 抄得對嗎
python3 scripts/coverage_gate.py --uid <UID>                            # 有沒有漏抄
python3 scripts/normalize_block_types.py --check                        # 型別在清單內嗎
python3 scripts/normalize_word_search.py --check                        # 找字座標對嗎
python3 scripts/traditional_only_gate.py --uid <UID>                    # 有沒有簡體字
```

| 道 | 檢查 | 抓什麼 | 抓不到什麼 |
|---|---|---|---|
| 1 | JSON/YAML schema：欄位、型別、必填 | 結構跑掉 | |
| 2 | 契約：`answer ∈ options`、答案不出現在題幹、索引連續 | 語意矛盾 | |
| 3 | **逐字比對** `verbatim_gate.py` | 潤稿、看錯字形、改到原稿 | **漏抄**（少一段，剩下的字還是對的）|
| 4 | **覆蓋率** `coverage_gate.py` | 整段課文沒抽到 | 課文以外的漏抄（見下）|
| 5 | **型別清單** `normalize_block_types.py` | 發明型別、YAML 裸 `no:` 陷阱 | |
| 6 | **找字座標** `normalize_word_search.py` | 圈選答案的座標轉錯 | |
| 7 | **正體字** `traditional_only_gate.py` | 照 PDF 抄到被字型換掉的字形 | 圖上的字（`text_carrier: image`）|

⚠️ **測第 7 道門的時候，不要拿正簡兩用的字當 mutation**。有 worker 用「响」
去測，門 PASS，他一度以為門是壞的 —— 實際上「响」有原稿用過、本來就在字集裡。
判準是「全庫用過的字」不是簡繁分類，要測就用字集外的字（例如「读」）。

第 7 道的判準是**全庫 175 份原稿的用字聯集**，不是手維護的簡體字清單 ——
我試過手打清單三輪，每輪都混進正體字（只／起／里／干／累），每輪都讓一整批
正確的課被判 FAIL。**判準錯的門比沒有門更糟**：它會叫人去改沒有壞的東西。
語料推導還會自動處理灰色地帶：「拮据」的「据」、引用頻道名「有点意思」的「点」
都在原稿裡，所以不會被誤報。

**第 3、4 道互為表裡**：3 問「寫下來的對嗎」，4 問「該寫的寫了嗎」。
只有 3 的時候，L0124 少抄一整段課文照樣 PASS —— 剩下的每個字都是對的。

⚠️ 第 4 道目前**只管課文**。其他大題的完整性還沒有可靠的判準（v2 是平的、v3 是
巢狀的，任何比「字串接起來長什麼樣」的做法都會把排版差異報成內容遺失 ——
試過三種寫法都在量相鄰關係，見 `coverage_gate.py` 的檔頭）。所以那些大題目前
**靠逐頁讀 PDF 的紀律，不靠機器**：④ 那條「每一頁都要讀，不抽樣」是這個缺口的擋箭牌。

```bash
python3 scripts/verbatim_gate.py --yaml <抽出的.yml> --docx <原稿.docx>
# 退出碼 0 = PASS，1 = FAIL；--json 可存報告
```

L0124 實測：受檢 106 個字串 **抓出 10 個真錯、0 假陽性**——

| 我抽出的 | 原稿 | 類型 |
|---|---|---|
| 不分軒**輕**（4 處） | 不分軒**輊** | 看錯字形 |
| 熱帶雨林**不只不會**讓我們… | **不只會** | 多一個否定詞，句意相反 |
| 把灰框內的語詞**刪**掉 | **劃**掉 | 抄錯字 |
| 先**猜猜**標題 | 先**猜測**標題 | 潤稿 |
| 使用語詞正確**？** | **?**（半形） | 標點 |
| 素肉**，**最強調 | 素肉**，，**最強調 | **擅自修掉原稿的排版錯** |

### 原稿本身印錯時怎麼記（⚠️ 不要跟著錯）

教材是人做的，會有錯字、漏字、重複標點。**明顯的錯要改正，但原樣要留下來**，
否則線上會出現錯字，而且逐字門會把「我們刻意做的修正」誤報成抽錯。

三件事一起做：

```yaml
source_errata:                       # 課級清單，寫在 meta 之後
  - id: E1
    section: 一 讀全文-做記號
    locator: 第 1 段句末
    source: 許多動物發展出各種讓人驚嘆竹的各種生存妙招。
    corrected: 許多動物發展出各種讓人驚嘆的生存妙招。
    kind: 贅字＋語詞重複
    why: 「驚嘆」後多一個「竹」字；且「各種」在同一句出現兩次
    confidence: high
    evidence: PDF p1 與 document.xml 一致

paragraphs:
  - idx: 1
    text: …讓人驚嘆的生存妙招。          # 修正後，線上用這個
    source_text: …讓人驚嘆竹的各種生存妙招。  # 原稿原樣，逐字門比對這個
    errata_ref: E1
```

- 同名式 `source_text` ↔ `text`，前綴式 `stem_source_text` ↔ `stem`，兩種都支援
- 逐字門看到 `X_source_text` 就自動跳過 `X`
- 彙整全庫：`python3 scripts/collect_errata.py`（`--format json/csv`、`--kind 錯字`）

**判準**：改的是**教材印錯**（錯字/漏字/重複標點）才進 errata；
自己讀錯字形、潤稿、多打字 **不是勘誤，是抽錯**，直接改掉不要記進來。
分不清就看原稿 —— 原稿有的是我的錯，原稿沒有的才是教材的錯。

> 這道門也會誤報，修過兩個洞才乾淨：
> ① 填空符號 `（　）`【　】要當**斷點**切段比對，直接刪掉會把兩側接成原稿不存在的字串
> ② 課文以外的文字散在 `footnotes.xml` / `endnotes.xml`，只讀 `document.xml` 會誤報註腳
> ③ 破折號 `──／—／–` 在兩邊常互換，要正規化
> 這三個都已內建在腳本裡。**新的誤報要修腳本，不要改 YAML 去迎合它。**

### ⑧ diff.md

以**大題**為單位（教材印的一~九），分三欄：完全正確／有缺陷／整節沒產出。

⛔ **不要用「細項數」算百分比** —— 粒度由你決定，數字會隨切法浮動
（L0072 就出現過：聚光燈拆 19 項、詞語複習算 1 項 → 46% 這個數字不可信）。

每個落差都要標：**DOCX 裡有沒有**。
「有料沒抽到」和「來源缺料」是兩種完全不同的問題，不可混為一談。

---

## 計時與成本（必量，不估）

每次跑都記進 `qa/content-evidence/<date>-truth-<UID>/run.json`：

```json
{
  "lesson_uid": "L0072",
  "pdf_pages": 9,
  "pages_read": 9,
  "wall_clock_seconds": null,
  "read_calls": 2,
  "gate_failures": {"schema": 0, "contract": 0, "verbatim": 0},
  "retries": 0
}
```

⛔ 沒量過就寫「未量測」，**不要給估計數字**。

---

## 反模式

- ❌ 抽樣讀（只讀有題目的頁）—— 缺漏就是這樣產生的
- ❌ 拿 archive 裡的一修 DOCX 當來源
- ❌ 新增形狀啟發式
- ❌ 用細項數算正確率
- ❌ 把「總表議題欄空白」報成抽取 bug
- ❌ 讀到 `spotlight.blocks: []` 就說「聚光燈整節抓不到是通病」——全庫只有 7/175 課空
- ❌ 沒確認工作樹 == HEAD 就量 repo 側數字（2026-08-17 因此產生假警報）

---

## 相關

- PRD `docs/prd/2026-08-17-multimodal-extraction.md`
- 第一份真值 `qa/content-evidence/2026-08-17-truth-L0072/`
- SOT `private/curriculum-source/_SOT/STAMP.md`
- issue #2736（本 skill 來源）／#2735（答案被改）／#2720（錨點誤當索引）／#2683（二修 re-ink）
