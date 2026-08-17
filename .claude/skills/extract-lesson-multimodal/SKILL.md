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
| DOCX 圖形層（☑ 勾選答案、圈選） | **讀不到** | `☑` 在文字流出現 0 次的課：**169/175** |
| DOCX 版面關係（☞ 錨點、印刷段號） | 誤當索引 | #2720 |
| 系統合成（intro） | 拼總表 | 短版 68 課 ⟺ 總表議題欄空 68 課 |

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
soffice --headless --convert-to pdf --outdir $W $W/src.docx
cd $W && unzip -o -q src.docx word/document.xml
python3 -c "import fitz;d=fitz.open('$W/src.pdf');print('pages',d.page_count)"
```

### ④ 逐頁讀 PDF ← 主抽取

用 `Read` 工具帶 `pages`（單次上限 20 頁，教材多為 6~12 頁）。

**鐵律**：
- **每一頁都要讀**，不抽樣。頁數要在報告裡寫成 `9/9`
- 紅色 `☑`／橘色圈選／框線 **就是教師版答案**，這是多模態存在的理由，逐一記下
- 看到的是**印出來的樣子**——教材上印什麼就記什麼，不要腦補、不要潤稿
- 版面會騙人（元素互相遮擋、換行、裁切）。判「缺／錯」前先換基準確認，不要直接寫進差異表

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

### ⑦ 三道格式門

| 道 | 檢查 | 抓什麼 |
|---|---|---|
| 1 | JSON/YAML schema：欄位、型別、必填 | 結構跑掉 |
| 2 | 契約：`answer ∈ options`、答案不出現在題幹、索引連續 | 語意矛盾 |
| 3 | **逐字比對**（`scripts/verbatim_gate.py`） | LLM 潤稿、看錯字形、漏字 |

**第 3 道是強制的，不是選配。**

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
